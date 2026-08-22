import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import {
  vcCompare,
  vcDominates,
  vcEquals,
  vcFromNodes,
  vcGet,
  vcMerge,
  vcOf,
  vcReceive,
  vcTick,
  vectorClock,
  type VcUpdate,
  type VectorClock,
} from './vector-clock'
import { makeCtx } from './types'
import { assertConvergence, assertMergeLaws, assertOpConvergence, canon } from './laws'

const NODES = ['a', 'b', 'c', 'd'] as const

const vcArb: fc.Arbitrary<VectorClock> = fc
  .dictionary(fc.constantFrom(...NODES), fc.nat(5), { maxKeys: NODES.length })
  .map(vcOf)

const updateArb = (): fc.Arbitrary<VcUpdate> =>
  fc.oneof(
    { weight: 3, arbitrary: fc.constant<VcUpdate>({ tick: true }) },
    { weight: 1, arbitrary: vcArb.map((receive): VcUpdate => ({ receive })) },
  )

describe('vector clock: rules', () => {
  it('tick bumps only the acting node and adds it if missing', () => {
    expect(vcTick({}, 'alice')).toEqual({ alice: 1 })
    expect(vcTick({ alice: 1, bob: 2 }, 'alice')).toEqual({ alice: 2, bob: 2 })
    expect(vcTick({ alice: 1 }, 'bob')).toEqual({ alice: 1, bob: 1 })
  })

  it('merge is the per-node max over the union of nodes', () => {
    expect(vcMerge({ a: 1, b: 0 }, { a: 0, b: 1 })).toEqual({ a: 1, b: 1 })
    expect(vcMerge({ a: 3 }, { b: 2 })).toEqual({ a: 3, b: 2 })
    expect(vcMerge({ a: 2, b: 5 }, { a: 4, b: 1 })).toEqual({ a: 4, b: 5 })
  })

  it('receive = merge, then tick the receiver', () => {
    expect(vcReceive({ a: 2, b: 0 }, { a: 1, b: 3 }, 'a')).toEqual({ a: 3, b: 3 })
    expect(vcReceive({}, { a: 1 }, 'b')).toEqual({ a: 1, b: 1 })
  })

  it('canonical examples: concurrent vs after', () => {
    expect(vcCompare({ a: 1, b: 0 }, { a: 0, b: 1 })).toBe('concurrent')
    expect(vcCompare({ a: 0, b: 1 }, { a: 1, b: 0 })).toBe('concurrent')
    expect(vcCompare({ a: 2, b: 1 }, { a: 1, b: 1 })).toBe('after')
    expect(vcCompare({ a: 1, b: 1 }, { a: 2, b: 1 })).toBe('before')
    expect(vcCompare({ a: 1, b: 1 }, { a: 1, b: 1 })).toBe('equal')
  })

  it('missing entries count as zero', () => {
    expect(vcCompare({ a: 1 }, { a: 1, b: 0 })).toBe('equal')
    expect(vcCompare({}, { a: 0 })).toBe('equal')
    expect(vcCompare({ a: 1 }, { b: 1 })).toBe('concurrent')
    expect(vcCompare({ a: 1 }, { a: 1, b: 1 })).toBe('before')
    expect(vcGet({ a: 1 }, 'zed')).toBe(0)
    expect(vcEquals({ a: 1, b: 0 }, { a: 1 })).toBe(true)
  })

  it('dominates = equal or after', () => {
    expect(vcDominates({ a: 2, b: 1 }, { a: 1, b: 1 })).toBe(true)
    expect(vcDominates({ a: 1, b: 1 }, { a: 1, b: 1 })).toBe(true)
    expect(vcDominates({ a: 1, b: 1 }, { a: 2, b: 1 })).toBe(false)
    expect(vcDominates({ a: 1, b: 0 }, { a: 0, b: 1 })).toBe(false)
  })

  it('the lesson scenario: a message from alice makes bob "after" alice; a third node stays concurrent', () => {
    let alice = vcFromNodes(['alice', 'bob', 'carol'])
    let bob = vcFromNodes(['alice', 'bob', 'carol'])
    let carol = vcFromNodes(['alice', 'bob', 'carol'])

    alice = vcTick(alice, 'alice') // alice edits → {alice:1}
    const msg = alice // alice sends her clock with the edit
    carol = vcTick(carol, 'carol') // carol edits on her own → {carol:1}
    bob = vcReceive(bob, msg, 'bob') // bob gets it → {alice:1, bob:1}

    expect(bob).toEqual({ alice: 1, bob: 1, carol: 0 })
    expect(vcCompare(msg, bob)).toBe('before') // alice's edit happened before bob's receive
    expect(vcCompare(carol, bob)).toBe('concurrent') // carol's edit is unrelated to both
    expect(vcCompare(carol, alice)).toBe('concurrent')
  })

  it('the classic pitfall a Lamport clock cannot see: equal totals, still concurrent', () => {
    const x = { a: 2, b: 0 }
    const y = { a: 0, b: 2 }
    expect(vcCompare(x, y)).toBe('concurrent')
    // A single counter would say "2 vs 2" and guess wrong either way.
  })

  it('keys come out sorted and inputs are never mutated', () => {
    const messy = { zed: 1, alpha: 2 }
    expect(Object.keys(vcOf(messy))).toEqual(['alpha', 'zed'])
    expect(Object.keys(vcMerge({ zed: 1 }, { alpha: 2 }))).toEqual(['alpha', 'zed'])
    expect(Object.keys(vcTick({ zed: 1 }, 'alpha'))).toEqual(['alpha', 'zed'])
    expect(Object.keys(vcFromNodes(['c', 'a', 'b']))).toEqual(['a', 'b', 'c'])

    const a: VectorClock = { a: 1, b: 2 }
    const b: VectorClock = { a: 3 }
    const before = canon(a)
    vcTick(a, 'a')
    vcMerge(a, b)
    vcReceive(a, b, 'b')
    expect(canon(a)).toBe(before)
    expect(b).toEqual({ a: 3 })
  })

  it('property: compare is antisymmetric and tick always moves strictly forward', () => {
    fc.assert(
      fc.property(vcArb, vcArb, (x, y) => {
        const xy = vcCompare(x, y)
        const yx = vcCompare(y, x)
        const flipped = {
          equal: 'equal',
          before: 'after',
          after: 'before',
          concurrent: 'concurrent',
        }
        return yx === flipped[xy]
      }),
    )
    fc.assert(
      fc.property(
        vcArb,
        fc.constantFrom(...NODES),
        (x, n) => vcCompare(vcTick(x, n), x) === 'after',
      ),
    )
  })

  it('property: merge dominates both inputs; receive is after both', () => {
    fc.assert(
      fc.property(vcArb, vcArb, fc.constantFrom(...NODES), (x, y, n) => {
        const m = vcMerge(x, y)
        const r = vcReceive(x, y, n)
        return (
          vcDominates(m, x) &&
          vcDominates(m, y) &&
          vcCompare(r, x) === 'after' &&
          vcCompare(r, y) === 'after'
        )
      }),
    )
  })
})

describe('vector clock: CrdtType view', () => {
  it('init is empty by default; update ticks / receives as ctx.node', () => {
    const ctx = makeCtx('alice')
    let s = vectorClock.init('alice')
    expect(s).toEqual({})
    s = vectorClock.update(s, { tick: true }, ctx)
    expect(s).toEqual({ alice: 1 })
    s = vectorClock.update(s, { receive: { bob: 4 } }, ctx)
    expect(s).toEqual({ alice: 2, bob: 4 })
    expect(vectorClock.value(s)).toEqual({ alice: 2, bob: 4 })
  })

  it('init with { nodes } pre-fills a zero row per actor, always including the node itself', () => {
    expect(vectorClock.init('alice', { nodes: ['carol', 'bob'] })).toEqual({
      alice: 0,
      bob: 0,
      carol: 0,
    })
    expect(Object.keys(vectorClock.init('alice', { nodes: ['carol', 'bob', 'alice'] }))).toEqual([
      'alice',
      'bob',
      'carol',
    ])
  })

  it('merge both directions gives the same clock', () => {
    const a = { alice: 2, bob: 0 }
    const b = { alice: 1, bob: 3 }
    expect(vectorClock.merge(a, b)).toEqual({ alice: 2, bob: 3 })
    expect(canon(vectorClock.merge(a, b))).toBe(canon(vectorClock.merge(b, a)))
  })

  it('effect(prepare(...)) equals update(...); the op carries the sender', () => {
    const ctx = makeCtx('bob')
    const s = { alice: 1, bob: 1 }
    for (const u of [{ tick: true } as const, { receive: { carol: 2 } }]) {
      const op = vectorClock.prepare(s, u, ctx)
      expect(op.from).toBe('bob')
      expect(vectorClock.effect(s, op)).toEqual(vectorClock.update(s, u, ctx))
    }
  })

  it('equals is semantic: a zero row equals a missing row', () => {
    expect(vectorClock.equals?.({ a: 1, b: 0 }, { a: 1 })).toBe(true)
    expect(vectorClock.equals?.({ a: 1, b: 1 }, { a: 1 })).toBe(false)
  })

  it('merge laws', () => {
    assertMergeLaws({ type: vectorClock, args: undefined, updateArb })
  })

  it('state convergence', () => {
    assertConvergence({ type: vectorClock, args: undefined, updateArb })
  })

  it('op convergence', () => {
    assertOpConvergence({ type: vectorClock, args: undefined, updateArb })
  })
})
