import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import type { AppSettings, SettingsPatch } from '../../../shared/types'
import { unwrap } from '../lib/errors'

interface SettingsState {
  settings: AppSettings | null
  loadError: string | null
  update(patch: SettingsPatch): Promise<void>
  /** Para operaciones que devuelven la configuración actualizada (elegir carpeta, token). */
  replace(next: AppSettings): void
}

const SettingsContext = createContext<SettingsState | null>(null)

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  useEffect(() => {
    unwrap(window.gosen.settings.get()).then(setSettings, (err: Error) => setLoadError(err.message))
  }, [])

  const update = useCallback(async (patch: SettingsPatch) => {
    setSettings(await unwrap(window.gosen.settings.update(patch)))
  }, [])

  return (
    <SettingsContext.Provider value={{ settings, loadError, update, replace: setSettings }}>
      {children}
    </SettingsContext.Provider>
  )
}

export function useSettings(): SettingsState {
  const ctx = useContext(SettingsContext)
  if (!ctx) throw new Error('useSettings debe usarse dentro de SettingsProvider')
  return ctx
}
