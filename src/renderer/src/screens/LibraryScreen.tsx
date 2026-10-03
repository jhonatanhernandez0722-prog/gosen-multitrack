import { useCallback, useEffect, useMemo, useState } from 'react'
import type { LibraryEntry, LibraryScanResult } from '../../../shared/types'
import { errorMessage, unwrap } from '../lib/errors'
import { formatTime } from '../lib/format'
import { useSettings } from '../state/SettingsContext'
import { notifySongDeleted, usePlayerState } from '../state/playback'
import { useImportFlow } from '../state/useImportFlow'
import { useToast } from '../components/Toast'
import { Modal } from '../components/Modal'
import { Icon } from '../components/Icon'
import { LibrarySetupButtons } from '../components/LibrarySetup'
import { TRACK_TYPE_COLORS, TRACK_TYPE_LABELS } from '../lib/trackTypes'

interface Props {
  onPlay: (entry: LibraryEntry) => void
  onEdit: (songId: string) => void
  onOpenSettings: () => void
}

export function LibraryScreen({ onPlay, onEdit, onOpenSettings }: Props) {
  const { settings } = useSettings()
  const toast = useToast()
  const { song: loadedSong, status } = usePlayerState()
  const [scan, setScan] = useState<LibraryScanResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [creating, setCreating] = useState(false)
  const libraryPath = settings?.libraryPath ?? null

  const load = useCallback(async () => {
    setError(null)
    try {
      setScan(await unwrap(window.gosen.library.scan()))
    } catch (err) {
      setScan(null)
      setError(errorMessage(err))
    }
  }, [])

  useEffect(() => {
    if (libraryPath) void load()
  }, [libraryPath, load])

  const importFlow = useImportFlow(() => void load())

  const remove = async (entry: LibraryEntry) => {
    if (loadedSong?.id === entry.song.id && status === 'playing') {
      toast.error('No se puede eliminar la canción que está sonando. Deténla primero.')
      return
    }
    const res = await window.gosen.library.delete(entry.song.id)
    if (!res.ok) {
      if (res.error.code !== 'CANCELLED') toast.error(res.error.message)
      return
    }
    notifySongDeleted(entry.song.id)
    toast.success(`"${entry.song.name}" enviada a la Papelera.`)
    void load()
  }

  const reimport = (entry: LibraryEntry) => {
    if (loadedSong?.id === entry.song.id && status === 'playing') {
      toast.error('Detén la canción antes de reemplazar sus pistas.')
      return
    }
    void importFlow.start({ id: entry.song.id, name: entry.song.name, artist: entry.song.artist })
  }

  const filtered = useMemo(() => {
    const q = normalize(query)
    const entries = scan?.entries ?? []
    return q ? entries.filter((e) => normalize(`${e.song.name} ${e.song.artist}`).includes(q)) : entries
  }, [scan, query])

  if (!libraryPath) {
    return (
      <section className="screen">
        <header className="screen-header">
          <h1>Biblioteca</h1>
        </header>
        <div className="empty-state">
          <h2>Elige dónde guardar tu biblioteca musical</h2>
          <p className="muted">
            Cada canción se guarda en una carpeta de este equipo, con sus pistas. Después podrás arrastrar aquí tus ZIP.
          </p>
          <LibrarySetupButtons />
        </div>
      </section>
    )
  }

  return (
    <section className="screen">
      <header className="screen-header">
        <div>
          <div className="eyebrow muted">{scan ? `${scan.entries.length} canciones` : 'Cargando…'}</div>
          <h1>Biblioteca</h1>
        </div>
        <div className="toolbar">
          <div className="search-wrap">
            <Icon name="search" size={16} />
          <input
            className="input search"
            type="search"
            placeholder="Buscar canción o artista…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Buscar canción"
          />
          </div>
          <button className="btn icon-only" onClick={() => void load()} title="Volver a leer la carpeta" aria-label="Actualizar">
            <Icon name="refresh" />
          </button>
          <button className="btn" onClick={() => setCreating(true)}>
            <Icon name="plus" /> Nueva
          </button>
          <button className="btn primary" onClick={() => void importFlow.start()}>
            <Icon name="upload" /> Importar ZIP
          </button>
        </div>
      </header>

      <p className="muted small path-line">
        {libraryPath} · <button className="link" onClick={() => void window.gosen.library.openFolder()}>abrir</button> ·{' '}
        <button className="link" onClick={onOpenSettings}>cambiar</button>
      </p>

      {error && <div className="alert error">{error}</div>}
      {scan?.errors.map((e) => (
        <div key={e.folderName} className="alert warning">
          <strong>{e.folderName}:</strong> {e.message}
        </div>
      ))}

      {scan && scan.entries.length === 0 && !error && (
        <div className="empty-state">
          <h2>La biblioteca está vacía</h2>
          <p className="muted">Arrastra aquí un ZIP con las pistas WAV o MP3 de una canción, o elígelo desde tu PC.</p>
          <button className="btn primary" onClick={() => void importFlow.start()}>
            Importar ZIP
          </button>
        </div>
      )}

      {scan && scan.entries.length > 0 && filtered.length === 0 && <p className="muted">Ninguna canción coincide con "{query}".</p>}

      {filtered.length > 0 && (
        <table className="song-table">
          <thead>
            <tr>
              <th style={{ width: 56 }} />
              <th>Canción</th>
              <th>Artista</th>
              <th className="num">Pistas</th>
              <th className="num">Duración</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {filtered.map((entry) => {
              const { song, folderName, missingTrackIds } = entry
              const isLoaded = loadedSong?.id === song.id
              return (
                <tr key={song.id} className={isLoaded ? 'is-loaded' : ''} onDoubleClick={() => onPlay(entry)}>
                  <td>
                    <button className="play-chip" onClick={() => onPlay(entry)} aria-label={`Reproducir ${song.name}`} title="Abrir en el reproductor">
                      ▶
                    </button>
                  </td>
                  <td>
                    <div className="song-cell">
                      <span className="song-title-row">
                        <span className="song-name">{song.name}</span>
                        {song.holyrics.enabled && song.holyrics.holyricsSongId && (
                          <span className="tag accent" title="Vinculada con Holyrics">
                            Holyrics
                          </span>
                        )}
                      </span>
                      <span className="track-dots" aria-label={song.tracks.map((t) => TRACK_TYPE_LABELS[t.type]).join(', ')}>
                        {song.tracks.map((t) => (
                          <span key={t.id} style={{ background: TRACK_TYPE_COLORS[t.type] }} title={t.name} />
                        ))}
                      </span>
                    </div>
                  </td>
                  <td className="muted">{song.artist || '—'}</td>
                  <td className="num">
                    {song.tracks.length}
                    {missingTrackIds.length > 0 && (
                      <span className="tag warning" title="Hay pistas cuyo archivo no existe">
                        {missingTrackIds.length} faltan
                      </span>
                    )}
                  </td>
                  <td className="num mono">{song.duration ? formatTime(song.duration) : '—'}</td>
                  <td className="actions">
                    <button className="btn small" onClick={() => onEdit(song.id)}>
                      <Icon name="edit" size={14} /> Editar
                    </button>
                    <button className="btn small icon-only" onClick={() => void window.gosen.library.openFolder(folderName)} title="Abrir carpeta" aria-label="Abrir carpeta">
                      <Icon name="folder" size={14} />
                    </button>
                    <button className="btn small icon-only" onClick={() => reimport(entry)} title="Reimportar ZIP (reemplaza las pistas)" aria-label="Reimportar ZIP">
                      <Icon name="swap" size={14} />
                    </button>
                    <button className="btn small icon-only danger" onClick={() => void remove(entry)} title="Enviar a la Papelera" aria-label="Eliminar">
                      <Icon name="trash" size={14} />
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}

      {importFlow.dialog}
      {creating && (
        <CreateSongDialog
          onClose={() => setCreating(false)}
          onCreated={(entry) => {
            setCreating(false)
            onEdit(entry.song.id)
          }}
        />
      )}
    </section>
  )
}

function CreateSongDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (e: LibraryEntry) => void }) {
  const [name, setName] = useState('')
  const [artist, setArtist] = useState('')
  const [error, setError] = useState<string | null>(null)

  const create = async () => {
    try {
      onCreated(await unwrap(window.gosen.library.create({ name, artist })))
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  return (
    <Modal
      title="Nueva canción"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancelar
          </button>
          <button className="btn primary" disabled={!name.trim()} onClick={create}>
            Crear y añadir pistas
          </button>
        </>
      }
    >
      <div className="field">
        <label htmlFor="new-name">Nombre</label>
        <input id="new-name" className="input" autoFocus value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && name.trim() && void create()} />
      </div>
      <div className="field">
        <label htmlFor="new-artist">Artista</label>
        <input id="new-artist" className="input" value={artist} onChange={(e) => setArtist(e.target.value)} />
      </div>
      {error && <div className="alert error">{error}</div>}
    </Modal>
  )
}

/** Búsqueda sin tildes ni mayúsculas ("Batería" encuentra "bateria"). */
function normalize(s: string): string {
  return s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().trim()
}
