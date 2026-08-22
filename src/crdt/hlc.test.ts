import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import {
  hlcClock,
  hlcCompare,
  hlcInit,
  hlcNow,
  hlcReceive,
  hlcSameReading,
  hlcToString,
  type Hlc,
  type HlcUpdate,
} from './hlc'
import { makeCtx } from './types'
import { assertConvergence, assertMergeLaws } from './laws'

const at = (wall: number, counter: number, node = 'alice'): Hlc => ({ wall, counter, node })

describe('hlc: local events', () => {
  it('takes the physical time when it moves forward and resets the counter', () => {
    const a = hlcNow(hlcInit('alice'), 100)
    expect(a).toEqual(at(100, 0))
    expect(hlcNow(a, 150)).toEqual(at(150, 0))
  })

  it('counts up when the physical time has not moved', () => {
    let a = hlcNow(hlcInit('alice'), 100)
    a = hlcNow(a, 100)
    a = hlcNow(a, 100)
    expect(a).toEqual(at(100, 2))
  })

  it('stays monotonic when the wall clock goes backwards', () => {
    const before = hlcNow(hlcInit('alice'), 100)
    const after = hlcNow(before, 50) // the OS clock jumped back 50ms
    expect(after).toEqual(at(100, 1))
    expect(hlcCompare(after, before)).toBeGreaterThan(0)
    const later = hlcNow(after, 99)
    expect(later).toEqual(at(100, 2))
    expect(hlcCompare(later, after)).toBeGreaterThan(0)
  })

  it('never mutates its inputs', () => {
    const a = at(100, 3)
    hlcNow(a, 200)
    hlcReceive(a, at(300, 1, 'bob'), 200)
    expect(a).toEqual(at(100, 3))
  })
})

describe('hlc: receive', () => {
  it('a message from the future bumps the counter past the remote', () => {
    const local = at(100, 0)
    const remote = at(200, 3, 'bob')
    const r = hlcReceive(local, remote, 100)
    expect(r).toEqual(at(200, 4))
    expect(hlcCompare(r, remote)).toBeGreaterThan(0)
    expect(hlcCompare(r, local)).toBeGreaterThan(0)
  })

  it('when all three walls tie, the counter goes one past the larger counter', () => {
    expect(hlcReceive(at(100, 5), at(100, 2, 'bob'), 100)).toEqual(at(100, 6))
    expect(hlcReceive(at(100, 2), at(100, 5, 'bob'), 100)).toEqual(at(100, 6))
  })

  it('when our wall is ahead, the remote cannot lower it; our counter ticks', () => {
    expect(hlcReceive(at(300, 1), at(200, 9, 'bob'), 250)).toEqual(at(300, 2))
  })

  it('when physical time is ahead of both, the counter resets', () => {
    expect(hlcReceive(at(100, 7), at(120, 9, 'bob'), 500)).toEqual(at(500, 0))
  })

  it('keeps the receiver node id', () => {
    const r = hlcReceive(hlcInit('alice'), at(50, 0, 'bob'), 10)
    expect(r.node).toBe('alice')
  })

  it('the lesson scenario: alice and bob trade a message; the order matches causality', () => {
    let alice = hlcNow(hlcInit('alice'), 1_000)
    let bob = hlcNow(hlcInit('bob'), 990) // bob's clock is 10ms behind
    const msg = alice
    bob = hlcReceive(bob, msg, 995) // still behind, but the HLC jumps to alice's wall
    expect(bob).toEqual({ wall: 1_000, counter: 1, node: 'bob' })
    expect(hlcCompare(bob, msg)).toBeGreaterThan(0)
    alice = hlcNow(alice, 1_000)
    // alice's next event and bob's receive both sit at wall 1000, counter 1: the node id decides.
    expect(hlcCompare(alice, bob)).toBeLessThan(0)
  })
})

describe('hlc: compare and format', () => {
  it('orders by wall, then counter, then node', () => {
    expect(hlcCompare(at(2, 0), at(1, 9))).toBeGreaterThan(0)
    expect(hlcCompare(at(1, 1), at(1, 2))).toBeLessThan(0)
    expect(hlcCompare(at(1, 1, 'alice'), at(1, 1, 'bob'))).toBeLessThan(0)
    expect(hlcCompare(at(1, 1, 'bob'), at(1, 1, 'alice'))).toBeGreaterThan(0)
    expect(hlcCompare(at(1, 1), at(1, 1))).toBe(0)
  })

  it('formats as wall.counter@node', () => {
    expect(hlcToString(at(1_700_000_000_000, 2, 'alice'))).toBe('1700000000000.2@alice')
    expect(hlcToString(hlcInit('bob'))).toBe('0.0@bob')
  })
})

describe('hlc: properties', () => {
  const hlcArb = fc
    .tuple(fc.nat(1_000), fc.nat(10), fc.constantFrom('bob', 'carol'))
    .map(([wall, counter, node]) => at(wall, counter, node))

  it('every local event is strictly later, whatever the wall clock does', () => {
    fc.assert(
      fc.property(fc.array(fc.nat(1_000), { minLength: 1, maxLength: 50 }), (walls) => {
        let prev = hlcInit('alice')
        for (const wall of walls) {
          const next = hlcNow(prev, wall)
          if (hlcCompare(next, prev) <= 0) return false
          prev = next
        }
        return true
      }),
    )
  })

  it('receive is strictly after both prev and remote, and never below physical time', () => {
    fc.assert(
      fc.property(hlcArb, hlcArb, fc.nat(1_000), (prevRaw, remote, wallNow) => {
        const prev = { ...prevRaw, node: 'alice' }
        const r = hlcReceive(prev, remote, wallNow)
        return (
          hlcCompare(r, prev) > 0 &&
          hlcCompare(r, remote) > 0 &&
          r.wall >= wallNow &&
          r.node === 'alice'
        )
      }),
    )
  })

  it('the wall never runs ahead of the largest physical time seen (the counter absorbs the rest)', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.oneof(
            fc.nat(1_000).map((wall) => ({ kind: 'now' as const, wall })),
            fc
              .tuple(hlcArb, fc.nat(1_000))
              .map(([remote, wall]) => ({ kind: 'recv' as const, remote, wall })),
          ),
          { maxLength: 40 },
        ),
        (events) => {
          let clock = hlcInit('alice')
          let maxSeen = 0
          for (const e of events) {
            if (e.kind === 'now') {
              clock = hlcNow(clock, e.wall)
              maxSeen = Math.max(maxSeen, e.wall)
            } else {
              clock = hlcReceive(clock, e.remote, e.wall)
              maxSeen = Math.max(maxSeen, e.wall, e.remote.wall)
            }
            if (clock.wall > maxSeen) return false
          }
          return true
        },
      ),
    )
  })
})

describe('hlc: CrdtType view (hlcClock)', () => {
  const tick: HlcUpdate = { tick: true }

  it('init is a clock that has seen no time; value hides the node', () => {
    expect(hlcClock.name).toBe('hlc')
    expect(hlcClock.init('alice', undefined)).toEqual({ wall: 0, counter: 0, node: 'alice' })
    expect(hlcClock.value(at(100, 2))).toEqual({ wall: 100, counter: 2 })
  })

  it('update is a local event at the physical time ctx.ts', () => {
    const ctx = makeCtx('alice', 100)
    let a = hlcClock.init('alice', undefined)
    a = hlcClock.update(a, tick, ctx)
    expect(a).toEqual(at(100, 0))
    a = hlcClock.update(a, tick, ctx) // the clock did not move: counter climbs
    expect(a).toEqual(at(100, 1))
    a = hlcClock.update(a, tick, ctx.at(90)) // the clock went backwards: still monotonic
    expect(a).toEqual(at(100, 2))
    a = hlcClock.update(a, tick, ctx.at(150))
    expect(a).toEqual(at(150, 0))
  })

  it('update equals effect(prepare(...)): the source adopts its own stamp', () => {
    const ctx1 = makeCtx('alice', 100)
    const ctx2 = makeCtx('alice', 100)
    let viaUpdate = hlcClock.init('alice', undefined)
    let viaOps = hlcClock.init('alice', undefined)
    for (const ts of [100, 100, 90, 150, 150]) {
      viaUpdate = hlcClock.update(viaUpdate, tick, ctx1.at(ts))
      viaOps = hlcClock.effect(viaOps, hlcClock.prepare(viaOps, tick, ctx2.at(ts)))
      expect(viaOps).toEqual(viaUpdate)
    }
  })

  it('effect at another replica is a receive: strictly after both clocks', () => {
    const alice = hlcClock.update(hlcClock.init('alice', undefined), tick, makeCtx('alice', 1_000))
    const op = hlcClock.prepare(alice, tick, makeCtx('alice', 1_000)) // alice's 2nd event: 1000.1
    expect(op.stamp).toEqual(at(1_000, 1))
    const bob = hlcClock.update(hlcClock.init('bob', undefined), tick, makeCtx('bob', 990))
    const bob2 = hlcClock.effect(bob, op)
    expect(bob2).toEqual({ wall: 1_000, counter: 2, node: 'bob' })
    expect(hlcCompare(bob2, op.stamp)).toBeGreaterThan(0)
    expect(hlcCompare(bob2, bob)).toBeGreaterThan(0)
    // a receive is an event: applying the same op twice moves the clock again (not idempotent)
    expect(hlcClock.effect(bob2, op)).toEqual({ wall: 1_000, counter: 3, node: 'bob' })
  })

  it('receive when our wall is ahead: our counter ticks, the wall stays', () => {
    const bob = at(2_000, 4, 'bob')
    expect(hlcClock.effect(bob, { stamp: at(1_500, 9, 'alice') })).toEqual(at(2_000, 5, 'bob'))
  })

  it("merge is a join on the reading and keeps the holder's node", () => {
    const a = at(100, 3, 'alice')
    const b = at(200, 0, 'bob')
    expect(hlcClock.merge(a, b)).toEqual({ wall: 200, counter: 0, node: 'alice' })
    expect(hlcClock.merge(b, a)).toBe(b)
    expect(hlcClock.merge(a, a)).toBe(a)
    // equal readings: nothing to take, whatever the node ids say
    expect(hlcClock.merge(at(5, 5, 'alice'), at(5, 5, 'bob'))).toEqual(at(5, 5, 'alice'))
    expect(hlcSameReading(hlcClock.merge(a, b), hlcClock.merge(b, a))).toBe(true)
  })

  const updateArb = () => fc.constant<HlcUpdate>({ tick: true })

  it('merge laws (on the reading)', () => {
    assertMergeLaws({ type: hlcClock, args: undefined, updateArb })
  })

  it('state-based convergence', () => {
    assertConvergence({ type: hlcClock, args: undefined, updateArb })
  })

  // Op convergence is deliberately not asserted: `effect` at a non-source replica is a receive,
  // which is an event of its own (the counter climbs once per received op), so two replicas that
  // received different numbers of ops legitimately read differently. See the hlcClock comment.

  it('states are JSON-safe', () => {
    const s = hlcClock.update(hlcClock.init('alice', undefined), tick, makeCtx('alice', 7))
    expect(JSON.parse(JSON.stringify(s))).toEqual(s)
  })
})
