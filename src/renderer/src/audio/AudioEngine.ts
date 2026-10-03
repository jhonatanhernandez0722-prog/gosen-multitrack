/**
 * Envoltorio del AudioContext único de la aplicación.
 *
 * Grafo:  [pistas] ─► bus (fundidos de transporte) ─► master (volumen general) ─► salida
 *
 * El reloj del AudioContext (`currentTime`) avanza con el hardware de audio: es el reloj maestro
 * de toda la reproducción. Nada de lo que suena depende de temporizadores de JavaScript.
 */
type SinkCapableContext = AudioContext & { setSinkId?: (id: string) => Promise<void> }

export class AudioEngine {
  readonly ctx: SinkCapableContext
  /** Bus de transporte: se usa para fundidos cortos al pausar/buscar y evitar clics. */
  readonly bus: GainNode
  readonly master: GainNode
  /** Solo lectura para el medidor general; no altera la señal. */
  readonly masterAnalyser: AnalyserNode

  constructor() {
    // 'playback' prioriza estabilidad (buffers más grandes, sin cortes) sobre latencia mínima:
    // en un servicio en vivo es preferible un arranque 30 ms más tarde a un chasquido.
    this.ctx = new AudioContext({ latencyHint: 'playback' })
    this.bus = this.ctx.createGain()
    this.master = this.ctx.createGain()
    this.masterAnalyser = createMeterAnalyser(this.ctx)
    this.bus.connect(this.master)
    this.master.connect(this.ctx.destination)
    this.master.connect(this.masterAnalyser)
  }

  get now(): number {
    return this.ctx.currentTime
  }

  async resume(): Promise<void> {
    if (this.ctx.state !== 'running') await this.ctx.resume()
  }

  setMasterVolume(v: number): void {
    this.master.gain.setTargetAtTime(clamp01(v), this.now, 0.015)
  }

  /** Decodifica a PCM en memoria (WAV, MP3; ver shared/audioFormats.ts). */
  async decode(bytes: Uint8Array): Promise<AudioBuffer> {
    // decodeAudioData necesita un ArrayBuffer propio (lo "consume").
    const copy = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
    return this.ctx.decodeAudioData(copy)
  }

  get supportsOutputSelection(): boolean {
    return typeof this.ctx.setSinkId === 'function'
  }

  /** '' = salida predeterminada del sistema. */
  async setOutputDevice(deviceId: string): Promise<void> {
    if (!this.ctx.setSinkId) throw new Error('Este sistema no permite elegir la salida de audio.')
    await this.ctx.setSinkId(deviceId)
  }
}

export function createMeterAnalyser(ctx: BaseAudioContext): AnalyserNode {
  const a = ctx.createAnalyser()
  a.fftSize = 1024
  a.smoothingTimeConstant = 0
  return a
}

const meterBuffer = new Float32Array(1024)

/** Pico absoluto del último bloque analizado (0..1+). */
export function readPeak(analyser: AnalyserNode): number {
  analyser.getFloatTimeDomainData(meterBuffer)
  let peak = 0
  for (let i = 0; i < meterBuffer.length; i++) {
    const v = Math.abs(meterBuffer[i]!)
    if (v > peak) peak = v
  }
  return peak
}

export function clamp01(v: number): number {
  return Math.min(1, Math.max(0, Number.isFinite(v) ? v : 0))
}
