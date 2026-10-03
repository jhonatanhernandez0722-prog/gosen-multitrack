import { useState } from 'react'
import type { LibraryEntry, TrackType, ZipPreview } from '../../../shared/types'
import { Modal } from './Modal'
import { errorMessage, unwrap } from '../lib/errors'
import { TRACK_TYPES, TRACK_TYPE_LABELS } from '../lib/trackTypes'

interface Row {
  entryName: string
  fileName: string
  include: boolean
  name: string
  type: TrackType
  size: number
}

/**
 * Paso 2 de la importación: el usuario revisa las pistas detectadas, edita nombres/tipos
 * y confirma. Con `replaceSong` se reimporta sobre una canción existente.
 */
export function ImportDialog({
  preview,
  replaceSong,
  onDone,
  onCancel
}: {
  preview: ZipPreview
  replaceSong?: { id: string; name: string; artist: string }
  onDone: (entry: LibraryEntry) => void
  onCancel: () => void
}) {
  const [name, setName] = useState(replaceSong?.name ?? preview.suggestedName)
  const [artist, setArtist] = useState(replaceSong?.artist ?? '')
  const [rows, setRows] = useState<Row[]>(
    preview.tracks.map((t) => ({
      entryName: t.entryName,
      fileName: t.fileName,
      include: true,
      name: t.suggestedName,
      type: t.suggestedType,
      size: t.size
    }))
  )
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const selected = rows.filter((r) => r.include)
  const update = (i: number, patch: Partial<Row>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)))

  const cancel = () => {
    if (busy) return
    void window.gosen.import.cancel(preview.importId)
    onCancel()
  }

  const commit = async () => {
    setBusy(true)
    setError(null)
    try {
      const entry = await unwrap(
        window.gosen.import.commit({
          importId: preview.importId,
          name,
          artist,
          tracks: selected.map((r) => ({ entryName: r.entryName, name: r.name, type: r.type })),
          replaceSongId: replaceSong?.id
        })
      )
      onDone(entry)
    } catch (err) {
      setError(errorMessage(err))
      setBusy(false)
    }
  }

  return (
    <Modal
      title={replaceSong ? `Reimportar "${replaceSong.name}"` : 'Importar canción'}
      onClose={cancel}
      wide
      footer={
        <>
          <span className="muted small grow">
            {selected.length} de {rows.length} pistas · {formatSize(selected.reduce((s, r) => s + r.size, 0))}
          </span>
          <button className="btn" onClick={cancel} disabled={busy}>
            Cancelar
          </button>
          <button className="btn primary" onClick={commit} disabled={busy || !name.trim() || selected.length === 0}>
            {busy ? 'Importando…' : replaceSong ? 'Reemplazar pistas' : 'Importar'}
          </button>
        </>
      }
    >
      <p className="muted small">Archivo: {preview.zipFileName}</p>

      {replaceSong && (
        <div className="alert warning">
          Las pistas actuales se enviarán a la Papelera. Se conservan el vínculo con Holyrics y las marcas de tiempo.
        </div>
      )}
      {!replaceSong && preview.duplicateOf && (
        <div className="alert warning">
          Ya existe "{preview.duplicateOf.name}". Cambia el nombre o usa <strong>Reimportar</strong> en esa canción.
        </div>
      )}

      <div className="row">
        <div className="field grow">
          <label htmlFor="imp-name">Nombre de la canción</label>
          <input id="imp-name" className="input" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </div>
        <div className="field grow">
          <label htmlFor="imp-artist">Artista</label>
          <input id="imp-artist" className="input" value={artist} onChange={(e) => setArtist(e.target.value)} />
        </div>
      </div>

      <table className="song-table compact">
        <thead>
          <tr>
            <th style={{ width: 36 }} />
            <th>Archivo</th>
            <th>Nombre de la pista</th>
            <th style={{ width: 160 }}>Tipo</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.entryName} className={r.include ? '' : 'is-excluded'}>
              <td>
                <input
                  type="checkbox"
                  checked={r.include}
                  onChange={(e) => update(i, { include: e.target.checked })}
                  aria-label={`Incluir ${r.fileName}`}
                />
              </td>
              <td className="muted small mono" title={r.entryName}>
                {r.fileName}
              </td>
              <td>
                <input className="input" value={r.name} disabled={!r.include} onChange={(e) => update(i, { name: e.target.value })} />
              </td>
              <td>
                <select className="input" value={r.type} disabled={!r.include} onChange={(e) => update(i, { type: e.target.value as TrackType })}>
                  {TRACK_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {TRACK_TYPE_LABELS[t]}
                    </option>
                  ))}
                </select>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {preview.ignored.length > 0 && (
        <details className="ignored">
          <summary className="muted small">{preview.ignored.length} archivos ignorados (no son WAV/MP3 o no son seguros)</summary>
          <ul className="small muted mono">
            {preview.ignored.map((f) => (
              <li key={f}>{f}</li>
            ))}
          </ul>
        </details>
      )}

      {error && <div className="alert error">{error}</div>}
    </Modal>
  )
}

function formatSize(bytes: number): string {
  if (bytes > 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`
  return `${Math.round(bytes / 1024 ** 2)} MB`
}
