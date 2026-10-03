import type {
  AppSettings,
  HolyricsSlideList,
  HolyricsSongSummary,
  HolyricsStatus,
  LibraryEntry,
  LibraryScanResult,
  Result,
  SettingsPatch,
  SongPatch,
  ZipImportRequest,
  ZipPreview
} from '../shared/types'

export interface GosenApi {
  settings: {
    get(): Promise<Result<AppSettings>>
    update(patch: SettingsPatch): Promise<Result<AppSettings>>
    chooseLibraryFolder(): Promise<Result<AppSettings>>
    /** Usa Documentos/Gosen Multitrack como biblioteca. */
    useDefaultLibraryFolder(): Promise<Result<AppSettings>>
    /** null borra el token guardado. */
    setHolyricsToken(token: string | null): Promise<Result<AppSettings>>
  }
  library: {
    scan(): Promise<Result<LibraryScanResult>>
    get(songId: string): Promise<Result<LibraryEntry>>
    create(input: { name: string; artist: string }): Promise<Result<LibraryEntry>>
    update(songId: string, patch: SongPatch): Promise<Result<LibraryEntry>>
    /** Pide confirmación nativa y envía la carpeta a la Papelera. */
    delete(songId: string): Promise<Result<void>>
    /** Sin argumento abre la carpeta raíz de la biblioteca. */
    openFolder(folderName?: string): Promise<Result<void>>
    readTrack(songId: string, trackId: string): Promise<Result<Uint8Array>>
    addTracks(songId: string): Promise<Result<LibraryEntry>>
    replaceTrack(songId: string, trackId: string): Promise<Result<LibraryEntry>>
    removeTrack(songId: string, trackId: string): Promise<Result<LibraryEntry>>
    setDurations(songId: string, durations: Record<string, number>): Promise<Result<LibraryEntry>>
  }
  import: {
    chooseZip(): Promise<Result<ZipPreview>>
    /** ZIP arrastrado y soltado sobre la ventana. */
    inspectDroppedFile(file: File): Promise<Result<ZipPreview>>
    commit(req: ZipImportRequest): Promise<Result<LibraryEntry>>
    cancel(importId: string): Promise<Result<void>>
  }
  holyrics: {
    status(): Promise<Result<HolyricsStatus>>
    search(text: string): Promise<Result<HolyricsSongSummary[]>>
    slides(holyricsSongId: string): Promise<Result<HolyricsSlideList>>
    show(holyricsSongId: string, initialIndex?: number): Promise<Result<void>>
    goToSlide(index: number): Promise<Result<void>>
    goToSection(name: string): Promise<Result<void>>
    close(): Promise<Result<void>>
  }
}
