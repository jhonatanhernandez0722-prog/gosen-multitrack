import { promises as fs, constants as fsConstants } from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { shell } from 'electron'
import {
  SONG_SCHEMA_VERSION,
  type LibraryEntry,
  type LibraryScanResult,
  type Song,
  type SongPatch,
  type Track,
  type TrackType
} from '../../../shared/types'
import { isSupportedAudioFile } from '../../../shared/audioFormats'
import { AppException } from '../../errors'
import { resolveInside, sanitizeFileName } from '../../fs/safePath'
import { writeJsonAtomic } from '../../fs/atomicWrite'
import type { ConfigService } from '../ConfigService'
import { parseSong } from './songSchema'
import { sniffFile } from './audioSniff'
import { guessTrack } from './trackNaming'

export const SONG_FILE = 'song.json'
export const TRACKS_DIR = 'tracks'

const TRACK_TYPES: readonly TrackType[] = [
  'drums', 'percussion', 'bass', 'guitar', 'keys', 'synth', 'vocals', 'choir', 'click', 'guide', 'other'
]

/**
 * Biblioteca local: cada subcarpeta de MusicLibrary con un song.json es una canción.
 * El disco es la fuente de verdad; no hay base de datos aparte que pueda desincronizarse.
 * Las carpetas que empiezan por "." (importaciones en curso) se ignoran.
 */
export class LibraryService {
  /** id de canción → nombre de carpeta (se reconstruye en cada scan). */
  private index = new Map<string, string>()
  /** Cola por canción para que dos escrituras de song.json nunca se pisen. */
  private locks = new Map<string, Promise<unknown>>()

  constructor(private readonly config: ConfigService) {}

  /** Carpeta raíz de la biblioteca; lanza si no está configurada o no es accesible. */
  async root(): Promise<string> {
    const root = this.config.libraryPath
    if (!root) throw new AppException('LIBRARY_NOT_CONFIGURED', 'Aún no se ha elegido la carpeta de la biblioteca.')
    try {
      const stat = await fs.stat(root)
      if (!stat.isDirectory()) throw new Error()
    } catch {
      throw new AppException('LIBRARY_UNAVAILABLE', `No se puede acceder a la carpeta de biblioteca: ${root}`)
    }
    return root
  }

  async scan(): Promise<LibraryScanResult> {
    const root = await this.root()
    const dirents = await fs.readdir(root, { withFileTypes: true })
    const result: LibraryScanResult = { entries: [], errors: [] }
    const index = new Map<string, string>()

    await Promise.all(
      dirents
        .filter((d) => d.isDirectory() && !d.name.startsWith('.'))
        .map(async (d) => {
          try {
            const entry = await this.readEntry(root, d.name)
            if (!entry) return
            if (index.has(entry.song.id)) {
              result.errors.push({
                folderName: d.name,
                message: `Tiene el mismo id que "${index.get(entry.song.id)}"; se ignora para evitar conflictos.`
              })
              return
            }
            index.set(entry.song.id, d.name)
            result.entries.push(entry)
          } catch (err) {
            result.errors.push({ folderName: d.name, message: (err as Error).message })
          }
        })
    )

    this.index = index
    result.entries.sort((a, b) => a.song.name.localeCompare(b.song.name, 'es', { sensitivity: 'base' }))
    return result
  }

  async getEntry(songId: string): Promise<LibraryEntry> {
    const root = await this.root()
    let folderName = this.index.get(songId)
    if (!folderName) {
      await this.scan()
      folderName = this.index.get(songId)
    }
    const entry = folderName ? await this.readEntry(root, folderName).catch(() => null) : null
    if (!entry || entry.song.id !== songId) {
      this.index.delete(songId)
      throw new AppException('NOT_FOUND', 'La canción ya no existe en la biblioteca (¿se borró la carpeta manualmente?).')
    }
    return entry
  }

  async folderPath(folderName: string): Promise<string> {
    return resolveInside(await this.root(), folderName)
  }

  /** Busca otra canción con el mismo nombre (sin distinguir mayúsculas ni tildes). */
  async findDuplicate(name: string, exceptId?: string): Promise<Song | undefined> {
    const key = nameKey(name)
    const { entries } = await this.scan()
    return entries.find((e) => e.song.id !== exceptId && nameKey(e.song.name) === key)?.song
  }

  /** Nombre de carpeta libre a partir del nombre de la canción ("Coro", "Coro (2)"…). */
  async uniqueFolderName(songName: string): Promise<string> {
    const root = await this.root()
    const base = sanitizeFileName(songName, 'Cancion')
    for (let i = 1; ; i++) {
      const candidate = i === 1 ? base : `${base} (${i})`
      if (!(await exists(path.join(root, candidate)))) return candidate
    }
  }

  async writeSong(folder: string, song: Song): Promise<void> {
    song.updatedAt = new Date().toISOString()
    await writeJsonAtomic(path.join(folder, SONG_FILE), song)
  }

  // -------------------------------------------------------------------------
  // Operaciones de canción
  // -------------------------------------------------------------------------

  async createSong(input: { name: string; artist: string }): Promise<LibraryEntry> {
    const name = input.name.trim()
    if (!name) throw new AppException('UNKNOWN', 'La canción necesita un nombre.')
    const dup = await this.findDuplicate(name)
    if (dup) throw new AppException('DUPLICATE_SONG', `Ya existe una canción llamada "${dup.name}".`)

    const folderName = await this.uniqueFolderName(name)
    const folder = await this.folderPath(folderName)
    await fs.mkdir(path.join(folder, TRACKS_DIR), { recursive: true })
    const song = buildSong({ name, artist: input.artist.trim(), tracks: [] })
    await this.writeSong(folder, song)
    this.index.set(song.id, folderName)
    return { song, folderName, missingTrackIds: [] }
  }

  async updateSong(songId: string, patch: SongPatch): Promise<LibraryEntry> {
    return this.withLock(songId, async () => {
      const entry = await this.getEntry(songId)
      const song = entry.song

      if (patch.name !== undefined) {
        const name = patch.name.trim()
        if (!name) throw new AppException('UNKNOWN', 'La canción necesita un nombre.')
        const dup = await this.findDuplicate(name, songId)
        if (dup) throw new AppException('DUPLICATE_SONG', `Ya existe una canción llamada "${dup.name}".`)
        song.name = name
      }
      if (patch.artist !== undefined) song.artist = patch.artist.trim()
      if (patch.bpm !== undefined) song.bpm = patch.bpm && patch.bpm > 0 ? patch.bpm : undefined
      if (patch.key !== undefined) song.key = patch.key?.trim() || undefined

      for (const t of patch.tracks ?? []) {
        const track = song.tracks.find((x) => x.id === t.id)
        if (!track) continue
        if (t.name !== undefined) track.name = t.name.trim() || track.name
        if (t.type !== undefined && TRACK_TYPES.includes(t.type)) track.type = t.type
        if (t.volume !== undefined) track.volume = Math.min(1, Math.max(0, t.volume))
        if (t.muted !== undefined) track.muted = t.muted
      }

      if (patch.trackOrder) {
        const order = new Map(patch.trackOrder.map((id, i) => [id, i]))
        song.tracks.sort((a, b) => (order.get(a.id) ?? 1e9) - (order.get(b.id) ?? 1e9))
      }

      if (patch.holyrics) {
        const h = patch.holyrics
        song.holyrics = {
          enabled: h.enabled ?? song.holyrics.enabled,
          songName: h.songName ?? song.holyrics.songName,
          holyricsSongId: h.holyricsSongId !== undefined ? h.holyricsSongId || undefined : song.holyrics.holyricsSongId,
          cues: h.cues
            ? h.cues
                .filter((c) => Number.isFinite(c.time) && c.time >= 0)
                .map((c) => ({ ...c }))
                .sort((a, b) => a.time - b.time)
            : song.holyrics.cues
        }
      }

      await this.writeSong(await this.folderPath(entry.folderName), song)
      return this.getEntry(songId)
    })
  }

  /** Envía la carpeta a la Papelera (recuperable). La confirmación la pide la capa IPC. */
  async deleteSong(songId: string): Promise<void> {
    return this.withLock(songId, async () => {
      const entry = await this.getEntry(songId)
      await trash(await this.folderPath(entry.folderName))
      this.index.delete(songId)
    })
  }

  // -------------------------------------------------------------------------
  // Pistas
  // -------------------------------------------------------------------------

  async readTrack(songId: string, trackId: string): Promise<Uint8Array> {
    const entry = await this.getEntry(songId)
    const track = entry.song.tracks.find((t) => t.id === trackId)
    if (!track) throw new AppException('NOT_FOUND', 'La pista no existe en la canción.')
    const folder = await this.folderPath(entry.folderName)
    try {
      return await fs.readFile(resolveInside(folder, track.file))
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new AppException('NOT_FOUND', `Falta el archivo de la pista "${track.name}" (${track.file}).`)
      }
      throw err
    }
  }

  async addTrackFiles(songId: string, filePaths: string[]): Promise<LibraryEntry> {
    return this.withLock(songId, async () => {
      const entry = await this.getEntry(songId)
      const folder = await this.folderPath(entry.folderName)
      for (const src of filePaths) {
        const file = await this.copyAudioIntoSong(folder, src)
        const guess = guessTrack(src)
        entry.song.tracks.push({ id: randomUUID(), name: guess.name, type: guess.type, file, volume: 1, muted: false })
      }
      await this.writeSong(folder, entry.song)
      return this.getEntry(songId)
    })
  }

  /** Sustituye el archivo de una pista conservando su nombre, tipo y mezcla. El archivo anterior va a la Papelera. */
  async replaceTrackFile(songId: string, trackId: string, srcPath: string): Promise<LibraryEntry> {
    return this.withLock(songId, async () => {
      const entry = await this.getEntry(songId)
      const track = entry.song.tracks.find((t) => t.id === trackId)
      if (!track) throw new AppException('NOT_FOUND', 'La pista no existe en la canción.')
      const folder = await this.folderPath(entry.folderName)
      const oldFile = track.file
      track.file = await this.copyAudioIntoSong(folder, srcPath)
      track.duration = undefined
      await this.writeSong(folder, entry.song)
      await trash(resolveInside(folder, oldFile)).catch(() => undefined)
      return this.getEntry(songId)
    })
  }

  async removeTrack(songId: string, trackId: string): Promise<LibraryEntry> {
    return this.withLock(songId, async () => {
      const entry = await this.getEntry(songId)
      const track = entry.song.tracks.find((t) => t.id === trackId)
      if (!track) throw new AppException('NOT_FOUND', 'La pista no existe en la canción.')
      const folder = await this.folderPath(entry.folderName)
      entry.song.tracks = entry.song.tracks.filter((t) => t.id !== trackId)
      await this.writeSong(folder, entry.song)
      // Si el archivo ya no existe (borrado manual) no es un error.
      await trash(resolveInside(folder, track.file)).catch(() => undefined)
      return this.getEntry(songId)
    })
  }

  /** Guarda las duraciones medidas por el motor de audio al decodificar. */
  async setDurations(songId: string, durations: Record<string, number>): Promise<LibraryEntry> {
    return this.withLock(songId, async () => {
      const entry = await this.getEntry(songId)
      for (const t of entry.song.tracks) {
        const d = durations[t.id]
        if (typeof d === 'number' && Number.isFinite(d) && d > 0) t.duration = Math.round(d * 1000) / 1000
      }
      entry.song.duration = Math.max(0, ...entry.song.tracks.map((t) => t.duration ?? 0))
      await this.writeSong(await this.folderPath(entry.folderName), entry.song)
      return entry
    })
  }

  // -------------------------------------------------------------------------

  private async readEntry(root: string, folderName: string): Promise<LibraryEntry | null> {
    const folder = resolveInside(root, folderName)
    let raw: string
    try {
      raw = await fs.readFile(path.join(folder, SONG_FILE), 'utf8')
    } catch (err) {
      // Carpetas sin song.json no son canciones; se ignoran en silencio.
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw new Error('No se pudo leer song.json (¿archivo bloqueado?).')
    }
    let song: Song
    try {
      song = parseSong(JSON.parse(raw))
    } catch (err) {
      throw new Error(`song.json inválido: ${(err as Error).message}`)
    }
    const missingTrackIds: string[] = []
    for (const track of song.tracks) {
      try {
        await fs.access(resolveInside(folder, track.file))
      } catch {
        missingTrackIds.push(track.id)
      }
    }
    return { song, folderName, missingTrackIds }
  }

  /** Copia un archivo de audio validado a /tracks con un nombre único. Devuelve la ruta relativa. */
  private async copyAudioIntoSong(folder: string, srcPath: string): Promise<string> {
    const fileName = path.basename(srcPath)
    if (!isSupportedAudioFile(fileName)) {
      throw new AppException('UNSUPPORTED_FORMAT', `Formato no compatible: ${fileName}. Usa WAV o MP3.`)
    }
    if (!(await sniffFile(srcPath))) {
      throw new AppException('UNSUPPORTED_FORMAT', `"${fileName}" no parece un archivo de audio válido o está dañado.`)
    }
    const tracksDir = path.join(folder, TRACKS_DIR)
    await fs.mkdir(tracksDir, { recursive: true })
    const target = await uniqueFilePath(tracksDir, fileName)
    await fs.copyFile(srcPath, target, fsConstants.COPYFILE_EXCL)
    return `${TRACKS_DIR}/${path.basename(target)}`
  }

  private withLock<T>(key: string, op: () => Promise<T>): Promise<T> {
    const prev = this.locks.get(key) ?? Promise.resolve()
    const next = prev.catch(() => undefined).then(op)
    this.locks.set(key, next)
    void next.finally(() => {
      if (this.locks.get(key) === next) this.locks.delete(key)
    }).catch(() => undefined)
    return next
  }
}

export function buildSong(input: { id?: string; name: string; artist: string; tracks: Track[] }): Song {
  const now = new Date().toISOString()
  return {
    schemaVersion: SONG_SCHEMA_VERSION,
    id: input.id ?? randomUUID(),
    name: input.name,
    artist: input.artist,
    duration: 0,
    tracks: input.tracks,
    holyrics: { enabled: false, songName: input.name, cues: [] },
    createdAt: now,
    updatedAt: now
  }
}

/** "bateria.wav" → "bateria.wav" o "bateria (2).wav" si ya existe. Nunca sobrescribe. */
export async function uniqueFilePath(dir: string, fileName: string): Promise<string> {
  const ext = path.extname(fileName).toLowerCase()
  const base = sanitizeFileName(path.basename(fileName, path.extname(fileName)), 'pista')
  for (let i = 1; ; i++) {
    const candidate = path.join(dir, i === 1 ? `${base}${ext}` : `${base} (${i})${ext}`)
    if (!(await exists(candidate))) return candidate
  }
}

function nameKey(name: string): string {
  return name.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim()
}

async function exists(p: string): Promise<boolean> {
  return fs.access(p).then(
    () => true,
    () => false
  )
}

async function trash(p: string): Promise<void> {
  try {
    await shell.trashItem(p)
  } catch {
    throw new AppException('FILE_LOCKED', `No se pudo enviar a la Papelera: ${p}. ¿Está abierto en otro programa?`)
  }
}
