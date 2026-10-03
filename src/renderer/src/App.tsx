import { useCallback, useEffect, useState } from 'react'
import type { LibraryEntry } from '../../shared/types'
import { Sidebar, type Screen } from './components/Sidebar'
import { LibraryScreen } from './screens/LibraryScreen'
import { PlayerScreen } from './screens/PlayerScreen'
import { SongEditorScreen } from './screens/SongEditorScreen'
import { SettingsScreen } from './screens/SettingsScreen'
import { HolyricsScreen } from './screens/HolyricsScreen'
import { useSettings } from './state/SettingsContext'
import { loadSongIntoPlayer, lyricsSync, player } from './state/playback'
import { ToastProvider, useToast } from './components/Toast'
import { DropZone } from './components/DropZone'
import { LibrarySetupDialog } from './components/LibrarySetup'
import { useImportFlow } from './state/useImportFlow'

export function App() {
  return (
    <ToastProvider>
      <AppShell />
    </ToastProvider>
  )
}

function AppShell() {
  const [screen, setScreen] = useState<Screen>('library')
  const [editSongId, setEditSongId] = useState<string | null>(null)
  const [libraryVersion, setLibraryVersion] = useState(0)
  const { settings, loadError } = useSettings()
  const toast = useToast()

  // Importación por arrastrar y soltar, disponible en cualquier pantalla.
  const dropImport = useImportFlow(() => {
    setLibraryVersion((v) => v + 1)
    setScreen('library')
  })
  // Si aún no hay biblioteca, se pide la carpeta y luego se continúa con el mismo ZIP.
  const [zipWaitingForLibrary, setZipWaitingForLibrary] = useState<File | null>(null)
  const hasLibrary = !!settings?.libraryPath
  const onZipDropped = useCallback(
    (file: File) => (hasLibrary ? void dropImport.startFromFile(file) : setZipWaitingForLibrary(file)),
    [hasLibrary, dropImport.startFromFile]
  )

  usePlaybackSettingsBridge()
  useGlobalShortcuts()

  const playEntry = useCallback(
    async (entry: LibraryEntry) => {
      setScreen('player')
      try {
        await loadSongIntoPlayer(entry)
      } catch (err) {
        toast.error(`No se pudo cargar la canción: ${(err as Error).message}`)
      }
    },
    [toast]
  )

  const editSong = useCallback((songId: string) => {
    setEditSongId(songId)
    setScreen('editor')
  }, [])

  if (loadError) return <div className="fatal">No se pudo cargar la configuración: {loadError}</div>
  if (!settings) return <div className="fatal muted">Cargando…</div>

  return (
    <div className="app">
      <Sidebar current={screen} onNavigate={setScreen} />
      <main className="content">
        {screen === 'library' && (
          <LibraryScreen key={libraryVersion} onPlay={playEntry} onEdit={editSong} onOpenSettings={() => setScreen('settings')} />
        )}
        {screen === 'player' && <PlayerScreen onEdit={editSong} onOpenLibrary={() => setScreen('library')} />}
        {screen === 'editor' && (
          <SongEditorScreen songId={editSongId ?? player.getState().song?.id ?? null} onBack={() => setScreen('library')} onPlay={playEntry} />
        )}
        {screen === 'holyrics' && <HolyricsScreen onOpenSettings={() => setScreen('settings')} />}
        {screen === 'settings' && <SettingsScreen />}
      </main>
      <DropZone onZip={onZipDropped} disabled={dropImport.dialog !== null || zipWaitingForLibrary !== null} />
      {dropImport.dialog}
      {zipWaitingForLibrary && (
        <LibrarySetupDialog
          fileName={zipWaitingForLibrary.name}
          onCancel={() => setZipWaitingForLibrary(null)}
          onReady={() => {
            const file = zipWaitingForLibrary
            setZipWaitingForLibrary(null)
            void dropImport.startFromFile(file)
          }}
        />
      )}
    </div>
  )
}

/** Aplica la configuración guardada al motor de audio y a la sincronización de letras. */
function usePlaybackSettingsBridge(): void {
  const { settings } = useSettings()
  const toast = useToast()
  const playback = settings?.playback
  const holyrics = settings?.holyrics

  useEffect(() => {
    if (playback) player.setStartLatency(playback.startLatencyMs)
  }, [playback?.startLatencyMs])

  // El volumen general guardado solo se aplica al arrancar; después lo controla el reproductor.
  useEffect(() => {
    if (playback) player.setMasterVolume(playback.masterVolume)
  }, [playback === undefined])

  useEffect(() => {
    if (!playback || !player.audio.supportsOutputSelection) return
    player.audio.setOutputDevice(playback.outputDeviceId).catch(() => {
      toast.error('No se encontró el dispositivo de salida guardado; se usa la salida predeterminada.')
      void player.audio.setOutputDevice('').catch(() => undefined)
    })
  }, [playback?.outputDeviceId])

  useEffect(() => {
    if (holyrics) lyricsSync.configure(holyrics)
  }, [holyrics])
}

/** Espacio = reproducir/pausar (salvo escribiendo en un campo). Inicio = volver al principio. */
function useGlobalShortcuts(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement
      if (el.closest('input, textarea, select, [contenteditable="true"]')) return
      if (e.code === 'Space') {
        e.preventDefault()
        void player.togglePlay()
      } else if (e.code === 'Home') {
        e.preventDefault()
        player.restart()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}
