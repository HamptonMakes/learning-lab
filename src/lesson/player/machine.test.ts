import { describe, expect, it } from 'vitest'
import {
  clamp,
  createInitialState,
  moves,
  transition,
  type PlayerEvent,
  type PlayerState,
} from './machine'

const base = (over: Partial<PlayerState> = {}): PlayerState => ({
  ...createInitialState({ total: 5 }),
  ...over,
})
const at = (index: number, over: Partial<PlayerState> = {}) => base({ index, ...over })

describe('clamp', () => {
  it('clamps into [lo, hi] and collapses an empty range onto lo', () => {
    expect(clamp(3, 0, 4)).toBe(3)
    expect(clamp(-2, 0, 4)).toBe(0)
    expect(clamp(9, 0, 4)).toBe(4)
    expect(clamp(3, 0, -1)).toBe(0)
  })
})

describe('createInitialState', () => {
  it('starts paused at a clamped index with the given speed', () => {
    expect(createInitialState({ total: 5 })).toEqual({
      index: 0,
      total: 5,
      status: 'paused',
      speed: 1,
      mode: 'lesson',
      move: { kind: 'seek', seq: 0 },
    })
    expect(createInitialState({ total: 5, index: 9, speed: 2 })).toMatchObject({
      index: 4,
      speed: 2,
    })
    expect(createInitialState({ total: 5, index: -1 })).toMatchObject({ index: 0 })
    expect(createInitialState({ total: 0, index: 3 })).toMatchObject({ index: 0, total: 0 })
  })
})

describe('transition: next', () => {
  it('advances with a `next` move and bumps seq', () => {
    const s = transition(at(1), { t: 'next', source: 'user' })
    expect(s).toMatchObject({ index: 2, status: 'paused', move: { kind: 'next', seq: 1 } })
  })
  it('auto and user sources behave alike', () => {
    expect(transition(at(1), { t: 'next', source: 'auto' })).toEqual(
      transition(at(1), { t: 'next', source: 'user' }),
    )
  })
  it('at the last frame: ends when playing, otherwise is a no-op (same object)', () => {
    const paused = at(4)
    expect(transition(paused, { t: 'next', source: 'user' })).toBe(paused)
    const playing = at(4, { status: 'playing' })
    const s = transition(playing, { t: 'next', source: 'auto' })
    expect(s).toMatchObject({ index: 4, status: 'ended', move: { kind: 'seek', seq: 0 } })
  })
  it('keeps playing while advancing', () => {
    expect(transition(at(0, { status: 'playing' }), { t: 'next', source: 'auto' })).toMatchObject({
      index: 1,
      status: 'playing',
    })
  })
  it('is a no-op on an empty timeline', () => {
    const empty = createInitialState({ total: 0 })
    expect(transition(empty, { t: 'next', source: 'user' })).toBe(empty)
  })
})

describe('transition: prev', () => {
  it('steps back with a `prev` move', () => {
    expect(transition(at(3), { t: 'prev' })).toMatchObject({
      index: 2,
      status: 'paused',
      move: { kind: 'prev', seq: 1 },
    })
  })
  it('at frame 0 is a no-op (same object)', () => {
    const s = at(0)
    expect(transition(s, { t: 'prev' })).toBe(s)
  })
  it('keeps playing when playing', () => {
    expect(transition(at(3, { status: 'playing' }), { t: 'prev' })).toMatchObject({
      index: 2,
      status: 'playing',
    })
  })
  it('from ended goes back to paused', () => {
    expect(transition(at(4, { status: 'ended' }), { t: 'prev' })).toMatchObject({
      index: 3,
      status: 'paused',
      move: { kind: 'prev', seq: 1 },
    })
  })
})

describe('transition: seek', () => {
  it('moves with a `seek` move and pauses', () => {
    expect(transition(at(1, { status: 'playing' }), { t: 'seek', index: 3 })).toMatchObject({
      index: 3,
      status: 'paused',
      move: { kind: 'seek', seq: 1 },
    })
  })
  it('clamps out-of-range targets', () => {
    expect(transition(at(1), { t: 'seek', index: 99 })).toMatchObject({ index: 4 })
    expect(transition(at(1), { t: 'seek', index: -5 })).toMatchObject({ index: 0 })
  })
  it('seeking to the current index is a no-op (does not pause, same object)', () => {
    const s = at(2, { status: 'playing' })
    expect(transition(s, { t: 'seek', index: 2 })).toBe(s)
  })
  it('from ended pauses at the target', () => {
    expect(transition(at(4, { status: 'ended' }), { t: 'seek', index: 0 })).toMatchObject({
      index: 0,
      status: 'paused',
    })
  })
})

describe('transition: play / pause / toggle', () => {
  it('play sets playing without moving', () => {
    const s = transition(at(2), { t: 'play' })
    expect(s).toMatchObject({ index: 2, status: 'playing', move: { kind: 'seek', seq: 0 } })
  })
  it('play at the end (paused or ended) restarts from 0 with a seek move', () => {
    for (const status of ['paused', 'ended'] as const) {
      expect(transition(at(4, { status }), { t: 'play' })).toMatchObject({
        index: 0,
        status: 'playing',
        move: { kind: 'seek', seq: 1 },
      })
    }
  })
  it('pause sets paused from playing and from ended', () => {
    expect(transition(at(2, { status: 'playing' }), { t: 'pause' })).toMatchObject({
      status: 'paused',
    })
    expect(transition(at(4, { status: 'ended' }), { t: 'pause' })).toMatchObject({
      status: 'paused',
      index: 4,
    })
  })
  it('toggle flips playing ↔ paused and restarts from ended', () => {
    expect(transition(at(2), { t: 'toggle' })).toMatchObject({ status: 'playing' })
    expect(transition(at(2, { status: 'playing' }), { t: 'toggle' })).toMatchObject({
      status: 'paused',
    })
    expect(transition(at(4, { status: 'ended' }), { t: 'toggle' })).toMatchObject({
      index: 0,
      status: 'playing',
    })
  })
})

describe('transition: setSpeed', () => {
  it('changes the speed and nothing else', () => {
    const s = at(2, { status: 'playing' })
    expect(transition(s, { t: 'setSpeed', speed: 2 })).toEqual({ ...s, speed: 2 })
  })
  it('same speed is a no-op (same object)', () => {
    const s = at(2)
    expect(transition(s, { t: 'setSpeed', speed: 1 })).toBe(s)
  })
})

describe('transition: load', () => {
  it('sets total, clamps the index, pauses and counts as a seek move', () => {
    expect(transition(at(3, { status: 'playing' }), { t: 'load', total: 3, index: 7 })).toEqual({
      ...at(3),
      total: 3,
      index: 2,
      status: 'paused',
      move: { kind: 'seek', seq: 1 },
    })
  })
  it('keeps the index when it fits', () => {
    expect(transition(at(2), { t: 'load', total: 10, index: 2 })).toMatchObject({
      index: 2,
      total: 10,
    })
  })
  it('handles an empty timeline', () => {
    expect(transition(at(2), { t: 'load', total: 0, index: 2 })).toMatchObject({
      index: 0,
      total: 0,
    })
  })
})

describe('moves', () => {
  it('is true only when the event changes the index / move seq', () => {
    const events: Array<[PlayerEvent, boolean]> = [
      [{ t: 'next', source: 'user' }, true],
      [{ t: 'prev' }, true],
      [{ t: 'seek', index: 2 }, false],
      [{ t: 'seek', index: 3 }, true],
      [{ t: 'play' }, false],
      [{ t: 'pause' }, false],
      [{ t: 'setSpeed', speed: 3 }, false],
      [{ t: 'load', total: 5, index: 2 }, true],
    ]
    for (const [e, expected] of events) expect(moves(at(2), e), e.t).toBe(expected)
    expect(moves(at(4), { t: 'play' })).toBe(true)
    expect(moves(at(0), { t: 'prev' })).toBe(false)
  })
})

describe('transition: purity', () => {
  it('never mutates its input', () => {
    const s = at(2, { status: 'playing' })
    const snapshot = structuredClone(s)
    const events: PlayerEvent[] = [
      { t: 'next', source: 'auto' },
      { t: 'prev' },
      { t: 'seek', index: 0 },
      { t: 'play' },
      { t: 'pause' },
      { t: 'toggle' },
      { t: 'setSpeed', speed: 0.5 },
      { t: 'load', total: 2, index: 1 },
    ]
    for (const e of events) transition(s, e)
    expect(s).toEqual(snapshot)
  })
})
