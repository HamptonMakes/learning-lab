import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { gSet, gSetHas, gSetType, keyOf, sortRecord, type GSetState } from './g-set'
import { assertConvergence, assertMergeLaws, assertOpConvergence, canon } from './laws'
import { makeCtx } from './types'

const ITEMS = ['apple', 'bread', 'milk', 'eggs'] as const
const itemArb = fc.constantFrom(...ITEMS)
const updateArb = () => fc.record({ add: itemArb })

/** Recursively freezes `x` so any accidental mutation throws (modules are strict mode). */
function deepFreeze<T>(x: T): T {
  if (x && typeof x === 'object') {
    for (const v of Object.values(x as object)) deepFreeze(v)
    Object.freeze(x)
  }
  return x
}

describe('G-Set: lesson examples', () => {
  it('two replicas add different items; merging either way gives the same sorted set', () => {
    const alice = makeCtx('alice', 1)
    const bob = makeCtx('bob', 1)
    let a = gSet.init('alice')
    let b = gSet.init('bob')
    a = gSet.update(a, { add: 'milk' }, alice)
    b = gSet.update(b, { add: 'eggs' }, bob)
    b = gSet.update(b, { add: 'apple' }, bob)

    const ab = gSet.merge(a, b)
    const ba = gSet.merge(b, a)
    expect(canon(ab)).toBe(canon(ba))
    expect(gSet.value(ab)).toEqual(['apple', 'eggs', 'milk'])
    expect(Object.keys(ab.items)).toEqual(['apple', 'eggs', 'milk'])
  })

  it('adding the same item on both sides counts once', () => {
    const a = gSet.update(gSet.init('alice'), { add: 'milk' }, makeCtx('alice', 1))
    const b = gSet.update(gSet.init('bob'), { add: 'milk' }, makeCtx('bob', 2))
    expect(gSet.value(gSet.merge(a, b))).toEqual(['milk'])
  })

  it('there is no remove: merging an older replica back never loses items', () => {
    const ctx = makeCtx('alice', 1)
    const empty = gSet.init('alice')
    const full = gSet.update(gSet.update(empty, { add: 'milk' }, ctx), { add: 'eggs' }, ctx)
    expect(gSet.value(gSet.merge(full, empty))).toEqual(['eggs', 'milk'])
    expect(gSet.value(gSet.merge(empty, full))).toEqual(['eggs', 'milk'])
  })

  it('op-based: the op is the element; delivering it twice or to many replicas is harmless', () => {
    const alice = makeCtx('alice', 1)
    const a0 = gSet.init('alice')
    const op = gSet.prepare(a0, { add: 'bread' }, alice)
    expect(op).toEqual({ add: 'bread' })
    const a1 = gSet.effect(a0, op)
    const a2 = gSet.effect(a1, op)
    expect(a2).toBe(a1) // no-op returns the same state
    const b1 = gSet.effect(gSet.init('bob'), op)
    expect(canon(b1)).toBe(canon(a1))
    // update ≡ effect(prepare())
    expect(canon(gSet.update(a0, { add: 'bread' }, alice))).toBe(canon(a1))
  })
})

describe('G-Set: laws', () => {
  it('merge is commutative, associative, idempotent', () => {
    assertMergeLaws({ type: gSet, args: undefined, updateArb })
  })
  it('replicas converge under random gossip', () => {
    assertConvergence({ type: gSet, args: undefined, updateArb })
  })
  it('ops converge in any causal order', () => {
    assertOpConvergence({ type: gSet, args: undefined, updateArb })
  })
})

describe('G-Set: edge cases', () => {
  it('fresh state is empty and each init is a new object', () => {
    const a = gSet.init('alice')
    const b = gSet.init('bob')
    expect(gSet.value(a)).toEqual([])
    expect(a).not.toBe(b)
    expect(a).toEqual({ items: {} })
  })

  it('never mutates its inputs', () => {
    const ctx = makeCtx('alice', 1)
    const a = deepFreeze(gSet.update(gSet.init('alice'), { add: 'milk' }, ctx))
    const b = deepFreeze(gSet.update(gSet.init('bob'), { add: 'eggs' }, ctx))
    expect(() => gSet.update(a, { add: 'bread' }, ctx)).not.toThrow()
    expect(() => gSet.merge(a, b)).not.toThrow()
    expect(() => gSet.effect(a, { add: 'bread' })).not.toThrow()
    expect(gSet.value(a)).toEqual(['milk'])
    expect(gSet.value(b)).toEqual(['eggs'])
  })

  it('state is canonical: keys are sorted regardless of add order', () => {
    const ctx = makeCtx('alice', 1)
    let s = gSet.init('alice')
    for (const e of ['milk', 'apple', 'eggs']) s = gSet.update(s, { add: e }, ctx)
    expect(Object.keys(s.items)).toEqual(['apple', 'eggs', 'milk'])
    expect(JSON.parse(JSON.stringify(s))).toEqual(s)
  })

  it('generic elements: objects are identified by canonical JSON (key order does not matter)', () => {
    type Item = { id: number; name: string }
    const items = gSetType<Item>()
    const ctx = makeCtx('alice', 1)
    let s = items.init('alice')
    s = items.update(s, { add: { id: 2, name: 'milk' } }, ctx)
    s = items.update(s, { add: { name: 'milk', id: 2 } }, ctx)
    s = items.update(s, { add: { id: 1, name: 'eggs' } }, ctx)
    expect(items.value(s)).toEqual([
      { id: 1, name: 'eggs' },
      { id: 2, name: 'milk' },
    ])
    expect(gSetHas(s, { name: 'milk', id: 2 })).toBe(true)
    expect(gSetHas(s, { id: 3, name: 'bread' })).toBe(false)
  })

  it('keyOf: strings are themselves, everything else is canonical JSON', () => {
    expect(keyOf('milk')).toBe('milk')
    expect(keyOf(42)).toBe('42')
    expect(keyOf(null)).toBe('null')
    expect(keyOf({ b: 1, a: [{ d: 2, c: 3 }] })).toBe('{"a":[{"c":3,"d":2}],"b":1}')
    expect(keyOf({ b: 1, a: 2 })).toBe(keyOf({ a: 2, b: 1 }))
  })

  it('sortRecord: canonical key order', () => {
    const rec: Record<string, number> = { milk: 1, apple: 2, eggs: 3 }
    expect(Object.keys(sortRecord(rec))).toEqual(['apple', 'eggs', 'milk'])
    expect(Object.keys(rec)).toEqual(['milk', 'apple', 'eggs']) // input untouched
  })

  it('property: value is sorted, duplicate-free, and equal to the set of all adds', () => {
    fc.assert(
      fc.property(fc.array(itemArb, { maxLength: 12 }), (adds) => {
        const ctx = makeCtx('alice', 1)
        let s: GSetState<string> = gSet.init('alice')
        for (const e of adds) s = gSet.update(s, { add: e }, ctx)
        const expected = [...new Set(adds)].sort()
        expect(gSet.value(s)).toEqual(expected)
      }),
    )
  })
})
