import { useCallback, useEffect, useState } from 'react'
import type { HolyricsSlideList, HolyricsSongSummary, LibraryEntry, LyricsCue, Result, TrackType } from '../../../shared/types'
import { useToast } from '../components/Toast'
import { errorMessage, unwrap } from '../lib/errors'
import { formatTime } from '../lib/format'
import { TRACK_TYPES, TRACK_TYPE_COLORS, TRACK_TYPE_LABELS } from '../lib/trackTypes'
import { useSettings } from '../state/SettingsContext'
import { notifySongChanged, player, usePlayerState } from '../state/playback'
import { useImportFlow } from '../state/useImportFlow'

interface Props {
  songId: string | null
  onBack: () => void
  onPlay: (entry: LibraryEntry) => void
}

export function SongEditorScreen({ songId, onBack, onPlay }: Props) {
  const [entry, setEntry] = useState<LibraryEntry | null>(null)
  const [error, setError] = useState<string | null>(null)
  const toast = useToast()

  const load = useCallback(async () => {
    if (!songId) return
    try {
      setEntry(await unwrap(window.gosen.library.get(songId)))
      setError(null)
    } catch (err) {
      setError(errorMessage(err))
    }
  }, [songId])

  useEffect(() => {
    void load()
  }, [load])

  /** Aplica el resultado de una operación de biblioteca y avisa al reproductor. */
  const apply = useCallback(
    async (op: Promise<Result<LibraryEntry>>, okText?: string): Promise<boolean> => {
      const res = await op
      if (!res.ok) {
        if (res.error.code !== 'CANCELLED') toast.error(res.error.message)
        return false
      }
      setEntry(res.value)
      notifySongChanged(res.value.song)
      if (okText) toast.success(okText)
      return true
    },
    [toast]
  )

  if (!songId) {
    return (
      <section className="screen">
        <header className="screen-header">
          <h1>Editor de canción</h1>
        </header>
        <div className="empty-state">
          <h2>Sin canción seleccionada</h2>
          <p className="muted">Elige "Editar" en una canción de la Biblioteca.</p>
          <button className="btn primary" onClick={onBack}>
            Ir a la Biblioteca
          </button>
        </div>
      </section>
    )
  }
  if (error) return <section className="screen"><div className="alert error">{error}</div><button className="btn" onClick={onBack}>Volver</button></section>
  if (!entry) return <section className="screen muted">Cargando…</section>

  return (
    <section className="screen">
      <header className="screen-header">
        <div>
          <button className="link small" onClick={onBack}>
            ← Biblioteca
          </button>
          <h1>{entry.song.name}</h1>
        </div>
        <div className="row">
          <button className="btn" onClick={() => void window.gosen.library.openFolder(entry.folderName)}>
            Abrir carpeta
          </button>
          <button className="btn primary" onClick={() => onPlay(entry)} disabled={entry.song.tracks.length === 0}>
            Abrir en el reproductor
          </button>
        </div>
      </header>

      <DetailsCard entry={entry} apply={apply} />
      <TracksCard entry={entry} apply={apply} onImported={setEntry} />
      <HolyricsCard entry={entry} apply={apply} />
    </section>
  )
}

type Apply = (op: Promise<Result<LibraryEntry>>, okText?: string) => Promise<boolean>

// ---------------------------------------------------------------------------

function DetailsCard({ entry, apply }: { entry: LibraryEntry; apply: Apply }) {
  const { song } = entry
  const [name, setName] = useState(song.name)
  const [artist, setArtist] = useState(song.artist)
  const [bpm, setBpm] = useState(song.bpm ? String(song.bpm) : '')
  const [key, setKey] = useState(song.key ?? '')

  useEffect(() => {
    setName(song.name)
    setArtist(song.artist)
    setBpm(song.bpm ? String(song.bpm) : '')
    setKey(song.key ?? '')
  }, [song.id, song.updatedAt])

  const dirty = name !== song.name || artist !== song.artist || bpm !== (song.bpm ? String(song.bpm) : '') || key !== (song.key ?? '')

  return (
    <div className="card">
      <h2>Datos</h2>
      <div className="row">
        <div className="field grow">
          <label htmlFor="ed-name">Nombre</label>
          <input id="ed-name" className="input" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="field grow">
          <label htmlFor="ed-artist">Artista</label>
          <input id="ed-artist" className="input" value={artist} onChange={(e) => setArtist(e.target.value)} />
        </div>
        <div className="field" style={{ width: 90 }}>
          <label htmlFor="ed-bpm">BPM</label>
          <input id="ed-bpm" className="input" inputMode="decimal" value={bpm} onChange={(e) => setBpm(e.target.value)} />
        </div>
        <div className="field" style={{ width: 90 }}>
          <label htmlFor="ed-key">Tono</label>
          <input id="ed-key" className="input" value={key} onChange={(e) => setKey(e.target.value)} />
        </div>
      </div>
      <div className="row">
        <span className="muted small grow">
          Duración: {song.duration ? formatTime(song.duration) : 'se mide al cargar en el reproductor'} · Carpeta: {entry.folderName}
        </span>
        <button
          className="btn primary"
          disabled={!dirty || !name.trim()}
          onClick={() =>
            void apply(
              window.gosen.library.update(song.id, { name, artist, bpm: bpm ? Number(bpm) || null : null, key: key || null }),
              'Datos guardados.'
            )
          }
        >
          Guardar
        </button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------

function TracksCard({ entry, apply, onImported }: { entry: LibraryEntry; apply: Apply; onImported: (e: LibraryEntry) => void }) {
  const { song } = entry
  const { song: loaded, status } = usePlayerState()
  const playingThis = loaded?.id === song.id && status === 'playing'
  const toast = useToast()
  const importFlow = useImportFlow(onImported)
  const [names, setNames] = useState<Record<string, string>>({})

  useEffect(() => setNames(Object.fromEntries(song.tracks.map((t) => [t.id, t.name]))), [song.updatedAt])

  const guard = (fn: () => void) => () => {
    if (playingThis) toast.error('Detén la reproducción antes de cambiar los archivos de pista.')
    else fn()
  }

  const move = (index: number, delta: number) => {
    const ids = song.tracks.map((t) => t.id)
    const [id] = ids.splice(index, 1)
    ids.splice(index + delta, 0, id!)
    void apply(window.gosen.library.update(song.id, { trackOrder: ids }))
  }

  const saveName = (trackId: string) => {
    const value = names[trackId]?.trim()
    const track = song.tracks.find((t) => t.id === trackId)
    if (!value || !track || value === track.name) return
    void apply(window.gosen.library.update(song.id, { tracks: [{ id: trackId, name: value }] }))
  }

  return (
    <div className="card">
      <div className="row">
        <h2 className="grow">Pistas ({song.tracks.length})</h2>
        <button className="btn small" onClick={guard(() => void apply(window.gosen.library.addTracks(song.id), 'Pistas añadidas.'))}>
          Añadir archivos…
        </button>
        <button className="btn small" onClick={guard(() => void importFlow.start({ id: song.id, name: song.name, artist: song.artist }))}>
          Reimportar ZIP…
        </button>
      </div>

      {song.tracks.length === 0 ? (
        <p className="muted">Sin pistas. Añade archivos WAV/MP3 o reimporta desde un ZIP.</p>
      ) : (
        <table className="song-table compact">
          <thead>
            <tr>
              <th style={{ width: 8 }} />
              <th>Nombre</th>
              <th style={{ width: 150 }}>Tipo</th>
              <th>Archivo</th>
              <th className="num">Duración</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {song.tracks.map((t, i) => {
              const missing = entry.missingTrackIds.includes(t.id)
              return (
                <tr key={t.id}>
                  <td>
                    <span className="track-color" style={{ background: TRACK_TYPE_COLORS[t.type] }} />
                  </td>
                  <td>
                    <input
                      className="input"
                      value={names[t.id] ?? t.name}
                      onChange={(e) => setNames((n) => ({ ...n, [t.id]: e.target.value }))}
                      onBlur={() => saveName(t.id)}
                      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                    />
                  </td>
                  <td>
                    <select
                      className="input"
                      value={t.type}
                      onChange={(e) => void apply(window.gosen.library.update(song.id, { tracks: [{ id: t.id, type: e.target.value as TrackType }] }))}
                    >
                      {TRACK_TYPES.map((type) => (
                        <option key={type} value={type}>
                          {TRACK_TYPE_LABELS[type]}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="small mono">
                    {missing ? <span className="error-text">Falta: {t.file}</span> : <span className="muted">{t.file}</span>}
                  </td>
                  <td className="num">{t.duration ? formatTime(t.duration) : '—'}</td>
                  <td className="actions">
                    <button className="btn small" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Subir">
                      ↑
                    </button>
                    <button className="btn small" disabled={i === song.tracks.length - 1} onClick={() => move(i, 1)} aria-label="Bajar">
                      ↓
                    </button>
                    <button className="btn small" onClick={guard(() => void apply(window.gosen.library.replaceTrack(song.id, t.id), 'Pista reemplazada.'))}>
                      Reemplazar
                    </button>
                    <button className="btn small danger" onClick={guard(() => void apply(window.gosen.library.removeTrack(song.id, t.id), 'Pista quitada.'))}>
                      Quitar
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
      {importFlow.dialog}
    </div>
  )
}

// ---------------------------------------------------------------------------

function HolyricsCard({ entry, apply }: { entry: LibraryEntry; apply: Apply }) {
  const { song } = entry
  const { settings } = useSettings()
  const toast = useToast()
  const [query, setQuery] = useState(song.holyrics.songName || song.name)
  const [results, setResults] = useState<HolyricsSongSummary[] | null>(null)
  const [searching, setSearching] = useState(false)
  const [slides, setSlides] = useState<HolyricsSlideList | null>(null)
  const [cues, setCues] = useState<LyricsCue[]>(song.holyrics.cues)
  const linkedId = song.holyrics.holyricsSongId

  useEffect(() => setCues(song.holyrics.cues), [song.updatedAt])

  if (!settings?.holyrics.enabled) {
    return (
      <div className="card">
        <h2>Holyrics</h2>
        <p className="muted">Activa la integración con Holyrics en Configuración para vincular la letra.</p>
      </div>
    )
  }

  const search = async () => {
    setSearching(true)
    try {
      setResults(await unwrap(window.gosen.holyrics.search(query)))
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setSearching(false)
    }
  }

  const loadSlides = async () => {
    if (!linkedId) return
    try {
      setSlides(await unwrap(window.gosen.holyrics.slides(linkedId)))
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }

  const link = (s: HolyricsSongSummary) => {
    setResults(null)
    setSlides(null)
    void apply(
      window.gosen.library.update(song.id, { holyrics: { enabled: true, holyricsSongId: s.id, songName: s.title } }),
      `Vinculada con "${s.title}" de Holyrics.`
    )
  }

  const cuesDirty = JSON.stringify(cues) !== JSON.stringify(song.holyrics.cues)
  const setCue = (i: number, patch: Partial<LyricsCue>) => setCues((cs) => cs.map((c, j) => (j === i ? { ...c, ...patch } : c)))

  const testCue = (c: LyricsCue) => {
    const op = c.slideDescription ? window.gosen.holyrics.goToSection(c.slideDescription) : window.gosen.holyrics.goToSlide(c.slideIndex ?? 0)
    void op.then((r) => !r.ok && toast.error(r.error.message))
  }

  return (
    <div className="card">
      <div className="row">
        <h2 className="grow">Holyrics</h2>
        {linkedId && (
          <label className="small row">
            <input
              type="checkbox"
              checked={song.holyrics.enabled}
              onChange={(e) => void apply(window.gosen.library.update(song.id, { holyrics: { enabled: e.target.checked } }))}
            />
            Usar al reproducir
          </label>
        )}
      </div>

      {linkedId ? (
        <p>
          Vinculada con <strong>{song.holyrics.songName}</strong> <span className="muted small">(id {linkedId})</span>{' '}
          <button className="link small" onClick={() => void apply(window.gosen.library.update(song.id, { holyrics: { holyricsSongId: '', enabled: false } }))}>
            desvincular
          </button>
        </p>
      ) : (
        <p className="muted small">Busca la canción en Holyrics para vincular su letra.</p>
      )}

      <div className="row">
        <input className="input grow" value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void search()} placeholder="Título o artista en Holyrics" />
        <button className="btn" onClick={() => void search()} disabled={searching || !query.trim()}>
          {searching ? 'Buscando…' : 'Buscar en Holyrics'}
        </button>
      </div>
      {results && (
        <div className="result-list">
          {results.length === 0 && <p className="muted small">Sin resultados.</p>}
          {results.map((r) => (
            <button key={r.id} className={`result${r.id === linkedId ? ' active' : ''}`} onClick={() => link(r)}>
              <strong>{r.title}</strong> <span className="muted">{r.artist}</span>
            </button>
          ))}
        </div>
      )}

      {linkedId && (
        <>
          <h3>Marcas de tiempo</h3>
          <p className="hint">
            Al llegar a cada marca, Gosen envía a Holyrics el cambio de diapositiva (por número o por sección, p. ej. "Coro").
            También puedes grabarlas en el reproductor con el modo ensayo.
          </p>
          <div className="row">
            <button className="btn small" onClick={() => void loadSlides()}>
              Cargar diapositivas de Holyrics
            </button>
            <button
              className="btn small"
              onClick={() => setCues((cs) => [...cs, { time: Math.round(player.getPosition() * 10) / 10, slideIndex: (cs.at(-1)?.slideIndex ?? -1) + 1 }])}
            >
              Añadir marca
            </button>
            {slides && (
              <span className="muted small">
                {slides.slides.length} diapositivas ·{' '}
                {slides.source === 'presentation' ? 'leídas de la presentación en pantalla (índices exactos)' : 'leídas de la canción; verifica los índices con "Probar"'}
              </span>
            )}
          </div>

          {cues.length > 0 && (
            <table className="song-table compact">
              <thead>
                <tr>
                  <th style={{ width: 110 }}>Tiempo</th>
                  <th>Destino</th>
                  <th>Etiqueta</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {cues.map((c, i) => (
                  <tr key={i}>
                    <td>
                      <TimeInput value={c.time} onChange={(time) => setCue(i, { time })} />
                    </td>
                    <td>
                      <CueTarget cue={c} slides={slides} onChange={(patch) => setCue(i, patch)} />
                    </td>
                    <td>
                      <input className="input" value={c.label ?? ''} placeholder="Opcional" onChange={(e) => setCue(i, { label: e.target.value || undefined })} />
                    </td>
                    <td className="actions">
                      <button className="btn small" onClick={() => testCue(c)} title="Enviar ahora a Holyrics">
                        Probar
                      </button>
                      <button className="btn small danger" onClick={() => setCues((cs) => cs.filter((_, j) => j !== i))}>
                        ✕
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <div className="row" style={{ justifyContent: 'flex-end' }}>
            {cuesDirty && (
              <button className="btn" onClick={() => setCues(song.holyrics.cues)}>
                Descartar
              </button>
            )}
            <button className="btn primary" disabled={!cuesDirty} onClick={() => void apply(window.gosen.library.update(song.id, { holyrics: { cues } }), 'Marcas guardadas.')}>
              Guardar marcas
            </button>
          </div>
        </>
      )}
    </div>
  )
}

function CueTarget({ cue, slides, onChange }: { cue: LyricsCue; slides: HolyricsSlideList | null; onChange: (p: Partial<LyricsCue>) => void }) {
  const mode = cue.slideDescription !== undefined ? 'section' : 'index'
  const sections = slides ? [...new Set(slides.slides.map((s) => s.slideDescription).filter(Boolean))] : []
  return (
    <div className="row nowrap">
      <select
        className="input"
        style={{ width: 120 }}
        value={mode}
        onChange={(e) =>
          onChange(e.target.value === 'section' ? { slideDescription: sections[0] ?? '', slideIndex: undefined } : { slideDescription: undefined, slideIndex: 0 })
        }
      >
        <option value="index">Diapositiva</option>
        <option value="section">Sección</option>
      </select>
      {mode === 'index' ? (
        slides ? (
          <select className="input grow" value={cue.slideIndex ?? 0} onChange={(e) => onChange({ slideIndex: Number(e.target.value) })}>
            {slides.slides.map((s) => (
              <option key={s.index} value={s.index}>
                {s.index + 1}. {s.slideDescription ? `[${s.slideDescription}] ` : ''}
                {s.text.replace(/\s+/g, ' ').slice(0, 60)}
              </option>
            ))}
          </select>
        ) : (
          <input
            className="input"
            style={{ width: 80 }}
            type="number"
            min={1}
            value={(cue.slideIndex ?? 0) + 1}
            onChange={(e) => onChange({ slideIndex: Math.max(0, Number(e.target.value) - 1) })}
            title="Número de diapositiva (1 = primera)"
          />
        )
      ) : (
        <input
          className="input grow"
          list="hr-sections"
          value={cue.slideDescription ?? ''}
          placeholder="Ej.: Coro, Verso 1"
          onChange={(e) => onChange({ slideDescription: e.target.value })}
        />
      )}
      {sections.length > 0 && (
        <datalist id="hr-sections">
          {sections.map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>
      )}
    </div>
  )
}

/** Campo de tiempo "m:ss.d". */
function TimeInput({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const fmt = (v: number) => `${Math.floor(v / 60)}:${(v % 60).toFixed(1).padStart(4, '0')}`
  const [text, setText] = useState(fmt(value))
  useEffect(() => setText(fmt(value)), [value])
  const commit = () => {
    const m = /^(?:(\d+):)?(\d+(?:[.,]\d+)?)$/.exec(text.trim())
    if (!m) return setText(fmt(value))
    const v = Number(m[1] ?? 0) * 60 + Number(m[2]!.replace(',', '.'))
    onChange(Math.round(v * 10) / 10)
  }
  return <input className="input mono" value={text} onChange={(e) => setText(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === 'Enter' && commit()} />
}
