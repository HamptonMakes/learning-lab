import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import { gCounter, gCounterEntries, type GCounterState, type GCounterUpdate } from './g-counter'
import { assertConvergence, assertMergeLaws, assertOpConvergence, canon } from './laws'
import { makeCtx, type NodeId } from './types'

const updateArb = (_node: NodeId): fc.Arbitrary<GCounterUpdate> =>
  fc.integer({ min: 1, max: 5 }).map((inc) => ({ inc }))

describe('g-counter: lesson examples', () => {
  it('starts empty with value 0', () => {
    const s = gCounter.init('alice')
    expect(s).toEqual({ counts: {} })
    expect(gCounter.value(s)).toBe(0)
    expect(gCounterEntries(s)).toEqual([])
  })

  it('each node raises only its own tally', () => {
    const alice = makeCtx('alice')
    let s = gCounter.init('alice')
    s = gCounter.update(s, { inc: 1 }, alice)
    s = gCounter.update(s, { inc: 2 }, alice)
    expect(s).toEqual({ counts: { alice: 3 } })
    expect(gCounter.value(s)).toBe(3)
  })

  it('two replicas increment concurrently; merge adds them up (1 + 1 = 2, not 1)', () => {
    const a = gCounter.update(gCounter.init('alice'), { inc: 1 }, makeCtx('alice'))
    const b = gCounter.update(gCounter.init('bob'), { inc: 1 }, makeCtx('bob'))

    const ab = gCounter.merge(a, b)
    const ba = gCounter.merge(b, a)
    expect(ab).toEqual({ counts: { alice: 1, bob: 1 } })
    expect(canon(ab)).toBe(canon(ba))
    expect(gCounter.value(ab)).toBe(2)
    expect(gCounter.value(ba)).toBe(2)
  })

  it('merge is a per-node max, so syncing the same state twice never double counts', () => {
    const alice = makeCtx('alice')
    const a = gCounter.update(gCounter.init('alice'), { inc: 5 }, alice)
    let b = gCounter.init('bob')
    b = gCounter.merge(b, a)
    b = gCounter.merge(b, a) // the network delivered Alice's state again
    b = gCounter.merge(b, a)
    expect(gCounter.value(b)).toBe(5)
    expect(b).toEqual({ counts: { alice: 5 } })
  })

  it('a stale copy never lowers a tally: max keeps the newest total per node', () => {
    const alice = makeCtx('alice')
    const old = gCounter.update(gCounter.init('alice'), { inc: 1 }, alice)
    const fresh = gCounter.update(old, { inc: 4 }, alice)
    expect(gCounter.merge(fresh, old)).toEqual({ counts: { alice: 5 } })
    expect(gCounter.merge(old, fresh)).toEqual({ counts: { alice: 5 } })
  })

  it('three replicas: Carol joins late and catches up from either peer', () => {
    let a = gCounter.update(gCounter.init('alice'), { inc: 2 }, makeCtx('alice'))
    let b = gCounter.update(gCounter.init('bob'), { inc: 3 }, makeCtx('bob'))
    a = gCounter.merge(a, b)
    b = gCounter.merge(b, a)
    const c = gCounter.update(gCounter.init('carol'), { inc: 1 }, makeCtx('carol'))
    const viaAlice = gCounter.merge(c, a)
    const viaBob = gCounter.merge(c, b)
    expect(viaAlice).toEqual({ counts: { alice: 2, bob: 3, carol: 1 } })
    expect(canon(viaAlice)).toBe(canon(viaBob))
    expect(gCounter.value(viaAlice)).toBe(6)
    expect(gCounterEntries(viaAlice)).toEqual([
      { node: 'alice', count: 2 },
      { node: 'bob', count: 3 },
      { node: 'carol', count: 1 },
    ])
  })
})

describe('g-counter: op-based use', () => {
  it('prepare carries the node NEW total; update == effect(prepare)', () => {
    const alice = makeCtx('alice')
    const s0 = gCounter.update(gCounter.init('alice'), { inc: 2 }, alice)
    const op = gCounter.prepare(s0, { inc: 3 }, alice)
    expect(op).toEqual({ node: 'alice', count: 5 })
    expect(gCounter.effect(s0, op)).toEqual(gCounter.update(s0, { inc: 3 }, alice))
  })

  it('effect is idempotent: a duplicated op changes nothing', () => {
    const alice = makeCtx('alice')
    const op = gCounter.prepare(gCounter.init('alice'), { inc: 4 }, alice)
    const bob1 = gCounter.effect(gCounter.init('bob'), op)
    const bob2 = gCounter.effect(bob1, op)
    expect(bob2).toEqual({ counts: { alice: 4 } })
    expect(bob2).toBe(bob1) // no-op returns the same state object
  })

  it('effect tolerates out-of-order delivery: an older total never wins', () => {
    const alice = makeCtx('alice')
    const s1 = gCounter.update(gCounter.init('alice'), { inc: 1 }, alice)
    const op1 = gCounter.prepare(gCounter.init('alice'), { inc: 1 }, alice) // total 1
    const op2 = gCounter.prepare(s1, { inc: 2 }, alice) // total 3
    let bob = gCounter.init('bob')
    bob = gCounter.effect(bob, op2)
    bob = gCounter.effect(bob, op1)
    expect(bob).toEqual({ counts: { alice: 3 } })
  })
})

describe('g-counter: laws', () => {
  const cfg = { type: gCounter, args: undefined, updateArb }
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

describe('g-counter: edge cases', () => {
  it('rejects increments that are not integers >= 1', () => {
    const alice = makeCtx('alice')
    const s = gCounter.init('alice')
    for (const inc of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => gCounter.update(s, { inc }, alice)).toThrow(RangeError)
      expect(() => gCounter.prepare(s, { inc }, alice)).toThrow(RangeError)
    }
  })

  it('never mutates its inputs', () => {
    const alice = makeCtx('alice')
    const a = gCounter.update(gCounter.init('alice'), { inc: 1 }, alice)
    const b = gCounter.update(gCounter.init('bob'), { inc: 2 }, makeCtx('bob'))
    const aBefore = structuredClone(a)
    const bBefore = structuredClone(b)
    gCounter.update(a, { inc: 9 }, alice)
    gCounter.effect(a, { node: 'bob', count: 7 })
    gCounter.merge(a, b)
    gCounter.merge(b, a)
    expect(a).toEqual(aBefore)
    expect(b).toEqual(bBefore)
  })

  it('keeps keys sorted so equal states serialize identically', () => {
    const a = gCounter.update(gCounter.init('alice'), { inc: 1 }, makeCtx('alice'))
    const z = gCounter.update(gCounter.init('zed'), { inc: 1 }, makeCtx('zed'))
    const m = gCounter.update(gCounter.init('mia'), { inc: 1 }, makeCtx('mia'))
    const one = gCounter.merge(gCounter.merge(z, m), a)
    const two = gCounter.merge(a, gCounter.merge(m, z))
    expect(JSON.stringify(one)).toBe(JSON.stringify(two))
    expect(Object.keys(one)).toEqual(['counts'])
    expect(Object.keys(one.counts)).toEqual(['alice', 'mia', 'zed'])
    // effect/update also insert in sorted position
    const viaEffect = gCounter.effect(gCounter.effect(z, { node: 'alice', count: 1 }), {
      node: 'mia',
      count: 1,
    })
    expect(Object.keys(viaEffect.counts)).toEqual(['alice', 'mia', 'zed'])
  })

  it('merging with an empty replica is the identity', () => {
    const a = gCounter.update(gCounter.init('alice'), { inc: 3 }, makeCtx('alice'))
    const empty: GCounterState = gCounter.init('bob')
    expect(gCounter.merge(a, empty)).toEqual(a)
    expect(gCounter.merge(empty, a)).toEqual(a)
  })

  it('state is JSON-serializable and round-trips', () => {
    const a = gCounter.update(gCounter.init('alice'), { inc: 3 }, makeCtx('alice'))
    const back = JSON.parse(JSON.stringify(a)) as GCounterState
    expect(canon(back)).toBe(canon(a))
    expect(gCounter.value(back)).toBe(3)
  })
})
