import { act, StrictMode } from 'react'
import { render, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { settingsStore } from '@/settings'
import { installMockAudioContext, MockAudioContext } from './audio-context.mock'
import { installAudioUnlock, isAudioUnlocked, resetAudioForTests } from './context'
import { SoundProvider, useSound } from './hooks'

beforeEach(() => {
  localStorage.clear()
  settingsStore.reset()
  resetAudioForTests()
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  resetAudioForTests()
})

describe('useSound', () => {
  it('reflects and updates the sound settings', () => {
    const { result } = renderHook(() => useSound())
    expect(result.current.enabled).toBe(true)
    expect(result.current.volume).toBe(0.5)

    act(() => result.current.setEnabled(false))
    expect(result.current.enabled).toBe(false)
    expect(settingsStore.get().sound).toBe(false)

    act(() => result.current.setVolume(0.8))
    expect(result.current.volume).toBe(0.8)
    act(() => result.current.setVolume(7))
    expect(settingsStore.get().volume).toBe(1)
  })

  it('unlocks audio when sound is switched on, and play() reaches the synth', () => {
    installMockAudioContext()
    settingsStore.patch({ sound: false })
    const { result } = renderHook(() => useSound())
    expect(isAudioUnlocked()).toBe(false)

    act(() => result.current.setEnabled(true))
    expect(isAudioUnlocked()).toBe(true)

    act(() => result.current.play('tick'))
    const ctx = MockAudioContext.instances[0]
    expect(ctx?.nodesOf('oscillator')).toHaveLength(1)
  })

  it('keeps play() referentially stable across renders', () => {
    const { result, rerender } = renderHook(() => useSound())
    const first = result.current.play
    rerender()
    expect(result.current.play).toBe(first)
  })
})

describe('SoundProvider', () => {
  it('installs the unlock listeners once and renders children', () => {
    const add = vi.spyOn(window, 'addEventListener')
    const { getByText } = render(
      <SoundProvider>
        <span>child</span>
      </SoundProvider>,
    )
    expect(getByText('child')).toBeInTheDocument()
    expect(add).toHaveBeenCalledTimes(3)
    // Already installed: asking again adds nothing.
    installAudioUnlock()
    expect(add).toHaveBeenCalledTimes(3)
  })

  it('survives StrictMode double effects and cleans up on unmount', () => {
    const add = vi.spyOn(window, 'addEventListener')
    const remove = vi.spyOn(window, 'removeEventListener')
    const { unmount } = render(
      <StrictMode>
        <SoundProvider />
      </StrictMode>,
    )
    // mount, strict cleanup, re-mount → listeners installed twice, removed once so far
    expect(add).toHaveBeenCalledTimes(6)
    expect(remove).toHaveBeenCalledTimes(3)
    unmount()
    expect(remove).toHaveBeenCalledTimes(6)
    window.dispatchEvent(new Event('pointerdown'))
    expect(isAudioUnlocked()).toBe(false)
  })
})
