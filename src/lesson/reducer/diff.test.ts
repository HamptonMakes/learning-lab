import { describe, expect, it } from 'vitest'
import type { Change, World } from '../types'
import { diffValue, diffWorld } from './diff'
import {
  bytesOf,
  clockOf,
  counter,
  fixtureWorld,
  list,
  rec,
  run,
  scalar,
  sset,
  table,
  textOf,
} from './test-utils'

const slots = (
  w: World,
  actor: string,
  holds: Record<string, ReturnType<typeof scalar>>,
): World => {
  const a = w.actors[actor]
  if (!a) throw new Error(actor)
  return { ...w, actors: { ...w.actors, [actor]: { ...a, holds: { ...a.holds, ...holds } } } }
}
const values = (prev: ReturnType<typeof scalar>, next: ReturnType<typeof scalar>): Change[] => {
  const out: Change[] = []
  diffValue(prev, next, 'a.s', out)
  return out
}
const v = (path: string, op: 'added' | 'changed' | 'removed' | 'meta'): Change => ({
  kind: 'value',
  path,
  op,
})

describe('diffValue', () => {
  it('scalars: value → changed, meta-only → meta, same → nothing', () => {
    expect(values(scalar(1), scalar(2))).toEqual([v('a.s', 'changed')])
    expect(values(scalar(1), scalar(1, { ts: 1 }))).toEqual([v('a.s', 'meta')])
    expect(values(scalar(1, { ts: 1 }), scalar(1, { ts: 1 }))).toEqual([])
    expect(values(scalar(1), list(['x']))).toEqual([v('a.s', 'changed')])
  })

  it('records: fields by key at the deepest path; reorder/display → the record', () => {
    expect(
      values(
        rec({ a: scalar(1), b: scalar(2) }),
        rec({ a: scalar(1), b: scalar(3), c: scalar(4) }),
      ),
    ).toEqual([v('a.s.b', 'changed'), v('a.s.c', 'added')])
    expect(values(rec({ a: scalar(1), b: scalar(2) }), rec({ a: scalar(1) }))).toEqual([
      v('a.s.b', 'removed'),
    ])
    expect(
      values(rec({ a: scalar(1), b: scalar(2) }), rec({ b: scalar(2), a: scalar(1) })),
    ).toEqual([v('a.s', 'changed')])
    expect(values(rec({ a: rec({ x: scalar(1) }) }), rec({ a: rec({ x: scalar(2) }) }))).toEqual([
      v('a.s.a.x', 'changed'),
    ])
    expect(
      values(rec({ a: scalar(1) }), { ...rec({ a: scalar(1) }), meta: { type: 'lww-map' } }),
    ).toEqual([v('a.s', 'meta')])
  })

  it('lists and sets: items by id; a reorder of surviving items → the container', () => {
    expect(values(list(['a', 'b']), list(['a', 'b', 'c']))).toEqual([v('a.s[c]', 'added')])
    expect(values(list(['a', 'b']), list(['b']))).toEqual([v('a.s[a]', 'removed')])
    expect(values(list(['a', 'b']), list(['b', 'a']))).toEqual([v('a.s', 'changed')])
    expect(values(list(['a', 'b']), list(['b', 'a', 'c']))).toEqual([
      v('a.s[c]', 'added'),
      v('a.s', 'changed'),
    ])
    expect(
      values(list([['a', scalar('a')]]), list([['a', scalar('a', { tombstone: true })]])),
    ).toEqual([v('a.s[a]', 'meta')])
    expect(values(list(['a']), list(['a'], 'text'))).toEqual([v('a.s', 'changed')])
    expect(values(sset(['a']), sset(['a', 'z']))).toEqual([v('a.s[z]', 'added')])
  })

  it('counters by node, clocks by entry, tables by row and cell', () => {
    expect(values(counter({ alice: 1 }), counter({ alice: 2, bob: 1 }))).toEqual([
      v('a.s[alice]', 'changed'),
      v('a.s[bob]', 'added'),
    ])
    expect(values(counter({ alice: 1, bob: 1 }), counter({ alice: 1 }))).toEqual([
      v('a.s[bob]', 'removed'),
    ])
    expect(values(clockOf({ alice: 1 }), clockOf({ alice: 2, bob: 0 }))).toEqual([
      v('a.s.alice', 'changed'),
      v('a.s.bob', 'added'),
    ])
    expect(values(clockOf({ alice: 1, bob: 0 }), clockOf({ alice: 1 }))).toEqual([
      v('a.s.bob', 'removed'),
    ])
    expect(
      values(
        table(['x', 'y'], [['r1', { x: 1, y: 2 }]]),
        table(
          ['x', 'y'],
          [
            ['r1', { x: 1, y: 3 }],
            ['r2', { x: 0 }],
          ],
        ),
      ),
    ).toEqual([v('a.s[r1].y', 'changed'), v('a.s[r2]', 'added')])
    expect(
      values(
        table(
          ['x'],
          [
            ['r1', { x: 1 }],
            ['r2', { x: 2 }],
          ],
        ),
        table(
          ['x'],
          [
            ['r2', { x: 2 }],
            ['r1', { x: 1 }],
          ],
        ),
      ),
    ).toEqual([v('a.s', 'changed')])
    expect(values(table(['x'], [['r1', { x: 1 }]]), table(['x'], [['r1', {}]]))).toEqual([
      v('a.s[r1].x', 'removed'),
    ])
  })

  it('bytes, text, pattern and meter compare as a whole', () => {
    expect(values(bytesOf('0011'), bytesOf('0012'))).toEqual([v('a.s', 'changed')])
    expect(values(bytesOf('0011'), { ...bytesOf('0011'), display: 'bits' })).toEqual([
      v('a.s', 'changed'),
    ])
    expect(
      values(bytesOf('0011'), { ...bytesOf('0011'), annotations: [{ from: 0, to: 1 }] }),
    ).toEqual([v('a.s', 'changed')])
    expect(values(bytesOf('0011'), { ...bytesOf('0011'), meta: { note: 'x' } })).toEqual([
      v('a.s', 'meta'),
    ])
    expect(values(textOf('a'), textOf('b'))).toEqual([v('a.s', 'changed')])
    expect(values(textOf('a'), { ...textOf('a'), cursor: 1 })).toEqual([v('a.s', 'changed')])
    expect(values({ kind: 'meter', value: 1 }, { kind: 'meter', value: 2 })).toEqual([
      v('a.s', 'changed'),
    ])
    expect(
      values({ kind: 'pattern', tokens: [] }, { kind: 'pattern', tokens: [], cursor: 1 }),
    ).toEqual([v('a.s', 'changed')])
  })
})

describe('diffWorld', () => {
  it('actors: spawned / removed / online / offline / status / skew, then holds, outbox and inbox', () => {
    const prev = fixtureWorld()
    const next = run(prev, [
      { t: 'offline', actor: 'alice' },
      { t: 'status', actor: 'alice', status: 'busy' },
      { t: 'skew', actor: 'alice', by: 3 },
      { t: 'set', path: 'alice.doc', value: 'x' },
      { t: 'set', path: 'alice.fresh', value: 1 },
      { t: 'delete', path: 'alice.n' },
      { t: 'remove', actor: 'bob' },
      { t: 'spawn', actor: { id: 'carol', kind: 'person', label: 'C' } },
    ]).world
    expect(diffWorld(prev, next)).toEqual([
      { kind: 'actor', id: 'alice', op: 'offline' },
      { kind: 'actor', id: 'alice', op: 'status' },
      { kind: 'actor', id: 'alice', op: 'skew' },
      v('alice.doc', 'changed'),
      v('alice.fresh', 'added'),
      v('alice.n', 'removed'),
      { kind: 'actor', id: 'carol', op: 'spawned' },
      { kind: 'actor', id: 'bob', op: 'removed' },
    ])
  })

  it('outbox chips and the parked set are value changes on <actor>@outbox / @inbox', () => {
    const prev = fixtureWorld()
    const chips = {
      ...prev,
      actors: {
        ...prev.actors,
        alice: {
          ...(prev.actors.alice as NonNullable<World['actors'][string]>),
          outbox: [{ slot: 'likes', id: 'alice:1' as const, label: 'inc 1' }],
        },
      },
    }
    expect(diffWorld(prev, chips)).toEqual([v('alice@outbox', 'changed')])
    const parked = run(prev, [
      { t: 'offline', actor: 'bob' },
      { t: 'send', from: 'alice', to: 'bob', payload: 1 },
    ]).world
    expect(diffWorld(prev, parked)).toEqual([
      { kind: 'actor', id: 'bob', op: 'offline' },
      v('bob@inbox', 'changed'),
    ])
    // a flying message is not an inbox change
    const flying = run(prev, [{ t: 'send', from: 'alice', to: 'bob', payload: 1 }]).world
    expect(diffWorld(prev, flying)).toEqual([])
  })

  it('boards added / changed (label, tone) / removed, value changes under board.<id>', () => {
    const prev = fixtureWorld()
    const next = run(prev, [
      { t: 'note', id: 'rule', text: 'merge = max', label: 'Rule' },
      { t: 'note', id: 'two', text: 'second' },
    ]).world
    expect(diffWorld(prev, next)).toEqual([
      { kind: 'board', id: 'rule', op: 'changed' },
      { kind: 'board', id: 'two', op: 'added' },
    ])
    const retext = run(prev, [{ t: 'note', id: 'rule', text: 'other' }]).world
    expect(diffWorld(prev, retext)).toEqual([v('board.rule', 'changed')])
    const removed = run(prev, [{ t: 'removeBoard', board: 'rule' }]).world
    expect(diffWorld(prev, removed)).toEqual([{ kind: 'board', id: 'rule', op: 'removed' }])
    const withTable = {
      ...prev,
      boards: { t: { id: 't', value: table(['x'], [['r1', { x: 1 }]]) } },
    }
    const cell = run(withTable, [{ t: 'set', path: 'board.t[r1].x', value: 2 }]).world
    expect(diffWorld(withTable, cell)).toEqual([v('board.t[r1].x', 'changed')])
  })

  it('layout, clock and marks (by id; changed content = removed + added), in that order after boards', () => {
    const prev = slots(fixtureWorld(), 'alice', { x: scalar(1) })
    const next = run(prev, [
      { t: 'layout', preset: 'triangle', hub: 'alice' },
      { t: 'tick', by: 2 },
      { t: 'highlight', path: 'alice.x', id: 'h1' },
      { t: 'note', id: 'n', text: 'n' },
    ]).world
    const withOld = {
      ...prev,
      marks: [
        { id: 'old', kind: 'check' as const, path: 'alice.x', sticky: true },
        { id: 'h1', kind: 'check' as const, path: 'alice.x' },
      ],
    }
    expect(diffWorld(withOld, next)).toEqual([
      { kind: 'board', id: 'n', op: 'added' },
      {
        kind: 'layout',
        from: { preset: 'pair', hub: 'server' },
        to: { preset: 'triangle', hub: 'alice' },
      },
      { kind: 'clock', from: 0, to: 2 },
      { kind: 'mark', id: 'old', op: 'removed' },
      { kind: 'mark', id: 'h1', op: 'removed' },
      { kind: 'mark', id: 'h1', op: 'added' },
    ])
    expect(diffWorld(prev, prev)).toEqual([])
  })
})
