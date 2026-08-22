import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import {
  pnCounter,
  pnCounterEntries,
  type PNCounterState,
  type PNCounterUpdate,
} from './pn-counter'
import { assertConvergence, assertMergeLaws, assertOpConvergence, canon } from './laws'
import { makeCtx, type NodeId } from './types'

const updateArb = (_node: NodeId): fc.Arbitrary<PNCounterUpdate> =>
  fc.oneof(
    fc.integer({ min: 1, max: 5 }).map((inc): PNCounterUpdate => ({ inc })),
    fc.integer({ min: 1, max: 5 }).map((dec): PNCounterUpdate => ({ dec })),
  )

describe('pn-counter: lesson examples', () => {
  it('starts with two empty G-Counters and value 0', () => {
    const s = pnCounter.init('alice')
    expect(s).toEqual({ p: { counts: {} }, n: { counts: {} } })
    expect(pnCounter.value(s)).toBe(0)
    expect(pnCounterEntries(s)).toEqual([])
  })

  it('inc raises p, dec raises n; value = sum(p) - sum(n)', () => {
    const alice = makeCtx('alice')
    let s = pnCounter.init('alice')
    s = pnCounter.update(s, { inc: 3 }, alice)
    s = pnCounter.update(s, { dec: 1 }, alice)
    expect(s).toEqual({ p: { counts: { alice: 3 } }, n: { counts: { alice: 1 } } })
    expect(pnCounter.value(s)).toBe(2)
  })

  it('likes and unlikes: Alice unlikes while Bob likes — both edits survive the merge', () => {
    const aliceCtx = makeCtx('alice')
    const bobCtx = makeCtx('bob')
    // Alice likes the post. Everyone syncs: 1 like.
    let alice = pnCounter.update(pnCounter.init('alice'), { inc: 1 }, aliceCtx)
    let bob = pnCounter.merge(pnCounter.init('bob'), alice)
    expect(pnCounter.value(alice)).toBe(1)
    expect(pnCounter.value(bob)).toBe(1)

    // Offline and at the same time: Alice unlikes, Bob likes.
    alice = pnCounter.update(alice, { dec: 1 }, aliceCtx)
    bob = pnCounter.update(bob, { inc: 1 }, bobCtx)
    expect(pnCounter.value(alice)).toBe(0)
    expect(pnCounter.value(bob)).toBe(2)

    // Back online: merge both ways. Alice's like is gone, Bob's like stays → 1.
    const ab = pnCounter.merge(alice, bob)
    const ba = pnCounter.merge(bob, alice)
    expect(ab).toEqual({ p: { counts: { alice: 1, bob: 1 } }, n: { counts: { alice: 1 } } })
    expect(canon(ab)).toBe(canon(ba))
    expect(pnCounter.value(ab)).toBe(1)
    expect(pnCounter.value(ba)).toBe(1)
    expect(pnCounterEntries(ab)).toEqual([
      { node: 'alice', inc: 1, dec: 1 },
      { node: 'bob', inc: 1, dec: 0 },
    ])
  })

  it('pitfall: concurrent decrements can take the count below zero', () => {
    const aliceCtx = makeCtx('alice')
    const bobCtx = makeCtx('bob')
    let alice = pnCounter.update(pnCounter.init('alice'), { inc: 1 }, aliceCtx)
    let bob = pnCounter.merge(pnCounter.init('bob'), alice)
    // Both see 1 and both "unlike" it at the same time.
    alice = pnCounter.update(alice, { dec: 1 }, aliceCtx)
    bob = pnCounter.update(bob, { dec: 1 }, bobCtx)
    const merged = pnCounter.merge(alice, bob)
    expect(pnCounter.value(merged)).toBe(-1)
    expect(canon(pnCounter.merge(bob, alice))).toBe(canon(merged))
  })

  it('syncing the same state again never double counts on either side', () => {
    const aliceCtx = makeCtx('alice')
    let alice = pnCounter.update(pnCounter.init('alice'), { inc: 4 }, aliceCtx)
    alice = pnCounter.update(alice, { dec: 1 }, aliceCtx)
    let bob = pnCounter.init('bob')
    bob = pnCounter.merge(bob, alice)
    bob = pnCounter.merge(bob, alice)
    expect(pnCounter.value(bob)).toBe(3)
    expect(canon(bob)).toBe(canon(alice))
  })

  it('three replicas with mixed inc/dec converge through any peer', () => {
    let a = pnCounter.update(pnCounter.init('alice'), { inc: 5 }, makeCtx('alice'))
    let b = pnCounter.update(pnCounter.init('bob'), { dec: 2 }, makeCtx('bob'))
    const c = pnCounter.update(pnCounter.init('carol'), { inc: 1 }, makeCtx('carol'))
    a = pnCounter.merge(a, b)
    b = pnCounter.merge(b, a)
    const viaA = pnCounter.merge(c, a)
    const viaB = pnCounter.merge(c, b)
    expect(canon(viaA)).toBe(canon(viaB))
    expect(pnCounter.value(viaA)).toBe(4)
    expect(pnCounterEntries(viaA)).toEqual([
      { node: 'alice', inc: 5, dec: 0 },
      { node: 'bob', inc: 0, dec: 2 },
      { node: 'carol', inc: 1, dec: 0 },
    ])
  })
})

describe('pn-counter: op-based use', () => {
  it('prepare carries the side and the node NEW total on that side; update == effect(prepare)', () => {
    const alice = makeCtx('alice')
    const s0 = pnCounter.update(pnCounter.init('alice'), { inc: 2 }, alice)
    const incOp = pnCounter.prepare(s0, { inc: 3 }, alice)
    const decOp = pnCounter.prepare(s0, { dec: 1 }, alice)
    expect(incOp).toEqual({ side: 'p', node: 'alice', count: 5 })
    expect(decOp).toEqual({ side: 'n', node: 'alice', count: 1 })
    expect(pnCounter.effect(s0, incOp)).toEqual(pnCounter.update(s0, { inc: 3 }, alice))
    expect(pnCounter.effect(s0, decOp)).toEqual(pnCounter.update(s0, { dec: 1 }, alice))
  })

  it('effect is idempotent: a duplicated op changes nothing', () => {
    const alice = makeCtx('alice')
    const op = pnCounter.prepare(pnCounter.init('alice'), { dec: 2 }, alice)
    const bob1 = pnCounter.effect(pnCounter.init('bob'), op)
    const bob2 = pnCounter.effect(bob1, op)
    expect(bob2).toEqual({ p: { counts: {} }, n: { counts: { alice: 2 } } })
    expect(bob2).toBe(bob1)
    expect(pnCounter.value(bob2)).toBe(-2)
  })

  it('ops on different sides commute', () => {
    const alice = makeCtx('alice')
    const bob = makeCtx('bob')
    const incOp = pnCounter.prepare(pnCounter.init('alice'), { inc: 3 }, alice)
    const decOp = pnCounter.prepare(pnCounter.init('bob'), { dec: 1 }, bob)
    const c = pnCounter.init('carol')
    const x = pnCounter.effect(pnCounter.effect(c, incOp), decOp)
    const y = pnCounter.effect(pnCounter.effect(c, decOp), incOp)
    expect(canon(x)).toBe(canon(y))
    expect(pnCounter.value(x)).toBe(2)
  })
})

describe('pn-counter: laws', () => {
  const cfg = { type: pnCounter, args: undefined, updateArb }
  it('merge is commutative, associative, idempotent', () => {
    assertMergeLaws(cfg)
  })
  it('replicas converge under random gossip', () => {
    assertConvergence(cfg)
  })
  it('ops converge under causal delivery', () => {
    assertOpConvergence(cfg)
  })
})

describe('pn-counter: edge cases', () => {
  it('rejects inc/dec that are not integers >= 1', () => {
    const alice = makeCtx('alice')
    const s = pnCounter.init('alice')
    for (const n of [0, -1, 2.5, Number.NaN, Number.NEGATIVE_INFINITY]) {
      expect(() => pnCounter.update(s, { inc: n }, alice)).toThrow(RangeError)
      expect(() => pnCounter.update(s, { dec: n }, alice)).toThrow(RangeError)
      expect(() => pnCounter.prepare(s, { inc: n }, alice)).toThrow(RangeError)
      expect(() => pnCounter.prepare(s, { dec: n }, alice)).toThrow(RangeError)
    }
  })

  it('never mutates its inputs', () => {
    const aliceCtx = makeCtx('alice')
    const a = pnCounter.update(pnCounter.init('alice'), { inc: 2 }, aliceCtx)
    const b = pnCounter.update(pnCounter.init('bob'), { dec: 1 }, makeCtx('bob'))
    const aBefore = structuredClone(a)
    const bBefore = structuredClone(b)
    pnCounter.update(a, { dec: 9 }, aliceCtx)
    pnCounter.effect(a, { side: 'n', node: 'bob', count: 7 })
    pnCounter.merge(a, b)
    pnCounter.merge(b, a)
    expect(a).toEqual(aBefore)
    expect(b).toEqual(bBefore)
  })

  it('keeps keys sorted on both sides so equal states serialize identically', () => {
    const z = pnCounter.update(pnCounter.init('zed'), { dec: 1 }, makeCtx('zed'))
    const a = pnCounter.update(pnCounter.init('alice'), { dec: 1 }, makeCtx('alice'))
    const m = pnCounter.update(pnCounter.init('mia'), { inc: 1 }, makeCtx('mia'))
    const one = pnCounter.merge(pnCounter.merge(z, m), a)
    const two = pnCounter.merge(a, pnCounter.merge(m, z))
    expect(JSON.stringify(one)).toBe(JSON.stringify(two))
    expect(Object.keys(one.n.counts)).toEqual(['alice', 'zed'])
    expect(Object.keys(one.p.counts)).toEqual(['mia'])
  })

  it('merging with an empty replica is the identity', () => {
    const a = pnCounter.update(pnCounter.init('alice'), { dec: 3 }, makeCtx('alice'))
    const empty: PNCounterState = pnCounter.init('bob')
    expect(pnCounter.merge(a, empty)).toEqual(a)
    expect(pnCounter.merge(empty, a)).toEqual(a)
  })

  it('state is JSON-serializable and round-trips', () => {
    const alice = makeCtx('alice')
    let a = pnCounter.update(pnCounter.init('alice'), { inc: 3 }, alice)
    a = pnCounter.update(a, { dec: 1 }, alice)
    const back = JSON.parse(JSON.stringify(a)) as PNCounterState
    expect(canon(back)).toBe(canon(a))
    expect(pnCounter.value(back)).toBe(2)
  })
})
