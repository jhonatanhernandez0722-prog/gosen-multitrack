import type { AppError, AppErrorCode, Result } from '../shared/types'

/** Error de dominio con un código estable que la UI puede traducir a un mensaje claro. */
export class AppException extends Error {
  constructor(
    readonly code: AppErrorCode,
    message: string
  ) {
    super(message)
    this.name = 'AppException'
  }
}

export function toAppError(err: unknown): AppError {
  if (err instanceof AppException) return { code: err.code, message: err.message }
  const nodeCode = (err as NodeJS.ErrnoException | undefined)?.code
  if (nodeCode === 'EBUSY' || nodeCode === 'EPERM' || nodeCode === 'EACCES') {
    return { code: 'FILE_LOCKED', message: 'El archivo está bloqueado o no hay permisos para accederlo.' }
  }
  if (nodeCode === 'ENOENT') return { code: 'NOT_FOUND', message: 'No se encontró el archivo o carpeta.' }
  const message = err instanceof Error ? err.message : String(err)
  return { code: 'UNKNOWN', message }
}

/** Ejecuta una operación y la envuelve en Result; los errores se registran y nunca se propagan al IPC. */
export async function asResult<T>(op: () => Promise<T> | T): Promise<Result<T>> {
  try {
    return { ok: true, value: await op() }
  } catch (err) {
    const error = toAppError(err)
    if (error.code === 'UNKNOWN') console.error('[gosen] error inesperado:', err)
    return { ok: false, error }
  }
}
