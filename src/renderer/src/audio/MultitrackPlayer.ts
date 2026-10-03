import type { LibraryEntry, Song, TrackType } from '../../../shared/types'
import { AudioEngine, clamp01, createMeterAnalyser, readPeak } from './AudioEngine'

export type TrackStatus = 'loading' | 'ready' | 'missing' | 'error'
export type TransportStatus = 'empty' | 'loading' | 'ready' | 'playing' | 'paused' | 'error'
export type TransportEvent = 'load' | 'play' | 'pause' | 'stop' | 'seek' | 'ended'

export interface PlayerTrackState {
  id: string
  name: string
  type: TrackType
  volume: number
  muted: boolean
  solo: boolean
  /** Audible tras aplicar mute y solo. */
  audible: boolean
  status: TrackStatus
  error?: string
  duration: number
}

export interface PlayerState {
  song: Song | null
  status: TransportStatus
  /** Duración maestra = pista más larga decodificada. */
  duration: number
  tracks: PlayerTrackState[]
  masterVolume: number
  error?: string
  /** El archivo de la canción cambió mientras sonaba; recargar al terminar. */
  needsReload: boolean
  /** Envolvente de la mezcla (0..1) para dibujar la forma de onda; vacía hasta cargar. */
  waveform: Float32Array
}

interface TrackNode {
  state: PlayerTrackState
  buffer?: AudioBuffer
  volumeGain: GainNode
  muteGain: GainNode
  analyser: AnalyserNode
  source?: AudioBufferSourceNode
}

const RAMP = 0.012 // constante de tiempo de las rampas de ganancia (s): sin clics, respuesta inmediata
const FADE_OUT = 0.03 // fundido al pausar/buscar (s)
const DECODE_CONCURRENCY = 3 // limita el pico de memoria al decodificar muchas pistas

/**
 * Reproductor multipista sincronizado.
 *
 * SINCRONIZACIÓN
 *  - Todas las pistas se programan con `source.start(when, offset)` con el MISMO `when`
 *    (tiempo futuro del reloj de audio). Web Audio garantiza que comienzan en la misma muestra.
 *  - Posición = startOffset + (ctx.currentTime − startedAt). No hay contadores ni setInterval.
 *  - Pausa/búsqueda: se detienen todas las fuentes (son de un solo uso) y se crean nuevas que
 *    vuelven a arrancar juntas. Nunca se reposiciona una pista por separado.
 *  - Mute/solo/volumen: solo cambian ganancias; la pista sigue sonando (en silencio) y no se
 *    pierde la sincronía.
 *
 * DURACIONES DISTINTAS
 *  - La duración maestra es la de la pista más larga. Las más cortas terminan antes y quedan en
 *    silencio. Si se busca más allá del final de una pista corta, esa pista no se programa.
 *  - La canción termina cuando la última fuente termina (evento `ended`), no por un temporizador.
 *
 * ERRORES
 *  - Una pista que falta o no se puede decodificar queda marcada con error; el resto se reproduce.
 */
export class MultitrackPlayer {
  private readonly engine: AudioEngine
  private nodes: TrackNode[] = []
  private state: PlayerState = {
    song: null,
    status: 'empty',
    duration: 0,
    tracks: [],
    masterVolume: 0.9,
    needsReload: false,
    waveform: new Float32Array(0)
  }
  private listeners = new Set<() => void>()
  private transportListeners = new Set<(e: TransportEvent) => void>()

  private startLatency = 0.1
  private startedAt = 0
  private startOffset = 0
  private pausedAt = 0
  /** Se incrementa en cada carga: descarta resultados de decodificaciones antiguas. */
  private loadGeneration = 0
  /** Se incrementa en cada arranque/parada: descarta eventos `ended` de fuentes antiguas. */
  private playGeneration = 0
  private activeSources = 0

  constructor(engine = new AudioEngine()) {
    this.engine = engine
    this.engine.setMasterVolume(this.state.masterVolume)
  }

  get audio(): AudioEngine {
    return this.engine
  }

  // --- Suscripción (compatible con useSyncExternalStore) --------------------

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  getState = (): PlayerState => this.state

  onTransport(listener: (e: TransportEvent) => void): () => void {
    this.transportListeners.add(listener)
    return () => this.transportListeners.delete(listener)
  }

  private setState(patch: Partial<PlayerState>): void {
    this.state = { ...this.state, ...patch }
    for (const l of this.listeners) l()
  }

  private emit(e: TransportEvent): void {
    for (const l of this.transportListeners) {
      try {
        l(e)
      } catch (err) {
        console.error('[gosen] error en oyente de transporte:', err)
      }
    }
  }

  private syncTracks(): void {
    const anySolo = this.nodes.some((n) => n.state.solo)
    for (const n of this.nodes) {
      const audible = !n.state.muted && (!anySolo || n.state.solo)
      n.state = { ...n.state, audible }
      n.muteGain.gain.setTargetAtTime(audible ? 1 : 0, this.engine.now, RAMP)
    }
    this.setState({ tracks: this.nodes.map((n) => n.state) })
  }

  // --- Configuración --------------------------------------------------------

  setStartLatency(ms: number): void {
    this.startLatency = Math.max(0.04, ms / 1000)
  }

  setMasterVolume(v: number): void {
    const masterVolume = clamp01(v)
    this.engine.setMasterVolume(masterVolume)
    this.setState({ masterVolume })
  }

  // --- Carga ----------------------------------------------------------------

  /**
   * Carga y decodifica todas las pistas. Devuelve las duraciones medidas para que la biblioteca
   * las guarde. Las pistas con problemas no impiden reproducir el resto.
   */
  async load(entry: LibraryEntry): Promise<Record<string, number>> {
    this.stopSources()
    this.disposeNodes()
    const generation = ++this.loadGeneration
    const { song } = entry
    this.startOffset = 0
    this.pausedAt = 0

    this.nodes = song.tracks.map((t) => {
      const volumeGain = this.engine.ctx.createGain()
      const muteGain = this.engine.ctx.createGain()
      volumeGain.gain.value = clamp01(t.volume)
      volumeGain.connect(muteGain)
      muteGain.connect(this.engine.bus)
      // Medidor post-fader/post-mute: muestra lo que realmente suena.
      const analyser = createMeterAnalyser(this.engine.ctx)
      muteGain.connect(analyser)
      const missing = entry.missingTrackIds.includes(t.id)
      return {
        volumeGain,
        muteGain,
        analyser,
        state: {
          id: t.id,
          name: t.name,
          type: t.type,
          volume: clamp01(t.volume),
          muted: t.muted,
          solo: false,
          audible: !t.muted,
          status: missing ? 'missing' : 'loading',
          error: missing ? `Falta el archivo ${t.file}` : undefined,
          duration: 0
        }
      }
    })
    this.setState({ song, status: 'loading', duration: 0, error: undefined, needsReload: false, waveform: new Float32Array(0) })
    this.syncTracks()
    this.emit('load')

    const queue = this.nodes.filter((n) => n.state.status === 'loading')
    const worker = async () => {
      for (let node = queue.shift(); node; node = queue.shift()) {
        await this.decodeTrack(song.id, node, generation)
      }
    }
    await Promise.all(Array.from({ length: DECODE_CONCURRENCY }, worker))
    if (generation !== this.loadGeneration) return {}

    const ready = this.nodes.filter((n) => n.buffer)
    const duration = Math.max(0, ...ready.map((n) => n.buffer!.duration))
    if (ready.length === 0) {
      this.setState({ status: 'error', duration: 0, error: 'No se pudo cargar ninguna pista de esta canción.' })
    } else {
      this.setState({ status: 'ready', duration, waveform: computeWaveform(ready.map((n) => n.buffer!), duration) })
    }
    return Object.fromEntries(ready.map((n) => [n.state.id, n.buffer!.duration]))
  }

  private async decodeTrack(songId: string, node: TrackNode, generation: number): Promise<void> {
    try {
      const res = await window.gosen.library.readTrack(songId, node.state.id)
      if (generation !== this.loadGeneration) return
      if (!res.ok) {
        node.state = { ...node.state, status: res.error.code === 'NOT_FOUND' ? 'missing' : 'error', error: res.error.message }
      } else {
        const buffer = await this.engine.decode(res.value)
        if (generation !== this.loadGeneration) return
        node.buffer = buffer
        node.state = { ...node.state, status: 'ready', error: undefined, duration: buffer.duration }
      }
    } catch {
      if (generation !== this.loadGeneration) return
      node.state = { ...node.state, status: 'error', error: 'El archivo de audio está dañado o no se puede decodificar.' }
    }
    this.setState({ tracks: this.nodes.map((n) => n.state) })
  }

  /** Actualiza nombres/tipos sin recargar el audio (ediciones desde el editor). */
  updateSongMeta(song: Song): void {
    if (this.state.song?.id !== song.id) return
    const sameFiles =
      song.tracks.length === this.nodes.length &&
      song.tracks.every((t) => this.nodes.some((n) => n.state.id === t.id)) &&
      this.state.song.tracks.every((old) => song.tracks.find((t) => t.id === old.id)?.file === old.file)
    if (!sameFiles) {
      this.setState({ song, needsReload: true })
      return
    }
    const order = new Map(song.tracks.map((t, i) => [t.id, i]))
    this.nodes.sort((a, b) => order.get(a.state.id)! - order.get(b.state.id)!)
    for (const n of this.nodes) {
      const t = song.tracks.find((x) => x.id === n.state.id)!
      n.state = { ...n.state, name: t.name, type: t.type }
    }
    this.setState({ song, tracks: this.nodes.map((n) => n.state) })
  }

  unload(): void {
    this.stopSources()
    this.disposeNodes()
    this.loadGeneration++
    this.startOffset = 0
    this.pausedAt = 0
    this.setState({ song: null, status: 'empty', duration: 0, tracks: [], error: undefined, needsReload: false, waveform: new Float32Array(0) })
  }

  // --- Transporte ------------------------------------------------------------

  get isPlaying(): boolean {
    return this.state.status === 'playing'
  }

  /** Posición real de reproducción en segundos, derivada del reloj de audio. */
  /** Niveles de pico actuales por pista y general (para los medidores; no afecta al audio). */
  readLevels(): { tracks: Map<string, number>; master: number } {
    const tracks = new Map<string, number>()
    for (const n of this.nodes) tracks.set(n.state.id, readPeak(n.analyser))
    return { tracks, master: readPeak(this.engine.masterAnalyser) }
  }

  getPosition(): number {
    if (this.state.status !== 'playing') return this.pausedAt
    const elapsed = this.engine.now - this.startedAt
    return Math.min(this.state.duration, this.startOffset + Math.max(0, elapsed))
  }

  async play(): Promise<void> {
    const { status } = this.state
    if (status !== 'ready' && status !== 'paused') return
    await this.engine.resume()
    let offset = this.pausedAt
    if (offset >= this.state.duration - 0.01) offset = 0
    this.startAt(offset)
    this.setState({ status: 'playing' })
    this.emit('play')
  }

  pause(): void {
    if (this.state.status !== 'playing') return
    this.pausedAt = this.getPosition()
    this.stopSources()
    this.setState({ status: 'paused' })
    this.emit('pause')
  }

  stop(): void {
    const { status } = this.state
    if (status !== 'playing' && status !== 'paused') return
    this.stopSources()
    this.pausedAt = 0
    this.setState({ status: 'ready' })
    this.emit('stop')
  }

  async togglePlay(): Promise<void> {
    if (this.isPlaying) this.pause()
    else await this.play()
  }

  /** Vuelve al inicio; si estaba sonando sigue sonando. */
  restart(): void {
    this.seek(0)
  }

  seek(seconds: number): void {
    const { status, duration } = this.state
    if (status !== 'playing' && status !== 'paused' && status !== 'ready') return
    const target = Math.min(Math.max(0, seconds), Math.max(0, duration - 0.001))
    if (status === 'playing') {
      this.stopSources()
      this.startAt(target)
    } else {
      this.pausedAt = target
      if (status === 'ready' && target > 0) this.setState({ status: 'paused' })
    }
    this.emit('seek')
    for (const l of this.listeners) l()
  }

  // --- Mezcla ---------------------------------------------------------------

  setTrackVolume(trackId: string, volume: number): void {
    const node = this.nodes.find((n) => n.state.id === trackId)
    if (!node) return
    const v = clamp01(volume)
    node.volumeGain.gain.setTargetAtTime(v, this.engine.now, RAMP)
    node.state = { ...node.state, volume: v }
    this.setState({ tracks: this.nodes.map((n) => n.state) })
  }

  setTrackMuted(trackId: string, muted: boolean): void {
    const node = this.nodes.find((n) => n.state.id === trackId)
    if (!node) return
    node.state = { ...node.state, muted }
    this.syncTracks()
  }

  setTrackSolo(trackId: string, solo: boolean): void {
    const node = this.nodes.find((n) => n.state.id === trackId)
    if (!node) return
    node.state = { ...node.state, solo }
    this.syncTracks()
  }

  clearSolo(): void {
    for (const n of this.nodes) n.state = { ...n.state, solo: false }
    this.syncTracks()
  }

  // --- Interno --------------------------------------------------------------

  private startAt(offset: number): void {
    const { ctx, bus } = this.engine
    const generation = ++this.playGeneration
    // Margen para que todas las pistas queden programadas antes de que llegue `when`.
    const when = ctx.currentTime + Math.max(this.startLatency, FADE_OUT + 0.01)
    bus.gain.cancelScheduledValues(when)
    bus.gain.setValueAtTime(1, when)

    this.activeSources = 0
    for (const node of this.nodes) {
      if (!node.buffer || offset >= node.buffer.duration) continue
      const src = ctx.createBufferSource()
      src.buffer = node.buffer
      src.connect(node.volumeGain)
      src.onended = () => this.handleSourceEnded(generation)
      src.start(when, offset)
      node.source = src
      this.activeSources++
    }
    this.startedAt = when
    this.startOffset = offset
    this.pausedAt = offset
    if (this.activeSources === 0) queueMicrotask(() => this.handleSourceEnded(generation, true))
  }

  private handleSourceEnded(generation: number, force = false): void {
    if (generation !== this.playGeneration) return // fuente de un arranque anterior
    if (!force && --this.activeSources > 0) return
    // Terminó la pista más larga: fin natural de la canción.
    for (const n of this.nodes) {
      n.source?.disconnect()
      n.source = undefined
    }
    this.playGeneration++
    this.pausedAt = 0
    this.setState({ status: 'ready' })
    this.emit('ended')
  }

  private stopSources(): void {
    const { ctx, bus } = this.engine
    this.playGeneration++
    const now = ctx.currentTime
    bus.gain.cancelScheduledValues(now)
    bus.gain.setValueAtTime(bus.gain.value, now)
    bus.gain.linearRampToValueAtTime(0, now + FADE_OUT)
    for (const n of this.nodes) {
      const src = n.source
      if (!src) continue
      src.onended = null
      try {
        src.stop(now + FADE_OUT)
      } catch {
        // ya detenida
      }
      setTimeout(() => src.disconnect(), (FADE_OUT + 0.05) * 1000)
      n.source = undefined
    }
    this.activeSources = 0
  }

  private disposeNodes(): void {
    for (const n of this.nodes) {
      n.volumeGain.disconnect()
      n.muteGain.disconnect()
      n.analyser.disconnect()
      n.buffer = undefined
    }
    this.nodes = []
  }
}

const WAVEFORM_POINTS = 1600

/**
 * Envolvente de la mezcla: pico por segmento sumando todas las pistas.
 * Se muestrea con salto para que tarde pocos milisegundos incluso con canciones largas.
 */
function computeWaveform(buffers: AudioBuffer[], duration: number): Float32Array {
  const out = new Float32Array(WAVEFORM_POINTS)
  if (duration <= 0) return out
  const sr = buffers[0]?.sampleRate ?? 44100
  const perPoint = (duration * sr) / WAVEFORM_POINTS
  const step = Math.max(1, Math.floor(perPoint / 64))
  for (const buf of buffers) {
    const ch = buf.getChannelData(0)
    for (let p = 0; p < WAVEFORM_POINTS; p++) {
      const start = Math.floor(p * perPoint)
      const end = Math.min(ch.length, Math.floor((p + 1) * perPoint))
      let peak = 0
      for (let i = start; i < end; i += step) {
        const v = Math.abs(ch[i]!)
        if (v > peak) peak = v
      }
      out[p]! += peak
    }
  }
  let max = 0
  for (const v of out) if (v > max) max = v
  if (max > 0) for (let i = 0; i < out.length; i++) out[i] = out[i]! / max
  return out
}
