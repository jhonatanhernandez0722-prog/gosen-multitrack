import { promises as fs } from 'node:fs'
import path from 'node:path'
import { app, dialog, ipcMain, shell, type BrowserWindow } from 'electron'
import { IPC } from '../shared/ipc'
import { ENABLED_AUDIO_EXTENSIONS } from '../shared/audioFormats'
import type { SettingsPatch, SongPatch, ZipImportRequest } from '../shared/types'
import { AppException, asResult } from './errors'
import type { ConfigService } from './services/ConfigService'
import type { LibraryService } from './services/library/LibraryService'
import type { ZipImportService } from './services/import/ZipImportService'
import type { HolyricsAdapter } from './services/holyrics/HolyricsAdapter'

interface Services {
  config: ConfigService
  library: LibraryService
  zipImport: ZipImportService
  holyrics: HolyricsAdapter
  getWindow: () => BrowserWindow | null
}

const AUDIO_FILTER = { name: 'Audio (WAV, MP3)', extensions: ENABLED_AUDIO_EXTENSIONS.map((e) => e.slice(1)) }

function str(v: unknown, what: string): string {
  if (typeof v !== 'string' || !v) throw new AppException('UNKNOWN', `Parámetro inválido: ${what}.`)
  return v
}

/** Capa fina: valida la entrada, delega en servicios y devuelve Result. Sin lógica de negocio. */
export function registerIpc({ config, library, zipImport, holyrics, getWindow }: Services): void {
  const openDialog = async (options: Electron.OpenDialogOptions): Promise<string[]> => {
    const win = getWindow()
    const res = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
    if (res.canceled || res.filePaths.length === 0) throw new AppException('CANCELLED', 'Selección cancelada.')
    return res.filePaths
  }

  /** Confirmación nativa en el proceso principal: ninguna eliminación ocurre sin ella. */
  const confirm = async (message: string, detail: string): Promise<void> => {
    const win = getWindow()
    const options: Electron.MessageBoxOptions = {
      type: 'warning',
      buttons: ['Cancelar', 'Enviar a la Papelera'],
      defaultId: 0,
      cancelId: 0,
      title: 'Confirmar eliminación',
      message,
      detail
    }
    const res = win ? await dialog.showMessageBox(win, options) : await dialog.showMessageBox(options)
    if (res.response !== 1) throw new AppException('CANCELLED', 'Eliminación cancelada.')
  }

  // --- Configuración -------------------------------------------------------

  ipcMain.handle(IPC.settingsGet, () => asResult(() => config.get()))
  ipcMain.handle(IPC.settingsUpdate, (_e, patch: SettingsPatch) => asResult(() => config.update(patch)))

  ipcMain.handle(IPC.settingsChooseLibrary, () =>
    asResult(async () => {
      const [dir] = await openDialog({
        title: 'Elegir carpeta de la biblioteca musical',
        properties: ['openDirectory', 'createDirectory']
      })
      return config.update({ libraryPath: dir! })
    })
  )

  /** Primer arranque: Documentos/Gosen Multitrack (se crea si no existe; nunca se sobrescribe nada). */
  ipcMain.handle(IPC.settingsUseDefaultLibrary, () =>
    asResult(async () => {
      const dir = path.join(app.getPath('documents'), 'Gosen Multitrack')
      await fs.mkdir(dir, { recursive: true })
      return config.update({ libraryPath: dir })
    })
  )

  ipcMain.handle(IPC.settingsSetHolyricsToken, (_e, token: unknown) =>
    asResult(async () => {
      if (token !== null && typeof token !== 'string') throw new AppException('UNKNOWN', 'Token inválido.')
      await config.setHolyricsToken(token ? token.trim() : null)
      return config.get()
    })
  )

  // --- Biblioteca ----------------------------------------------------------

  ipcMain.handle(IPC.libraryScan, () => asResult(() => library.scan()))
  ipcMain.handle(IPC.libraryGet, (_e, id: unknown) => asResult(() => library.getEntry(str(id, 'id'))))

  ipcMain.handle(IPC.libraryCreate, (_e, input: { name?: unknown; artist?: unknown }) =>
    asResult(() =>
      library.createSong({ name: str(input?.name, 'nombre'), artist: typeof input?.artist === 'string' ? input.artist : '' })
    )
  )

  ipcMain.handle(IPC.libraryUpdate, (_e, id: unknown, patch: SongPatch) =>
    asResult(() => library.updateSong(str(id, 'id'), patch ?? {}))
  )

  ipcMain.handle(IPC.libraryDelete, (_e, id: unknown) =>
    asResult(async () => {
      const entry = await library.getEntry(str(id, 'id'))
      await confirm(
        `¿Eliminar "${entry.song.name}"?`,
        `La carpeta "${entry.folderName}" y sus ${entry.song.tracks.length} pistas se enviarán a la Papelera.`
      )
      await library.deleteSong(entry.song.id)
    })
  )

  ipcMain.handle(IPC.libraryOpenFolder, (_e, folderName: unknown) =>
    asResult(async () => {
      const target = typeof folderName === 'string' && folderName ? await library.folderPath(folderName) : await library.root()
      const err = await shell.openPath(target)
      if (err) throw new AppException('IO_ERROR', err)
    })
  )

  ipcMain.handle(IPC.libraryReadTrack, (_e, songId: unknown, trackId: unknown) =>
    asResult(() => library.readTrack(str(songId, 'canción'), str(trackId, 'pista')))
  )

  ipcMain.handle(IPC.libraryAddTracks, (_e, songId: unknown) =>
    asResult(async () => {
      const files = await openDialog({ title: 'Añadir pistas', filters: [AUDIO_FILTER], properties: ['openFile', 'multiSelections'] })
      return library.addTrackFiles(str(songId, 'canción'), files)
    })
  )

  ipcMain.handle(IPC.libraryReplaceTrack, (_e, songId: unknown, trackId: unknown) =>
    asResult(async () => {
      const [file] = await openDialog({ title: 'Reemplazar pista', filters: [AUDIO_FILTER], properties: ['openFile'] })
      return library.replaceTrackFile(str(songId, 'canción'), str(trackId, 'pista'), file!)
    })
  )

  ipcMain.handle(IPC.libraryRemoveTrack, (_e, songId: unknown, trackId: unknown) =>
    asResult(async () => {
      const entry = await library.getEntry(str(songId, 'canción'))
      const track = entry.song.tracks.find((t) => t.id === trackId)
      if (!track) throw new AppException('NOT_FOUND', 'La pista no existe.')
      await confirm(`¿Quitar la pista "${track.name}"?`, `El archivo ${track.file} se enviará a la Papelera.`)
      return library.removeTrack(entry.song.id, track.id)
    })
  )

  ipcMain.handle(IPC.librarySetDurations, (_e, songId: unknown, durations: Record<string, number>) =>
    asResult(() => library.setDurations(str(songId, 'canción'), durations ?? {}))
  )

  // --- Importación ZIP -----------------------------------------------------

  ipcMain.handle(IPC.importChooseZip, () =>
    asResult(async () => {
      const [zipPath] = await openDialog({
        title: 'Importar canción desde ZIP',
        filters: [{ name: 'Archivo ZIP', extensions: ['zip'] }],
        properties: ['openFile']
      })
      return zipImport.inspect(zipPath!)
    })
  )

  // ZIP arrastrado a la ventana: la ruta llega del renderer, así que se valida antes de abrirla.
  ipcMain.handle(IPC.importInspectPath, (_e, zipPath: unknown) =>
    asResult(async () => {
      // Ruta vacía: el archivo no está en disco (arrastrado desde un navegador o desde dentro de otro ZIP).
      if (typeof zipPath !== 'string' || !zipPath) {
        throw new AppException(
          'INVALID_PATH',
          'No se puede leer la ubicación de ese archivo. Guarda primero el ZIP en una carpeta de tu PC y arrástralo desde allí.'
        )
      }
      const p = zipPath
      if (!path.isAbsolute(p) || path.extname(p).toLowerCase() !== '.zip') {
        throw new AppException('INVALID_ZIP', 'Solo se pueden importar archivos .zip.')
      }
      const stat = await fs.stat(p).catch(() => null)
      if (!stat?.isFile()) throw new AppException('NOT_FOUND', 'No se encontró el archivo arrastrado.')
      return zipImport.inspect(p)
    })
  )

  ipcMain.handle(IPC.importCommit, (_e, req: ZipImportRequest) => asResult(() => zipImport.commit(req)))
  ipcMain.handle(IPC.importCancel, (_e, importId: unknown) => asResult(() => zipImport.cancel(str(importId, 'importación'))))

  // --- Holyrics ------------------------------------------------------------

  ipcMain.handle(IPC.holyricsStatus, () => asResult(() => holyrics.status()))
  ipcMain.handle(IPC.holyricsSearch, (_e, text: unknown) => asResult(() => holyrics.searchSongs(String(text ?? ''))))
  ipcMain.handle(IPC.holyricsSlides, (_e, id: unknown) => asResult(() => holyrics.getSlides(str(id, 'id'))))
  ipcMain.handle(IPC.holyricsShow, (_e, id: unknown, index: unknown) =>
    asResult(() => holyrics.showSong(str(id, 'id'), typeof index === 'number' ? index : undefined))
  )
  ipcMain.handle(IPC.holyricsGoToSlide, (_e, index: unknown) => asResult(() => holyrics.goToSlide(Number(index))))
  ipcMain.handle(IPC.holyricsGoToSection, (_e, name: unknown) => asResult(() => holyrics.goToSection(str(name, 'sección'))))
  ipcMain.handle(IPC.holyricsClose, () => asResult(() => holyrics.close()))
}
