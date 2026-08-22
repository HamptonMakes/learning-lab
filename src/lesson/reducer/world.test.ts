import { describe, expect, it } from 'vitest'
import { ReducerError, type SceneWorld } from '../types'
import { actorFromSpec, defaultHub, initWorld } from './world'

const person = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  kind: 'person' as const,
  label: id,
  ...extra,
})

describe('initWorld', () => {
  it('fills actor defaults: colour a, online, wrapped scalars, empty outbox', () => {
    const w = initWorld({
      actors: [person('alice', { holds: { n: 3, doc: { kind: 'scalar', value: 'x' } } })],
    })
    expect(w.actors.alice).toEqual({
      id: 'alice',
      kind: 'person',
      label: 'alice',
      color: 'a',
      online: true,
      holds: { n: { kind: 'scalar', value: 3 }, doc: { kind: 'scalar', value: 'x' } },
      outbox: [],
    })
    expect(w.layout).toEqual({ preset: 'row', hub: 'alice' })
    expect(w.clock).toEqual({ now: 0, show: false, format: 'counter' })
    expect(w.boards).toEqual({})
    expect(w.messages).toEqual([])
    expect(w.marks).toEqual([])
    expect(w.replicas).toEqual({})
    expect(w.engines).toEqual({})
    expect(w.ids).toBe(0)
  })

  it('derives colours: owner → server/service → next free of a, b, c, d', () => {
    const w = initWorld({
      actors: [
        person('alice'),
        { id: 'server', kind: 'server', label: 'Server' },
        person('bob'),
        { id: 'laptop', kind: 'device', label: 'Laptop', owner: 'alice' },
        { id: 'edge', kind: 'service', label: 'Edge' },
      ],
    })
    expect(Object.values(w.actors).map((a) => a.color)).toEqual(['a', 'server', 'b', 'a', 'server'])
    expect(w.actors.laptop?.owner).toBe('alice')
  })

  it('falls back to neutral once a–d are taken and honours an explicit colour', () => {
    const w = initWorld({
      actors: [
        person('p1'),
        person('p2'),
        person('p3'),
        person('p4', { color: 'neutral' }),
        person('p5'),
      ],
    })
    expect(Object.values(w.actors).map((a) => a.color)).toEqual(['a', 'b', 'c', 'neutral', 'd'])
  })

  it('keeps explicit optional fields and online:false', () => {
    const w = initWorld({
      actors: [
        person('alice', {
          online: false,
          subtitle: 'phone',
          icon: 'phone',
          status: 'lock',
          skew: 2,
          color: 'c',
        }),
      ],
    })
    expect(w.actors.alice).toMatchObject({
      online: false,
      subtitle: 'phone',
      icon: 'phone',
      status: 'lock',
      skew: 2,
      color: 'c',
    })
  })

  it('hub defaults to the first server/service, else the first actor; explicit hub wins', () => {
    expect(initWorld({ actors: [person('a'), person('b')] }).layout.hub).toBe('a')
    expect(
      initWorld({ actors: [person('a'), { id: 's', kind: 'service', label: 'S' }] }).layout.hub,
    ).toBe('s')
    expect(
      initWorld({ hub: 'b', layout: 'hub', actors: [person('a'), person('b')] }).layout,
    ).toEqual({ preset: 'hub', hub: 'b' })
    expect(initWorld({ actors: [] }).layout).toEqual({ preset: 'row' })
    expect(defaultHub({})).toBeUndefined()
  })

  it('merges a partial clock over the defaults', () => {
    expect(initWorld({ actors: [], clock: { show: true, now: 2 } }).clock).toEqual({
      now: 2,
      show: true,
      format: 'counter',
    })
    expect(
      initWorld({ actors: [], clock: { format: 'time', start: '10:00', autoTick: true } }).clock,
    ).toEqual({ now: 0, show: false, format: 'time', start: '10:00', autoTick: true })
    expect(() => initWorld({ actors: [], clock: { format: 'time' } })).toThrow(ReducerError)
  })

  it('keys boards by id in declaration order', () => {
    const w = initWorld({
      actors: [],
      boards: [
        { id: 'b', value: { kind: 'scalar', value: 1 } },
        { id: 'a', value: { kind: 'scalar', value: 2 }, label: 'A', tone: 'info' },
      ],
    })
    expect(Object.keys(w.boards)).toEqual(['b', 'a'])
    expect(w.boards.a).toEqual({
      id: 'a',
      value: { kind: 'scalar', value: 2 },
      label: 'A',
      tone: 'info',
    })
  })

  it('throws on authoring mistakes', () => {
    const six: SceneWorld = { actors: ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => person(id)) }
    expect(() => initWorld(six)).toThrow(/at most 5/)
    expect(() => initWorld({ actors: [person('board')] })).toThrow(/reserved/)
    expect(() => initWorld({ actors: [person('msg')] })).toThrow(/reserved/)
    expect(() => initWorld({ actors: [person('a'), person('a')] })).toThrow(/already on stage/)
    expect(() => initWorld({ actors: [person('a.b')] })).toThrow(ReducerError)
    expect(() => initWorld({ actors: [person('a b')] })).toThrow(ReducerError)
    expect(() =>
      initWorld({ actors: [{ id: 'laptop', kind: 'device', label: 'L', owner: 'alice' }] }),
    ).toThrow(/owner/)
    expect(() => initWorld({ actors: [person('a')], hub: 'zed' })).toThrow(/hub/)
    expect(() =>
      initWorld({
        actors: [],
        boards: [
          { id: 'x', value: { kind: 'scalar', value: 1 } },
          { id: 'x', value: { kind: 'scalar', value: 1 } },
        ],
      }),
    ).toThrow(/twice/)
    expect(() =>
      initWorld({ actors: [], boards: [{ id: 'a.b', value: { kind: 'scalar', value: 1 } }] }),
    ).toThrow(ReducerError)
  })

  it('actorFromSpec rejects bad slot ids and a sixth actor', () => {
    expect(() => actorFromSpec(person('a', { holds: { 'x y': 1 } }), {})).toThrow(/slot id/)
    const five = initWorld({ actors: ['a', 'b', 'c', 'd', 'e'].map((id) => person(id)) }).actors
    expect(() => actorFromSpec(person('f'), five)).toThrow(/at most 5/)
  })
})
