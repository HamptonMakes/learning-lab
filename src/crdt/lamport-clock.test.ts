import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import {
  LAMPORT_ZERO,
  compareLamportStamp,
  compareStamp,
  lamportClock,
  receive,
  stamp,
  tick,
  type Lamport,
  type LamportUpdate,
} from './lamport-clock'
import { makeCtx } from './types'
import { assertConvergence, assertMergeLaws, assertOpConvergence } from './laws'

describe('lamport clock: rules', () => {
  it('tick adds one', () => {
    expect(tick(LAMPORT_ZERO)).toBe(1)
    expect(tick(41)).toBe(42)
  })

  it('receive jumps past both clocks', () => {
    expect(receive(3, 7)).toBe(8)
    expect(receive(7, 3)).toBe(8)
    expect(receive(5, 5)).toBe(6)
  })

  it('the lesson scenario: alice sends, bob receives, bob is now "after" alice', () => {
    let alice: Lamport = LAMPORT_ZERO
    let bob: Lamport = LAMPORT_ZERO
    bob = tick(bob) // bob does some local work (1)
    bob = tick(bob) // (2)
    alice = tick(alice) // alice sends at 1
    const msg = alice
    bob = receive(bob, msg) // max(2, 1) + 1 = 3
    expect(alice).toBe(1)
    expect(bob).toBe(3)
    expect(bob).toBeGreaterThan(msg)
  })

  it('the classic pitfall: a smaller stamp does not prove happened-before', () => {
    // alice and bob never talk; both counters advance independently.
    const alice = tick(tick(tick(LAMPORT_ZERO))) // 3
    const bob = tick(LAMPORT_ZERO) // 1
    // bob < alice, yet bob's event is concurrent with alice's — the clock cannot tell us.
    expect(bob).toBeLessThan(alice)
  })

  it('stamps order by ts, then by node id', () => {
    expect(compareStamp(stamp(2, 'alice'), stamp(1, 'bob'))).toBeGreaterThan(0)
    expect(compareStamp(stamp(1, 'alice'), stamp(2, 'bob'))).toBeLessThan(0)
    expect(compareStamp(stamp(1, 'alice'), stamp(1, 'bob'))).toBeLessThan(0)
    expect(compareStamp(stamp(1, 'bob'), stamp(1, 'alice'))).toBeGreaterThan(0)
    expect(compareLamportStamp(stamp(1, 'bob'), stamp(1, 'bob'))).toBe(0)
  })

  it('stamp returns a fresh object and never mutates its inputs', () => {
    const s = stamp(4, 'carol')
    expect(s).toEqual({ ts: 4, node: 'carol' })
    const c: Lamport = 9
    tick(c)
    receive(c, 20)
    expect(c).toBe(9)
  })

  it('property: receive is always strictly larger than both inputs', () => {
    fc.assert(
      fc.property(fc.nat(1000), fc.nat(1000), (a, b) => {
        const r = receive(a, b)
        return r > a && r > b && r === Math.max(a, b) + 1
      }),
    )
  })
})

const updateArb = (): fc.Arbitrary<LamportUpdate> =>
  fc.oneof(
    fc.constant<LamportUpdate>({ tick: true }),
    fc.nat(30).map((receive): LamportUpdate => ({ receive })),
  )

describe('lamport clock: CrdtType view', () => {
  it('update / merge / value mirror the plain functions', () => {
    const ctx = makeCtx('alice')
    let a = lamportClock.init('alice', undefined)
    expect(a).toBe(0)
    a = lamportClock.update(a, { tick: true }, ctx)
    a = lamportClock.update(a, { receive: 10 }, ctx)
    expect(lamportClock.value(a)).toBe(11)
    expect(lamportClock.merge(a, 4)).toBe(11)
    expect(lamportClock.merge(4, a)).toBe(11)
  })

  it('effect(prepare(...)) equals update(...)', () => {
    const ctx = makeCtx('bob')
    for (const u of [{ tick: true } as const, { receive: 5 }, { receive: 0 }]) {
      const s: Lamport = 3
      expect(lamportClock.effect(s, lamportClock.prepare(s, u, ctx))).toBe(
        lamportClock.update(s, u, ctx),
      )
    }
  })

  it('merge laws', () => {
    assertMergeLaws({ type: lamportClock, args: undefined, updateArb })
  })

  it('state convergence', () => {
    assertConvergence({ type: lamportClock, args: undefined, updateArb })
  })

  it('op convergence', () => {
    assertOpConvergence({ type: lamportClock, args: undefined, updateArb })
  })
})
