import path from 'node:path'
import { AppException } from '../errors'

/**
 * Resuelve `relative` dentro de `root` y garantiza que el resultado no escapa de `root`
 * (protección contra path traversal: "..", rutas absolutas, letras de unidad, UNC).
 */
export function resolveInside(root: string, relative: string): string {
  if (relative.includes('\0')) throw new AppException('INVALID_PATH', 'Ruta inválida.')
  const normalized = relative.replace(/\\/g, '/')
  if (path.isAbsolute(normalized) || /^[a-zA-Z]:/.test(normalized) || normalized.startsWith('//')) {
    throw new AppException('INVALID_PATH', `Ruta absoluta no permitida: ${relative}`)
  }
  const base = path.resolve(root)
  const target = path.resolve(base, normalized)
  const rel = path.relative(base, target)
  if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new AppException('INVALID_PATH', `Ruta fuera de la carpeta permitida: ${relative}`)
  }
  return target
}

const RESERVED_WINDOWS_NAMES = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i

/** Convierte un texto libre (nombre de canción/pista) en un nombre de archivo/carpeta válido en Windows. */
export function sanitizeFileName(input: string, fallback = 'sin-nombre'): string {
  let name = input
    .normalize('NFC')
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/, '')
  if (name.length > 80) name = name.slice(0, 80).trim()
  if (!name || RESERVED_WINDOWS_NAMES.test(name)) name = fallback
  return name
}
