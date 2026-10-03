import { player, usePlayerState } from '../state/playback'

export function TransportControls({ size = 'large' }: { size?: 'large' | 'small' }) {
  const { status } = usePlayerState()
  const canPlay = status === 'ready' || status === 'paused' || status === 'playing'
  const playing = status === 'playing'

  return (
    <div className={`transport transport-${size}`}>
      <button
        className="tbtn"
        onClick={() => player.restart()}
        disabled={!canPlay}
        title="Volver al inicio (Inicio)"
        aria-label="Volver al inicio"
      >
        <svg viewBox="0 0 24 24" aria-hidden>
          <path d="M6 5h2v14H6zM20 5v14L9.5 12z" />
        </svg>
      </button>
      <button
        className={`tbtn tbtn-play${playing ? ' is-playing' : ''}`}
        onClick={() => void player.togglePlay()}
        disabled={!canPlay}
        title={playing ? 'Pausa (Espacio)' : 'Reproducir (Espacio)'}
        aria-label={playing ? 'Pausa' : 'Reproducir'}
      >
        {playing ? (
          <svg viewBox="0 0 24 24" aria-hidden>
            <path d="M6 5h4v14H6zM14 5h4v14h-4z" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" aria-hidden>
            <path d="M7 4.5v15L19.5 12z" />
          </svg>
        )}
      </button>
      <button
        className="tbtn"
        onClick={() => player.stop()}
        disabled={status !== 'playing' && status !== 'paused'}
        title="Detener"
        aria-label="Detener"
      >
        <svg viewBox="0 0 24 24" aria-hidden>
          <path d="M6 6h12v12H6z" />
        </svg>
      </button>
    </div>
  )
}
