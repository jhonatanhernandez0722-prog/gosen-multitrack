import { promises as fs } from 'node:fs'
import path from 'node:path'
import { safeStorage } from 'electron'
import type { AppSettings, SettingsPatch } from '../../shared/types'
import { writeFileAtomic, writeJsonAtomic } from '../fs/atomicWrite'
import { AppException } from '../errors'

type StoredSettings = Omit<AppSettings, 'holyrics'> & {
  holyrics: Omit<AppSettings['holyrics'], 'hasToken'>
}

const DEFAULTS: StoredSettings = {
  libraryPath: null,
  playback: { outputDeviceId: '', masterVolume: 0.9, startLatencyMs: 100 },
  // 8091 es el puerto que muestra la documentación oficial de Holyrics como ejemplo (GetAPIServerInfo).
  holyrics: { enabled: false, host: '127.0.0.1', port: 8091, autoShowOnPlay: true }
}

/**
 * Configuración persistente en %APPDATA%/Gosen Multitrack/settings.json.
 * El token de Holyrics se guarda aparte y cifrado con safeStorage (DPAPI en Windows);
 * nunca se envía al renderer.
 */
export class ConfigService {
  private settings: StoredSettings = structuredClone(DEFAULTS)
  private readonly settingsFile: string
  private readonly tokenFile: string

  constructor(userDataDir: string) {
    this.settingsFile = path.join(userDataDir, 'settings.json')
    this.tokenFile = path.join(userDataDir, 'holyrics-token.bin')
  }

  async load(): Promise<void> {
    try {
      const raw = JSON.parse(await fs.readFile(this.settingsFile, 'utf8')) as Partial<StoredSettings>
      this.settings = {
        libraryPath: typeof raw.libraryPath === 'string' ? raw.libraryPath : null,
        playback: { ...DEFAULTS.playback, ...raw.playback },
        holyrics: { ...DEFAULTS.holyrics, ...raw.holyrics }
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        // Archivo corrupto: se conserva una copia para diagnóstico y se usan valores por defecto.
        console.warn('[gosen] settings.json ilegible, usando valores por defecto:', err)
        await fs.copyFile(this.settingsFile, this.settingsFile + '.corrupt').catch(() => undefined)
      }
      this.settings = structuredClone(DEFAULTS)
    }
  }

  async get(): Promise<AppSettings> {
    return {
      ...structuredClone(this.settings),
      holyrics: { ...this.settings.holyrics, hasToken: await this.hasToken() }
    }
  }

  get libraryPath(): string | null {
    return this.settings.libraryPath
  }

  async update(patch: SettingsPatch): Promise<AppSettings> {
    // Solo se aceptan claves conocidas: el objeto llega desde el renderer.
    const p = patch.playback ?? {}
    const h = patch.holyrics ?? {}
    const cur = this.settings
    const next: StoredSettings = {
      libraryPath: patch.libraryPath !== undefined ? patch.libraryPath : cur.libraryPath,
      playback: {
        outputDeviceId: typeof p.outputDeviceId === 'string' ? p.outputDeviceId : cur.playback.outputDeviceId,
        masterVolume: typeof p.masterVolume === 'number' ? p.masterVolume : cur.playback.masterVolume,
        startLatencyMs: typeof p.startLatencyMs === 'number' ? p.startLatencyMs : cur.playback.startLatencyMs
      },
      holyrics: {
        enabled: typeof h.enabled === 'boolean' ? h.enabled : cur.holyrics.enabled,
        host: typeof h.host === 'string' ? h.host : cur.holyrics.host,
        port: typeof h.port === 'number' ? h.port : cur.holyrics.port,
        autoShowOnPlay: typeof h.autoShowOnPlay === 'boolean' ? h.autoShowOnPlay : cur.holyrics.autoShowOnPlay
      }
    }
    validate(next)
    await fs.mkdir(path.dirname(this.settingsFile), { recursive: true })
    await writeJsonAtomic(this.settingsFile, next)
    this.settings = next
    return this.get()
  }

  async setHolyricsToken(token: string | null): Promise<void> {
    if (!token) {
      await fs.rm(this.tokenFile, { force: true })
      return
    }
    if (!safeStorage.isEncryptionAvailable()) {
      throw new AppException('IO_ERROR', 'El cifrado del sistema no está disponible; no se guardará el token.')
    }
    await fs.mkdir(path.dirname(this.tokenFile), { recursive: true })
    await writeFileAtomic(this.tokenFile, safeStorage.encryptString(token))
  }

  /** Solo para uso interno del proceso principal (HolyricsClient). */
  async getHolyricsToken(): Promise<string | null> {
    try {
      const data = await fs.readFile(this.tokenFile)
      return safeStorage.decryptString(data)
    } catch {
      return null
    }
  }

  private async hasToken(): Promise<boolean> {
    return fs.access(this.tokenFile).then(
      () => true,
      () => false
    )
  }
}

function validate(s: StoredSettings): void {
  const { port, host } = s.holyrics
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new AppException('INVALID_PATH', 'El puerto de Holyrics debe estar entre 1 y 65535.')
  }
  if (!/^[a-zA-Z0-9.\-:[\]]+$/.test(host)) {
    throw new AppException('INVALID_PATH', 'La dirección de Holyrics no es válida.')
  }
  const { masterVolume, startLatencyMs } = s.playback
  if (!(masterVolume >= 0 && masterVolume <= 1)) throw new AppException('UNKNOWN', 'Volumen fuera de rango.')
  if (!(startLatencyMs >= 20 && startLatencyMs <= 1000)) {
    throw new AppException('UNKNOWN', 'La latencia de arranque debe estar entre 20 y 1000 ms.')
  }
  if (s.libraryPath !== null && !path.isAbsolute(s.libraryPath)) {
    throw new AppException('INVALID_PATH', 'La carpeta de biblioteca debe ser una ruta absoluta.')
  }
}
