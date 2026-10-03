/**
 * Modelos de dominio compartidos entre el proceso principal (main) y la UI (renderer).
 * Solo tipos y constantes puras: nada de Node ni DOM aquí.
 */

export const SONG_SCHEMA_VERSION = 1

export type TrackType =
  | 'drums'
  | 'percussion'
  | 'bass'
  | 'guitar'
  | 'keys'
  | 'synth'
  | 'vocals'
  | 'choir'
  | 'click'
  | 'guide'
  | 'other'

export interface Track {
  id: string
  name: string
  /** Ruta relativa a la carpeta de la canción, siempre con '/' (p. ej. "tracks/bateria.wav"). */
  file: string
  type: TrackType
  /** Volumen guardado por defecto, 0..1. */
  volume: number
  /** Mute guardado por defecto (estado inicial al abrir la canción). */
  muted: boolean
  /** Duración detectada en segundos (informativa; la fuente de verdad es el audio decodificado). */
  duration?: number
}

/**
 * Integración de letras. Pensada para crecer sin romper el formato:
 * - `holyricsSongId`: ID real de la canción en Holyrics (obtenido vía SearchSong/GetSongs).
 * - `cues`: futura sincronización tiempo → diapositiva (FASE 8). Vacío hasta entonces.
 */
export interface LyricsCue {
  /** Segundos desde el inicio de la canción. */
  time: number
  /** Índice de diapositiva en Holyrics (base 0, como ActionGoToIndex). */
  slideIndex?: number
  /** Nombre de descripción de diapositiva (como ActionGoToSlideDescription). */
  slideDescription?: string
  label?: string
}

export interface HolyricsLink {
  enabled: boolean
  /** Nombre usado para buscar/mostrar en Holyrics. */
  songName: string
  holyricsSongId?: string
  cues: LyricsCue[]
}

export interface Song {
  schemaVersion: number
  id: string
  name: string
  artist: string
  /** Duración maestra en segundos = la pista más larga. */
  duration: number
  bpm?: number
  key?: string
  tracks: Track[]
  holyrics: HolyricsLink
  createdAt: string
  updatedAt: string
}

/** Resumen de una canción en la biblioteca, incluyendo su carpeta y problemas detectados. */
export interface LibraryEntry {
  song: Song
  folderName: string
  /** Pistas cuyo archivo no existe en disco. */
  missingTrackIds: string[]
}

export interface LibraryScanResult {
  entries: LibraryEntry[]
  /** Carpetas que no pudieron leerse (song.json corrupto, etc.). */
  errors: { folderName: string; message: string }[]
}

/** Cambios editables de una canción. Las pistas se identifican por id; el orden por `trackOrder`. */
export interface SongPatch {
  name?: string
  artist?: string
  bpm?: number | null
  key?: string | null
  tracks?: { id: string; name?: string; type?: TrackType; volume?: number; muted?: boolean }[]
  trackOrder?: string[]
  holyrics?: Partial<HolyricsLink>
}

// ---------------------------------------------------------------------------
// Importación ZIP
// ---------------------------------------------------------------------------

export interface ZipTrackCandidate {
  /** Nombre completo de la entrada dentro del ZIP (clave para la extracción). */
  entryName: string
  fileName: string
  suggestedName: string
  suggestedType: TrackType
  size: number
}

export interface ZipPreview {
  /** Token opaco que identifica el ZIP elegido en el proceso principal (la UI nunca envía rutas). */
  importId: string
  zipFileName: string
  suggestedName: string
  tracks: ZipTrackCandidate[]
  /** Archivos ignorados (no son audio admitido, ocultos, __MACOSX…). */
  ignored: string[]
  /** Canción existente con el mismo nombre, si la hay. */
  duplicateOf?: { id: string; name: string }
}

export interface ZipImportRequest {
  importId: string
  name: string
  artist: string
  tracks: { entryName: string; name: string; type: TrackType }[]
  /** Reimportar: sustituye las pistas de esta canción conservando su id y su vínculo Holyrics. */
  replaceSongId?: string
}

// ---------------------------------------------------------------------------
// Holyrics (datos reales devueltos por la API)
// ---------------------------------------------------------------------------

export interface HolyricsSongSummary {
  id: string
  title: string
  artist: string
}

export interface HolyricsSlide {
  /** Índice base 0, el que espera ActionGoToIndex. */
  index: number
  text: string
  slideDescription?: string
}

export interface HolyricsSlideList {
  /**
   * 'presentation': leídas de la presentación en pantalla (GetCurrentPresentation) → índices exactos.
   * 'song': leídas de la canción (GetSong + order) → si Holyrics añade diapositiva de título, los índices
   * pueden desplazarse; por eso conviene usar marcas por sección (slideDescription) o verificar.
   */
  source: 'presentation' | 'song'
  slides: HolyricsSlide[]
}

// ---------------------------------------------------------------------------
// Configuración
// ---------------------------------------------------------------------------

export interface HolyricsSettings {
  enabled: boolean
  host: string
  port: number
  /** true si existe un token guardado (el token nunca viaja al renderer). */
  hasToken: boolean
  /** Mostrar la letra automáticamente al reproducir una canción vinculada. */
  autoShowOnPlay: boolean
}

export interface PlaybackSettings {
  /** ID del dispositivo de salida (AudioContext.setSinkId). '' = predeterminado del sistema. */
  outputDeviceId: string
  masterVolume: number
  /** Margen de arranque en ms para programar todas las pistas al mismo instante. */
  startLatencyMs: number
}

export interface AppSettings {
  libraryPath: string | null
  playback: PlaybackSettings
  holyrics: HolyricsSettings
}

/** Lo que el renderer puede modificar (el token va por un canal aparte). */
export type SettingsPatch = {
  libraryPath?: string | null
  playback?: Partial<PlaybackSettings>
  holyrics?: Partial<Omit<HolyricsSettings, 'hasToken'>>
}

// ---------------------------------------------------------------------------
// Resultados de IPC
// ---------------------------------------------------------------------------

/** Todas las llamadas IPC devuelven un Result: los errores nunca cruzan como excepciones. */
export type Result<T> = { ok: true; value: T } | { ok: false; error: AppError }

export type AppErrorCode =
  | 'LIBRARY_NOT_CONFIGURED'
  | 'LIBRARY_UNAVAILABLE'
  | 'NOT_FOUND'
  | 'INVALID_PATH'
  | 'INVALID_ZIP'
  | 'EMPTY_ZIP'
  | 'NO_AUDIO_IN_ZIP'
  | 'UNSUPPORTED_FORMAT'
  | 'DUPLICATE_SONG'
  | 'FILE_LOCKED'
  | 'IO_ERROR'
  | 'HOLYRICS_DISABLED'
  | 'HOLYRICS_UNREACHABLE'
  | 'HOLYRICS_AUTH'
  | 'HOLYRICS_ERROR'
  | 'CANCELLED'
  | 'UNKNOWN'

export interface AppError {
  code: AppErrorCode
  message: string
}

export interface HolyricsStatus {
  state: 'disabled' | 'not-configured' | 'connected' | 'error'
  message?: string
  version?: string
}
