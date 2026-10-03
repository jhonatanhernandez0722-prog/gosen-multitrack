import type { TrackType } from '../../../shared/types'

export const TRACK_TYPE_LABELS: Record<TrackType, string> = {
  drums: 'Batería',
  percussion: 'Percusión',
  bass: 'Bajo',
  guitar: 'Guitarra',
  keys: 'Teclados',
  synth: 'Sintetizador',
  vocals: 'Voces',
  choir: 'Coros',
  click: 'Click',
  guide: 'Guía',
  other: 'Otro'
}

/** Color por familia: permite localizar una pista de un vistazo durante el servicio. */
export const TRACK_TYPE_COLORS: Record<TrackType, string> = {
  drums: '#f46a6a',
  percussion: '#f08c5a',
  bass: '#f1b44c',
  guitar: '#8fd16a',
  keys: '#34c38f',
  synth: '#3ec5d6',
  vocals: '#4f8cff',
  choir: '#8a7dff',
  click: '#9aa3b5',
  guide: '#c77dff',
  other: '#6b7385'
}

export const TRACK_TYPES = Object.keys(TRACK_TYPE_LABELS) as TrackType[]
