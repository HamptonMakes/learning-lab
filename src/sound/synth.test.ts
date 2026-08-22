import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { settingsStore } from '@/settings'
import { installMockAudioContext, MockAudioContext } from './audio-context.mock'
import { resetAudioForTests } from './context'
import { MAX_SOUND_SECONDS, SOUND_NAMES, clamp01, playSound, unlockAudio } from './synth'

function setHidden(hidden: boolean): void {
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden })
}

beforeEach(() => {
  localStorage.clear()
  settingsStore.reset()
  resetAudioForTests()
})

afterEach(() => {
  vi.unstubAllGlobals()
  Reflect.deleteProperty(document, 'hidden')
  resetAudioForTests()
})

describe('playSound without Web Audio (jsdom)', () => {
  it('is a silent no-op and never throws', () => {
    expect(typeof AudioContext).toBe('undefined')
    expect(() => unlockAudio()).not.toThrow()
    for (const name of SOUND_NAMES) expect(() => playSound(name)).not.toThrow()
  })
})

describe('playSound with a mocked AudioContext', () => {
  it('does not create a context before audio is unlocked', () => {
    installMockAudioContext()
    playSound('bloop')
    expect(MockAudioContext.instances).toHaveLength(0)
  })

  it('creates exactly one context and schedules oscillator + gain nodes for bloop', () => {
    installMockAudioContext()
    unlockAudio()
    playSound('bloop')
    playSound('bloop')
    expect(MockAudioContext.instances).toHaveLength(1)
    const ctx = MockAudioContext.instances[0]
    expect(ctx).toBeDefined()
    if (!ctx) return
    const oscillators = ctx.nodesOf('oscillator')
    expect(oscillators).toHaveLength(2)
    expect(oscillators[0]?.start).toHaveBeenCalledWith(0)
    expect(oscillators[0]?.type).toBe('sine')
    expect(oscillators[0]?.frequency?.exponentialRampToValueAtTime).toHaveBeenCalled()
    expect(ctx.nodesOf('gain').length).toBeGreaterThanOrEqual(3) // master + voice + envelope
  })

  it('creates no context or nodes when the sound setting is off', () => {
    installMockAudioContext()
    settingsStore.patch({ sound: false })
    unlockAudio()
    playSound('bloop')
    expect(MockAudioContext.instances).toHaveLength(0)
    // Even with a live context, switching sound off silences play().
    settingsStore.patch({ sound: true })
    playSound('bloop')
    settingsStore.patch({ sound: false })
    playSound('bloop')
    const ctx = MockAudioContext.instances[0]
    expect(ctx?.nodesOf('oscillator')).toHaveLength(1)
  })

  it('creates no nodes while the document is hidden', () => {
    installMockAudioContext()
    unlockAudio()
    setHidden(true)
    playSound('bloop')
    const ctx = MockAudioContext.instances[0]
    expect(ctx?.nodesOf('oscillator')).toHaveLength(0)
  })

  it('routes through a master gain set from the volume setting', () => {
    installMockAudioContext()
    unlockAudio()
    settingsStore.patch({ volume: 0.3 })
    playSound('tick', { volume: 0.5 })
    const ctx = MockAudioContext.instances[0]
    const master = ctx?.nodesOf('gain')[0]
    expect(master?.connect).toHaveBeenCalledWith(ctx?.destination)
    expect(master?.gain?.value).toBeCloseTo(0.3)
    const voice = ctx?.nodesOf('gain')[1]
    expect(voice?.gain?.value).toBeCloseTo(0.5)
    expect(voice?.connect).toHaveBeenCalledWith(master)
  })

  it('resumes a suspended context on play', () => {
    installMockAudioContext()
    unlockAudio()
    const ctx = MockAudioContext.instances[0]
    expect(ctx).toBeDefined()
    if (!ctx) return
    ctx.resume.mockClear()
    ctx.state = 'suspended'
    playSound('pop')
    expect(ctx.resume).toHaveBeenCalledTimes(1)
  })

  it.each(SOUND_NAMES)('%s makes sound and finishes within the duration budget', (name) => {
    installMockAudioContext()
    unlockAudio()
    playSound(name)
    const ctx = MockAudioContext.instances[0]
    expect(ctx).toBeDefined()
    if (!ctx) return
    const stops = ctx.stopTimes()
    expect(stops.length).toBeGreaterThan(0)
    for (const t of stops) expect(t).toBeLessThanOrEqual(MAX_SOUND_SECONDS + 1e-9)
  })

  it('success is a three-note chord; whoosh is filtered noise', () => {
    installMockAudioContext()
    unlockAudio()
    playSound('success')
    playSound('whoosh')
    const ctx = MockAudioContext.instances[0]
    expect(ctx?.nodesOf('oscillator')).toHaveLength(3)
    expect(ctx?.nodesOf('buffersource')).toHaveLength(1)
    expect(ctx?.nodesOf('biquad').some((n) => n.type === 'bandpass')).toBe(true)
  })

  it('swallows errors thrown by the audio engine', () => {
    vi.stubGlobal('AudioContext', function BrokenAudioContext() {
      throw new Error('nope')
    })
    unlockAudio()
    expect(() => playSound('bloop')).not.toThrow()
  })
})

describe('clamp01', () => {
  it('clamps into 0..1 and maps NaN to 0', () => {
    expect(clamp01(-1)).toBe(0)
    expect(clamp01(2)).toBe(1)
    expect(clamp01(0.25)).toBe(0.25)
    expect(clamp01(Number.NaN)).toBe(0)
  })
})
