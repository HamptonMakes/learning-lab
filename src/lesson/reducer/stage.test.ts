import { describe, expect, it } from 'vitest'
import { ReducerError } from '../types'
import { ctx, fixtureWorld, run } from './test-utils'

describe('stage commands', () => {
  it('spawn adds an actor with derived defaults and keeps the hub', () => {
    const { world } = run(fixtureWorld(), [
      { t: 'spawn', actor: { id: 'carol', kind: 'person', label: 'Carol', holds: { x: 1 } } },
    ])
    expect(Object.keys(world.actors)).toEqual(['alice', 'bob', 'server', 'carol'])
    expect(world.actors.carol).toMatchObject({
      color: 'c',
      online: true,
      holds: { x: { kind: 'scalar', value: 1 } },
    })
    expect(world.layout.hub).toBe('server')
  })

  it('spawn into an empty stage sets the hub; duplicates and a sixth actor throw', () => {
    const empty = { ...fixtureWorld(), actors: {}, layout: { preset: 'row' as const } }
    const { world } = run(empty, [{ t: 'spawn', actor: { id: 'x', kind: 'person', label: 'X' } }])
    expect(world.layout).toEqual({ preset: 'row', hub: 'x' })
    expect(() =>
      run(fixtureWorld(), [{ t: 'spawn', actor: { id: 'alice', kind: 'person', label: 'A' } }]),
    ).toThrow(/already on stage/)
    const full = run(fixtureWorld(), [
      { t: 'spawn', actor: { id: 'c', kind: 'person', label: 'C' } },
      { t: 'spawn', actor: { id: 'd', kind: 'person', label: 'D' } },
    ]).world
    expect(() =>
      run(full, [{ t: 'spawn', actor: { id: 'e', kind: 'person', label: 'E' } }]),
    ).toThrow(/at most 5/)
  })

  it('remove drops in-flight messages to/from the actor with dropped events and clears its replicas/engines', () => {
    const c = ctx()
    const seeded = run(fixtureWorld(), [
      { t: 'send', from: 'alice', to: 'bob', payload: 'to-bob', id: 'm1' },
      { t: 'send', from: 'server', to: 'alice', payload: 'to-alice', id: 'm2' },
      { t: 'send', from: 'server', to: 'bob', payload: 'unrelated', id: 'm3' },
    ]).world
    const withState = {
      ...seeded,
      replicas: { alice: { doc: {} as never }, bob: {} },
      engines: { alice: {}, bob: {} },
    }
    const { world } = run(withState, [{ t: 'remove', actor: 'alice' }], c)
    expect(Object.keys(world.actors)).toEqual(['bob', 'server'])
    expect(world.messages.map((m) => m.id)).toEqual(['m3'])
    expect(world.replicas).toEqual({ bob: {} })
    expect(world.engines).toEqual({ bob: {} })
    expect(c.log.events).toEqual([
      { kind: 'message', op: 'dropped', message: seeded.messages[0] },
      { kind: 'message', op: 'dropped', message: seeded.messages[1] },
    ])
    expect(() => run(world, [{ t: 'remove', actor: 'alice' }])).toThrow(ReducerError)
  })

  it('remove marks a message sent in the same step as transient and recomputes the hub', () => {
    const c = ctx()
    const { world } = run(
      fixtureWorld(),
      [
        { t: 'send', from: 'alice', to: 'server', payload: 1, id: 'm1' },
        { t: 'remove', actor: 'server' },
      ],
      c,
    )
    expect(c.log.events.map((e) => (e.kind === 'message' ? [e.op, e.transient] : e.kind))).toEqual([
      ['sent', true],
      ['dropped', true],
    ])
    expect(world.layout.hub).toBe('alice')
  })

  it('removeBoard removes; unknown board throws', () => {
    const { world } = run(fixtureWorld(), [{ t: 'removeBoard', board: 'rule' }])
    expect(world.boards).toEqual({})
    expect(() => run(world, [{ t: 'removeBoard', board: 'rule' }])).toThrow(/no board/)
  })

  it('layout changes the preset, keeps or sets the hub, validates the hub', () => {
    const a = run(fixtureWorld(), [{ t: 'layout', preset: 'triangle' }]).world
    expect(a.layout).toEqual({ preset: 'triangle', hub: 'server' })
    const b = run(a, [{ t: 'layout', preset: 'ring', hub: 'bob' }]).world
    expect(b.layout).toEqual({ preset: 'ring', hub: 'bob' })
    const cw = run(b, [{ t: 'layout', preset: 'row' }]).world
    expect(cw.layout.hub).toBe('bob')
    expect(() => run(a, [{ t: 'layout', preset: 'hub', hub: 'nobody' }])).toThrow(ReducerError)
  })

  it('tick advances the clock by 1 or by `by`', () => {
    const w = run(fixtureWorld(), [{ t: 'tick' }, { t: 'tick', by: 150 }]).world
    expect(w.clock.now).toBe(151)
    expect(() => run(w, [{ t: 'tick', by: Number.NaN }])).toThrow(ReducerError)
  })

  it('skew / offline / online / status', () => {
    const w = run(fixtureWorld(), [
      { t: 'skew', actor: 'alice', by: 5 },
      { t: 'offline', actor: 'bob' },
      { t: 'status', actor: 'server', status: 'busy' },
    ]).world
    expect(w.actors.alice?.skew).toBe(5)
    expect(w.actors.bob?.online).toBe(false)
    expect(w.actors.server?.status).toBe('busy')
    const w2 = run(w, [
      { t: 'skew', actor: 'alice', by: 0 },
      { t: 'online', actor: 'bob' },
      { t: 'status', actor: 'server', status: null },
    ]).world
    expect(w2.actors.alice?.skew).toBe(0)
    expect(w2.actors.bob?.online).toBe(true)
    expect('status' in (w2.actors.server ?? {})).toBe(false)
    // idempotent: online on an online actor returns the same world
    expect(run(w2, [{ t: 'online', actor: 'bob' }]).world).toBe(w2)
    expect(() => run(w2, [{ t: 'skew', actor: 'zed', by: 1 }])).toThrow(/no actor/)
  })

  it('note upserts a text board in place', () => {
    const w = run(fixtureWorld(), [
      { t: 'note', id: 'law', text: 'law 1', tone: 'info', label: 'Laws' },
      { t: 'note', id: 'other', text: 'x' },
    ]).world
    expect(Object.keys(w.boards)).toEqual(['rule', 'law', 'other'])
    expect(w.boards.law).toEqual({
      id: 'law',
      label: 'Laws',
      tone: 'info',
      value: { kind: 'text', text: 'law 1', annotations: [] },
    })
    const w2 = run(w, [{ t: 'note', id: 'law', text: 'law 2' }]).world
    expect(Object.keys(w2.boards)).toEqual(['rule', 'law', 'other'])
    expect(w2.boards.law).toEqual({
      id: 'law',
      value: { kind: 'text', text: 'law 2', annotations: [] },
    })
    expect(() => run(w2, [{ t: 'note', id: 'bad id', text: 'x' }])).toThrow(ReducerError)
  })

  it('never mutates the input world', () => {
    const w = fixtureWorld()
    const frozen = JSON.stringify(w)
    run(w, [
      { t: 'spawn', actor: { id: 'c', kind: 'person', label: 'C' } },
      { t: 'tick' },
      { t: 'note', id: 'n', text: 'x' },
      { t: 'remove', actor: 'bob' },
    ])
    expect(JSON.stringify(w)).toBe(frozen)
  })
})
