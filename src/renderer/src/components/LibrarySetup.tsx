import { useState } from 'react'
import type { AppSettings, Result } from '../../../shared/types'
import { errorMessage, unwrap, UiError } from '../lib/errors'
import { useSettings } from '../state/SettingsContext'
import { Icon } from './Icon'
import { Modal } from './Modal'

/** Botones para elegir la carpeta de biblioteca (recomendada o personalizada). */
export function LibrarySetupButtons({ onDone }: { onDone?: () => void }) {
  const { replace } = useSettings()
  const [error, setError] = useState<string | null>(null)

  const run = async (op: () => Promise<Result<AppSettings>>) => {
    setError(null)
    try {
      replace(await unwrap(op()))
      onDone?.()
    } catch (err) {
      if (!(err instanceof UiError && err.code === 'CANCELLED')) setError(errorMessage(err))
    }
  }

  return (
    <>
      <div className="row" style={{ justifyContent: 'center' }}>
        <button className="btn primary lg" onClick={() => void run(() => window.gosen.settings.useDefaultLibraryFolder())}>
          <Icon name="folder" /> Usar Documentos › Gosen Multitrack
        </button>
        <button className="btn lg" onClick={() => void run(() => window.gosen.settings.chooseLibraryFolder())}>
          Elegir otra carpeta…
        </button>
      </div>
      {error && <p className="error-text">{error}</p>}
    </>
  )
}

/** Se muestra al soltar un ZIP antes de haber configurado la biblioteca. */
export function LibrarySetupDialog({ fileName, onReady, onCancel }: { fileName: string; onReady: () => void; onCancel: () => void }) {
  return (
    <Modal title="¿Dónde guardamos tus canciones?" onClose={onCancel}>
      <p>
        Para importar <strong>{fileName}</strong> primero elige la carpeta de la biblioteca. Allí se guardará cada canción con
        sus pistas. Puedes cambiarla después en Configuración.
      </p>
      <LibrarySetupButtons onDone={onReady} />
    </Modal>
  )
}
