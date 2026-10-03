import { AppException } from '../../errors'

/**
 * Cliente HTTP mínimo para la API Server OFICIAL de Holyrics.
 * Documentación: https://github.com/holyrics/API-Server
 *
 *   POST http://[IP]:[PORT]/api/{action}?token=...   (Content-Type: application/json)
 *   Respuesta: { "status": "ok", "data": ... } | { "status": "error", "error": string | {code,key,message} }
 *
 * Se activa en Holyrics: Archivo > Configuración > API Server. El token se crea en
 * "gestionar permisos", y cada token tiene permisos por acción.
 *
 * Solo se usa el método por token en red local. (La doc también describe un método "hash"
 * con nonce/sha256 y un endpoint por internet con API_KEY; se pueden añadir aquí sin tocar el resto.)
 */
export interface HolyricsConnection {
  host: string
  port: number
  token: string
}

const TIMEOUT_MS = 3000

export class HolyricsClient {
  constructor(private readonly conn: HolyricsConnection) {}

  async request<T = unknown>(action: string, body: Record<string, unknown> = {}): Promise<T> {
    const host = this.conn.host.includes(':') && !this.conn.host.startsWith('[') ? `[${this.conn.host}]` : this.conn.host
    const url = `http://${host}:${this.conn.port}/api/${encodeURIComponent(action)}?token=${encodeURIComponent(this.conn.token)}`

    let res: Response
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_MS)
      })
    } catch {
      throw new AppException(
        'HOLYRICS_UNREACHABLE',
        `No se pudo conectar con Holyrics en ${this.conn.host}:${this.conn.port}. ¿Está abierto y con la API Server activada?`
      )
    }

    if (res.status === 401 || res.status === 403) {
      throw new AppException('HOLYRICS_AUTH', 'Holyrics rechazó el token o no tiene permiso para esta acción.')
    }

    let json: { status?: string; data?: unknown; error?: unknown }
    try {
      json = (await res.json()) as typeof json
    } catch {
      throw new AppException('HOLYRICS_ERROR', `Respuesta no válida de Holyrics (HTTP ${res.status}).`)
    }

    if (json.status !== 'ok') {
      const message = describeError(json.error)
      const code = /token|permission|unauthorized/i.test(message) ? 'HOLYRICS_AUTH' : 'HOLYRICS_ERROR'
      throw new AppException(code, `Holyrics (${action}): ${message}`)
    }
    return json.data as T
  }
}

function describeError(error: unknown): string {
  if (typeof error === 'string') return error
  if (error && typeof error === 'object') {
    const e = error as Record<string, unknown>
    if (typeof e.message === 'string') return e.message
    if (typeof e.unauthorized_actions === 'string') return `acciones no autorizadas: ${e.unauthorized_actions}`
    return JSON.stringify(error)
  }
  return 'error desconocido'
}
