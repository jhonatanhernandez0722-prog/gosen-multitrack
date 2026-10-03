import { useHolyricsStatus } from '../state/useHolyricsStatus'
import { useSettings } from '../state/SettingsContext'

/** Acciones de la API Server oficial que usa Gosen Multitrack (el token necesita permiso para cada una). */
const ACTIONS: { feature: string; action: string; version: string }[] = [
  { feature: 'Comprobar conexión', action: 'GetTokenInfo', version: '2.25' },
  { feature: 'Buscar la canción', action: 'SearchSong', version: '2.19' },
  { feature: 'Leer diapositivas', action: 'GetSong · GetCurrentPresentation', version: '2.21' },
  { feature: 'Mostrar la letra', action: 'ShowSong', version: '2.19 (índice inicial 2.23)' },
  { feature: 'Cambiar de diapositiva por número', action: 'ActionGoToIndex', version: '2.19' },
  { feature: 'Cambiar de diapositiva por sección', action: 'ActionGoToSlideDescription', version: '2.19' },
  { feature: 'Cerrar la letra', action: 'CloseCurrentPresentation', version: '2.19' }
]

export function HolyricsScreen({ onOpenSettings }: { onOpenSettings: () => void }) {
  const { status, refresh } = useHolyricsStatus()
  const { settings } = useSettings()
  const h = settings?.holyrics

  return (
    <section className="screen">
      <header className="screen-header">
        <h1>Integración con Holyrics</h1>
        <div className="row">
          <button className="btn" onClick={onOpenSettings}>
            Configurar
          </button>
          <button className="btn primary" onClick={refresh} disabled={!h?.enabled}>
            Probar conexión
          </button>
        </div>
      </header>

      <div className="card">
        <h2>Estado</h2>
        <p>
          <strong>
            {status?.state === 'connected'
              ? 'Conectado'
              : status?.state === 'disabled'
                ? 'Desactivado'
                : status?.state === 'not-configured'
                  ? 'Falta el token'
                  : 'Sin conexión'}
          </strong>
          {status?.version && <span className="muted"> · Holyrics {status.version}</span>}
          {h?.enabled && (
            <span className="muted">
              {' '}
              · {h.host}:{h.port}
            </span>
          )}
        </p>
        {status?.message && <p className="muted">{status.message}</p>}
      </div>

      <div className="card">
        <h2>Cómo configurarlo</h2>
        <ol className="steps">
          <li>En Holyrics: Archivo › Configuración › API Server. Activa el acceso local y anota el puerto.</li>
          <li>En "gestionar permisos", crea un token y autoriza las acciones de la tabla de abajo.</li>
          <li>En Gosen › Configuración: activa Holyrics, escribe la IP (127.0.0.1 si es el mismo PC), el puerto y el token.</li>
          <li>En el Editor de cada canción, búscala en Holyrics para vincularla.</li>
        </ol>
      </div>

      <div className="card">
        <h2>Acciones de la API oficial que se usan</h2>
        <table className="song-table compact">
          <thead>
            <tr>
              <th>Función</th>
              <th>Acción</th>
              <th>Holyrics mínimo</th>
            </tr>
          </thead>
          <tbody>
            {ACTIONS.map((a) => (
              <tr key={a.action}>
                <td>{a.feature}</td>
                <td>
                  <code>{a.action}</code>
                </td>
                <td className="muted">{a.version}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="hint">
          Holyrics no puede seguir por sí mismo el reloj de un reproductor externo. Por eso Gosen guarda marcas de tiempo en
          cada canción y, al llegar a cada una, envía a Holyrics el cambio de diapositiva.
        </p>
      </div>
    </section>
  )
}
