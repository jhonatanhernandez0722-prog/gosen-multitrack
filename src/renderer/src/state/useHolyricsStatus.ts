import { useCallback, useEffect, useState } from 'react'
import type { HolyricsStatus } from '../../../shared/types'
import { useSettings } from './SettingsContext'

const POLL_MS = 15000

/**
 * Estado de conexión con Holyrics. Se consulta al cambiar la configuración y cada 15 s
 * (solo indicador visual; no interviene en el audio).
 */
export function useHolyricsStatus(): { status: HolyricsStatus | null; refresh: () => void } {
  const { settings } = useSettings()
  const [status, setStatus] = useState<HolyricsStatus | null>(null)

  const refresh = useCallback(() => {
    void window.gosen.holyrics.status().then((res) => {
      setStatus(res.ok ? res.value : { state: 'error', message: res.error.message })
    })
  }, [])

  const h = settings?.holyrics
  useEffect(() => {
    refresh()
    if (!h?.enabled) return
    const id = setInterval(refresh, POLL_MS)
    return () => clearInterval(id)
  }, [refresh, h?.enabled, h?.host, h?.port, h?.hasToken])

  return { status, refresh }
}
