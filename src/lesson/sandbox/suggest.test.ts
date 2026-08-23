/**
 * `suggestExperiments`: which experiments a world gets (by slot type and wire), how a TryIt
 * override restricts them, and the `done(history)` checks ticking on real sandbox histories
 * (frames produced by the real reducer).
 */
import { describe, expect, it } from 'vitest'
import { crdt, deliver, offline, online, tick } from '../builders'
import { applyStep, initWorld, makeReduceCtx, reduce } from '../reducer'
import type { Command, Frame, SceneWorld, World } from '../types'
import { suggestExperiments } from './suggest'

const PAIR: SceneWorld = {
  layout: 'pair',
  actors: [
    { id: 'alice', kind: 'person', label: 'Alice' },
    { id: 'bob', kind: 'person', label: 'Bob' },
  ],
}
const AB = ['alice', 'bob']

function world(cmds: Command[], scene: SceneWorld = PAIR): World {
  let w = initWorld(scene)
  const ctx = makeReduceCtx({ sceneId: 's', stepId: 't' })
  for (const c of cmds) w = reduce(w, c, ctx)
  return w
}

function startFrame(w: World): Frame {
  return {
    index: 0,
    sceneId: 's',
    sceneIndex: 0,
    step: { id: 's01', say: '', do: [] },
    world: w,
    prev: w,
    changes: [],
  }
}

/** Replay `steps` (each a command list) as sandbox steps; returns the history (start first). */
function play(w: World, steps: Command[][]): Frame[] {
  const history: Frame[] = [startFrame(w)]
  steps.forEach((cmds, i) => {
    const prev = history[history.length - 1]
    if (!prev) throw new Error('no start')
    const step = { id: `x${i + 1}`, say: '', do: cmds }
    const { world: next, changes } = applyStep(prev.world, step, {
      sceneId: 's',
      stepId: step.id,
      assertMode: 'warn',
    })
    history.push({ ...prev, index: prev.index + 1, step, world: next, prev: prev.world, changes })
  })
  return history
}

const kinds = (w: World, tryIt?: Parameters<typeof suggestExperiments>[1]) =>
  suggestExperiments(w, tryIt).map((s) => s.kind)

describe('suggestExperiments: which experiments', () => {
  it('a register gets a race, a counter a double-count check, plus one partition experiment', () => {
    const w = world([
      crdt.init(AB, 'status', 'lww-register', { seed: [{ op: 'set', args: ['Offline'] }] }),
      crdt.init(AB, 'views', 'g-counter'),
    ])
    const s = suggestExperiments(w)
    expect(s.map((x) => x.id)).toEqual(['race-status', 'doubleCount-views', 'partition-status'])
    expect(s[0]?.text).toEqual({
      key: 'tryIt.suggest.race',
      vars: { slot: 'status', a: 'Alice', b: 'Bob' },
    })
    expect(s[2]?.text).toEqual({
      key: 'tryIt.suggest.partition',
      vars: { slot: 'status', a: 'Alice', b: 'Bob' },
    })
  })

  it('sets: or-set add-vs-remove, 2P-set re-add, g-set add-both; rga type-both; clocks ticks', () => {
    expect(kinds(world([crdt.init(AB, 'cart', 'or-set')]))).toEqual(['addRemove', 'partition'])
    expect(kinds(world([crdt.init(AB, 'cart', 'lww-element-set')]))).toEqual([
      'addRemove',
      'partition',
    ])
    expect(kinds(world([crdt.init(AB, 'cart', 'two-phase-set')]))).toEqual(['readd', 'partition'])
    expect(kinds(world([crdt.init(AB, 'tags', 'g-set')]))).toEqual(['addBoth', 'partition'])
    expect(kinds(world([crdt.init(AB, 'text', 'rga')]))).toEqual(['typeBoth', 'partition'])
    expect(kinds(world([crdt.init(AB, 'clock', 'vector-clock')]))).toEqual(['ticks', 'partition'])
    expect(kinds(world([crdt.init(AB, 'doc', 'lww-map')]))).toEqual(['race', 'partition'])
  })

  it('an ops-wired slot gets broadcast + deliver and the offline-first variant', () => {
    const w = world([crdt.init(AB, 'likes', 'op-counter', { wire: 'ops' })])
    expect(kinds(w)).toEqual(['broadcastDeliver', 'offlineFirst'])
  })

  it('caps at three and needs two holders', () => {
    const w = world([
      crdt.init(AB, 'a', 'g-counter'),
      crdt.init(AB, 'b', 'g-counter'),
      crdt.init(AB, 'c', 'g-counter'),
      crdt.init(AB, 'd', 'g-counter'),
    ])
    expect(suggestExperiments(w)).toHaveLength(3)
    const solo = world([crdt.init(['alice'], 'n', 'g-counter')])
    expect(suggestExperiments(solo)).toEqual([])
  })

  it('a TryIt override restricts the slot and the network controls', () => {
    const w = world([crdt.init(AB, 'status', 'lww-register'), crdt.init(AB, 'views', 'g-counter')])
    expect(kinds(w, { slot: 'views', ops: [{ op: 'inc' }] })).toEqual(['doubleCount', 'partition'])
    expect(kinds(w, { slot: 'views', ops: [{ op: 'inc' }], network: ['sync'] })).toEqual([
      'doubleCount',
    ])
    expect(kinds(w, { slot: 'views', ops: [{ op: 'inc' }], network: ['offline'] })).toEqual([])
  })
})

describe('suggestExperiments: done(history)', () => {
  const reg = world([
    crdt.init(AB, 'status', 'lww-register', { seed: [{ op: 'set', args: ['Offline'] }] }),
    crdt.init(AB, 'views', 'g-counter'),
  ])
  const [race, double, part] = suggestExperiments(reg)

  it('race: set on both actors, then sync — not before the sync, not for one actor', () => {
    if (!race) throw new Error('no race')
    const h = play(reg, [
      [tick(), crdt.update('alice', 'status', 'set', 'Lunch')],
      [tick(), crdt.update('bob', 'status', 'set', 'Busy')],
      [crdt.sync('alice', 'bob', 'status')],
    ])
    expect(race.done(h.slice(0, 3))).toBe(false)
    expect(race.done(h)).toBe(true)
    const solo = play(reg, [
      [tick(), crdt.update('alice', 'status', 'set', 'Lunch')],
      [tick(), crdt.update('alice', 'status', 'set', 'Busy')],
      [crdt.sync('alice', 'bob', 'status')],
    ])
    expect(race.done(solo)).toBe(false)
    // A sync in between separates the writes into two rounds.
    const split = play(reg, [
      [tick(), crdt.update('alice', 'status', 'set', 'Lunch')],
      [crdt.sync('alice', 'bob', 'status')],
      [tick(), crdt.update('bob', 'status', 'set', 'Busy')],
      [crdt.sync('alice', 'bob', 'status')],
    ])
    expect(race.done(split)).toBe(false)
  })

  it('doubleCount: +1 on both, sync, sync again', () => {
    if (!double) throw new Error('no doubleCount')
    const h = play(reg, [
      [crdt.update('alice', 'views', 'inc', 1)],
      [crdt.update('bob', 'views', 'inc', 1)],
      [crdt.sync('alice', 'bob', 'views')],
      [crdt.sync('alice', 'bob', 'views')],
    ])
    expect(double.done(h.slice(0, 4))).toBe(false)
    expect(double.done(h)).toBe(true)
  })

  it('partition: offline, writes on both sides, online, sync', () => {
    if (!part) throw new Error('no partition')
    const h = play(reg, [
      [offline('bob')],
      [tick(), crdt.update('alice', 'status', 'set', 'Lunch')],
      [tick(), crdt.update('bob', 'status', 'set', 'Busy')],
      [online('bob')],
      [crdt.sync('alice', 'bob', 'status')],
    ])
    expect(part.done(h.slice(0, 5))).toBe(false)
    expect(part.done(h)).toBe(true)
    // Without the offline phase it is just a race, not a partition.
    const plain = play(reg, [
      [tick(), crdt.update('alice', 'status', 'set', 'Lunch')],
      [tick(), crdt.update('bob', 'status', 'set', 'Busy')],
      [crdt.sync('alice', 'bob', 'status')],
    ])
    expect(part.done(plain)).toBe(false)
  })

  it('addRemove: Bob removes the item Alice adds, then sync (same item, different actors)', () => {
    const w = world([
      crdt.init(AB, 'cart', 'or-set'),
      crdt.update('alice', 'cart', 'add', 'eggs'),
      crdt.sync('alice', 'bob', 'cart'),
    ])
    const [s] = suggestExperiments(w)
    if (!s) throw new Error('no suggestion')
    expect(s.kind).toBe('addRemove')
    const h = play(w, [
      [crdt.update('bob', 'cart', 'remove', 'eggs')],
      [crdt.update('alice', 'cart', 'add', 'eggs')],
      [crdt.sync('alice', 'bob', 'cart')],
    ])
    expect(s.done(h.slice(0, 3))).toBe(false)
    expect(s.done(h)).toBe(true)
    const other = play(w, [
      [crdt.update('bob', 'cart', 'remove', 'eggs')],
      [crdt.update('alice', 'cart', 'add', 'milk')],
      [crdt.sync('alice', 'bob', 'cart')],
    ])
    expect(s.done(other)).toBe(false)
  })

  it('typeBoth and ticks follow the same "two actors, then sync" shape', () => {
    const rga = world([crdt.init(AB, 'text', 'rga')])
    const [typeBoth] = suggestExperiments(rga)
    const h = play(rga, [
      [crdt.update('alice', 'text', 'type', 'HEAD', 'a')],
      [crdt.update('bob', 'text', 'type', 'HEAD', 'b')],
      [crdt.sync('alice', 'bob', 'text')],
    ])
    expect(typeBoth?.done(h)).toBe(true)

    const vc = world([crdt.init(AB, 'clock', 'vector-clock')])
    const [ticks] = suggestExperiments(vc)
    const hv = play(vc, [
      [crdt.update('alice', 'clock', 'tick')],
      [crdt.update('alice', 'clock', 'tick')],
      [crdt.sync('alice', 'bob', 'clock')],
    ])
    expect(ticks?.done(hv.slice(0, 3))).toBe(false)
    expect(ticks?.done(hv)).toBe(true)
  })

  it('ops wire: broadcast then deliver all; offline first, broadcast, back online, deliver', () => {
    const w = world([crdt.init(AB, 'likes', 'op-counter', { wire: 'ops' })])
    const [bd, off] = suggestExperiments(w)
    if (!bd || !off) throw new Error('no suggestions')
    const h = play(w, [
      [crdt.update('alice', 'likes', 'inc', 1)],
      [crdt.broadcast('alice', 'likes', { id: 'm1' })],
      [deliver('m1@bob')],
    ])
    expect(bd.done(h.slice(0, 3))).toBe(false)
    expect(bd.done(h)).toBe(true)
    expect(off.done(h)).toBe(false)

    const ho = play(w, [
      [offline('bob')],
      [crdt.update('alice', 'likes', 'inc', 1)],
      [crdt.broadcast('alice', 'likes', { id: 'm1' })],
      [online('bob')],
      [deliver('m1@bob')],
    ])
    expect(off.done(ho.slice(0, 5))).toBe(false)
    expect(off.done(ho)).toBe(true)
    expect(bd.done(ho)).toBe(true)
  })
})
