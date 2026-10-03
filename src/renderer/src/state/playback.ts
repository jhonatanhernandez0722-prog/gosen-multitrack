import { useEffect, useState, useSyncExternalStore } from 'react'
import type { LibraryEntry, Song } from '../../../shared/types'
import { MultitrackPlayer, type PlayerState } from '../audio/MultitrackPlayer'
import { LyricsSync, type LyricsSyncState } from '../sync/LyricsSync'
import { startMeters } from '../audio/meters'

/**
 * Instancias únicas de la app: el reproductor vive fuera de los componentes, así la música
 * sigue sonando mientras el usuario navega entre pantallas.
 */
export const player = new MultitrackPlayer()
export const lyricsSync = new LyricsSync(player)
startMeters(player)

export function usePlayerState(): PlayerState {
  return useSyncExternalStore(player.subscribe, player.getState)
}

export function useLyricsSyncState(): LyricsSyncState {
  return useSyncExternalStore(lyricsSync.subscribe, lyricsSync.getState)
}

/**
 * Posición para PINTAR la línea de tiempo. Se lee del reloj de audio en cada frame;
 * no interviene en la reproducción.
 */
export function usePlaybackPosition(): number {
  const { status } = usePlayerState()
  const [pos, setPos] = useState(() => player.getPosition())

  useEffect(() => {
    setPos(player.getPosition())
    const off = player.onTransport(() => setPos(player.getPosition()))
    if (status !== 'playing') return off
    let raf = 0
    const tick = () => {
      setPos(player.getPosition())
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(raf)
      off()
    }
  }, [status])

  return pos
}

/** Carga una canción en el reproductor y guarda las duraciones reales si cambiaron. */
export async function loadSongIntoPlayer(entry: LibraryEntry): Promise<void> {
  lyricsSync.setSong(entry.song)
  const durations = await player.load(entry)
  const changed = entry.song.tracks.some((t) => {
    const d = durations[t.id]
    return d !== undefined && Math.abs((t.duration ?? 0) - d) > 0.01
  })
  if (changed) {
    const res = await window.gosen.library.setDurations(entry.song.id, durations)
    if (res.ok && player.getState().song?.id === entry.song.id) {
      player.updateSongMeta(res.value.song)
      lyricsSync.setSong(res.value.song)
    }
  }
}

/** Avisar al reproductor de que una canción cambió en disco (editor, reimportación…). */
export function notifySongChanged(song: Song): void {
  if (player.getState().song?.id !== song.id) return
  player.updateSongMeta(song)
  lyricsSync.setSong(song)
  // Si cambiaron los archivos de pista y no está sonando, se recarga ya; si suena, se avisa en pantalla.
  if (player.getState().needsReload && !player.isPlaying) void reloadCurrentSong()
}

export async function reloadCurrentSong(): Promise<void> {
  const id = player.getState().song?.id
  if (!id) return
  const res = await window.gosen.library.get(id)
  if (res.ok) await loadSongIntoPlayer(res.value)
  else player.unload()
}

export function notifySongDeleted(songId: string): void {
  if (player.getState().song?.id === songId) {
    player.unload()
    lyricsSync.setSong(null)
  }
}
