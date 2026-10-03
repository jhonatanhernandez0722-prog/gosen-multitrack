import type { MultitrackPlayer } from './MultitrackPlayer'

/**
 * Medidores de nivel. Un único bucle requestAnimationFrame lee los analizadores y escribe
 * directamente en el estilo de los elementos registrados (sin re-renderizar React).
 * Es solo visual: nunca influye en la reproducción.
 *
 * Cada elemento recibe dos variables CSS en escala 0..1 (−60 dB … 0 dB):
 *   --level  nivel con caída suave       --peak  pico retenido ~1 s
 */
const FLOOR_DB = -60
const FALL_PER_FRAME = 0.018
const HOLD_FRAMES = 60

interface MeterEl {
  el: HTMLElement
  key: string
  level: number
  peak: number
  hold: number
}

const meters = new Set<MeterEl>()
let raf = 0
let player: MultitrackPlayer | null = null

export function dbToMeter(peak: number): number {
  if (peak <= 0) return 0
  const db = 20 * Math.log10(peak)
  return Math.min(1, Math.max(0, (db - FLOOR_DB) / -FLOOR_DB))
}

function tick() {
  raf = 0
  if (!player) return
  const playing = player.isPlaying
  const levels = playing ? player.readLevels() : null
  let active = playing

  for (const m of meters) {
    const raw = levels ? dbToMeter(m.key === 'master' ? levels.master : (levels.tracks.get(m.key) ?? 0)) : 0
    m.level = raw > m.level ? raw : Math.max(0, m.level - FALL_PER_FRAME)
    if (raw >= m.peak) {
      m.peak = raw
      m.hold = HOLD_FRAMES
    } else if (m.hold > 0) m.hold--
    else m.peak = Math.max(0, m.peak - FALL_PER_FRAME / 2)
    m.el.style.setProperty('--level', m.level.toFixed(3))
    m.el.style.setProperty('--peak', m.peak.toFixed(3))
    m.el.classList.toggle('is-clipping', m.peak > 0.995)
    if (m.level > 0 || m.peak > 0) active = true
  }
  if (active) raf = requestAnimationFrame(tick)
}

export function startMeters(p: MultitrackPlayer): void {
  player = p
  p.onTransport(() => {
    if (!raf) raf = requestAnimationFrame(tick)
  })
}

/** Callback ref para React: `<div ref={meterRef(trackId)} />`. */
export function meterRef(key: string): (el: HTMLElement | null) => void {
  let entry: MeterEl | null = null
  return (el) => {
    if (entry) meters.delete(entry)
    entry = null
    if (el) {
      entry = { el, key, level: 0, peak: 0, hold: 0 }
      meters.add(entry)
      if (!raf && player?.isPlaying) raf = requestAnimationFrame(tick)
    }
  }
}
