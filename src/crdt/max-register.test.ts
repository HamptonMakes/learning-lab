/** Max Register: lesson-shaped examples, merge laws, convergence, and edge cases. */
import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import { makeCtx } from './types'
import { assertConvergence, assertMergeLaws, assertOpConvergence, canon } from './laws'
import { maxRegister, type MaxRegisterUpdate } from './max-register'

const updateArb = (): fc.Arbitrary<MaxRegisterUpdate> =>
  fc.integer({ min: -5, max: 20 }).map((set) => ({ set }))

describe('max-register: examples', () => {
  it('starts unset: null value', () => {
    const s = maxRegister.init('alice')
    expect(s).toEqual({ value: null })
    expect(maxRegister.value(s)).toBeNull()
  })

  it('the first write always lands, even a negative one', () => {
    const s = maxRegister.update(maxRegister.init('alice'), { set: -3 }, makeCtx('alice', 1))
    expect(s).toEqual({ value: -3 })
    expect(maxRegister.value(s)).toBe(-3)
  })

  it('a bigger write replaces the value; a smaller write is ignored', () => {
    const ctx = makeCtx('alice', 1)
    const s1 = maxRegister.update(maxRegister.init('alice'), { set: 5 }, ctx)
    const s2 = maxRegister.update(s1, { set: 9 }, ctx)
    expect(maxRegister.value(s2)).toBe(9)
    const s3 = maxRegister.update(s2, { set: 2 }, ctx)
    expect(s3).toBe(s2) // a no-op returns the same state object
    expect(maxRegister.value(s3)).toBe(9)
  })

  it('concurrent writes: the bigger number wins, in both merge directions', () => {
    const alice = maxRegister.update(maxRegister.init('alice'), { set: 7 }, makeCtx('alice', 1))
    const bob = maxRegister.update(maxRegister.init('bob'), { set: 12 }, makeCtx('bob', 1))
    expect(maxRegister.value(maxRegister.merge(alice, bob))).toBe(12)
    expect(maxRegister.value(maxRegister.merge(bob, alice))).toBe(12)
    expect(canon(maxRegister.merge(alice, bob))).toBe(canon(maxRegister.merge(bob, alice)))
  })

  it('an unset replica loses to any number', () => {
    const alice = maxRegister.update(maxRegister.init('alice'), { set: 0 }, makeCtx('alice', 1))
    const bob = maxRegister.init('bob')
    expect(maxRegister.merge(bob, alice)).toEqual({ value: 0 })
    expect(maxRegister.merge(alice, bob)).toBe(alice)
    expect(maxRegister.merge(bob, maxRegister.init('carol'))).toEqual({ value: null })
  })

  it('merging the loser back into the winner changes nothing', () => {
    const alice = maxRegister.update(maxRegister.init('alice'), { set: 7 }, makeCtx('alice', 1))
    const bob = maxRegister.update(maxRegister.init('bob'), { set: 12 }, makeCtx('bob', 1))
    const m = maxRegister.merge(alice, bob)
    expect(maxRegister.merge(m, alice)).toBe(m)
    expect(maxRegister.merge(m, bob)).toBe(m)
    expect(maxRegister.merge(m, m)).toBe(m)
  })

  it('the lesson: a high-water mark (largest version seen) never goes backwards', () => {
    let s = maxRegister.init('alice')
    const ctx = makeCtx('alice', 1)
    for (const seen of [3, 1, 4, 1, 5, 9, 2, 6]) s = maxRegister.update(s, { set: seen }, ctx)
    expect(maxRegister.value(s)).toBe(9)
  })
})

describe('max-register: op-based', () => {
  it('prepare carries the number; effect applies the same max everywhere', () => {
    const ctx = makeCtx('alice', 1)
    const a0 = maxRegister.init('alice')
    const op = maxRegister.prepare(a0, { set: 4 }, ctx)
    expect(op).toEqual({ set: 4 })
    const a1 = maxRegister.effect(a0, op)
    const b1 = maxRegister.effect(maxRegister.init('bob'), op)
    expect(a1).toEqual(maxRegister.update(a0, { set: 4 }, ctx))
    expect(canon(a1)).toBe(canon(b1))
  })

  it('effects commute and a replayed op is a no-op', () => {
    const opA = maxRegister.prepare(maxRegister.init('alice'), { set: 4 }, makeCtx('alice', 1))
    const opB = maxRegister.prepare(maxRegister.init('bob'), { set: 8 }, makeCtx('bob', 1))
    const ab = maxRegister.effect(maxRegister.effect(maxRegister.init('carol'), opA), opB)
    const ba = maxRegister.effect(maxRegister.effect(maxRegister.init('carol'), opB), opA)
    expect(canon(ab)).toBe(canon(ba))
    expect(maxRegister.effect(ab, opA)).toBe(ab)
    expect(maxRegister.effect(ab, opB)).toBe(ab)
  })
})

describe('max-register: laws', () => {
  const cfg = { type: maxRegister, args: undefined, updateArb }

  it('merge is commutative, associative, idempotent', () => {
    assertMergeLaws(cfg)
  })

  it('replicas converge under random updates and gossip', () => {
    assertConvergence(cfg)
  })

  it('op-based replicas converge under any causal delivery order', () => {
    assertOpConvergence(cfg)
  })
})

describe('max-register: edge cases', () => {
  it('rejects NaN and infinities (they break max and are not JSON-safe)', () => {
    const s = maxRegister.init('alice')
    const ctx = makeCtx('alice', 1)
    expect(() => maxRegister.update(s, { set: Number.NaN }, ctx)).toThrow(RangeError)
    expect(() => maxRegister.update(s, { set: Number.POSITIVE_INFINITY }, ctx)).toThrow(RangeError)
    expect(() => maxRegister.prepare(s, { set: Number.NEGATIVE_INFINITY }, ctx)).toThrow(RangeError)
  })

  it('never mutates its inputs', () => {
    const s0 = Object.freeze(maxRegister.init('alice'))
    const s1 = maxRegister.update(s0, { set: 1 }, makeCtx('alice', 1))
    expect(s0).toEqual({ value: null })
    const s2 = maxRegister.update(Object.freeze(s1), { set: 2 }, makeCtx('alice', 2))
    expect(s1).toEqual({ value: 1 })
    expect(s2).toEqual({ value: 2 })
    expect(maxRegister.merge(Object.freeze({ ...s1 }), Object.freeze({ ...s2 }))).toEqual({
      value: 2,
    })
  })

  it('states are JSON-safe and round-trip structurally', () => {
    const s = maxRegister.update(maxRegister.init('alice'), { set: 2.5 }, makeCtx('alice', 1))
    expect(JSON.parse(JSON.stringify(s))).toEqual(s)
    expect(JSON.parse(JSON.stringify(maxRegister.init('alice')))).toEqual({ value: null })
  })
})
