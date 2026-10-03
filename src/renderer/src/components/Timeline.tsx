import { useEffect, useRef, useState, type PointerEvent } from 'react'
import type { LyricsCue } from '../../../shared/types'
import { player, usePlaybackPosition, usePlayerState } from '../state/playback'
import { formatTime } from '../lib/format'

/**
 * Línea de tiempo con forma de onda de la mezcla y marcas de letra.
 * Mientras se arrastra solo se muestra la vista previa; la búsqueda real (que reprograma todas
 * las pistas a la vez) ocurre al soltar.
 */
export function Timeline({ cues = [], activeCue = -1 }: { cues?: LyricsCue[]; activeCue?: number }) {
  const { duration, status, waveform } = usePlayerState()
  const position = usePlaybackPosition()
  const barRef = useRef<HTMLDivElement>(null)
  const baseRef = useRef<HTMLCanvasElement>(null)
  const playedRef = useRef<HTMLCanvasElement>(null)
  const [dragPos, setDragPos] = useState<number | null>(null)
  const [width, setWidth] = useState(0)
  const enabled = duration > 0 && (status === 'ready' || status === 'paused' || status === 'playing')

  const shown = dragPos ?? position
  const pct = duration > 0 ? Math.min(100, (shown / duration) * 100) : 0

  useEffect(() => {
    const el = barRef.current
    if (!el) return
    const ro = new ResizeObserver(([entry]) => setWidth(Math.round(entry!.contentRect.width)))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    const css = getComputedStyle(document.documentElement)
    drawWave(baseRef.current, waveform, width, css.getPropertyValue('--wave-base').trim())
    drawWave(playedRef.current, waveform, width, css.getPropertyValue('--wave-played').trim())
  }, [waveform, width])

  const posFromEvent = (e: PointerEvent): number => {
    const rect = barRef.current!.getBoundingClientRect()
    return Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width)) * duration
  }

  return (
    <div className="timeline">
      <div
        ref={barRef}
        className={`wave${enabled ? '' : ' disabled'}`}
        role="slider"
        aria-label="Posición de reproducción"
        aria-valuemin={0}
        aria-valuemax={Math.round(duration)}
        aria-valuenow={Math.round(shown)}
        aria-valuetext={formatTime(shown)}
        tabIndex={enabled ? 0 : -1}
        onPointerDown={(e) => {
          if (!enabled) return
          e.currentTarget.setPointerCapture(e.pointerId)
          setDragPos(posFromEvent(e))
        }}
        onPointerMove={(e) => dragPos !== null && setDragPos(posFromEvent(e))}
        onPointerUp={(e) => {
          if (dragPos === null) return
          player.seek(posFromEvent(e))
          setDragPos(null)
        }}
        onPointerCancel={() => setDragPos(null)}
        onKeyDown={(e) => {
          if (!enabled) return
          if (e.key === 'ArrowRight') player.seek(player.getPosition() + 5)
          if (e.key === 'ArrowLeft') player.seek(player.getPosition() - 5)
        }}
      >
        <canvas ref={baseRef} className="wave-canvas" />
        <div className="wave-played" style={{ width: `${pct}%` }}>
          <canvas ref={playedRef} className="wave-canvas" style={{ width }} />
        </div>
        {waveform.length === 0 && <div className="wave-empty">{status === 'loading' ? 'Analizando audio…' : ''}</div>}

        {duration > 0 &&
          cues.map((c, i) => (
            <div
              key={`${c.time}-${i}`}
              className={`cue${i === activeCue ? ' active' : ''}${i < activeCue ? ' past' : ''}`}
              style={{ left: `${(c.time / duration) * 100}%` }}
            >
              <span className="cue-label">{cueLabel(c)}</span>
            </div>
          ))}
        <div className="playhead" style={{ left: `${pct}%` }} />
      </div>
      <div className="wave-scale">
        <span>00:00</span>
        <span>{formatTime(duration / 2)}</span>
        <span>{formatTime(duration)}</span>
      </div>
    </div>
  )
}

export function cueLabel(c: LyricsCue): string {
  return c.label || c.slideDescription || `Diap. ${(c.slideIndex ?? 0) + 1}`
}

function drawWave(canvas: HTMLCanvasElement | null, data: Float32Array, width: number, color: string) {
  if (!canvas || width <= 0) return
  const height = canvas.clientHeight || 72
  const dpr = window.devicePixelRatio || 1
  canvas.width = width * dpr
  canvas.height = height * dpr
  canvas.style.width = `${width}px`
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  ctx.scale(dpr, dpr)
  ctx.clearRect(0, 0, width, height)
  if (data.length === 0) return
  ctx.fillStyle = color
  const bar = 2
  const gap = 1
  const mid = height / 2
  for (let x = 0; x < width; x += bar + gap) {
    const v = data[Math.floor((x / width) * data.length)] ?? 0
    const h = Math.max(1, Math.pow(v, 0.8) * (height - 6))
    ctx.fillRect(x, mid - h / 2, bar, h)
  }
}
