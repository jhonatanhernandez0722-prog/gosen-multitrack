import type { CSSProperties } from 'react'
import type { PlayerTrackState } from '../audio/MultitrackPlayer'
import { meterRef } from '../audio/meters'
import { faderToGain, gainToDbLabel, gainToFader } from '../lib/audioMath'
import { TRACK_TYPE_COLORS, TRACK_TYPE_LABELS } from '../lib/trackTypes'
import { player, usePlayerState } from '../state/playback'

const FADER_STEPS = 1000

/** Medidor vertical: el nivel llega por variables CSS desde audio/meters.ts. */
function Meter({ meterKey }: { meterKey: string }) {
  return (
    <div className="meter" ref={meterRef(meterKey)} aria-hidden>
      <div className="meter-fill" />
      <div className="meter-peak" />
    </div>
  )
}

function Fader({ gain, label, onChange }: { gain: number; label: string; onChange: (gain: number) => void }) {
  return (
    <input
      className="fader"
      type="range"
      min={0}
      max={FADER_STEPS}
      value={Math.round(gainToFader(gain) * FADER_STEPS)}
      onChange={(e) => onChange(faderToGain(Number(e.target.value) / FADER_STEPS))}
      onDoubleClick={() => onChange(1)}
      aria-label={label}
      aria-valuetext={`${gainToDbLabel(gain)} dB`}
      title="Doble clic: 0 dB"
    />
  )
}

export function ChannelStrip({ track }: { track: PlayerTrackState }) {
  const broken = track.status === 'missing' || track.status === 'error'
  const style = { '--ch-color': TRACK_TYPE_COLORS[track.type] } as CSSProperties

  return (
    <div className={`channel${track.audible ? '' : ' is-silent'}${broken ? ' is-broken' : ''}`} style={style}>
      <div className="ch-cap" />
      <div className="ch-head">
        <div className="ch-name" title={track.name}>
          {track.name}
        </div>
        <div className="ch-type">
          {track.status === 'loading' ? 'Cargando…' : broken ? (track.status === 'missing' ? 'Sin archivo' : 'Error') : TRACK_TYPE_LABELS[track.type]}
        </div>
      </div>

      <div className="ch-body" title={broken ? track.error : undefined}>
        <Meter meterKey={track.id} />
        <Fader gain={track.volume} label={`Volumen de ${track.name}`} onChange={(g) => player.setTrackVolume(track.id, g)} />
      </div>

      <div className="ch-db">{gainToDbLabel(track.volume)}</div>

      <div className="ch-buttons">
        <button
          className={`mbtn mute${track.muted ? ' on' : ''}`}
          onClick={() => player.setTrackMuted(track.id, !track.muted)}
          aria-pressed={track.muted}
          aria-label={`${track.muted ? 'Activar' : 'Silenciar'} ${track.name}`}
        >
          M
        </button>
        <button
          className={`mbtn solo${track.solo ? ' on' : ''}`}
          onClick={() => player.setTrackSolo(track.id, !track.solo)}
          aria-pressed={track.solo}
          aria-label={`Solo ${track.name}`}
        >
          S
        </button>
      </div>
    </div>
  )
}

export function MasterStrip({ onCommit }: { onCommit: () => void }) {
  const { masterVolume } = usePlayerState()
  return (
    <div className="channel master-channel" onPointerUp={onCommit}>
      <div className="ch-cap" />
      <div className="ch-head">
        <div className="ch-name">MASTER</div>
        <div className="ch-type">Salida</div>
      </div>
      <div className="ch-body">
        <Meter meterKey="master" />
        <Fader gain={masterVolume} label="Volumen general" onChange={(g) => player.setMasterVolume(g)} />
      </div>
      <div className="ch-db">{gainToDbLabel(masterVolume)}</div>
      <div className="ch-buttons">
        <span className="ch-db-unit">dB</span>
      </div>
    </div>
  )
}
