import { useEffect, useState } from 'react'
import { errorMessage, unwrap, UiError } from '../lib/errors'
import { useSettings } from '../state/SettingsContext'

export function SettingsScreen() {
  const { settings, update, replace } = useSettings()
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)
  const [host, setHost] = useState('')
  const [port, setPort] = useState('')
  const [token, setToken] = useState('')

  useEffect(() => {
    if (!settings) return
    setHost(settings.holyrics.host)
    setPort(String(settings.holyrics.port))
  }, [settings?.holyrics.host, settings?.holyrics.port])

  if (!settings) return null

  const run = async (op: () => Promise<void>, okText: string) => {
    setMessage(null)
    try {
      await op()
      setMessage({ kind: 'ok', text: okText })
    } catch (err) {
      if (err instanceof UiError && err.code === 'CANCELLED') return
      setMessage({ kind: 'error', text: errorMessage(err) })
    }
  }

  return (
    <section className="screen">
      <header className="screen-header">
        <h1>Configuración</h1>
      </header>

      {message && <div className={`alert ${message.kind === 'ok' ? 'success' : 'error'}`}>{message.text}</div>}

      <div className="card">
        <h2>Biblioteca</h2>
        <div className="field">
          <label>Carpeta de la biblioteca</label>
          <div className="row">
            <input className="input grow" readOnly value={settings.libraryPath ?? 'Sin configurar'} />
            <button
              className="btn"
              onClick={() =>
                run(async () => replace(await unwrap(window.gosen.settings.chooseLibraryFolder())), 'Carpeta guardada.')
              }
            >
              Cambiar…
            </button>
          </div>
          <p className="hint">Cada canción es una subcarpeta con su song.json y sus pistas en /tracks.</p>
        </div>
      </div>

      <div className="card">
        <h2>Holyrics</h2>
        <div className="field checkbox">
          <label>
            <input
              type="checkbox"
              checked={settings.holyrics.enabled}
              onChange={(e) => run(() => update({ holyrics: { enabled: e.target.checked } }), 'Guardado.')}
            />
            Activar integración con Holyrics (API Server)
          </label>
        </div>
        <div className="row">
          <div className="field grow">
            <label htmlFor="hr-host">Dirección (IP del PC con Holyrics)</label>
            <input id="hr-host" className="input" value={host} onChange={(e) => setHost(e.target.value)} />
          </div>
          <div className="field" style={{ width: 120 }}>
            <label htmlFor="hr-port">Puerto</label>
            <input id="hr-port" className="input" inputMode="numeric" value={port} onChange={(e) => setPort(e.target.value)} />
          </div>
          <button
            className="btn align-end"
            onClick={() => run(() => update({ holyrics: { host: host.trim(), port: Number(port) } }), 'Dirección guardada.')}
          >
            Guardar
          </button>
        </div>
        <div className="field">
          <label htmlFor="hr-token">Token de acceso {settings.holyrics.hasToken && <span className="tag success">guardado</span>}</label>
          <div className="row">
            <input
              id="hr-token"
              className="input grow"
              type="password"
              autoComplete="off"
              placeholder={settings.holyrics.hasToken ? '•••••••• (escribe para reemplazar)' : 'Pega aquí el token'}
              value={token}
              onChange={(e) => setToken(e.target.value)}
            />
            <button
              className="btn"
              disabled={!token.trim()}
              onClick={() =>
                run(async () => {
                  replace(await unwrap(window.gosen.settings.setHolyricsToken(token)))
                  setToken('')
                }, 'Token guardado de forma cifrada.')
              }
            >
              Guardar token
            </button>
            {settings.holyrics.hasToken && (
              <button
                className="btn danger"
                onClick={() =>
                  run(async () => replace(await unwrap(window.gosen.settings.setHolyricsToken(null))), 'Token eliminado.')
                }
              >
                Borrar
              </button>
            )}
          </div>
          <p className="hint">
            En Holyrics: Archivo › Configuración › API Server › gestionar permisos. El token se cifra con el sistema
            (Windows DPAPI) y nunca sale del proceso principal.
          </p>
        </div>
      </div>

      <PlaybackCard run={run} />
    </section>
  )
}

type Run = (op: () => Promise<void>, okText: string) => Promise<void>

function PlaybackCard({ run }: { run: Run }) {
  const { settings, update } = useSettings()
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([])
  const [latency, setLatency] = useState(String(settings?.playback.startLatencyMs ?? 100))

  useEffect(() => {
    const refresh = () =>
      navigator.mediaDevices
        ?.enumerateDevices()
        .then((list) => setDevices(list.filter((d) => d.kind === 'audiooutput' && d.deviceId !== 'default')))
        .catch(() => setDevices([]))
    void refresh()
    navigator.mediaDevices?.addEventListener('devicechange', refresh)
    return () => navigator.mediaDevices?.removeEventListener('devicechange', refresh)
  }, [])

  if (!settings) return null
  const { playback, holyrics } = settings
  const savedMissing = playback.outputDeviceId && !devices.some((d) => d.deviceId === playback.outputDeviceId)

  return (
    <div className="card">
      <h2>Reproducción</h2>
      <div className="field">
        <label htmlFor="out-dev">Salida de audio</label>
        <select
          id="out-dev"
          className="input"
          value={playback.outputDeviceId}
          onChange={(e) => run(() => update({ playback: { outputDeviceId: e.target.value } }), 'Salida de audio cambiada.')}
        >
          <option value="">Predeterminada del sistema</option>
          {devices.map((d, i) => (
            <option key={d.deviceId} value={d.deviceId}>
              {d.label || `Dispositivo ${i + 1}`}
            </option>
          ))}
          {savedMissing && <option value={playback.outputDeviceId}>Dispositivo guardado (no conectado)</option>}
        </select>
        <p className="hint">Si eliges una interfaz de audio, conéctala antes del servicio. Si se desconecta, se usa la salida predeterminada.</p>
      </div>
      <div className="row">
        <div className="field" style={{ width: 220 }}>
          <label htmlFor="lat">Margen de arranque (ms)</label>
          <input id="lat" className="input" inputMode="numeric" value={latency} onChange={(e) => setLatency(e.target.value)} />
        </div>
        <button
          className="btn align-end"
          onClick={() => run(() => update({ playback: { startLatencyMs: Number(latency) } }), 'Margen guardado.')}
        >
          Guardar
        </button>
      </div>
      <p className="hint">
        Tiempo que se reserva para programar todas las pistas en el mismo instante. 100 ms es seguro; súbelo si notas cortes
        al pulsar Play en un equipo lento.
      </p>
      <div className="field checkbox">
        <label>
          <input
            type="checkbox"
            checked={holyrics.autoShowOnPlay}
            onChange={(e) => run(() => update({ holyrics: { autoShowOnPlay: e.target.checked } }), 'Guardado.')}
          />
          Mostrar la letra en Holyrics automáticamente al reproducir una canción vinculada
        </label>
      </div>
    </div>
  )
}
