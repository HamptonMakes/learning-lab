import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { assertConvergence, assertMergeLaws, assertOpConvergence, canon } from './laws'
import {
  twoPhaseSet,
  twoPhaseSetHas,
  twoPhaseSetRows,
  twoPhaseSetType,
  type TwoPhaseSetOp,
  type TwoPhaseSetState,
  type TwoPhaseSetUpdate,
} from './two-phase-set'
import { makeCtx, type CrdtType, type Ctx } from './types'

const ITEMS = ['apple', 'bread', 'milk', 'eggs'] as const
const itemArb = fc.constantFrom(...ITEMS)
const updateArb = (): fc.Arbitrary<TwoPhaseSetUpdate<string>> =>
  fc.oneof(
    { weight: 2, arbitrary: itemArb.map((add) => ({ add })) },
    { weight: 1, arbitrary: itemArb.map((remove) => ({ remove })) },
  )

/**
 * The laws helpers generate updates without seeing state, but the real type throws on a remove
 * of an element that was never added. This wrapper keeps every intent valid — a remove of an
 * unknown element is turned into an add — and delegates everything else to the real type, so
 * merge/effect/value under test are the genuine ones. Removes of known elements go through as-is.
 */
function lenient(): CrdtType<
  TwoPhaseSetState<string>,
  TwoPhaseSetUpdate<string>,
  TwoPhaseSetOp<string>,
  string[]
> {
  const fix = (
    state: TwoPhaseSetState<string>,
    u: TwoPhaseSetUpdate<string>,
  ): TwoPhaseSetUpdate<string> =>
    'remove' in u && !Object.hasOwn(state.added, u.remove) ? { add: u.remove } : u
  return {
    ...twoPhaseSet,
    update: (s, u, ctx) => twoPhaseSet.update(s, fix(s, u), ctx),
    prepare: (s, u, ctx) => twoPhaseSet.prepare(s, fix(s, u), ctx),
  }
}

function deepFreeze<T>(x: T): T {
  if (x && typeof x === 'object') {
    for (const v of Object.values(x as object)) deepFreeze(v)
    Object.freeze(x)
  }
  return x
}

describe('2P-Set: lesson examples', () => {
  it('add then remove: the element is gone, the tombstone stays', () => {
    const ctx = makeCtx('alice', 1)
    let a = twoPhaseSet.init('alice')
    a = twoPhaseSet.update(a, { add: 'milk' }, ctx)
    expect(twoPhaseSet.value(a)).toEqual(['milk'])
    a = twoPhaseSet.update(a, { remove: 'milk' }, ctx)
    expect(twoPhaseSet.value(a)).toEqual([])
    expect(a).toEqual({ added: { milk: 'milk' }, removed: { milk: true } })
    expect(twoPhaseSetHas(a, 'milk')).toBe(false)
  })

  it('pitfall — gone is gone: add, remove, add again → still removed', () => {
    const ctx = makeCtx('alice', 1)
    let a = twoPhaseSet.init('alice')
    a = twoPhaseSet.update(a, { add: 'milk' }, ctx)
    a = twoPhaseSet.update(a, { remove: 'milk' }, ctx)
    a = twoPhaseSet.update(a, { add: 'milk' }, ctx)
    expect(twoPhaseSet.value(a)).toEqual([])
  })

  it('pitfall across replicas: Bob re-adds what Alice removed; after sync it is still gone', () => {
    const alice = makeCtx('alice', 1)
    const bob = makeCtx('bob', 1)
    let a = twoPhaseSet.init('alice')
    let b = twoPhaseSet.init('bob')
    a = twoPhaseSet.update(a, { add: 'milk' }, alice)
    b = twoPhaseSet.merge(b, a) // Bob sees milk
    a = twoPhaseSet.update(a, { remove: 'milk' }, alice.at(2))
    b = twoPhaseSet.update(b, { add: 'milk' }, bob.at(3)) // concurrent re-add, later ts — irrelevant here
    const ab = twoPhaseSet.merge(a, b)
    const ba = twoPhaseSet.merge(b, a)
    expect(canon(ab)).toBe(canon(ba))
    expect(twoPhaseSet.value(ab)).toEqual([])
  })

  it('concurrent add (Alice) and remove of a different item (Bob) merge both ways to the same value', () => {
    const alice = makeCtx('alice', 1)
    const bob = makeCtx('bob', 1)
    let a = twoPhaseSet.init('alice')
    a = twoPhaseSet.update(a, { add: 'eggs' }, alice)
    a = twoPhaseSet.update(a, { add: 'bread' }, alice)
    let b = twoPhaseSet.merge(twoPhaseSet.init('bob'), a)
    b = twoPhaseSet.update(b, { remove: 'eggs' }, bob)
    a = twoPhaseSet.update(a, { add: 'milk' }, alice)
    const ab = twoPhaseSet.merge(a, b)
    const ba = twoPhaseSet.merge(b, a)
    expect(canon(ab)).toBe(canon(ba))
    expect(twoPhaseSet.value(ab)).toEqual(['bread', 'milk'])
    expect(Object.keys(ab.added)).toEqual(['bread', 'eggs', 'milk'])
    expect(Object.keys(ab.removed)).toEqual(['eggs'])
  })

  it('precondition: you can only remove what this replica has seen', () => {
    const ctx = makeCtx('alice', 1)
    const empty = twoPhaseSet.init('alice')
    expect(() => twoPhaseSet.update(empty, { remove: 'milk' }, ctx)).toThrow(/never added/)
    expect(() => twoPhaseSet.prepare(empty, { remove: 'milk' }, ctx)).toThrow(/never added/)
    // removing an already-removed element is allowed (it is still in `added`) and is a no-op
    const removed = twoPhaseSet.update(
      twoPhaseSet.update(empty, { add: 'milk' }, ctx),
      { remove: 'milk' },
      ctx,
    )
    expect(twoPhaseSet.update(removed, { remove: 'milk' }, ctx)).toBe(removed)
  })

  it('op-based: ops mirror updates; duplicates are harmless; a tombstone may even arrive first', () => {
    const alice = makeCtx('alice', 1)
    let a = twoPhaseSet.init('alice')
    const addOp = twoPhaseSet.prepare(a, { add: 'milk' }, alice)
    expect(addOp).toEqual({ add: 'milk' })
    a = twoPhaseSet.effect(a, addOp)
    const removeOp = twoPhaseSet.prepare(a, { remove: 'milk' }, alice)
    expect(removeOp).toEqual({ remove: 'milk' })
    a = twoPhaseSet.effect(a, removeOp)
    expect(twoPhaseSet.effect(a, removeOp)).toBe(a)
    expect(twoPhaseSet.effect(a, addOp)).toBe(a)

    // Bob receives the remove before the add (non-causal delivery): still converges.
    let b = twoPhaseSet.init('bob')
    b = twoPhaseSet.effect(b, removeOp)
    expect(twoPhaseSet.value(b)).toEqual([])
    b = twoPhaseSet.effect(b, addOp)
    expect(canon(b)).toBe(canon(a))
    expect(twoPhaseSet.value(b)).toEqual([])
  })
})

describe('2P-Set: laws', () => {
  it('merge is commutative, associative, idempotent', () => {
    assertMergeLaws({ type: lenient(), args: undefined, updateArb })
  })
  it('replicas converge under random gossip', () => {
    assertConvergence({ type: lenient(), args: undefined, updateArb })
  })
  it('ops converge in any causal order', () => {
    assertOpConvergence({ type: lenient(), args: undefined, updateArb })
  })
})

describe('2P-Set: edge cases', () => {
  it('fresh state is empty', () => {
    const s = twoPhaseSet.init('alice')
    expect(s).toEqual({ added: {}, removed: {} })
    expect(twoPhaseSet.value(s)).toEqual([])
    expect(twoPhaseSetRows(s)).toEqual([])
  })

  it('never mutates its inputs', () => {
    const ctx = makeCtx('alice', 1)
    let a = twoPhaseSet.init('alice')
    a = twoPhaseSet.update(a, { add: 'milk' }, ctx)
    a = twoPhaseSet.update(a, { add: 'eggs' }, ctx)
    deepFreeze(a)
    const b = deepFreeze(twoPhaseSet.update(twoPhaseSet.init('bob'), { add: 'bread' }, ctx))
    expect(() => twoPhaseSet.update(a, { remove: 'milk' }, ctx)).not.toThrow()
    expect(() => twoPhaseSet.update(a, { add: 'apple' }, ctx)).not.toThrow()
    expect(() => twoPhaseSet.merge(a, b)).not.toThrow()
    expect(() => twoPhaseSet.effect(a, { remove: 'eggs' })).not.toThrow()
    expect(twoPhaseSet.value(a)).toEqual(['eggs', 'milk'])
  })

  it('state is canonical and JSON-serializable', () => {
    const ctx = makeCtx('alice', 1)
    let s = twoPhaseSet.init('alice')
    for (const e of ['milk', 'apple', 'eggs']) s = twoPhaseSet.update(s, { add: e }, ctx)
    s = twoPhaseSet.update(s, { remove: 'milk' }, ctx)
    s = twoPhaseSet.update(s, { remove: 'apple' }, ctx)
    expect(Object.keys(s.added)).toEqual(['apple', 'eggs', 'milk'])
    expect(Object.keys(s.removed)).toEqual(['apple', 'milk'])
    expect(JSON.parse(JSON.stringify(s))).toEqual(s)
  })

  it('rows: one per element ever added, tombstones flagged, sorted by key', () => {
    const ctx = makeCtx('alice', 1)
    let s = twoPhaseSet.init('alice')
    s = twoPhaseSet.update(s, { add: 'milk' }, ctx)
    s = twoPhaseSet.update(s, { add: 'apple' }, ctx)
    s = twoPhaseSet.update(s, { remove: 'milk' }, ctx)
    expect(twoPhaseSetRows(s)).toEqual([
      { key: 'apple', e: 'apple', removed: false },
      { key: 'milk', e: 'milk', removed: true },
    ])
  })

  it('generic elements: objects identified by canonical JSON', () => {
    type Item = { id: number; name: string }
    const items = twoPhaseSetType<Item>()
    const ctx = makeCtx('alice', 1)
    let s = items.init('alice')
    s = items.update(s, { add: { id: 1, name: 'milk' } }, ctx)
    s = items.update(s, { remove: { name: 'milk', id: 1 } }, ctx)
    expect(items.value(s)).toEqual([])
    expect(Object.keys(s.removed)).toEqual(['{"id":1,"name":"milk"}'])
  })

  it('property: value = (set of adds) − (set of removes), sorted', () => {
    fc.assert(
      fc.property(fc.array(updateArb(), { maxLength: 16 }), (updates) => {
        const ctx = makeCtx('alice', 1)
        let s = twoPhaseSet.init('alice')
        const adds = new Set<string>()
        const removes = new Set<string>()
        for (const u of updates) {
          if ('add' in u) {
            adds.add(u.add)
            s = twoPhaseSet.update(s, u, ctx)
          } else if (adds.has(u.remove)) {
            removes.add(u.remove)
            s = twoPhaseSet.update(s, u, ctx)
          } else {
            expect(() => twoPhaseSet.update(s, u, ctx)).toThrow()
          }
        }
        const expected = [...adds].filter((e) => !removes.has(e)).sort()
        expect(twoPhaseSet.value(s)).toEqual(expected)
      }),
    )
  })

  it('Ctx is not consulted: ops carry no stamp', () => {
    const s = twoPhaseSet.update(twoPhaseSet.init('alice'), { add: 'milk' }, makeCtx('alice', 5))
    const ctx: Ctx = makeCtx('zed', 999)
    expect(twoPhaseSet.prepare(s, { add: 'eggs' }, ctx)).toEqual({ add: 'eggs' })
    expect(twoPhaseSet.prepare(s, { remove: 'milk' }, ctx)).toEqual({ remove: 'milk' })
  })
})
