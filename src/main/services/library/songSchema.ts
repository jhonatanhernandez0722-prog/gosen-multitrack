import { SONG_SCHEMA_VERSION, type Song, type Track, type TrackType, type LyricsCue } from '../../../shared/types'

const TRACK_TYPES: readonly TrackType[] = [
  'drums', 'percussion', 'bass', 'guitar', 'keys', 'synth', 'vocals', 'choir', 'click', 'guide', 'other'
]

const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : fallback)
const num = (v: unknown, fallback = 0): number => (typeof v === 'number' && Number.isFinite(v) ? v : fallback)
const clamp01 = (v: number): number => Math.min(1, Math.max(0, v))

/**
 * Valida y normaliza el contenido de un song.json leído de disco.
 * Tolera campos ausentes (archivos editados a mano o versiones antiguas) pero rechaza
 * lo que haría inutilizable la canción. Lanza Error con un mensaje legible.
 */
export function parseSong(raw: unknown): Song {
  if (!raw || typeof raw !== 'object') throw new Error('song.json no contiene un objeto válido.')
  const o = raw as Record<string, unknown>
  const id = str(o.id)
  if (!id) throw new Error('song.json no tiene "id".')
  if (!Array.isArray(o.tracks)) throw new Error('song.json no tiene una lista "tracks".')

  const tracks: Track[] = o.tracks.map((t, i) => {
    const tr = (t ?? {}) as Record<string, unknown>
    const file = str(tr.file).replace(/\\/g, '/')
    if (!file) throw new Error(`La pista #${i + 1} no tiene "file".`)
    const type = TRACK_TYPES.includes(tr.type as TrackType) ? (tr.type as TrackType) : 'other'
    return {
      id: str(tr.id, `track-${i + 1}`),
      name: str(tr.name, file),
      file,
      type,
      volume: clamp01(num(tr.volume, 1)),
      muted: tr.muted === true,
      duration: typeof tr.duration === 'number' ? tr.duration : undefined
    }
  })

  const h = (o.holyrics ?? {}) as Record<string, unknown>
  const cues: LyricsCue[] = Array.isArray(h.cues)
    ? h.cues
        .filter((c): c is Record<string, unknown> => !!c && typeof c === 'object')
        .map((c) => ({
          time: num(c.time),
          slideIndex: typeof c.slideIndex === 'number' ? c.slideIndex : undefined,
          slideDescription: typeof c.slideDescription === 'string' ? c.slideDescription : undefined,
          label: typeof c.label === 'string' ? c.label : undefined
        }))
    : []

  const name = str(o.name, 'Sin nombre')
  const now = new Date().toISOString()
  return {
    schemaVersion: num(o.schemaVersion, SONG_SCHEMA_VERSION),
    id,
    name,
    artist: str(o.artist),
    duration: num(o.duration),
    bpm: typeof o.bpm === 'number' ? o.bpm : undefined,
    key: typeof o.key === 'string' ? o.key : undefined,
    tracks,
    holyrics: {
      enabled: h.enabled === true,
      songName: str(h.songName, name),
      holyricsSongId: typeof h.holyricsSongId === 'string' ? h.holyricsSongId : undefined,
      cues
    },
    createdAt: str(o.createdAt, now),
    updatedAt: str(o.updatedAt, now)
  }
}
