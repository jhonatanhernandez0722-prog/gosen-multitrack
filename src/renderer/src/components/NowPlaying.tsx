import { player, usePlaybackPosition, usePlayerState } from '../state/playback'
import { formatTime } from '../lib/format'

/** Mini reproductor en la barra lateral: control rápido mientras se navega por la biblioteca. */
export function NowPlaying({ onOpen }: { onOpen: () => void }) {
  const { song, status, duration } = usePlayerState()
  const position = usePlaybackPosition()
  if (!song) return null
  const playing = status === 'playing'
  const canPlay = status === 'ready' || status === 'paused' || playing

  return (
    <div className={`now-playing${playing ? ' is-playing' : ''}`}>
      <button className="np-title" onClick={onOpen} title="Abrir reproductor">
        <span className="np-label">{playing ? 'Sonando' : status === 'loading' ? 'Cargando' : 'Cargada'}</span>
        <span className="np-name">{song.name}</span>
      </button>
      <div className="np-row">
        <button className="np-btn" disabled={!canPlay} onClick={() => void player.togglePlay()} aria-label={playing ? 'Pausa' : 'Reproducir'}>
          {playing ? '❚❚' : '▶'}
        </button>
        <span className="np-time">
          {formatTime(position)} / {formatTime(duration)}
        </span>
      </div>
      <div className="np-progress">
        <div style={{ width: `${duration ? (position / duration) * 100 : 0}%` }} />
      </div>
    </div>
  )
}
