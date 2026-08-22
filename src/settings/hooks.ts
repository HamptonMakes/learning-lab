import { useCallback, useEffect, useSyncExternalStore } from 'react'
import type { LocalStore } from './store'
import { settingsStore, resolveTheme, resolveReducedMotion, type Settings } from './settings'
import { progressStore, type Progress } from './progress'

function useStore<T>(store: LocalStore<T>): T {
  return useSyncExternalStore(store.subscribe, store.get, store.get)
}

export function useSettings(): [Settings, (patch: Partial<Settings>) => void] {
  const settings = useStore(settingsStore)
  const patch = useCallback((p: Partial<Settings>) => settingsStore.patch(p), [])
  return [settings, patch]
}

export function useSetting<K extends keyof Settings>(
  key: K,
): [Settings[K], (value: Settings[K]) => void] {
  const settings = useStore(settingsStore)
  const set = useCallback(
    (value: Settings[K]) => settingsStore.patch({ [key]: value } as Partial<Settings>),
    [key],
  )
  return [settings[key], set]
}

export function useProgress(): Progress {
  return useStore(progressStore)
}

function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (cb: () => void) => {
      const mql = window.matchMedia(query)
      mql.addEventListener('change', cb)
      return () => mql.removeEventListener('change', cb)
    },
    [query],
  )
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => false,
  )
}

/** Resolved theme; also applies the `.dark` class to <html>. Call once near the app root. */
export function useTheme(): 'light' | 'dark' {
  const [theme] = useSetting('theme')
  const systemDark = useMediaQuery('(prefers-color-scheme: dark)')
  const resolved = resolveTheme(theme, systemDark)
  useEffect(() => {
    document.documentElement.classList.toggle('dark', resolved === 'dark')
    document.documentElement.style.colorScheme = resolved
  }, [resolved])
  return resolved
}

/** True when motion should be minimized (user setting or OS preference). */
export function useReducedMotion(): boolean {
  const [pref] = useSetting('reducedMotion')
  const systemReduced = useMediaQuery('(prefers-reduced-motion: reduce)')
  return resolveReducedMotion(pref, systemReduced)
}
