import { useState } from 'react'
import type { LyricsCue, Song } from '../../../shared/types'
import { HolyricsBadge } from '../components/HolyricsBadge'
import { Icon } from '../components/Icon'
import { ChannelStrip, MasterStrip } from '../components/Mixer'
import { Timeline, cueLabel } from '../components/Timeline'
import { TransportControls } from '../components/TransportControls'
import { useToast } from '../components/Toast'
import { formatTimecode } from '../lib/audioMath'
import { formatTime } from '../lib/format'
import { useSettings } from '../state/SettingsContext'
import {
  lyricsSync,
  notifySongChanged,
  player,
  reloadCurrentSong,
  useLyricsSyncState,
  usePlaybackPosition,
  usePlayerState
} from '../state/playback'

const STATUS_LABEL = {
  empty: 'Sin canción',
  loading: 'Cargando',
  ready: 'Listo',
  playing: 'En vivo',
  paused: 'En pausa',
  error: 'Error'
} as const

export function PlayerScreen({ onEdit, onOpenLibrary }: { onEdit: (songId: string) => void; onOpenLibrary: () => void }) {
  const { song, status, tracks, error, needsReload } = usePlayerState()
  const { update } = useSettings()
  const toast = useToast()
  const { activeCue } = useLyricsSyncState()

  if (!song) {
    return (
      <section className="screen">
        <div className="hero-empty">
          <div className="hero-empty-icon">
            <Icon name="mixer" size={40} />
          </div>
          <h1>Ninguna canción cargada</h1>
          <p className="muted">Elige una canción en la Biblioteca para cargar sus pistas en el mezclador.</p>
          <button className="btn primary lg" onClick={onOpenLibrary}>
            <Icon name="library" /> Ir a la Biblioteca
          </button>
        </div>
      </section>
    )
  }

  const anySolo = tracks.some((t) => t.solo)
  const loaded = tracks.filter((t) => t.status !== 'loading').length
  const cues = song.holyrics.enabled ? song.holyrics.cues : []

  const saveMix = async () => {
    const res = await window.gosen.library.update(song.id, {
      tracks: tracks.map((t) => ({ id: t.id, volume: t.volume, muted: t.muted }))
    })
    if (res.ok) {
      notifySongChanged(res.value.song)
      toast.success('Mezcla guardada como predeterminada para esta canción.')
    } else toast.error(res.error.message)
  }

  const resetMix = () => {
    for (const t of song.tracks) {
      player.setTrackVolume(t.id, t.volume)
      player.setTrackMuted(t.id, t.muted)
    }
    player.clearSolo()
  }

  return (
    <section className="screen player">
      <header className="deck-header">
        <div className="deck-title">
          <div className="eyebrow">
            <span className={`state-pill state-${status}`}>
              <span className="state-dot" aria-hidden />
              {STATUS_LABEL[status]}
            </span>
            {status === 'loading' && (
              <span className="muted">
                {loaded}/{tracks.length} pistas
              </span>
            )}
          </div>
          <h1>{song.name}</h1>
          <div className="chips">
            <span className="chip">{song.artist || 'Sin artista'}</span>
            {song.bpm ? <span className="chip mono">{song.bpm} BPM</span> : null}
            {song.key ? <span className="chip mono">{song.key}</span> : null}
            <span className="chip mono">{tracks.length} pistas</span>
          </div>
        </div>
        <div className="row">
          <HolyricsBadge />
          <button className="btn" onClick={() => onEdit(song.id)}>
            <Icon name="edit" /> Editar
          </button>
        </div>
      </header>

      {needsReload && (
        <div className="alert warning row">
          <span className="grow">Las pistas de esta canción cambiaron en disco. Recarga cuando no esté sonando.</span>
          <button className="btn small" disabled={status === 'playing'} onClick={() => void reloadCurrentSong()}>
            <Icon name="refresh" size={14} /> Recargar
          </button>
        </div>
      )}
      {status === 'error' && <div className="alert error">{error}</div>}

      <div className="deck">
        <TransportControls />
        <Clock />
        <SectionDisplay song={song} cues={cues} activeCue={activeCue} />
      </div>

      <Timeline cues={cues} activeCue={activeCue} />

      <div className="section-bar">
        <h2>Mezclador</h2>
        <div className="row">
          {anySolo && (
            <button className="btn small warn" onClick={() => player.clearSolo()}>
              Quitar solos
            </button>
          )}
          <button className="btn small ghost" onClick={resetMix} title="Volver a la mezcla guardada">
            <Icon name="undo" size={14} /> Restablecer
          </button>
          <button className="btn small ghost" onClick={() => void saveMix()} title="Guardar volúmenes y mutes actuales">
            <Icon name="save" size={14} /> Guardar mezcla
          </button>
        </div>
      </div>

      {tracks.length === 0 ? (
        <div className="empty-state">
          <p className="muted">Esta canción no tiene pistas todavía.</p>
          <button className="btn" onClick={() => onEdit(song.id)}>
            <Icon name="plus" /> Añadir pistas
          </button>
        </div>
      ) : (
        <div className="mixer">
          <div className="mixer-channels">
            {tracks.map((t) => (
              <ChannelStrip key={t.id} track={t} />
            ))}
          </div>
          <MasterStrip onCommit={() => void update({ playback: { masterVolume: player.getState().masterVolume } }).catch(() => undefined)} />
        </div>
      )}

      <LyricsPanel />
    </section>
  )
}

/** Reloj grande: se re-renderiza por frame de forma aislada. */
function Clock() {
  const { duration } = usePlayerState()
  const pos = usePlaybackPosition()
  return (
    <div className="clock">
      <div className="timecode" aria-live="off">
        {formatTimecode(pos)}
      </div>
      <div className="clock-sub mono">
        <span>−{formatTime(Math.max(0, duration - pos))}</span>
        <span className="muted">/ {formatTime(duration)}</span>
      </div>
    </div>
  )
}

/** Sección actual y la siguiente con cuenta atrás (según las marcas de letra). */
function SectionDisplay({ song, cues, activeCue }: { song: Song; cues: LyricsCue[]; activeCue: number }) {
  const pos = usePlaybackPosition()
  if (cues.length === 0) {
    return (
      <div className="section-display">
        <div className="sd-label">Tempo</div>
        <div className="sd-value mono">{song.bpm ? `${song.bpm}` : '—'}</div>
        <div className="sd-sub">{song.key ? `Tono ${song.key}` : 'Añade BPM y tono en el editor'}</div>
      </div>
    )
  }
  const current = cues[activeCue]
  const next = cues[activeCue + 1]
  return (
    <div className="section-display">
      <div className="sd-label">Sección</div>
      <div className="sd-value">{current ? cueLabel(current) : 'Inicio'}</div>
      <div className="sd-sub">
        {next ? (
          <>
            Siguiente: <strong>{cueLabel(next)}</strong> en <span className="mono">{formatTime(Math.max(0, next.time - pos))}</span>
          </>
        ) : (
          'Última sección'
        )}
      </div>
    </div>
  )
}

/** Controles de letra en Holyrics para la canción cargada. */
function LyricsPanel() {
  const { song } = usePlayerState()
  const { settings } = useSettings()
  const sync = useLyricsSyncState()
  const toast = useToast()
  const [recording, setRecording] = useState(false)
  if (!song) return null

  const linked = !!(settings?.holyrics.enabled && song.holyrics.enabled && song.holyrics.holyricsSongId)
  const cues = song.holyrics.cues

  /** Modo ensayo: cada pulsación guarda una marca en la posición actual con la diapositiva siguiente. */
  const markNext = async () => {
    const pos = player.getPosition()
    const before = cues.filter((c) => c.time < pos)
    const prevIndex = Math.max(-1, ...before.map((c) => c.slideIndex ?? -1))
    const cue: LyricsCue = { time: Math.round(pos * 100) / 100, slideIndex: prevIndex + 1 }
    const next = [...cues.filter((c) => Math.abs(c.time - cue.time) > 0.05), cue].sort((a, b) => a.time - b.time)
    const res = await window.gosen.library.update(song.id, { holyrics: { cues: next } })
    if (!res.ok) {
      toast.error(res.error.message)
      return
    }
    notifySongChanged(res.value.song)
    if (linked) void window.gosen.holyrics.goToSlide(cue.slideIndex!)
  }

  return (
    <div className="lyrics-bar">
      <div className="lyrics-bar-title">
        <Icon name="slides" />
        <strong>Letra</strong>
        <span className="muted small">
          {!settings?.holyrics.enabled
            ? 'Holyrics desactivado en Configuración'
            : !linked
              ? 'Sin vincular · vincúlala desde el Editor'
              : cues.length === 0
                ? 'Se muestra al reproducir · sin marcas de tiempo'
                : `${cues.length} marcas sincronizadas`}
        </span>
      </div>
      {linked && (
        <div className="row">
          <label className="small row toggle">
            <input type="checkbox" checked={recording} onChange={(e) => setRecording(e.target.checked)} />
            Modo ensayo
          </label>
          {recording && (
            <button className="btn small primary" onClick={() => void markNext()} disabled={!player.isPlaying}>
              Marcar siguiente diapositiva
            </button>
          )}
          <button className="btn small" onClick={() => void lyricsSync.showNow()}>
            Mostrar letra
          </button>
          <button className="btn small ghost" onClick={() => void lyricsSync.closeNow()}>
            Cerrar letra
          </button>
        </div>
      )}
      {sync.lastError && <div className="alert error small lyrics-error">Holyrics: {sync.lastError}</div>}
    </div>
  )
}
