import { contextBridge, ipcRenderer, webUtils } from 'electron'
import { IPC } from '../shared/ipc'
import type { GosenApi } from './api'

/** Única superficie expuesta al renderer: funciones concretas, nunca ipcRenderer en bruto. */
const api: GosenApi = {
  settings: {
    get: () => ipcRenderer.invoke(IPC.settingsGet),
    update: (patch) => ipcRenderer.invoke(IPC.settingsUpdate, patch),
    chooseLibraryFolder: () => ipcRenderer.invoke(IPC.settingsChooseLibrary),
    useDefaultLibraryFolder: () => ipcRenderer.invoke(IPC.settingsUseDefaultLibrary),
    setHolyricsToken: (token) => ipcRenderer.invoke(IPC.settingsSetHolyricsToken, token)
  },
  library: {
    scan: () => ipcRenderer.invoke(IPC.libraryScan),
    get: (id) => ipcRenderer.invoke(IPC.libraryGet, id),
    create: (input) => ipcRenderer.invoke(IPC.libraryCreate, input),
    update: (id, patch) => ipcRenderer.invoke(IPC.libraryUpdate, id, patch),
    delete: (id) => ipcRenderer.invoke(IPC.libraryDelete, id),
    openFolder: (folderName) => ipcRenderer.invoke(IPC.libraryOpenFolder, folderName),
    readTrack: (songId, trackId) => ipcRenderer.invoke(IPC.libraryReadTrack, songId, trackId),
    addTracks: (songId) => ipcRenderer.invoke(IPC.libraryAddTracks, songId),
    replaceTrack: (songId, trackId) => ipcRenderer.invoke(IPC.libraryReplaceTrack, songId, trackId),
    removeTrack: (songId, trackId) => ipcRenderer.invoke(IPC.libraryRemoveTrack, songId, trackId),
    setDurations: (songId, durations) => ipcRenderer.invoke(IPC.librarySetDurations, songId, durations)
  },
  import: {
    chooseZip: () => ipcRenderer.invoke(IPC.importChooseZip),
    inspectDroppedFile: (file) => ipcRenderer.invoke(IPC.importInspectPath, webUtils.getPathForFile(file)),
    commit: (req) => ipcRenderer.invoke(IPC.importCommit, req),
    cancel: (importId) => ipcRenderer.invoke(IPC.importCancel, importId)
  },
  holyrics: {
    status: () => ipcRenderer.invoke(IPC.holyricsStatus),
    search: (text) => ipcRenderer.invoke(IPC.holyricsSearch, text),
    slides: (id) => ipcRenderer.invoke(IPC.holyricsSlides, id),
    show: (id, index) => ipcRenderer.invoke(IPC.holyricsShow, id, index),
    goToSlide: (index) => ipcRenderer.invoke(IPC.holyricsGoToSlide, index),
    goToSection: (name) => ipcRenderer.invoke(IPC.holyricsGoToSection, name),
    close: () => ipcRenderer.invoke(IPC.holyricsClose)
  }
}

contextBridge.exposeInMainWorld('gosen', api)
