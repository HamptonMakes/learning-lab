import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { track, type AnalyticsEvents } from '@/analytics'
import type { Frame } from '@/lesson/types'
import { progressStore, settingsStore, topicKey } from '@/settings'
import { CHANGES, frames } from './frames.fixture'
import { holdMs } from './hold'
import { usePlayer, type UsePlayerOptions } from './usePlayer'

const { playSpy, instantSpy } = vi.hoisted(() => ({ playSpy: vi.fn(), instantSpy: vi.fn() }))
vi.mock('@/analytics', () => ({ track: vi.fn() }))
vi.mock('@/sound', () => ({
  useSound: () => ({
    play: playSpy,
    enabled: true,
    setEnabled: () => {},
    volume: 0.5,
    setVolume: () => {},
  }),
}))
vi.mock('@/stage/motion', () => ({
  useInstantCommit: () => (commit: () => void) => {
    instantSpy()
    commit()
  },
}))

const TOPIC = { module: 'crdts', unit: 'state-based', topic: 'lww-register' }
const KEY = topicKey(TOPIC.module, TOPIC.unit, TOPIC.topic)
const tracked = () => vi.mocked(track).mock.calls
const propsOf = <N extends keyof AnalyticsEvents>(name: N): AnalyticsEvents[N][] =>
  tracked()
    .filter(([n]) => n === name)
    .map(([, p]) => p as AnalyticsEvents[N])
const playerEvents = () => propsOf('player')
const stepViews = () => propsOf('step_view')
const sounds = () => playSpy.mock.calls.map(([name]) => name as string)

type Props = { frames: Frame[]; opts: UsePlayerOptions }
function setup(fs: Frame[] = frames(4), over: Partial<UsePlayerOptions> = {}) {
  const initial: Props = { frames: fs, opts: { topic: TOPIC, locale: 'en', ...over } }
  const hook = renderHook((p: Props) => usePlayer(p.frames, p.opts), { initialProps: initial })
  const rerenderWith = (patch: Partial<Props['opts']>, nextFrames = fs) =>
    hook.rerender({ frames: nextFrames, opts: { ...initial.opts, ...patch } })
  return { ...hook, rerenderWith }
}

beforeEach(() => {
  vi.useFakeTimers()
  localStorage.clear()
  settingsStore.reset()
  progressStore.reset()
  vi.mocked(track).mockClear()
  playSpy.mockClear()
  instantSpy.mockClear()
})
afterEach(() => {
  cleanup() // no vitest globals → no RTL auto-cleanup; a playing hook would leak into the next test
  vi.useRealTimers()
})

describe('usePlayer: initial state', () => {
  it('starts paused at frame 0 with the speed setting and an instant (seek) commit', () => {
    settingsStore.patch({ speed: 1.5 })
    const { result } = setup()
    expect(result.current.state).toEqual({
      index: 0,
      total: 4,
      status: 'paused',
      speed: 1.5,
      mode: 'lesson',
      move: { kind: 'seek', seq: 0 },
    })
    expect(result.current.frame?.step.id).toBe('s1')
    expect(result.current.instant).toBe(true)
  })

  it('honours initialIndex (clamped) and reports the correction through onIndexChange', () => {
    const onIndexChange = vi.fn()
    const { result } = setup(frames(4), { initialIndex: 2, onIndexChange })
    expect(result.current.state.index).toBe(2)
    expect(onIndexChange).not.toHaveBeenCalled()

    const clamped = setup(frames(4), { initialIndex: 9, onIndexChange })
    expect(clamped.result.current.state.index).toBe(3)
    expect(onIndexChange).toHaveBeenCalledWith(3, 'seek')
  })

  it('records progress and a step_view on mount, but no tick (a load is not a step)', () => {
    setup()
    expect(progressStore.get().topics[KEY]).toMatchObject({ lastStep: 0, totalSteps: 4 })
    expect(stepViews()).toEqual([{ ...TOPIC, scene: 'scene-1', step: 's1', index: 0, total: 4 }])
    expect(sounds()).toEqual([])
  })

  it('copes with an empty timeline', () => {
    const { result } = setup([])
    expect(result.current.frame).toBeUndefined()
    expect(result.current.state).toMatchObject({ index: 0, total: 0 })
    act(() => result.current.next())
    act(() => result.current.play())
    expect(result.current.state.index).toBe(0)
  })

  it('forceInstant makes every commit instant', () => {
    const { result } = setup(frames(4), { forceInstant: true })
    act(() => result.current.next())
    expect(result.current.state.move.kind).toBe('next')
    expect(result.current.instant).toBe(true)
  })
})

describe('usePlayer: moves', () => {
  it('next animates (plain dispatch), ticks, tracks and records progress', () => {
    const onIndexChange = vi.fn()
    const { result } = setup(frames(4), { onIndexChange })
    act(() => result.current.next())
    expect(result.current.state).toMatchObject({ index: 1, move: { kind: 'next', seq: 1 } })
    expect(result.current.instant).toBe(false)
    expect(instantSpy).not.toHaveBeenCalled()
    expect(sounds()).toEqual(['tick'])
    expect(playerEvents()).toEqual([{ ...TOPIC, action: 'next', index: 1 }])
    expect(stepViews().at(-1)).toMatchObject({ step: 's2', index: 1, total: 4 })
    expect(progressStore.get().topics[KEY]?.lastStep).toBe(1)
    expect(onIndexChange).toHaveBeenCalledWith(1, 'next')
  })

  it('prev is an instant commit and ticks', () => {
    const { result } = setup(frames(4), { initialIndex: 2 })
    act(() => result.current.prev())
    expect(result.current.state).toMatchObject({ index: 1, move: { kind: 'prev' } })
    expect(result.current.instant).toBe(true)
    expect(instantSpy).toHaveBeenCalledTimes(1)
    expect(sounds()).toEqual(['tick'])
    expect(playerEvents()).toEqual([{ ...TOPIC, action: 'prev', index: 1 }])
  })

  it('seek is an instant commit, pauses, clamps, and a same-index seek is a no-op', () => {
    const { result } = setup()
    act(() => result.current.play())
    act(() => result.current.seek(2))
    expect(result.current.state).toMatchObject({
      index: 2,
      status: 'paused',
      move: { kind: 'seek' },
    })
    expect(instantSpy).toHaveBeenCalledTimes(1)
    act(() => result.current.seek(99))
    expect(result.current.state.index).toBe(3)
    const seq = result.current.state.move.seq
    act(() => result.current.seek(3))
    expect(result.current.state.move.seq).toBe(seq)
    expect(playerEvents().filter((p) => p.action === 'seek')).toEqual([
      { ...TOPIC, action: 'seek', index: 2 },
      { ...TOPIC, action: 'seek', index: 3 },
      { ...TOPIC, action: 'seek', index: 3 },
    ])
  })

  it('restart seeks to 0 instantly and keeps playing if it was playing', () => {
    const { result } = setup(frames(4), { initialIndex: 2 })
    act(() => result.current.restart())
    expect(result.current.state).toMatchObject({
      index: 0,
      status: 'paused',
      move: { kind: 'seek' },
    })
    expect(playerEvents().at(-1)).toEqual({ ...TOPIC, action: 'restart', index: 0 })

    act(() => result.current.seek(2))
    act(() => result.current.play())
    act(() => result.current.restart())
    expect(result.current.state).toMatchObject({ index: 0, status: 'playing' })
  })

  it('toggle tracks play / pause by the resulting status', () => {
    const { result } = setup()
    act(() => result.current.toggle())
    expect(result.current.state.status).toBe('playing')
    act(() => result.current.toggle())
    expect(result.current.state.status).toBe('paused')
    expect(playerEvents().map((p) => p.action)).toEqual(['play', 'pause'])
  })

  it('play from the end restarts at 0 as an instant seek', () => {
    const { result } = setup(frames(3), { initialIndex: 2 })
    act(() => result.current.play())
    expect(result.current.state).toMatchObject({
      index: 0,
      status: 'playing',
      move: { kind: 'seek' },
    })
    expect(result.current.instant).toBe(true)
    expect(instantSpy).toHaveBeenCalledTimes(1)
  })

  it('the raw dispatch is routed but not tracked', () => {
    const { result } = setup()
    act(() => result.current.dispatch({ t: 'seek', index: 2 }))
    expect(result.current.state.index).toBe(2)
    expect(instantSpy).toHaveBeenCalledTimes(1)
    expect(playerEvents()).toEqual([])
  })
})

describe('usePlayer: autoplay', () => {
  it('advances after holdMs and respects hold, changes and speed', () => {
    const fs = frames(3, (i) => (i === 0 ? { hold: 'short', changes: [CHANGES.delivered] } : {}))
    const { result } = setup(fs)
    act(() => result.current.play())
    const hold0 = holdMs(fs[0] as Frame, 1, false) // 600 + 1200
    expect(hold0).toBe(1800)
    act(() => vi.advanceTimersByTime(hold0 - 1))
    expect(result.current.state.index).toBe(0)
    act(() => vi.advanceTimersByTime(1))
    expect(result.current.state).toMatchObject({
      index: 1,
      status: 'playing',
      move: { kind: 'next' },
    })
    expect(playerEvents()).toEqual([{ ...TOPIC, action: 'play', index: 0 }]) // auto steps are not user actions
    expect(stepViews().at(-1)).toMatchObject({ index: 1 })

    act(() => result.current.setSpeed(2))
    expect(settingsStore.get().speed).toBe(2)
    expect(tracked()).toContainEqual(['speed_change', { speed: 2 }])
    act(() => vi.advanceTimersByTime(2200 / 2 - 1))
    expect(result.current.state.index).toBe(1)
    act(() => vi.advanceTimersByTime(1))
    expect(result.current.state.index).toBe(2)
  })

  it('ends at the last frame: success chord + topic_complete once per mount', () => {
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
    const { result } = setup(frames(2))
    act(() => result.current.play())
    act(() => vi.advanceTimersByTime(2200))
    expect(result.current.state).toMatchObject({ index: 1, status: 'playing' })
    act(() => vi.advanceTimersByTime(2200))
    expect(result.current.state.status).toBe('ended')
    expect(sounds()).toEqual(['tick', 'success'])
    expect(tracked()).toContainEqual(['topic_complete', { ...TOPIC, locale: 'en', seconds: 4 }])
    expect(progressStore.get().topics[KEY]?.completed).toBe(true)
    expect(result.current.state.move.kind).toBe('next') // ended does not move; the frame stays

    // Play again to the end: the chord plays, topic_complete is not re-sent.
    act(() => result.current.play())
    expect(result.current.state).toMatchObject({ index: 0, status: 'playing' })
    act(() => vi.advanceTimersByTime(2200))
    act(() => vi.advanceTimersByTime(2200))
    expect(result.current.state.status).toBe('ended')
    expect(sounds().filter((s) => s === 'success')).toHaveLength(2)
    expect(tracked().filter(([n]) => n === 'topic_complete')).toHaveLength(1)
  })

  it('a user next while playing at the last frame also ends', () => {
    const { result } = setup(frames(2), { initialIndex: 1 })
    act(() => result.current.dispatch({ t: 'play' }))
    // play at the end restarts; move to the end again while playing
    act(() => vi.advanceTimersByTime(2200))
    expect(result.current.state).toMatchObject({ index: 1, status: 'playing' })
    act(() => result.current.next())
    expect(result.current.state.status).toBe('ended')
  })

  it('pause clears the timer; state changes re-arm it', () => {
    const { result } = setup()
    act(() => result.current.play())
    act(() => vi.advanceTimersByTime(2000))
    act(() => result.current.pause())
    act(() => vi.advanceTimersByTime(5000))
    expect(result.current.state.index).toBe(0)
    act(() => result.current.play())
    act(() => vi.advanceTimersByTime(2199))
    expect(result.current.state.index).toBe(0)
    act(() => vi.advanceTimersByTime(1))
    expect(result.current.state.index).toBe(1)
  })

  it('under reduced motion the animation budget is dropped', () => {
    settingsStore.patch({ reducedMotion: 'on' })
    const fs = frames(3, () => ({ changes: [CHANGES.delivered] }))
    const { result } = setup(fs)
    act(() => result.current.play())
    act(() => vi.advanceTimersByTime(2200))
    expect(result.current.state.index).toBe(1)
  })

  it('follows the speed setting when the settings menu changes it', () => {
    const { result } = setup()
    act(() => settingsStore.patch({ speed: 0.5 }))
    expect(result.current.state.speed).toBe(0.5)
    act(() => result.current.play())
    act(() => vi.advanceTimersByTime(4399))
    expect(result.current.state.index).toBe(0)
    act(() => vi.advanceTimersByTime(1))
    expect(result.current.state.index).toBe(1)
  })

  it('enabled=false pauses, suspends autoplay and mutes the automatic effects', () => {
    const { result, rerenderWith } = setup()
    act(() => result.current.play())
    rerenderWith({ enabled: false })
    expect(result.current.state.status).toBe('paused')
    act(() => result.current.play())
    act(() => vi.advanceTimersByTime(10_000))
    expect(result.current.state.index).toBe(0)
    playSpy.mockClear()
    vi.mocked(track).mockClear()
    act(() => result.current.next())
    expect(sounds()).toEqual([])
    expect(stepViews()).toEqual([])
    expect(playerEvents()).toEqual([{ ...TOPIC, action: 'next', index: 1 }])
  })
})

describe('usePlayer: sounds for the new frame', () => {
  const fs = () =>
    frames(5, (i) =>
      i === 1
        ? { changes: [CHANGES.sent, CHANGES.transientDelivered] }
        : i === 2
          ? { changes: [CHANGES.dropped, CHANGES.delivered, CHANGES.delivered] }
          : i === 3
            ? { changes: [CHANGES.parked] }
            : {},
    )

  it('bloops once on a delivery (transient included), pops softly on a drop, nothing on parked', () => {
    const { result } = setup(fs())
    act(() => result.current.next()) // → 1: transient delivery
    expect(playSpy.mock.calls).toEqual([['tick'], ['bloop']])
    playSpy.mockClear()
    act(() => result.current.next()) // → 2: drop + 2 deliveries → one bloop, one soft pop
    expect(playSpy.mock.calls).toEqual([['tick'], ['bloop'], ['pop', { volume: 0.5 }]])
    playSpy.mockClear()
    act(() => result.current.next()) // → 3: parked only
    expect(playSpy.mock.calls).toEqual([['tick']])
  })

  it('only forward steps play delivery sounds; prev / seek just tick', () => {
    const { result } = setup(fs(), { initialIndex: 3 })
    act(() => result.current.prev()) // → 2 (deliveries) instantly
    expect(playSpy.mock.calls).toEqual([['tick']])
    playSpy.mockClear()
    act(() => result.current.seek(1))
    expect(playSpy.mock.calls).toEqual([['tick']])
  })
})

describe('usePlayer: external changes', () => {
  it('seeks when initialIndex changes from outside and ignores its own echo', () => {
    const onIndexChange = vi.fn()
    const { result, rerenderWith } = setup(frames(4), { initialIndex: 0, onIndexChange })
    act(() => result.current.next())
    expect(onIndexChange).toHaveBeenLastCalledWith(1, 'next')
    const seq = result.current.state.move.seq
    rerenderWith({ initialIndex: 1 }) // the URL caught up
    expect(result.current.state.move.seq).toBe(seq)

    rerenderWith({ initialIndex: 3 }) // Back/Forward
    expect(result.current.state).toMatchObject({ index: 3, move: { kind: 'seek' } })
    expect(onIndexChange).toHaveBeenLastCalledWith(3, 'seek')
    expect(instantSpy).toHaveBeenCalledTimes(1)
    expect(playerEvents().map((p) => p.action)).toEqual(['next']) // not a user action
  })

  it('reloads when the frames change identity, keeping the index, without a tick', () => {
    const onIndexChange = vi.fn()
    const { result, rerenderWith } = setup(frames(4), { onIndexChange, initialIndex: 2 })
    act(() => result.current.play())
    playSpy.mockClear()
    vi.mocked(track).mockClear()
    onIndexChange.mockClear()
    rerenderWith({}, frames(4))
    expect(result.current.state).toMatchObject({
      index: 2,
      total: 4,
      status: 'paused',
      move: { kind: 'seek' },
    })
    expect(sounds()).toEqual([])
    expect(stepViews()).toEqual([]) // same step, not re-viewed
    expect(onIndexChange).not.toHaveBeenCalled()

    rerenderWith({}, frames(2)) // shorter: clamp
    expect(result.current.state).toMatchObject({ index: 1, total: 2 })
    expect(onIndexChange).toHaveBeenLastCalledWith(1, 'seek')
    expect(sounds()).toEqual([]) // still a load
  })

  it('reports unknown locales as the default locale on topic_complete', () => {
    const { result } = setup(frames(1), { locale: 'xx' })
    act(() => result.current.play())
    act(() => vi.advanceTimersByTime(2200))
    expect(tracked()).toContainEqual(['topic_complete', expect.objectContaining({ locale: 'en' })])
  })

  it('returns a stable API object between identical renders', () => {
    const { result, rerender } = setup()
    const first = result.current
    rerender({
      frames: first.frame ? [first.frame, ...frames(4).slice(1)] : [],
      opts: { topic: TOPIC, locale: 'en' },
    })
    expect(result.current.next).toBe(first.next)
    expect(result.current.seek).toBe(first.seek)
    expect(result.current.dispatch).toBe(first.dispatch)
  })
})
