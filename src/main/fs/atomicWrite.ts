import { promises as fs } from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

/**
 * Escribe un archivo de forma atómica: primero a un temporal en la misma carpeta y luego rename.
 * Si la app se cierra a mitad de escritura, el archivo original queda intacto.
 */
export async function writeFileAtomic(filePath: string, data: string | Uint8Array): Promise<void> {
  const dir = path.dirname(filePath)
  const tmp = path.join(dir, `.${path.basename(filePath)}.${randomUUID()}.tmp`)
  await fs.writeFile(tmp, data)
  try {
    await renameWithRetry(tmp, filePath)
  } catch (err) {
    await fs.rm(tmp, { force: true })
    throw err
  }
}

export async function writeJsonAtomic(filePath: string, value: unknown): Promise<void> {
  await writeFileAtomic(filePath, JSON.stringify(value, null, 2) + '\n')
}

/** En Windows el antivirus o el indexador pueden bloquear el archivo un instante (EPERM/EBUSY). */
async function renameWithRetry(from: string, to: string, attempts = 5): Promise<void> {
  for (let i = 0; ; i++) {
    try {
      await fs.rename(from, to)
      return
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code
      if (i >= attempts - 1 || (code !== 'EPERM' && code !== 'EBUSY' && code !== 'EACCES')) throw err
      await new Promise((r) => setTimeout(r, 50 * (i + 1)))
    }
  }
}
