import type { HolyricsSettings, LyricsCue, Song } from '../../../shared/types'
import type { MultitrackPlayer, TransportEvent } from '../audio/MultitrackPlayer'

export interface LyricsSyncState {
  /** Índice de la marca activa en song.holyrics.cues, o -1. */
  activeCue: number
  shownSongId: string | null
  lastError: string | null
}

/**
 * Sincroniza la letra en Holyrics con el reloj de audio usando SOLO acciones documentadas:
 *   ShowSong al empezar, y ActionGoToIndex / ActionGoToSlideDescription al cruzar cada marca.
 *
 * Holyrics no puede seguir un reloj externo por sí mismo, así que Gosen decide cuándo cambiar.
 * La fuente de verdad del tiempo es `player.getPosition()` (reloj del AudioContext). El temporizador
 * solo "despierta" el proceso cerca de la siguiente marca; al dispararse se vuelve a leer la posición
 * real, por lo que no acumula deriva. (backgroundThrottling está desactivado en la ventana, así que
 * funciona aunque la app esté minimizada mientras se opera Holyrics.)
 */
export class LyricsSync {
  private song: Song | null = null
  private settings: HolyricsSettings | null = null
  private timer: ReturnType<typeof setTimeout> | null = null
  private lastSentCue = -1
  private state: LyricsSyncState = { activeCue: -1, shownSongId: null, lastError: null }
  private listeners = new Set<() => void>()

  constructor(private readonly player: MultitrackPlayer) {
    player.onTransport((e) => this.onTransport(e))
  }

  subscribe = (l: () => void): (() => void) => {
    this.listeners.add(l)
    return () => this.listeners.delete(l)
  }
  getState = (): LyricsSyncState => this.state

  private setState(patch: Partial<LyricsSyncState>): void {
    this.state = { ...this.state, ...patch }
    for (const l of this.listeners) l()
  }

  configure(settings: HolyricsSettings): void {
    this.settings = settings
  }

  /** Llamar cuando cambian las marcas o el vínculo de la canción cargada. */
  setSong(song: Song | null): void {
    const changedSong = song?.id !== this.song?.id
    this.song = song
    if (changedSong) {
      this.lastSentCue = -1
      this.setState({ activeCue: -1, shownSongId: null, lastError: null })
    }
    if (this.player.isPlaying) this.reschedule(true)
  }

  private get linkedId(): string | null {
    const s = this.song
    if (!s || !this.settings?.enabled || !s.holyrics.enabled || !s.holyrics.holyricsSongId) return null
    return s.holyrics.holyricsSongId
  }

  private get cues(): LyricsCue[] {
    return this.song?.holyrics.cues ?? []
  }

  private onTransport(e: TransportEvent): void {
    switch (e) {
      case 'load':
        this.clearTimer()
        this.lastSentCue = -1
        this.setState({ activeCue: -1, shownSongId: null, lastError: null })
        break
      case 'play':
        void this.onPlay()
        break
      case 'seek':
        if (this.player.isPlaying) this.reschedule(true)
        else this.setState({ activeCue: this.cueAt(this.player.getPosition()) })
        break
      case 'pause':
      case 'stop':
      case 'ended':
        this.clearTimer()
        if (e !== 'pause') this.setState({ activeCue: -1 })
        this.lastSentCue = -1
        break
    }
  }

  private async onPlay(): Promise<void> {
    const id = this.linkedId
    if (id && this.settings?.autoShowOnPlay && this.state.shownSongId !== id) {
      const cue = this.cues[this.cueAt(this.player.getPosition())]
      await this.call(() => window.gosen.holyrics.show(id, cue?.slideIndex))
      this.setState({ shownSongId: id })
    }
    this.reschedule(true)
  }

  /** Muestra la letra manualmente (botón del reproductor). */
  async showNow(): Promise<void> {
    const id = this.linkedId
    if (!id) return
    const cue = this.cues[this.cueAt(this.player.getPosition())]
    await this.call(() => window.gosen.holyrics.show(id, cue?.slideIndex))
    this.setState({ shownSongId: id })
    this.lastSentCue = -1
  }

  async closeNow(): Promise<void> {
    await this.call(() => window.gosen.holyrics.close())
    this.setState({ shownSongId: null })
  }

  /** Último índice de marca cuyo tiempo ya pasó. */
  private cueAt(position: number): number {
    const cues = this.cues
    let idx = -1
    for (let i = 0; i < cues.length; i++) {
      if (cues[i]!.time <= position + 0.005) idx = i
      else break
    }
    return idx
  }

  private reschedule(sendCurrent: boolean): void {
    this.clearTimer()
    if (!this.linkedId || this.cues.length === 0 || !this.player.isPlaying) return

    const pos = this.player.getPosition()
    const idx = this.cueAt(pos)
    if (idx !== this.state.activeCue) this.setState({ activeCue: idx })
    if (sendCurrent && idx >= 0 && idx !== this.lastSentCue) void this.sendCue(idx)

    const next = this.cues[idx + 1]
    if (!next) return
    // Despertar un poco antes y volver a medir con el reloj de audio.
    const delayMs = Math.max(0, (next.time - pos) * 1000 - 4)
    this.timer = setTimeout(() => {
      this.timer = null
      if (!this.player.isPlaying) return
      const now = this.player.getPosition()
      if (now + 0.008 >= next.time) {
        const i = this.cueAt(now + 0.008)
        this.setState({ activeCue: i })
        if (i >= 0 && i !== this.lastSentCue) void this.sendCue(i)
      }
      this.reschedule(false)
    }, delayMs)
  }

  private async sendCue(idx: number): Promise<void> {
    const cue = this.cues[idx]
    if (!cue) return
    this.lastSentCue = idx
    if (cue.slideDescription) {
      await this.call(() => window.gosen.holyrics.goToSection(cue.slideDescription!))
    } else if (typeof cue.slideIndex === 'number') {
      await this.call(() => window.gosen.holyrics.goToSlide(cue.slideIndex!))
    }
  }

  /** Los errores de Holyrics nunca interrumpen el audio: se registran y se muestran. */
  private async call(op: () => Promise<{ ok: boolean; error?: { message: string } }>): Promise<void> {
    try {
      const res = await op()
      this.setState({ lastError: res.ok ? null : (res.error?.message ?? 'Error de Holyrics') })
    } catch (err) {
      this.setState({ lastError: err instanceof Error ? err.message : String(err) })
    }
  }

  private clearTimer(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
  }
}
