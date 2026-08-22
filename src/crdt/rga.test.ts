import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import { assertConvergence, assertMergeLaws, assertOpConvergence, canon } from './laws'
import { dot, makeCtx, type Ctx, type Dot } from './types'
import {
  rga,
  rgaRows,
  rgaText,
  rgaType,
  rgaVisibleIds,
  type RgaOp,
  type RgaState,
  type RgaUpdate,
} from './rga'

type S = RgaState<string>
type Op = RgaOp<string>
/** A test clock: `ctx.at(ts)` sets the logical time and returns the ctx. */
type TestCtx = ReturnType<typeof makeCtx>

/** Id of the visible element at `index` (throws if there is none — test helper only). */
function idAt(state: S, index: number): Dot {
  const id = rgaVisibleIds(state)[index]
  if (id === undefined) throw new Error(`no visible element at ${index}`)
  return id
}

/** prepare + effect at the source; returns the new state and the op to ship to other replicas. */
function emit(state: S, u: RgaUpdate<string>, ctx: Ctx): [S, Op] {
  const op = rga.prepare(state, u, ctx)
  return [rga.effect(state, op), op]
}

function receive(state: S, ops: Op[]): S {
  return ops.reduce((s, op) => rga.effect(s, op), state)
}

/** Re-create the insert ops that produced `state` (in order), so a new replica can catch up. */
function historyOf(state: S): Op[] {
  return rgaRows(state).map((r) => ({
    insert: { id: r.id, value: r.value, after: r.after, ts: r.ts },
  }))
}

/** Type `text` one character at a time at the end, advancing the clock by one per key. */
function typeText(state: S, text: string, ctx: Ctx, startTs: number): [S, Op[]] {
  const ops: Op[] = []
  let s = state
  text.split('').forEach((ch, i) => {
    ctx.ts = startTs + i
    const [next, op] = emit(s, { insertAt: Number.MAX_SAFE_INTEGER, value: ch }, ctx)
    s = next
    ops.push(op)
  })
  return [s, ops]
}

/** Two replicas that both hold the same document (alice typed it, bob received the ops). */
function pair(text: string): { alice: S; bob: S; ca: TestCtx; cb: TestCtx; nextTs: number } {
  const ca = makeCtx('alice', 0)
  const cb = makeCtx('bob', 0)
  const [alice, ops] = typeText(rga.init('alice'), text, ca, 1)
  const bob = receive(rga.init('bob'), ops)
  return { alice, bob, ca, cb, nextTs: text.length + 1 }
}

function deepFreeze<T>(x: T): T {
  if (x && typeof x === 'object') {
    Object.freeze(x)
    for (const v of Object.values(x as object)) deepFreeze(v)
  }
  return x
}

describe('rga: typing', () => {
  it('types "hello" one character at a time', () => {
    const ctx = makeCtx('alice', 0)
    const [s] = typeText(rga.init('alice'), 'hello', ctx, 1)
    expect(rga.value(s)).toEqual(['h', 'e', 'l', 'l', 'o'])
    expect(rgaText(s)).toBe('hello')
    // ids are minted from the node's counter; each char is anchored on the previous one
    const rows = rgaRows(s)
    expect(rows.map((r) => r.id)).toEqual([1, 2, 3, 4, 5].map((n) => dot('alice', n)))
    expect(rows.map((r) => r.after)).toEqual(['HEAD', 'alice:1', 'alice:2', 'alice:3', 'alice:4'])
    expect(rows.map((r) => r.ts)).toEqual([1, 2, 3, 4, 5])
    expect(rows.map((r) => r.visibleIndex)).toEqual([0, 1, 2, 3, 4])
    expect(rows.every((r) => !r.tombstone)).toBe(true)
    expect(s.order).toEqual(rows.map((r) => r.id))
  })

  it('insertAfter and insertAt describe the same edit', () => {
    const a = makeCtx('alice', 0)
    const b = makeCtx('bob', 0)
    let viaAt = rga.init<string>('alice')
    let viaAfter = rga.init<string>('bob')
    viaAt = rga.update(viaAt, { insertAt: 0, value: 'a' }, a.at(1))
    viaAt = rga.update(viaAt, { insertAt: 1, value: 'c' }, a.at(2))
    viaAt = rga.update(viaAt, { insertAt: 1, value: 'b' }, a.at(3))
    viaAfter = rga.update(viaAfter, { insertAfter: 'HEAD', value: 'a' }, b.at(1))
    viaAfter = rga.update(viaAfter, { insertAfter: 'bob:1', value: 'c' }, b.at(2))
    viaAfter = rga.update(viaAfter, { insertAfter: 'bob:1', value: 'b' }, b.at(3))
    expect(rgaText(viaAt)).toBe('abc')
    expect(rgaText(viaAfter)).toBe('abc')
    expect(rgaRows(viaAfter).map((r) => r.after)).toEqual(['HEAD', 'bob:1', 'bob:1'])
  })

  it('inserting at the front repeatedly reverses the typed order', () => {
    const ctx = makeCtx('alice', 0)
    let s = rga.init<string>('alice')
    for (const [i, ch] of ['a', 'b', 'c'].entries()) {
      s = rga.update(s, { insertAt: 0, value: ch }, ctx.at(i + 1))
    }
    expect(rgaText(s)).toBe('cba')
  })
})

describe('rga: deleting', () => {
  it('delete keeps a tombstone; value and visible indexes skip it', () => {
    const { alice, ca, nextTs } = pair('abc')
    const s = rga.update(alice, { delete: idAt(alice, 1) }, ca.at(nextTs))
    expect(rgaText(s)).toBe('ac')
    expect(s.order).toEqual(['alice:1', 'alice:2', 'alice:3'])
    expect(rgaRows(s).map((r) => [r.value, r.tombstone, r.visibleIndex])).toEqual([
      ['a', false, 0],
      ['b', true, null],
      ['c', false, 1],
    ])
  })

  it('deleteAt removes the visible element at that index (tombstones do not count)', () => {
    const { alice, ca, nextTs } = pair('abcd')
    let s = rga.update(alice, { deleteAt: 1 }, ca.at(nextTs)) // "acd"
    s = rga.update(s, { deleteAt: 1 }, ca.at(nextTs + 1)) // "ad"
    expect(rgaText(s)).toBe('ad')
    expect(rgaRows(s).map((r) => r.tombstone)).toEqual([false, true, true, false])
  })

  it('deleting twice is idempotent (same state, same object)', () => {
    const { alice, ca, nextTs } = pair('ab')
    const once = rga.update(alice, { delete: 'alice:1' }, ca.at(nextTs))
    const twice = rga.update(once, { delete: 'alice:1' }, ca.at(nextTs + 1))
    expect(twice).toBe(once)
  })

  it('you can still insert after a deleted element; it lands where the element was', () => {
    const { alice, ca, nextTs } = pair('ab')
    let s = rga.update(alice, { delete: 'alice:1' }, ca.at(nextTs)) // "b"
    s = rga.update(s, { insertAfter: 'alice:1', value: 'x' }, ca.at(nextTs + 1))
    expect(rgaText(s)).toBe('xb')
  })
})

describe('rga: concurrent edits (op-based)', () => {
  it('two users insert at the same position: the higher ts wins the leftmost slot, on both replicas', () => {
    const { alice, bob, ca, cb, nextTs } = pair('ac')
    // Both insert between 'a' and 'c' without seeing each other.
    const [alice1, opA] = emit(alice, { insertAt: 1, value: 'b' }, ca.at(nextTs))
    const [bob1, opB] = emit(bob, { insertAt: 1, value: 'B' }, cb.at(nextTs + 1))
    expect(rgaText(alice1)).toBe('abc')
    expect(rgaText(bob1)).toBe('aBc')
    // Deliver. Bob's 'B' has the later ts, so it goes first after the shared anchor 'a'.
    const alice2 = receive(alice1, [opB])
    const bob2 = receive(bob1, [opA])
    expect(rgaText(alice2)).toBe('aBbc')
    expect(rgaText(bob2)).toBe('aBbc')
    expect(canon(alice2)).toBe(canon(bob2))
    // Both new elements name the same anchor; order is decided by ts, not by arrival.
    expect(rgaRows(alice2).map((r) => [r.value, r.after, r.ts])).toEqual([
      ['a', 'HEAD', 1],
      ['B', 'alice:1', 4],
      ['b', 'alice:1', 3],
      ['c', 'alice:1', 2],
    ])
  })

  it('equal ts: the higher node id wins the leftmost slot', () => {
    const { alice, bob, ca, cb, nextTs } = pair('ac')
    const [alice1, opA] = emit(alice, { insertAt: 1, value: 'b' }, ca.at(nextTs))
    const [bob1, opB] = emit(bob, { insertAt: 1, value: 'B' }, cb.at(nextTs))
    expect(rgaText(receive(alice1, [opB]))).toBe('aBbc') // 'bob' > 'alice'
    expect(rgaText(receive(bob1, [opA]))).toBe('aBbc')
  })

  it('the outcome does not depend on the order ops arrive', () => {
    const { alice, bob, ca, cb, nextTs } = pair('ac')
    const [, opA] = emit(alice, { insertAt: 1, value: 'b' }, ca.at(nextTs))
    const [, opB] = emit(bob, { insertAt: 1, value: 'B' }, cb.at(nextTs + 1))
    // Carol starts empty and receives the history ('a', 'c') plus the two concurrent inserts,
    // once in each order.
    const c1 = receive(rga.init('carol'), [...historyOf(alice), opA, opB])
    const c2 = receive(rga.init('carol'), [...historyOf(alice), opB, opA])
    expect(canon(c1)).toBe(canon(c2))
    expect(rgaText(c1)).toBe('aBbc')
  })

  it('three concurrent inserts at one anchor line up by descending ts', () => {
    const { alice } = pair('a')
    const stamps: [string, number][] = [
      ['x', 7],
      ['y', 5],
      ['z', 9],
    ]
    const ops = stamps.map(([node, ts]) => {
      const replica = receive(rga.init(node), historyOf(alice))
      return emit(replica, { insertAfter: 'alice:1', value: node }, makeCtx(node, ts))[1]
    })
    expect(rgaText(receive(alice, ops))).toBe('azxy') // z(9), x(7), y(5)
  })

  it('delete + concurrent insert after the deleted element still lands correctly', () => {
    const { alice, bob, ca, cb, nextTs } = pair('abc')
    const [alice1, delB] = emit(alice, { delete: 'alice:2' }, ca.at(nextTs)) // alice: "ac"
    const [bob1, insX] = emit(bob, { insertAfter: 'alice:2', value: 'x' }, cb.at(nextTs)) // bob: "abxc"
    const alice2 = receive(alice1, [insX])
    const bob2 = receive(bob1, [delB])
    expect(rgaText(alice2)).toBe('axc')
    expect(rgaText(bob2)).toBe('axc')
    expect(canon(alice2)).toBe(canon(bob2))
    // The tombstone is what keeps x's anchor resolvable.
    const rows = rgaRows(alice2)
    expect(rows.map((r) => [r.value, r.tombstone, r.visibleIndex])).toEqual([
      ['a', false, 0],
      ['b', true, null],
      ['x', false, 1],
      ['c', false, 2],
    ])
    expect(rows.find((r) => r.value === 'x')?.after).toBe('alice:2')
  })

  it('two users typing a word at the same spot: the words do not interleave', () => {
    const alice = makeCtx('alice', 0)
    const bob = makeCtx('bob', 0)
    const [a, opsA] = typeText(rga.init('alice'), 'cat', alice, 1)
    const [b, opsB] = typeText(rga.init('bob'), 'dog', bob, 1)
    expect(rgaText(receive(a, opsB))).toBe('dogcat')
    expect(rgaText(receive(b, opsA))).toBe('dogcat')
  })

  it('both delete the same element concurrently: still one tombstone, same state', () => {
    const { alice, bob, ca, cb, nextTs } = pair('ab')
    const [alice1, delA] = emit(alice, { deleteAt: 0 }, ca.at(nextTs))
    const [bob1, delB] = emit(bob, { deleteAt: 0 }, cb.at(nextTs))
    expect(delA).toEqual(delB)
    const alice2 = receive(alice1, [delB])
    const bob2 = receive(bob1, [delA])
    expect(rgaText(alice2)).toBe('b')
    expect(canon(alice2)).toBe(canon(bob2))
  })
})

describe('rga: state-based use', () => {
  it('merge is the union of elements, both directions give the same state', () => {
    const { alice, bob, ca, cb, nextTs } = pair('ac')
    const a = rga.update(alice, { insertAt: 1, value: 'b' }, ca.at(nextTs))
    const b = rga.update(bob, { insertAt: 1, value: 'B' }, cb.at(nextTs + 1))
    const ab = rga.merge(a, b)
    const ba = rga.merge(b, a)
    expect(canon(ab)).toBe(canon(ba))
    expect(rgaText(ab)).toBe('aBbc')
    expect(canon(rga.merge(ab, a))).toBe(canon(ab))
    expect(canon(rga.merge(ab, ab))).toBe(canon(ab))
  })

  it('a delete on one side wins over the untouched element on the other side', () => {
    const { alice, bob, ca, nextTs } = pair('abc')
    const a = rga.update(alice, { delete: 'alice:2' }, ca.at(nextTs))
    expect(rgaText(rga.merge(a, bob))).toBe('ac')
    expect(rgaText(rga.merge(bob, a))).toBe('ac')
    expect(rgaText(rga.merge(rga.merge(bob, a), bob))).toBe('ac')
  })

  it('delete on one side + insert after that element on the other side (merge)', () => {
    const { alice, bob, ca, cb, nextTs } = pair('abc')
    const a = rga.update(alice, { delete: 'alice:2' }, ca.at(nextTs))
    const b = rga.update(bob, { insertAfter: 'alice:2', value: 'x' }, cb.at(nextTs))
    expect(rgaText(rga.merge(a, b))).toBe('axc')
    expect(rgaText(rga.merge(b, a))).toBe('axc')
  })
})

describe('rga: laws (property tests)', () => {
  const updateArb = (): fc.Arbitrary<RgaUpdate<string>> =>
    fc.oneof(
      {
        weight: 3,
        arbitrary: fc
          .record({
            insertAt: fc.integer({ min: 0, max: 6 }),
            value: fc.constantFrom('a', 'b', 'c'),
          })
          .map((u): RgaUpdate<string> => u),
      },
      {
        weight: 1,
        arbitrary: fc.record({ deleteAt: fc.integer({ min: 0, max: 6 }) }),
      },
    )
  const cfg = { type: rgaType<string>(), args: undefined, updateArb }

  it('op-based: ops delivered in any causal order converge', () => {
    assertOpConvergence(cfg)
  })

  it('state-based: merge is commutative, associative, idempotent', () => {
    assertMergeLaws(cfg)
  })

  it('state-based: replicas gossiping states in random order converge', () => {
    assertConvergence(cfg)
  })

  it('op-based and state-based paths agree: update(s, u) === effect(s, prepare(s, u))', () => {
    fc.assert(
      fc.property(fc.array(updateArb(), { maxLength: 8 }), (updates) => {
        const c1 = makeCtx('a', 0)
        const c2 = makeCtx('a', 0)
        let viaUpdate = rga.init<string>('a')
        let viaOps = rga.init<string>('a')
        updates.forEach((u, i) => {
          viaUpdate = rga.update(viaUpdate, u, c1.at(i + 1))
          viaOps = rga.effect(viaOps, rga.prepare(viaOps, u, c2.at(i + 1)))
        })
        return canon(viaUpdate) === canon(viaOps)
      }),
      { numRuns: 100 },
    )
  })
})

describe('rga: edge cases', () => {
  it('a fresh replica is empty', () => {
    const s = rga.init<string>('alice')
    expect(s).toEqual({ nodes: {}, order: [] })
    expect(rga.value(s)).toEqual([])
    expect(rgaRows(s)).toEqual([])
    expect(rgaText(s)).toBe('')
  })

  it('insertAt clamps out-of-range indexes', () => {
    const { alice, ca, nextTs } = pair('ab')
    expect(rgaText(rga.update(alice, { insertAt: 99, value: 'z' }, ca.at(nextTs)))).toBe('abz')
    expect(rgaText(rga.update(alice, { insertAt: -5, value: 'z' }, ca.at(nextTs)))).toBe('zab')
  })

  it('deleteAt clamps out-of-range indexes', () => {
    const { alice, ca, nextTs } = pair('abc')
    expect(rgaText(rga.update(alice, { deleteAt: 99 }, ca.at(nextTs)))).toBe('ab')
    expect(rgaText(rga.update(alice, { deleteAt: -1 }, ca.at(nextTs)))).toBe('bc')
  })

  it('deleteAt on an empty list is a no-op (prepare yields { noop: true })', () => {
    const s = rga.init<string>('alice')
    const ctx = makeCtx('alice', 1)
    expect(rga.prepare(s, { deleteAt: 0 }, ctx)).toEqual({ noop: true })
    expect(rga.update(s, { deleteAt: 0 }, ctx)).toBe(s)
    // an all-deleted list is "empty" too
    const { alice, ca, nextTs } = pair('a')
    const gone = rga.update(alice, { deleteAt: 0 }, ca.at(nextTs))
    expect(rga.prepare(gone, { deleteAt: 0 }, ca.at(nextTs + 1))).toEqual({ noop: true })
  })

  it('prepare rejects anchors and ids this replica does not know', () => {
    const s = rga.init<string>('alice')
    const ctx = makeCtx('alice', 1)
    expect(() => rga.prepare(s, { insertAfter: 'bob:7', value: 'x' }, ctx)).toThrow(
      /no such element/,
    )
    expect(() => rga.prepare(s, { delete: 'bob:7' }, ctx)).toThrow(/no such element/)
  })

  it('effect throws clearly when an insert arrives before its anchor (causal delivery)', () => {
    const s = rga.init<string>('bob')
    const op: Op = { insert: { id: 'alice:2', value: 'b', after: 'alice:1', ts: 2 } }
    expect(() => rga.effect(s, op)).toThrow(/anchor has not arrived yet/)
  })

  it('effect throws clearly when a delete arrives before its insert', () => {
    const s = rga.init<string>('bob')
    expect(() => rga.effect(s, { delete: 'alice:1' })).toThrow(/has not arrived yet/)
  })

  it('re-delivered ops are ignored', () => {
    const { alice, bob, ca, nextTs } = pair('ab')
    const [alice1, op] = emit(alice, { insertAt: 1, value: 'x' }, ca.at(nextTs))
    const once = receive(bob, [op])
    expect(receive(once, [op])).toBe(once)
    expect(receive(alice1, [op])).toBe(alice1)
    expect(rgaText(once)).toBe('axb')
  })

  it('without advancing the clock, one node still sees its own newest insert first (seq tie-break)', () => {
    const ctx = makeCtx('alice', 0) // ts stays 0 for every edit
    let s = rga.init<string>('alice')
    s = rga.update(s, { insertAt: 0, value: 'a' }, ctx)
    s = rga.update(s, { insertAt: 1, value: 'b' }, ctx)
    s = rga.update(s, { insertAt: 0, value: 'x' }, ctx)
    s = rga.update(s, { insertAt: 1, value: 'y' }, ctx)
    expect(rgaText(s)).toBe('xyab')
    expect(rgaRows(s).every((r) => r.ts === 0)).toBe(true)
  })

  it('never mutates its inputs', () => {
    const { alice, bob, ca, nextTs } = pair('abc')
    deepFreeze(alice)
    deepFreeze(bob)
    const before = canon(alice)
    const a = rga.update(alice, { insertAt: 1, value: 'x' }, ca.at(nextTs))
    const a2 = rga.update(deepFreeze(a), { deleteAt: 0 }, ca.at(nextTs + 1))
    rga.merge(alice, deepFreeze(a2))
    rga.merge(a2, bob)
    expect(canon(alice)).toBe(before)
    expect(rgaText(alice)).toBe('abc')
  })

  it('state is plain JSON: a round trip through JSON.stringify is structurally equal', () => {
    const { alice, ca, nextTs } = pair('abc')
    const s = rga.update(alice, { deleteAt: 1 }, ca.at(nextTs))
    const copy = JSON.parse(JSON.stringify(s)) as S
    expect(canon(copy)).toBe(canon(s))
    expect(JSON.stringify(copy)).toBe(JSON.stringify(s)) // keys are kept in canonical order
    expect(rgaText(copy)).toBe('ac')
  })

  it('states built by different histories of the same ops are identical, key order included', () => {
    const { alice, bob, ca, cb, nextTs } = pair('ac')
    const [alice1, opA] = emit(alice, { insertAt: 1, value: 'b' }, ca.at(nextTs))
    const [bob1, opB] = emit(bob, { insertAt: 1, value: 'B' }, cb.at(nextTs + 1))
    expect(JSON.stringify(receive(alice1, [opB]))).toBe(JSON.stringify(receive(bob1, [opA])))
  })

  it('a long document (one chain of 50,000 anchors) does not overflow the stack', () => {
    // Build the element table directly: each char is anchored on the previous one, so the
    // linearization walks a chain 50,000 deep. A recursive walk would blow the call stack here.
    const n = 50_000
    const nodes: S['nodes'] = {}
    for (let i = 1; i <= n; i++) {
      const id = dot('alice', i)
      nodes[id] = {
        id,
        value: 'x',
        after: i === 1 ? 'HEAD' : dot('alice', i - 1),
        tombstone: false,
        ts: i,
      }
    }
    const s = rga.merge({ nodes, order: [] }, rga.init<string>('bob')) // merge recomputes `order`
    expect(s.order).toHaveLength(n)
    expect(s.order[0]).toBe('alice:1')
    expect(s.order[n - 1]).toBe(dot('alice', n))
    expect(rgaText(s)).toBe('x'.repeat(n))
  })

  it('works for non-string elements', () => {
    const ctx = makeCtx('alice', 0)
    let s = rga.init<{ task: string; done: boolean }>('alice')
    s = rga.update(s, { insertAt: 0, value: { task: 'write test', done: false } }, ctx.at(1))
    s = rga.update(s, { insertAt: 1, value: { task: 'fix', done: true } }, ctx.at(2))
    expect(rga.value(s).map((t) => t.task)).toEqual(['write test', 'fix'])
  })

  it('rgaType<E>() exposes the shared implementation as a CrdtType', () => {
    const t = rgaType<string>()
    expect(t.name).toBe('rga')
    const ctx = makeCtx('alice', 1)
    const s = t.update(t.init('alice'), { insertAt: 0, value: 'q' }, ctx)
    expect(t.value(s)).toEqual(['q'])
  })
})
