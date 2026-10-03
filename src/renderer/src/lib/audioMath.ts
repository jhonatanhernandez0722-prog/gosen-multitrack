/**
 * Curva del fader: posición² = ganancia. Da más recorrido útil cerca de 0 dB, como un fader real.
 * La ganancia (0..1) es lo que se guarda en song.json y lo que usa el motor.
 */
export const faderToGain = (pos: number): number => pos * pos
export const gainToFader = (gain: number): number => Math.sqrt(Math.max(0, gain))

export function gainToDbLabel(gain: number): string {
  if (gain <= 0.0001) return '−∞'
  const db = 20 * Math.log10(gain)
  return `${db > -0.05 ? '0.0' : db.toFixed(1).replace('-', '−')}`
}

/** 83.46 → "01:23.4" */
export function formatTimecode(seconds: number): string {
  const s = Math.max(0, seconds)
  const m = Math.floor(s / 60)
  const sec = Math.floor(s % 60)
  const tenth = Math.floor((s * 10) % 10)
  return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}.${tenth}`
}
