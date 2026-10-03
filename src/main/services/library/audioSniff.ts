import { promises as fs } from 'node:fs'
import path from 'node:path'

/**
 * Comprueba la cabecera real del archivo (no solo la extensión) para descartar archivos
 * renombrados o dañados antes de añadirlos a la biblioteca.
 */
export function looksLikeAudio(fileName: string, head: Uint8Array): boolean {
  const ext = path.extname(fileName).toLowerCase()
  const ascii = (from: number, to: number) => String.fromCharCode(...head.subarray(from, to))
  if (ext === '.wav') {
    return ['RIFF', 'RF64', 'BW64'].includes(ascii(0, 4)) && ascii(8, 12) === 'WAVE'
  }
  if (ext === '.mp3') {
    if (ascii(0, 3) === 'ID3') return true
    return head[0] === 0xff && (head[1]! & 0xe0) === 0xe0
  }
  // Formatos futuros: validar al activarlos en shared/audioFormats.ts.
  return false
}

export async function sniffFile(filePath: string): Promise<boolean> {
  const handle = await fs.open(filePath, 'r')
  try {
    const buf = new Uint8Array(12)
    const { bytesRead } = await handle.read(buf, 0, 12, 0)
    return bytesRead >= 4 && looksLikeAudio(filePath, buf)
  } finally {
    await handle.close()
  }
}
