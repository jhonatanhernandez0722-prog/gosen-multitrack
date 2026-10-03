import type { AppError, Result } from '../../../shared/types'

/** Error del lado UI que conserva el código del proceso principal. */
export class UiError extends Error {
  constructor(readonly appError: AppError) {
    super(appError.message)
  }
  get code(): AppError['code'] {
    return this.appError.code
  }
}

/** Convierte un Result en valor o lanza UiError (para usar con try/catch en la UI). */
export async function unwrap<T>(promise: Promise<Result<T>>): Promise<T> {
  const res = await promise
  if (!res.ok) throw new UiError(res.error)
  return res.value
}

export function errorMessage(err: unknown): string {
  if (err instanceof UiError) return err.message
  if (err instanceof Error) return err.message
  return String(err)
}
