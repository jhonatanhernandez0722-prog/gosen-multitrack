import logo from '../assets/logo.png'
import { HolyricsBadge } from './HolyricsBadge'
import { NowPlaying } from './NowPlaying'
import { Icon, type IconName } from './Icon'

export type Screen = 'library' | 'player' | 'editor' | 'holyrics' | 'settings'

const ITEMS: { id: Screen; label: string; icon: IconName }[] = [
  { id: 'library', label: 'Biblioteca', icon: 'library' },
  { id: 'player', label: 'Reproductor', icon: 'mixer' },
  { id: 'editor', label: 'Editor', icon: 'edit' },
  { id: 'holyrics', label: 'Holyrics', icon: 'slides' },
  { id: 'settings', label: 'Configuración', icon: 'settings' }
]

export function Sidebar({ current, onNavigate }: { current: Screen; onNavigate: (s: Screen) => void }) {
  return (
    <nav className="sidebar" aria-label="Navegación principal">
      <div className="brand">
        <img src={logo} alt="" className="brand-mark" />
        <div>
          <div className="brand-name">GOSEN</div>
          <div className="brand-sub">Multitrack</div>
        </div>
      </div>
      <ul className="nav-list">
        {ITEMS.map((item) => (
          <li key={item.id}>
            <button
              className={`nav-item${current === item.id ? ' active' : ''}`}
              aria-current={current === item.id ? 'page' : undefined}
              onClick={() => onNavigate(item.id)}
            >
              <Icon name={item.icon} />
              <span>{item.label}</span>
            </button>
          </li>
        ))}
      </ul>
      {current !== 'player' && <NowPlaying onOpen={() => onNavigate('player')} />}
      <div className="sidebar-footer">
        <HolyricsBadge />
      </div>
    </nav>
  )
}
