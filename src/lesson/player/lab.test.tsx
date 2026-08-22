/* oxlint-disable no-underscore-dangle -- `window.__lab` is the test hook name fixed by stage-architecture §9.3 */
import { cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Frame } from '@/lesson/types'
import { progressStore, settingsStore } from '@/settings'
import { frames } from './frames.fixture'
import { installLab, settle, useLabHook, type LabApi } from './lab'
import { usePlayer } from './usePlayer'

vi.mock('@/analytics', () => ({ track: vi.fn() }))

const TOPIC = { module: 'crdts', unit: 'state-based', topic: 'lww-register' }
const FRAMES: Record<number, Frame[]> = { 1: frames(1), 4: frames(4) } // stable identities

beforeEach(() => {
  localStorage.clear()
  settingsStore.reset()
  progressStore.reset()
})
afterEach(() => {
  cleanup() // no vitest globals → no RTL auto-cleanup
  delete window.__lab
  vi.restoreAllMocks()
})

function fakeLabApi(): LabApi & { log: string[] } {
  const log: string[] = []
  return {
    log,
    total: 3,
    current: () => ({ index: 1, stepId: 's2', sceneId: 'scene-1', say: 'hi', changes: [] }),
    goto: async (i) => {
      log.push(`goto ${i}`)
    },
    next: async () => {
      log.push('next')
    },
    prev: async () => {
      log.push('prev')
    },
  }
}

describe('settle', () => {
  it('resolves in jsdom (no fonts / getAnimations) after two frames', async () => {
    await expect(settle()).resolves.toBeUndefined()
  })

  it('waits for fonts and for the running animations only', async () => {
    let fontsDone = false
    let animDone = false
    const fonts = {
      ready: new Promise<void>((r) => setTimeout(() => ((fontsDone = true), r()), 5)),
    }
    const running = {
      playState: 'running',
      finished: new Promise<void>((r) => setTimeout(() => ((animDone = true), r()), 30)),
    }
    const paused = { playState: 'paused', finished: new Promise(() => {}) } // would hang
    const doc = {
      fonts,
      getAnimations: () => [running, paused],
    } as unknown as Document
    await settle(doc)
    expect(fontsDone).toBe(true)
    expect(animDone).toBe(true)
  })

  it('survives a rejected animation.finished', async () => {
    const finished = Promise.reject(new Error('cancelled'))
    void finished.catch(() => undefined) // created eagerly: mark it handled for the test runner
    const cancelled = { playState: 'running', finished }
    const doc = { getAnimations: () => [cancelled] } as unknown as Document
    await expect(settle(doc)).resolves.toBeUndefined()
  })
})

describe('installLab', () => {
  it('installs window.__lab with ready, a live total, current and settling moves', async () => {
    const api = fakeLabApi()
    const uninstall = installLab(api)
    const lab = window.__lab
    expect(lab).toBeDefined()
    if (!lab) return
    expect(lab.ready).toBe(true)
    expect(lab.total).toBe(3)
    api.total = 7
    expect(lab.total).toBe(7)
    expect(lab.current()).toEqual({
      index: 1,
      stepId: 's2',
      sceneId: 'scene-1',
      say: 'hi',
      changes: [],
    })
    await lab.goto(2)
    await lab.next()
    await lab.prev()
    expect(api.log).toEqual(['goto 2', 'next', 'prev'])
    uninstall()
    expect(window.__lab).toBeUndefined()
  })

  it('uninstall does not remove a newer lab', () => {
    const first = installLab(fakeLabApi())
    installLab(fakeLabApi())
    const current = window.__lab
    first()
    expect(window.__lab).toBe(current)
  })
})

describe('useLabHook', () => {
  // Playwright drives the lab from outside React, and the lab's promises resolve only after a
  // commit — so these calls must not run inside act() (that would wait for itself). Leave the act
  // environment for the duration; RTL re-enables it around its own render/act calls.
  const g = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  let previousActEnv: boolean | undefined
  beforeEach(() => {
    previousActEnv = g.IS_REACT_ACT_ENVIRONMENT
    g.IS_REACT_ACT_ENVIRONMENT = false
  })
  afterEach(() => {
    g.IS_REACT_ACT_ENVIRONMENT = previousActEnv
  })

  function setup(enabled = true, n = 4) {
    return renderHook(
      ({ on }: { on: boolean }) => {
        const api = usePlayer(FRAMES[n] ?? [], { topic: TOPIC, locale: 'en' })
        useLabHook(api, { enabled: on })
        return api
      },
      { initialProps: { on: enabled } },
    )
  }

  it('installs only when enabled and removes on unmount', () => {
    const { rerender, unmount } = setup(false)
    expect(window.__lab).toBeUndefined()
    rerender({ on: true })
    expect(window.__lab?.ready).toBe(true)
    expect(window.__lab?.total).toBe(4)
    rerender({ on: false })
    expect(window.__lab).toBeUndefined()
    rerender({ on: true })
    unmount()
    expect(window.__lab).toBeUndefined()
  })

  it('goto / next / prev resolve after the commit; current() reflects the frame', async () => {
    const { result } = setup()
    const lab = window.__lab
    expect(lab).toBeDefined()
    if (!lab) return
    expect(lab.current()).toMatchObject({
      index: 0,
      stepId: 's1',
      sceneId: 'scene-1',
      say: 'Step 1.',
    })

    await lab.next()
    expect(result.current.state).toMatchObject({ index: 1, move: { kind: 'next' } })
    expect(lab.current().stepId).toBe('s2')

    await lab.goto(3)
    expect(result.current.state).toMatchObject({ index: 3, move: { kind: 'seek' } })
    expect(result.current.instant).toBe(true)

    await lab.prev()
    expect(result.current.state).toMatchObject({ index: 2, move: { kind: 'prev' } })

    // No-op moves resolve too (the player does not re-commit).
    await lab.goto(2)
    expect(result.current.state.index).toBe(2)
    await lab.goto(99)
    expect(result.current.state.index).toBe(3)
    await lab.next()
    expect(result.current.state.index).toBe(3)
  })

  it('a single-frame topic: prev / next are no-ops that still resolve', async () => {
    const { result } = setup(true, 1)
    const lab = window.__lab
    if (!lab) throw new Error('lab not installed')
    await lab.prev()
    await lab.next()
    expect(result.current.state.index).toBe(0)
    expect(lab.current().stepId).toBe('s1')
  })
})
