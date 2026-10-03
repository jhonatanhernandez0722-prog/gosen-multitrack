import path from 'node:path'
import type { TrackType } from '../../../shared/types'

/** Palabras clave (español/inglés) → tipo de pista y nombre legible. El orden importa: lo más específico primero. */
const RULES: { type: TrackType; label: string; keywords: string[] }[] = [
  { type: 'click', label: 'Click', keywords: ['click', 'clic', 'metronomo', 'metronome'] },
  { type: 'guide', label: 'Guía', keywords: ['guia', 'guide', 'cue', 'cues', 'vocal guide'] },
  { type: 'choir', label: 'Coros', keywords: ['coro', 'coros', 'choir', 'bgv', 'backing vocal', 'backings', 'harmony', 'armonia'] },
  { type: 'vocals', label: 'Voces', keywords: ['voz', 'voces', 'vocal', 'vocals', 'vox', 'lead', 'cantante'] },
  { type: 'percussion', label: 'Percusión', keywords: ['perc', 'percusion', 'percussion', 'shaker', 'tambourine', 'pandero', 'conga', 'loop', 'loops'] },
  { type: 'drums', label: 'Batería', keywords: ['bateria', 'drum', 'drums', 'kick', 'snare', 'bombo', 'redoblante', 'toms', 'overhead', 'hihat', 'hat'] },
  { type: 'bass', label: 'Bajo', keywords: ['bajo', 'bass', 'sub', '808'] },
  { type: 'guitar', label: 'Guitarra', keywords: ['guitarra', 'guitar', 'gtr', 'eg', 'ag', 'electrica', 'acustica', 'acoustic', 'electric'] },
  { type: 'keys', label: 'Piano', keywords: ['piano', 'keys', 'key', 'teclado', 'teclados', 'rhodes', 'organ', 'organo', 'wurli'] },
  { type: 'synth', label: 'Sintetizador', keywords: ['synth', 'sinte', 'pad', 'pads', 'strings', 'cuerdas', 'arp', 'lead synth'] }
]

function normalize(s: string): string {
  return s
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[_\-.]+/g, ' ')
}

export function guessTrack(fileName: string): { name: string; type: TrackType } {
  const base = path.basename(fileName, path.extname(fileName))
  const words = normalize(base).split(/\s+/).filter(Boolean)
  const text = ` ${words.join(' ')} `
  for (const rule of RULES) {
    if (rule.keywords.some((k) => text.includes(` ${k} `) || words.some((w) => w.startsWith(k) && k.length >= 4))) {
      return { name: prettify(base), type: rule.type }
    }
  }
  return { name: prettify(base), type: 'other' }
}

/** "01_bateria-final" → "01 Bateria Final" (se conserva lo que escribió el usuario, solo se limpia). */
function prettify(base: string): string {
  const cleaned = base.replace(/[_]+/g, ' ').replace(/\s+/g, ' ').trim()
  return cleaned ? cleaned.charAt(0).toUpperCase() + cleaned.slice(1) : 'Pista'
}
