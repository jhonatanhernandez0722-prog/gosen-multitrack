import type { HolyricsSlide, HolyricsSlideList, HolyricsSongSummary, HolyricsStatus } from '../../../shared/types'
import type { ConfigService } from '../ConfigService'
import { AppException, toAppError } from '../../errors'
import { HolyricsClient } from './HolyricsClient'

/**
 * Capa desacoplada entre el reproductor y Holyrics.
 * El reproductor solo conoce esta interfaz; cómo se habla con Holyrics (HTTP hoy,
 * otro mecanismo mañana) queda encapsulado en la implementación.
 *
 * Cada método corresponde a acciones DOCUMENTADAS de la API Server oficial
 * (https://github.com/holyrics/API-Server):
 *   status        → GetTokenInfo (v2.25+)
 *   searchSongs   → SearchSong (v2.19+)
 *   getSlides     → GetCurrentPresentation {include_slides} (v2.21+) / GetSong (v2.21+)
 *   showSong      → ShowSong {id, initial_index} (initial_index v2.23+)
 *   goToSlide     → ActionGoToIndex {index} (v2.19+)
 *   goToSection   → ActionGoToSlideDescription {name} (v2.19+)
 *   close         → CloseCurrentPresentation (v2.19+)
 * El token necesita permiso para cada una de estas acciones.
 */
export interface HolyricsAdapter {
  status(): Promise<HolyricsStatus>
  searchSongs(text: string): Promise<HolyricsSongSummary[]>
  getSlides(songId: string): Promise<HolyricsSlideList>
  showSong(songId: string, initialIndex?: number): Promise<void>
  goToSlide(index: number): Promise<void>
  goToSection(name: string): Promise<void>
  close(): Promise<void>
}

interface LyricsDto {
  id?: string
  title?: string
  artist?: string
  order?: string
  slides?: { text?: string; slide_description?: string }[]
}

interface PresentationDto {
  type?: string
  song_id?: string
  slides?: { number?: number; text?: string; slide_description?: string }[]
}

export class HolyricsApiAdapter implements HolyricsAdapter {
  constructor(private readonly config: ConfigService) {}

  private async client(): Promise<HolyricsClient> {
    const { holyrics } = await this.config.get()
    if (!holyrics.enabled) throw new AppException('HOLYRICS_DISABLED', 'La integración con Holyrics está desactivada.')
    const token = await this.config.getHolyricsToken()
    if (!token) throw new AppException('HOLYRICS_AUTH', 'Falta el token de la API Server de Holyrics.')
    return new HolyricsClient({ host: holyrics.host, port: holyrics.port, token })
  }

  async status(): Promise<HolyricsStatus> {
    try {
      const client = await this.client()
      const info = await client.request<{ version?: string }>('GetTokenInfo')
      return { state: 'connected', version: info?.version }
    } catch (err) {
      const e = toAppError(err)
      if (e.code === 'HOLYRICS_DISABLED') return { state: 'disabled' }
      if (e.code === 'HOLYRICS_AUTH' && e.message.startsWith('Falta')) return { state: 'not-configured', message: e.message }
      return { state: 'error', message: e.message }
    }
  }

  async searchSongs(text: string): Promise<HolyricsSongSummary[]> {
    const query = text.trim()
    if (!query) return []
    const data = await (await this.client()).request<LyricsDto[] | null>('SearchSong', {
      text: query,
      title: true,
      artist: true,
      fields: 'id,title,artist'
    })
    return (data ?? [])
      .filter((s) => s.id !== undefined)
      .map((s) => ({ id: String(s.id), title: s.title ?? '', artist: s.artist ?? '' }))
  }

  async getSlides(songId: string): Promise<HolyricsSlideList> {
    const client = await this.client()

    // Si esa canción ya está en pantalla, sus diapositivas reales dan los índices exactos.
    const current = await client.request<PresentationDto | null>('GetCurrentPresentation', { include_slides: true })
    if (current?.type === 'song' && String(current.song_id) === songId && Array.isArray(current.slides)) {
      return {
        source: 'presentation',
        slides: current.slides.map((s, i) => ({
          index: typeof s.number === 'number' ? s.number - 1 : i,
          text: s.text ?? '',
          slideDescription: s.slide_description || undefined
        }))
      }
    }

    const song = await client.request<LyricsDto | null>('GetSong', { id: songId })
    if (!song) throw new AppException('HOLYRICS_ERROR', 'La canción vinculada ya no existe en Holyrics.')
    const base = song.slides ?? []
    // `order`: índices desde 1 separados por comas (p. ej. "1,2,3,2,4,2").
    const order = (song.order ?? '')
      .split(',')
      .map((n) => Number(n.trim()) - 1)
      .filter((n) => Number.isInteger(n) && n >= 0 && n < base.length)
    const sequence = order.length ? order : base.map((_, i) => i)
    const slides: HolyricsSlide[] = sequence.map((src, i) => ({
      index: i,
      text: base[src]?.text ?? '',
      slideDescription: base[src]?.slide_description || undefined
    }))
    return { source: 'song', slides }
  }

  async showSong(songId: string, initialIndex?: number): Promise<void> {
    const body: Record<string, unknown> = { id: songId }
    if (initialIndex !== undefined) body.initial_index = initialIndex
    await (await this.client()).request('ShowSong', body)
  }

  async goToSlide(index: number): Promise<void> {
    if (!Number.isInteger(index) || index < 0) throw new AppException('HOLYRICS_ERROR', 'Índice de diapositiva inválido.')
    await (await this.client()).request('ActionGoToIndex', { index })
  }

  async goToSection(name: string): Promise<void> {
    await (await this.client()).request('ActionGoToSlideDescription', { name })
  }

  async close(): Promise<void> {
    await (await this.client()).request('CloseCurrentPresentation')
  }
}
