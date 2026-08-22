/**
 * React bindings for the sound module: useSound() for components that play or configure sound,
 * and <SoundProvider> which installs the one-time user-gesture unlock near the app root.
 */
import { useCallback, useEffect, useMemo, type ReactNode } from 'react'
import { useSetting } from '@/settings'
import { installAudioUnlock, unlockAudio } from './context'
import type { SoundName } from './recipes'
import { clamp01, playSound, type PlayOptions } from './synth'

export interface SoundApi {
  play: (name: SoundName, opts?: PlayOptions) => void
  enabled: boolean
  setEnabled: (enabled: boolean) => void
  /** Master volume, 0..1. */
  volume: number
  setVolume: (volume: number) => void
}

export function useSound(): SoundApi {
  const [enabled, setSoundSetting] = useSetting('sound')
  const [volume, setVolumeSetting] = useSetting('volume')

  const setEnabled = useCallback(
    (next: boolean) => {
      setSoundSetting(next)
      // Switching sound on happens inside a click/keypress — the right moment to unlock audio.
      if (next) unlockAudio()
    },
    [setSoundSetting],
  )
  const setVolume = useCallback(
    (next: number) => setVolumeSetting(clamp01(next)),
    [setVolumeSetting],
  )
  const play = useCallback((name: SoundName, opts?: PlayOptions) => playSound(name, opts), [])

  return useMemo(
    () => ({ play, enabled, setEnabled, volume, setVolume }),
    [play, enabled, setEnabled, volume, setVolume],
  )
}

/** Mount once near the app root. Installs the first-gesture audio unlock; renders children as-is. */
export function SoundProvider({ children }: { children?: ReactNode }): ReactNode {
  useEffect(() => installAudioUnlock(), [])
  return children
}
