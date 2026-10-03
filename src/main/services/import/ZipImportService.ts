import { createWriteStream, promises as fs } from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { pipeline } from 'node:stream/promises'
import { Transform } from 'node:stream'
import { shell } from 'electron'
import yauzl from 'yauzl'
import type { LibraryEntry, Track, ZipImportRequest, ZipPreview, ZipTrackCandidate } from '../../../shared/types'
import { isSupportedAudioFile } from '../../../shared/audioFormats'
import { AppException } from '../../errors'
import { buildSong, TRACKS_DIR, uniqueFilePath, type LibraryService } from '../library/LibraryService'
import { sniffFile } from '../library/audioSniff'
import { guessTrack } from '../library/trackNaming'

/** Límites contra ZIPs maliciosos o absurdos ("zip bombs"). */
const MAX_ENTRY_BYTES = 4 * 1024 ** 3
const MAX_TOTAL_BYTES = 16 * 1024 ** 3
const MAX_ENTRIES = 5000

interface PendingImport {
  zipPath: string
  candidates: Map<string, ZipTrackCandidate>
}

/**
 * Importación en dos pasos:
 *   1. inspect(): lee solo el índice del ZIP y propone nombre y pistas (no escribe nada).
 *   2. commit(): extrae las pistas elegidas a ".import-<uuid>" dentro de la biblioteca, valida cada
 *      archivo y, solo si todo fue bien, renombra la carpeta temporal a su nombre final.
 * Así nunca queda una canción a medio importar. Nada del ZIP se ejecuta: solo se copian bytes de audio.
 */
export class ZipImportService {
  private pending = new Map<string, PendingImport>()

  constructor(private readonly library: LibraryService) {}

  async inspect(zipPath: string): Promise<ZipPreview> {
    await this.library.root()
    const zip = await openZip(zipPath)
    const candidates: ZipTrackCandidate[] = []
    const ignored: string[] = []
    let count = 0

    try {
      await forEachEntry(zip, async (entry) => {
        if (++count > MAX_ENTRIES) throw new AppException('INVALID_ZIP', 'El ZIP contiene demasiados archivos.')
        const name = entry.fileName
        if (name.endsWith('/')) return // carpeta
        const segments = name.split('/')
        const fileName = segments[segments.length - 1]!
        if (!isSafeEntryName(name)) {
          ignored.push(`${name} (ruta no segura)`)
          return
        }
        if (segments.some((s) => s.startsWith('.') || s === '__MACOSX')) return // basura de macOS / ocultos
        if (!isSupportedAudioFile(fileName)) {
          ignored.push(name)
          return
        }
        if ((entry.generalPurposeBitFlag & 0x1) !== 0) {
          ignored.push(`${name} (cifrado)`)
          return
        }
        if (entry.uncompressedSize > MAX_ENTRY_BYTES) {
          ignored.push(`${name} (demasiado grande)`)
          return
        }
        const guess = guessTrack(fileName)
        candidates.push({
          entryName: name,
          fileName,
          suggestedName: guess.name,
          suggestedType: guess.type,
          size: entry.uncompressedSize
        })
      })
    } finally {
      zip.close()
    }

    if (count === 0) throw new AppException('EMPTY_ZIP', 'El archivo ZIP está vacío.')
    if (candidates.length === 0) {
      throw new AppException('NO_AUDIO_IN_ZIP', 'El ZIP no contiene archivos de audio compatibles (WAV o MP3).')
    }

    candidates.sort((a, b) => a.entryName.localeCompare(b.entryName, 'es', { numeric: true }))
    const suggestedName = suggestSongName(zipPath, candidates)
    const duplicate = await this.library.findDuplicate(suggestedName)
    const importId = randomUUID()
    this.pending.set(importId, { zipPath, candidates: new Map(candidates.map((c) => [c.entryName, c])) })

    return {
      importId,
      zipFileName: path.basename(zipPath),
      suggestedName,
      tracks: candidates,
      ignored,
      duplicateOf: duplicate ? { id: duplicate.id, name: duplicate.name } : undefined
    }
  }

  cancel(importId: string): void {
    this.pending.delete(importId)
  }

  async commit(req: ZipImportRequest): Promise<LibraryEntry> {
    const pending = this.pending.get(req.importId)
    if (!pending) throw new AppException('NOT_FOUND', 'La importación expiró. Vuelve a elegir el ZIP.')
    const name = req.name.trim()
    if (!name) throw new AppException('UNKNOWN', 'La canción necesita un nombre.')
    if (req.tracks.length === 0) throw new AppException('NO_AUDIO_IN_ZIP', 'Selecciona al menos una pista.')
    for (const t of req.tracks) {
      if (!pending.candidates.has(t.entryName)) throw new AppException('INVALID_PATH', 'Pista no válida en la solicitud.')
    }

    const existing = req.replaceSongId ? await this.library.getEntry(req.replaceSongId) : undefined
    const dup = await this.library.findDuplicate(name, existing?.song.id)
    if (dup) throw new AppException('DUPLICATE_SONG', `Ya existe una canción llamada "${dup.name}". Usa "Reimportar" en esa canción.`)

    const root = await this.library.root()
    const staging = path.join(root, `.import-${randomUUID()}`)
    await fs.mkdir(path.join(staging, TRACKS_DIR), { recursive: true })

    try {
      const files = await extractEntries(pending.zipPath, new Set(req.tracks.map((t) => t.entryName)), path.join(staging, TRACKS_DIR))
      const tracks: Track[] = req.tracks.map((t) => ({
        id: randomUUID(),
        name: t.name.trim() || pending.candidates.get(t.entryName)!.suggestedName,
        type: t.type,
        file: `${TRACKS_DIR}/${files.get(t.entryName)!}`,
        volume: 1,
        muted: false
      }))

      const song = buildSong({ id: existing?.song.id, name, artist: req.artist.trim(), tracks })
      if (existing) {
        // Reimportar conserva identidad y vínculo con Holyrics; las marcas de tiempo siguen siendo válidas
        // si la canción es la misma grabación.
        song.holyrics = existing.song.holyrics
        song.createdAt = existing.song.createdAt
        song.bpm = existing.song.bpm
        song.key = existing.song.key
      }
      await this.library.writeSong(staging, song)

      let folderName: string
      if (existing) {
        folderName = existing.folderName
        await swapFolders(root, folderName, staging)
      } else {
        folderName = await this.library.uniqueFolderName(name)
        await fs.rename(staging, path.join(root, folderName))
      }
      this.pending.delete(req.importId)
      return await this.library.getEntry(song.id)
    } catch (err) {
      await fs.rm(staging, { recursive: true, force: true }).catch(() => undefined)
      throw err
    }
  }
}

// ---------------------------------------------------------------------------

/** Rechaza rutas absolutas, con unidad, con ".." o con caracteres de control. */
function isSafeEntryName(name: string): boolean {
  if (name.includes('\\') || name.includes('\0') || /[\u0000-\u001f]/.test(name)) return false
  if (name.startsWith('/') || /^[a-zA-Z]:/.test(name)) return false
  return !name.split('/').some((s) => s === '..')
}

/** Carpeta común de los audios (si no es "tracks") o, si no, el nombre del ZIP. */
function suggestSongName(zipPath: string, candidates: ZipTrackCandidate[]): string {
  const firstSegments = new Set(candidates.map((c) => (c.entryName.includes('/') ? c.entryName.split('/')[0] : '')))
  if (firstSegments.size === 1) {
    const [folder] = [...firstSegments]
    if (folder && folder.toLowerCase() !== 'tracks') return folder.trim()
  }
  return path
    .basename(zipPath, path.extname(zipPath))
    .replace(/^canci[oó]n[_\s-]+/i, '')
    .replace(/[_]+/g, ' ')
    .trim()
}

function openZip(zipPath: string): Promise<yauzl.ZipFile> {
  return new Promise((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true, autoClose: false, validateEntrySizes: true }, (err, zip) => {
      if (err || !zip) {
        reject(new AppException('INVALID_ZIP', 'El archivo no es un ZIP válido o está dañado.'))
        return
      }
      resolve(zip)
    })
  })
}

function forEachEntry(zip: yauzl.ZipFile, onEntry: (e: yauzl.Entry) => Promise<void> | void): Promise<void> {
  return new Promise((resolve, reject) => {
    zip.on('entry', (entry: yauzl.Entry) => {
      Promise.resolve(onEntry(entry)).then(
        () => zip.readEntry(),
        (err) => reject(err)
      )
    })
    zip.on('end', () => resolve())
    zip.on('error', (err: Error) => {
      // yauzl valida los nombres y rechaza rutas absolutas o con ".." (path traversal).
      if (/absolute path|invalid relative path|invalid characters/i.test(err?.message ?? '')) {
        reject(new AppException('INVALID_ZIP', 'El ZIP contiene rutas no seguras (fuera de su carpeta) y se rechazó por seguridad.'))
      } else {
        reject(new AppException('INVALID_ZIP', 'El ZIP está dañado y no se pudo leer completo.'))
      }
    })
    zip.readEntry()
  })
}

/** Extrae solo las entradas pedidas. Devuelve entryName → nombre de archivo final. */
async function extractEntries(zipPath: string, wanted: Set<string>, destDir: string): Promise<Map<string, string>> {
  const zip = await openZip(zipPath)
  const out = new Map<string, string>()
  let total = 0
  try {
    await forEachEntry(zip, async (entry) => {
      if (!wanted.has(entry.fileName)) return
      const fileName = entry.fileName.split('/').pop()!
      const target = await uniqueFilePath(destDir, fileName)
      // Contador real de bytes: no se confía en el tamaño declarado en el ZIP.
      const limiter = new Transform({
        transform(chunk: Buffer, _enc, cb) {
          total += chunk.length
          if (total > MAX_TOTAL_BYTES) cb(new AppException('INVALID_ZIP', 'El contenido del ZIP es demasiado grande.'))
          else cb(null, chunk)
        }
      })
      const stream = await new Promise<NodeJS.ReadableStream>((resolve, reject) =>
        zip.openReadStream(entry, (err, s) => (err || !s ? reject(err) : resolve(s)))
      ).catch(() => {
        throw new AppException('INVALID_ZIP', `No se pudo leer "${fileName}" dentro del ZIP (¿dañado?).`)
      })
      try {
        await pipeline(stream, limiter, createWriteStream(target, { flags: 'wx' }))
      } catch (err) {
        if (err instanceof AppException) throw err
        throw new AppException('INVALID_ZIP', `Error al extraer "${fileName}": el archivo está dañado.`)
      }
      if (!(await sniffFile(target))) {
        throw new AppException('UNSUPPORTED_FORMAT', `"${fileName}" no es un archivo de audio válido o está dañado.`)
      }
      out.set(entry.fileName, path.basename(target))
    })
  } finally {
    zip.close()
  }
  const missing = [...wanted].filter((w) => !out.has(w))
  if (missing.length) throw new AppException('INVALID_ZIP', `No se encontraron en el ZIP: ${missing.join(', ')}`)
  return out
}

/**
 * Reimportación: la carpeta nueva sustituye a la existente.
 * old → ".old-<uuid>", staging → nombre definitivo, y la carpeta antigua va a la Papelera.
 * Si el segundo paso falla, se restaura la carpeta original.
 */
async function swapFolders(root: string, folderName: string, staging: string): Promise<void> {
  const current = path.join(root, folderName)
  const backup = path.join(root, `.old-${randomUUID()}`)
  try {
    await fs.rename(current, backup)
  } catch {
    throw new AppException('FILE_LOCKED', 'La carpeta de la canción está en uso (¿abierta en el Explorador o en reproducción?).')
  }
  try {
    await fs.rename(staging, current)
  } catch (err) {
    await fs.rename(backup, current).catch(() => undefined)
    throw err
  }
  // La carpeta oculta ".old-*" no aparece en la biblioteca aunque no se pueda enviar a la Papelera.
  await shell.trashItem(backup).catch((e) => console.warn('[gosen] no se pudo enviar a la Papelera', backup, e))
}
