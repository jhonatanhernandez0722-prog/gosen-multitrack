/**
 * Registro de formatos de audio admitidos.
 *
 * La reproducción usa Web Audio API (decodeAudioData de Chromium/Electron), que decodifica
 * de forma fiable WAV (PCM 8/16/24/32-bit y float), MP3, FLAC, OGG Vorbis/Opus y AAC/M4A.
 * Se habilitan primero WAV y MP3 (prioridad del proyecto). Para añadir otro formato basta con
 * marcarlo como `enabled: true` tras verificarlo con archivos reales.
 */
export interface AudioFormat {
  extension: string
  mime: string
  enabled: boolean
}

export const AUDIO_FORMATS: readonly AudioFormat[] = [
  { extension: '.wav', mime: 'audio/wav', enabled: true },
  { extension: '.mp3', mime: 'audio/mpeg', enabled: true },
  { extension: '.flac', mime: 'audio/flac', enabled: false },
  { extension: '.ogg', mime: 'audio/ogg', enabled: false },
  { extension: '.m4a', mime: 'audio/mp4', enabled: false }
]

export const ENABLED_AUDIO_EXTENSIONS: readonly string[] = AUDIO_FORMATS.filter((f) => f.enabled).map(
  (f) => f.extension
)

export function isSupportedAudioFile(fileName: string): boolean {
  const dot = fileName.lastIndexOf('.')
  if (dot < 0) return false
  return ENABLED_AUDIO_EXTENSIONS.includes(fileName.slice(dot).toLowerCase())
}
