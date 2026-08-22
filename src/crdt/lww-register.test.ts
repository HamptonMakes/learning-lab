/** LWW Register: lesson-shaped examples, merge laws, convergence, and edge cases. */
import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import { makeCtx } from './types'
import { assertConvergence, assertMergeLaws, assertOpConvergence, canon } from './laws'
import {
  lwwIsWritten,
  lwwRegister,
  lwwWrite,
  UNWRITTEN_TS,
  type LwwRegisterState,
  type LwwRegisterType,
} from './lww-register'

const reg: LwwRegisterType<string> = lwwRegister

describe('lww-register: examples', () => {
  it('starts empty: null value, unwritten stamp', () => {
    const s = reg.init('alice')
    expect(s).toEqual({ value: null, ts: UNWRITTEN_TS, node: '' })
    expect(reg.value(s)).toBeNull()
    expect(lwwIsWritten(s)).toBe(false)
  })

  it('a write replaces the value and records who wrote it and when', () => {
    const s = reg.update(reg.init('alice'), { set: 'cat' }, makeCtx('alice', 3))
    expect(s).toEqual({ value: 'cat', ts: 3, node: 'alice' })
    expect(reg.value(s)).toBe('cat')
    expect(lwwIsWritten(s)).toBe(true)
  })

  it('concurrent writes: the greater ts wins, in both merge directions', () => {
    const alice = reg.update(reg.init('alice'), { set: 'cat' }, makeCtx('alice', 1))
    const bob = reg.update(reg.init('bob'), { set: 'dog' }, makeCtx('bob', 2))
    expect(reg.value(reg.merge(alice, bob))).toBe('dog')
    expect(reg.value(reg.merge(bob, alice))).toBe('dog')
    expect(canon(reg.merge(alice, bob))).toBe(canon(reg.merge(bob, alice)))
  })

  it('equal ts: the greater node id wins (deterministic tie-break), both directions', () => {
    const alice = reg.update(reg.init('alice'), { set: 'cat' }, makeCtx('alice', 5))
    const bob = reg.update(reg.init('bob'), { set: 'dog' }, makeCtx('bob', 5))
    const ab = reg.merge(alice, bob)
    const ba = reg.merge(bob, alice)
    expect(ab).toEqual({ value: 'dog', ts: 5, node: 'bob' })
    expect(canon(ab)).toBe(canon(ba))
  })

  it('the wall-clock pitfall: a write that happened later in real time can lose', () => {
    // Alice's clock runs fast: she writes "first" at ts 10. Bob writes afterwards at ts 5.
    const alice = reg.update(reg.init('alice'), { set: 'cat' }, makeCtx('alice', 10))
    const bob = reg.update(reg.init('bob'), { set: 'dog' }, makeCtx('bob', 5))
    expect(reg.value(reg.merge(bob, alice))).toBe('cat')
    // Even Bob's own later local write loses once he has seen Alice's stamp.
    const bobAfter = reg.update(reg.merge(bob, alice), { set: 'fish' }, makeCtx('bob', 6))
    expect(reg.value(bobAfter)).toBe('cat')
  })

  it('a later local write overrides a merged-in value when its ts is greater', () => {
    const alice = reg.update(reg.init('alice'), { set: 'cat' }, makeCtx('alice', 1))
    const bob = reg.merge(reg.init('bob'), alice)
    const bob2 = reg.update(bob, { set: 'dog' }, makeCtx('bob', 2))
    expect(bob2).toEqual({ value: 'dog', ts: 2, node: 'bob' })
    // Alice learns about it by merging.
    expect(reg.value(reg.merge(alice, bob2))).toBe('dog')
  })

  it('merging the loser back into the winner changes nothing', () => {
    const alice = reg.update(reg.init('alice'), { set: 'cat' }, makeCtx('alice', 1))
    const bob = reg.update(reg.init('bob'), { set: 'dog' }, makeCtx('bob', 2))
    const m = reg.merge(alice, bob)
    expect(reg.merge(m, alice)).toBe(m)
    expect(reg.merge(m, bob)).toBe(m)
    expect(reg.merge(m, m)).toBe(m)
  })
})

describe('lww-register: op-based', () => {
  it('prepare stamps the op; effect applies it at every replica, including the source', () => {
    const ctx = makeCtx('alice', 7)
    const a0 = reg.init('alice')
    const op = reg.prepare(a0, { set: 'cat' }, ctx)
    expect(op).toEqual({ set: 'cat', ts: 7, node: 'alice' })
    const a1 = reg.effect(a0, op)
    const b1 = reg.effect(reg.init('bob'), op)
    expect(a1).toEqual(reg.update(a0, { set: 'cat' }, ctx))
    expect(canon(a1)).toBe(canon(b1))
  })

  it('effects of concurrent ops commute and a replayed op is a no-op', () => {
    const opA = reg.prepare(reg.init('alice'), { set: 'cat' }, makeCtx('alice', 1))
    const opB = reg.prepare(reg.init('bob'), { set: 'dog' }, makeCtx('bob', 2))
    const ab = reg.effect(reg.effect(reg.init('carol'), opA), opB)
    const ba = reg.effect(reg.effect(reg.init('carol'), opB), opA)
    expect(canon(ab)).toBe(canon(ba))
    expect(reg.effect(ab, opA)).toBe(ab)
    expect(reg.effect(ab, opB)).toBe(ab)
  })
})

describe('lww-register: laws', () => {
  it('merge is commutative, associative, idempotent (strings)', () => {
    assertMergeLaws({
      type: lwwRegister,
      args: undefined,
      updateArb: () => fc.string({ maxLength: 4 }).map((set) => ({ set })),
    })
  })

  it('merge laws hold for small ints too', () => {
    assertMergeLaws({
      type: lwwRegister,
      args: undefined,
      updateArb: () => fc.integer({ min: 0, max: 9 }).map((set) => ({ set })),
    })
  })

  it('replicas converge under random updates and gossip', () => {
    assertConvergence({
      type: lwwRegister,
      args: undefined,
      updateArb: () => fc.string({ maxLength: 4 }).map((set) => ({ set })),
    })
  })

  it('op-based replicas converge under any causal delivery order', () => {
    assertOpConvergence({
      type: lwwRegister,
      args: undefined,
      updateArb: () => fc.integer({ min: 0, max: 9 }).map((set) => ({ set })),
    })
  })
})

describe('lww-register: edge cases', () => {
  it('never mutates its inputs', () => {
    const s0 = Object.freeze(reg.init('alice'))
    const s1 = reg.update(s0, { set: 'cat' }, makeCtx('alice', 1))
    expect(s0).toEqual({ value: null, ts: UNWRITTEN_TS, node: '' })
    const s2 = reg.update(Object.freeze(s1), { set: 'dog' }, makeCtx('alice', 2))
    expect(s1).toEqual({ value: 'cat', ts: 1, node: 'alice' })
    expect(s2.value).toBe('dog')
    const m = reg.merge(Object.freeze({ ...s1 }), Object.freeze({ ...s2 }))
    expect(m.value).toBe('dog')
  })

  it('a write at ts 0 beats the unwritten stamp', () => {
    const s = reg.update(reg.init('alice'), { set: 'cat' }, makeCtx('alice', 0))
    expect(s.value).toBe('cat')
    expect(reg.merge(reg.init('bob'), s).value).toBe('cat')
  })

  it('stamps must advance: a second write by the same node at the same ts is kept as-is', () => {
    const ctx = makeCtx('alice', 4)
    const s1 = reg.update(reg.init('alice'), { set: 'cat' }, ctx)
    const s2 = reg.update(s1, { set: 'dog' }, ctx)
    expect(s2).toBe(s1)
    // advancing the clock makes the write land
    expect(reg.update(s1, { set: 'dog' }, ctx.at(5)).value).toBe('dog')
  })

  it('holds any JSON value and keeps the value object by reference', () => {
    const obj = { x: 1, tags: ['a'] }
    const t: LwwRegisterType<{ x: number; tags: string[] }> = lwwRegister
    const s = t.update(t.init('alice'), { set: obj }, makeCtx('alice', 1))
    expect(t.value(s)).toBe(obj)
    expect(JSON.parse(JSON.stringify(s))).toEqual(s)
  })

  it('lwwWrite can write a null tombstone with a stamp (used by lww-map)', () => {
    const s1: LwwRegisterState<string> = { value: 'cat', ts: 1, node: 'alice' }
    const s2 = lwwWrite(s1, null, { ts: 2, node: 'bob' })
    expect(s2).toEqual({ value: null, ts: 2, node: 'bob' })
    expect(lwwWrite(s2, 'dog', { ts: 1, node: 'carol' })).toBe(s2)
  })

  it('states are JSON-safe and round-trip structurally', () => {
    const s = reg.update(reg.init('alice'), { set: 'cat' }, makeCtx('alice', 1))
    expect(JSON.parse(JSON.stringify(s))).toEqual(s)
    expect(JSON.parse(JSON.stringify(reg.init('alice')))).toEqual(reg.init('alice'))
  })
})
