import { useEffect, useRef, useState } from 'react'
import { Icon } from './Icon'
import { useToast } from './Toast'

/**
 * Permite soltar un ZIP en cualquier parte de la ventana.
 * También evita que Electron intente "abrir" el archivo soltado como si fuera una página.
 */
export function DropZone({ onZip, disabled }: { onZip: (file: File) => void; disabled?: boolean }) {
  const [active, setActive] = useState(false)
  const depth = useRef(0)
  const toast = useToast()

  useEffect(() => {
    const hasFiles = (e: DragEvent) => !!e.dataTransfer && [...e.dataTransfer.types].includes('Files')

    const onEnter = (e: DragEvent) => {
      if (!hasFiles(e)) return
      e.preventDefault()
      depth.current++
      if (!disabled) setActive(true)
    }
    const onOver = (e: DragEvent) => {
      if (!hasFiles(e)) return
      e.preventDefault()
      if (e.dataTransfer) e.dataTransfer.dropEffect = disabled ? 'none' : 'copy'
    }
    const onLeave = (e: DragEvent) => {
      if (!hasFiles(e)) return
      depth.current = Math.max(0, depth.current - 1)
      if (depth.current === 0) setActive(false)
    }
    const onDrop = (e: DragEvent) => {
      if (!hasFiles(e)) return
      e.preventDefault()
      depth.current = 0
      setActive(false)
      if (disabled) return
      const files = [...(e.dataTransfer?.files ?? [])]
      const zip = files.find((f) => f.name.toLowerCase().endsWith('.zip'))
      if (!zip) {
        toast.error('Suelta un archivo .zip con las pistas de la canción.')
        return
      }
      if (files.length > 1) toast.info(`Se importará solo "${zip.name}". Suelta los ZIP de uno en uno.`)
      onZip(zip)
    }

    window.addEventListener('dragenter', onEnter)
    window.addEventListener('dragover', onOver)
    window.addEventListener('dragleave', onLeave)
    window.addEventListener('drop', onDrop)
    return () => {
      window.removeEventListener('dragenter', onEnter)
      window.removeEventListener('dragover', onOver)
      window.removeEventListener('dragleave', onLeave)
      window.removeEventListener('drop', onDrop)
    }
  }, [onZip, disabled, toast])

  if (!active) return null
  return (
    <div className="drop-overlay" aria-hidden>
      <div className="drop-card">
        <div className="drop-icon">
          <Icon name="upload" size={40} />
        </div>
        <div className="drop-title">Suelta el ZIP para importar</div>
        <div className="muted">Se detectarán las pistas automáticamente</div>
      </div>
    </div>
  )
}
