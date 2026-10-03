import { useState, type ReactNode } from 'react'
import type { LibraryEntry, Result, ZipPreview } from '../../../shared/types'
import { ImportDialog } from '../components/ImportDialog'
import { useToast } from '../components/Toast'
import { errorMessage, unwrap, UiError } from '../lib/errors'
import { notifySongChanged } from './playback'

type ReplaceTarget = { id: string; name: string; artist: string }

/** Flujo completo de importación/reimportación ZIP: elegir o soltar archivo → revisar → confirmar. */
export function useImportFlow(onImported: (entry: LibraryEntry) => void): {
  start: (replace?: ReplaceTarget) => Promise<void>
  startFromFile: (file: File, replace?: ReplaceTarget) => Promise<void>
  dialog: ReactNode
} {
  const toast = useToast()
  const [pending, setPending] = useState<{ preview: ZipPreview; replace?: ReplaceTarget } | null>(null)

  const open = async (source: () => Promise<Result<ZipPreview>>, replace?: ReplaceTarget) => {
    try {
      setPending({ preview: await unwrap(source()), replace })
    } catch (err) {
      if (err instanceof UiError && err.code === 'CANCELLED') return
      toast.error(errorMessage(err))
    }
  }

  const start = (replace?: ReplaceTarget) => open(() => window.gosen.import.chooseZip(), replace)
  const startFromFile = (file: File, replace?: ReplaceTarget) => open(() => window.gosen.import.inspectDroppedFile(file), replace)

  const dialog = pending ? (
    <ImportDialog
      preview={pending.preview}
      replaceSong={pending.replace}
      onCancel={() => setPending(null)}
      onDone={(entry) => {
        setPending(null)
        toast.success(`"${entry.song.name}" importada con ${entry.song.tracks.length} pistas.`)
        notifySongChanged(entry.song)
        onImported(entry)
      }}
    />
  ) : null

  return { start, startFromFile, dialog }
}
