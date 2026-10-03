import { useHolyricsStatus } from '../state/useHolyricsStatus'

const LABELS = {
  disabled: 'Holyrics desactivado',
  'not-configured': 'Holyrics sin configurar',
  connected: 'Holyrics conectado',
  error: 'Holyrics sin conexión'
} as const

export function HolyricsBadge() {
  const { status } = useHolyricsStatus()
  const state = status?.state ?? 'disabled'
  return (
    <div className={`status-badge status-${state}`} title={status?.message ?? ''}>
      <span className="status-dot" aria-hidden />
      {LABELS[state]}
    </div>
  )
}
