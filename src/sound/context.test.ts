import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { settingsStore } from '@/settings'
import { installMockAudioContext, MockAudioContext } from './audio-context.mock'
import {
  getAudioGraph,
  installAudioUnlock,
  isAudioSupported,
  isAudioUnlocked,
  resetAudioForTests,
  unlockAudio,
} from './context'

const UNLOCK_EVENTS = ['pointerdown', 'keydown', 'touchstart']

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

describe('installAudioUnlock', () => {
  it('installs one listener per gesture event, only once', () => {
    const add = vi.spyOn(window, 'addEventListener')
    installAudioUnlock()
    installAudioUnlock()
    const types = add.mock.calls.map((c) => c[0])
    expect(types).toEqual(UNLOCK_EVENTS)
    expect(add).toHaveBeenCalledTimes(3)
  })

  it('unlocks on the first gesture and removes the remaining listeners', () => {
    const remove = vi.spyOn(window, 'removeEventListener')
    installAudioUnlock()
    expect(isAudioUnlocked()).toBe(false)
    window.dispatchEvent(new Event('pointerdown'))
    expect(isAudioUnlocked()).toBe(true)
    expect(remove.mock.calls.map((c) => c[0])).toEqual(UNLOCK_EVENTS)
    // A second gesture is harmless.
    expect(() => window.dispatchEvent(new Event('keydown'))).not.toThrow()
  })

  it('returns a cleanup that removes the listeners and allows a fresh install', () => {
    const add = vi.spyOn(window, 'addEventListener')
    const remove = vi.spyOn(window, 'removeEventListener')
    const uninstall = installAudioUnlock()
    uninstall()
    expect(remove).toHaveBeenCalledTimes(3)
    installAudioUnlock()
    expect(add).toHaveBeenCalledTimes(6)
  })

  it('is a no-op after audio is already unlocked', () => {
    const add = vi.spyOn(window, 'addEventListener')
    unlockAudio()
    installAudioUnlock()
    expect(add).not.toHaveBeenCalled()
  })
})

describe('audio graph', () => {
  it('reports support and refuses to build a graph before unlock', () => {
    expect(isAudioSupported()).toBe(false)
    installMockAudioContext()
    expect(isAudioSupported()).toBe(true)
    expect(getAudioGraph()).toBeNull()
  })

  it('unlockAudio creates and resumes the context when sound is enabled', () => {
    installMockAudioContext()
    unlockAudio()
    expect(MockAudioContext.instances).toHaveLength(1)
    expect(getAudioGraph()?.ctx).toBe(MockAudioContext.instances[0])
  })

  it('unlockAudio does not create a context when sound is disabled', () => {
    installMockAudioContext()
    settingsStore.patch({ sound: false })
    unlockAudio()
    expect(isAudioUnlocked()).toBe(true)
    expect(MockAudioContext.instances).toHaveLength(0)
  })

  it('returns null (and does not throw) when the constructor fails', () => {
    vi.stubGlobal('AudioContext', function BrokenAudioContext() {
      throw new Error('blocked')
    })
    expect(() => unlockAudio()).not.toThrow()
    expect(getAudioGraph()).toBeNull()
  })
})
