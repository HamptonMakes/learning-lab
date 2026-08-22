import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import {
  opCounter,
  type OpCounterOp,
  type OpCounterState,
  type OpCounterUpdate,
} from './op-counter'
import { assertOpConvergence, canon } from './laws'
import { makeCtx, type NodeId } from './types'

const updateArb = (_node: NodeId): fc.Arbitrary<OpCounterUpdate> =>
  fc
    .integer({ min: -5, max: 5 })
    .filter((n) => n !== 0)
    .map((add) => ({ add }))

describe('op-counter: lesson examples', () => {
  it('starts at 0 with no ops minted', () => {
    expect(opCounter.init('alice')).toEqual({ total: 0, node: 'alice', seq: 0 })
    expect(opCounter.value(opCounter.init('alice'))).toBe(0)
  })

  it('prepare mints an op id `node:seq` and leaves the state alone', () => {
    const alice = makeCtx('alice')
    const s = opCounter.init('alice')
    const op = opCounter.prepare(s, { add: 3 }, alice)
    expect(op).toEqual({ id: 'alice:1', add: 3 })
    expect(s).toEqual({ total: 0, node: 'alice', seq: 0 })
    expect(opCounter.prepare(s, { add: -1 }, alice)).toEqual({ id: 'alice:2', add: -1 })
  })

  it('update == effect(prepare); own ops advance seq, foreign ops do not', () => {
    const aliceCtx = makeCtx('alice')
    let alice = opCounter.update(opCounter.init('alice'), { add: 3 }, aliceCtx)
    expect(alice).toEqual({ total: 3, node: 'alice', seq: 1 })
    alice = opCounter.update(alice, { add: -1 }, aliceCtx)
    expect(alice).toEqual({ total: 2, node: 'alice', seq: 2 })

    const bobOp = opCounter.prepare(opCounter.init('bob'), { add: 10 }, makeCtx('bob'))
    alice = opCounter.effect(alice, bobOp)
    expect(alice).toEqual({ total: 12, node: 'alice', seq: 2 })
  })

  it('two replicas: concurrent adds, delivered once each, converge in any order', () => {
    const aliceCtx = makeCtx('alice')
    const bobCtx = makeCtx('bob')
    let alice = opCounter.init('alice')
    let bob = opCounter.init('bob')

    const a1 = opCounter.prepare(alice, { add: 3 }, aliceCtx)
    alice = opCounter.effect(alice, a1)
    const b1 = opCounter.prepare(bob, { add: -2 }, bobCtx)
    bob = opCounter.effect(bob, b1)
    expect(opCounter.value(alice)).toBe(3)
    expect(opCounter.value(bob)).toBe(-2)

    alice = opCounter.effect(alice, b1)
    bob = opCounter.effect(bob, a1)
    expect(opCounter.value(alice)).toBe(1)
    expect(opCounter.value(bob)).toBe(1)
    expect(alice).toEqual({ total: 1, node: 'alice', seq: 1 })
    expect(bob).toEqual({ total: 1, node: 'bob', seq: 1 })
  })

  it('increments commute: the same ops in a different order give the same total', () => {
    const ops: OpCounterOp[] = [
      { id: 'alice:1', add: 5 },
      { id: 'bob:1', add: -3 },
      { id: 'carol:1', add: 2 },
      { id: 'alice:2', add: -1 },
    ]
    const forward = ops.reduce((s, op) => opCounter.effect(s, op), opCounter.init('dave'))
    const backward = [...ops]
      .reverse()
      .reduce((s, op) => opCounter.effect(s, op), opCounter.init('dave'))
    expect(forward.total).toBe(3)
    expect(canon(forward)).toBe(canon(backward))
  })

  it('does not even need causal order: a node own ops can arrive out of sequence', () => {
    const aliceCtx = makeCtx('alice')
    const op1 = opCounter.prepare(opCounter.init('alice'), { add: 1 }, aliceCtx)
    const op2 = opCounter.prepare(opCounter.init('alice'), { add: 2 }, aliceCtx)
    let bob = opCounter.init('bob')
    bob = opCounter.effect(bob, op2)
    bob = opCounter.effect(bob, op1)
    expect(bob.total).toBe(3)
    // and Alice applying her own ops out of order still records the highest seq
    let alice = opCounter.init('alice')
    alice = opCounter.effect(alice, op2)
    alice = opCounter.effect(alice, op1)
    expect(alice).toEqual({ total: 3, node: 'alice', seq: 2 })
  })

  it('the pitfall: NOT idempotent — a replayed op double counts', () => {
    const aliceCtx = makeCtx('alice')
    const op = opCounter.prepare(opCounter.init('alice'), { add: 3 }, aliceCtx)
    let bob = opCounter.init('bob')
    bob = opCounter.effect(bob, op)
    bob = opCounter.effect(bob, op) // the network replayed it
    expect(bob.total).toBe(6) // wrong, and the type cannot tell
  })

  it('the fix lives in the delivery layer: dedupe by op id before calling effect', () => {
    const aliceCtx = makeCtx('alice')
    const bobCtx = makeCtx('bob')
    const a1 = opCounter.prepare(opCounter.init('alice'), { add: 3 }, aliceCtx)
    const b1 = opCounter.prepare(opCounter.init('bob'), { add: 4 }, bobCtx)
    // a tiny exactly-once inbox, as a lesson would draw it
    const seen = new Set<string>()
    let carol = opCounter.init('carol')
    for (const op of [a1, b1, a1, b1, a1]) {
      if (seen.has(op.id)) continue
      seen.add(op.id)
      carol = opCounter.effect(carol, op)
    }
    expect(carol.total).toBe(7)
  })
})

describe('op-counter: laws (op-based only)', () => {
  it('ops converge under causal, exactly-once delivery', () => {
    assertOpConvergence({ type: opCounter, args: undefined, updateArb })
  })

  it('merge is documented as a no-op that returns the left state (not a CvRDT)', () => {
    const a = opCounter.update(opCounter.init('alice'), { add: 2 }, makeCtx('alice'))
    const b = opCounter.update(opCounter.init('bob'), { add: 5 }, makeCtx('bob'))
    expect(opCounter.merge(a, b)).toBe(a)
    expect(opCounter.merge(b, a)).toBe(b)
  })
})

describe('op-counter: edge cases', () => {
  it('rejects deltas that are zero or not integers', () => {
    const alice = makeCtx('alice')
    const s = opCounter.init('alice')
    for (const add of [0, 0.5, -1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => opCounter.update(s, { add }, alice)).toThrow(RangeError)
      expect(() => opCounter.prepare(s, { add }, alice)).toThrow(RangeError)
    }
  })

  it('accepts negative deltas and can go below zero', () => {
    const alice = makeCtx('alice')
    const s = opCounter.update(opCounter.init('alice'), { add: -4 }, alice)
    expect(s).toEqual({ total: -4, node: 'alice', seq: 1 })
  })

  it('never mutates its inputs', () => {
    const aliceCtx = makeCtx('alice')
    const a = opCounter.update(opCounter.init('alice'), { add: 1 }, aliceCtx)
    const aBefore = structuredClone(a)
    opCounter.update(a, { add: 9 }, aliceCtx)
    opCounter.effect(a, { id: 'bob:1', add: 7 })
    opCounter.effect(a, { id: 'alice:9', add: 7 })
    opCounter.merge(a, opCounter.init('bob'))
    expect(a).toEqual(aBefore)
  })

  it('state is JSON-serializable and round-trips', () => {
    const a = opCounter.update(opCounter.init('alice'), { add: 3 }, makeCtx('alice'))
    const back = JSON.parse(JSON.stringify(a)) as OpCounterState
    expect(canon(back)).toBe(canon(a))
    expect(opCounter.value(back)).toBe(3)
  })
})
