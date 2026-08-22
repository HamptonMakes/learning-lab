/** LWW Map: per-field LWW examples, tombstones, merge laws, convergence, and edge cases. */
import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import { makeCtx } from './types'
import { assertConvergence, assertMergeLaws, assertOpConvergence, canon } from './laws'
import { lwwMap, lwwMapFields, type LwwMapType, type LwwMapUpdate } from './lww-map'

const map: LwwMapType<string> = lwwMap

describe('lww-map: examples', () => {
  it('starts empty', () => {
    const s = map.init('alice')
    expect(s).toEqual({ entries: {} })
    expect(map.value(s)).toEqual({})
    expect(lwwMapFields(s)).toEqual([])
  })

  it('a set writes one field with its stamp', () => {
    const s = map.update(map.init('alice'), { key: 'owner', set: 'alice' }, makeCtx('alice', 1))
    expect(s).toEqual({ entries: { owner: { value: 'alice', ts: 1, node: 'alice' } } })
    expect(map.value(s)).toEqual({ owner: 'alice' })
  })

  it('two people edit different fields of the same doc; merge keeps both (either direction)', () => {
    const alice = map.update(map.init('alice'), { key: 'owner', set: 'alice' }, makeCtx('alice', 1))
    const bob = map.update(map.init('bob'), { key: 'status', set: 'done' }, makeCtx('bob', 2))
    const ab = map.merge(alice, bob)
    const ba = map.merge(bob, alice)
    expect(map.value(ab)).toEqual({ owner: 'alice', status: 'done' })
    expect(canon(ab)).toBe(canon(ba))
    expect(lwwMapFields(ab)).toEqual([
      { key: 'owner', value: 'alice', ts: 1, node: 'alice', tombstone: false },
      { key: 'status', value: 'done', ts: 2, node: 'bob', tombstone: false },
    ])
  })

  it('two people edit the same field: LWW per key (greater ts wins; ties by node id)', () => {
    const alice = map.update(map.init('alice'), { key: 'owner', set: 'alice' }, makeCtx('alice', 1))
    const bob = map.update(map.init('bob'), { key: 'owner', set: 'bob' }, makeCtx('bob', 2))
    expect(map.value(map.merge(alice, bob))).toEqual({ owner: 'bob' })
    expect(map.value(map.merge(bob, alice))).toEqual({ owner: 'bob' })

    const alice5 = map.update(
      map.init('alice'),
      { key: 'owner', set: 'alice' },
      makeCtx('alice', 5),
    )
    const bob5 = map.update(map.init('bob'), { key: 'owner', set: 'bob' }, makeCtx('bob', 5))
    expect(map.value(map.merge(alice5, bob5))).toEqual({ owner: 'bob' })
    expect(canon(map.merge(alice5, bob5))).toBe(canon(map.merge(bob5, alice5)))
  })

  it('remove leaves a stamped tombstone; value() hides it; fields show it', () => {
    const ctx = makeCtx('alice', 1)
    const s1 = map.update(map.init('alice'), { key: 'owner', set: 'alice' }, ctx)
    const s2 = map.update(s1, { key: 'owner', remove: true }, ctx.at(2))
    expect(s2.entries).toEqual({ owner: { value: null, ts: 2, node: 'alice' } })
    expect(map.value(s2)).toEqual({})
    expect(lwwMapFields(s2)).toEqual([
      { key: 'owner', value: null, ts: 2, node: 'alice', tombstone: true },
    ])
  })

  it('a later set revives a removed key', () => {
    const ctx = makeCtx('alice', 1)
    const s1 = map.update(map.init('alice'), { key: 'owner', set: 'alice' }, ctx)
    const s2 = map.update(s1, { key: 'owner', remove: true }, ctx.at(2))
    const s3 = map.update(s2, { key: 'owner', set: 'carol' }, ctx.at(3))
    expect(map.value(s3)).toEqual({ owner: 'carol' })
    expect(lwwMapFields(s3)[0]?.tombstone).toBe(false)
  })

  it('remove vs concurrent set: the greater stamp wins, whichever it is', () => {
    const base = map.update(map.init('alice'), { key: 'owner', set: 'alice' }, makeCtx('alice', 1))
    const bobHas = map.merge(map.init('bob'), base)
    // Alice removes at ts 3; Bob sets at ts 2 → the remove wins.
    const aliceRm = map.update(base, { key: 'owner', remove: true }, makeCtx('alice', 3))
    const bobSet2 = map.update(bobHas, { key: 'owner', set: 'bob' }, makeCtx('bob', 2))
    expect(map.value(map.merge(aliceRm, bobSet2))).toEqual({})
    expect(map.value(map.merge(bobSet2, aliceRm))).toEqual({})
    // Bob sets at ts 4 → the set wins.
    const bobSet4 = map.update(bobHas, { key: 'owner', set: 'bob' }, makeCtx('bob', 4))
    expect(map.value(map.merge(aliceRm, bobSet4))).toEqual({ owner: 'bob' })
    expect(map.value(map.merge(bobSet4, aliceRm))).toEqual({ owner: 'bob' })
  })

  it('removing a key nobody has set still records a tombstone, so an older concurrent set loses', () => {
    const aliceRm = map.update(
      map.init('alice'),
      { key: 'owner', remove: true },
      makeCtx('alice', 5),
    )
    expect(aliceRm.entries).toEqual({ owner: { value: null, ts: 5, node: 'alice' } })
    const bobSet = map.update(map.init('bob'), { key: 'owner', set: 'bob' }, makeCtx('bob', 4))
    expect(map.value(map.merge(bobSet, aliceRm))).toEqual({})
  })

  it('tombstones are kept after merge (the cost of removal)', () => {
    const ctx = makeCtx('alice', 1)
    const s = map.update(
      map.update(map.init('alice'), { key: 'tmp', set: 'x' }, ctx),
      { key: 'tmp', remove: true },
      ctx.at(2),
    )
    const merged = map.merge(map.init('bob'), s)
    expect(Object.keys(merged.entries)).toEqual(['tmp'])
    expect(map.value(merged)).toEqual({})
  })
})

describe('lww-map: op-based', () => {
  it('prepare stamps the op; effect applies it anywhere; replay is a no-op', () => {
    const a0 = map.init('alice')
    const setOp = map.prepare(a0, { key: 'owner', set: 'alice' }, makeCtx('alice', 1))
    expect(setOp).toEqual({ key: 'owner', set: 'alice', ts: 1, node: 'alice' })
    const rmOp = map.prepare(a0, { key: 'owner', remove: true }, makeCtx('bob', 2))
    expect(rmOp).toEqual({ key: 'owner', remove: true, ts: 2, node: 'bob' })

    const viaOps = map.effect(map.effect(map.init('carol'), setOp), rmOp)
    const viaOpsReversed = map.effect(map.effect(map.init('carol'), rmOp), setOp)
    expect(canon(viaOps)).toBe(canon(viaOpsReversed))
    expect(map.value(viaOps)).toEqual({})
    expect(map.effect(viaOps, setOp)).toBe(viaOps)
    expect(map.effect(viaOps, rmOp)).toBe(viaOps)
  })
})

const keyArb = fc.constantFrom('owner', 'status', 'title')
const updateArb = (): fc.Arbitrary<LwwMapUpdate<number>> =>
  fc.oneof(
    {
      weight: 3,
      arbitrary: fc
        .tuple(keyArb, fc.integer({ min: 0, max: 9 }))
        .map(([key, set]) => ({ key, set })),
    },
    { weight: 1, arbitrary: keyArb.map((key) => ({ key, remove: true }) as const) },
  )

describe('lww-map: laws', () => {
  it('merge is commutative, associative, idempotent', () => {
    assertMergeLaws({ type: lwwMap, args: undefined, updateArb })
  })
  it('replicas converge under random updates and gossip', () => {
    assertConvergence({ type: lwwMap, args: undefined, updateArb })
  })
  it('op-based replicas converge under any causal delivery order', () => {
    assertOpConvergence({ type: lwwMap, args: undefined, updateArb })
  })
})

describe('lww-map: edge cases', () => {
  it('never mutates its inputs', () => {
    const s0 = map.init('alice')
    Object.freeze(s0.entries)
    Object.freeze(s0)
    const s1 = map.update(s0, { key: 'a', set: '1' }, makeCtx('alice', 1))
    expect(s0).toEqual({ entries: {} })
    Object.freeze(s1.entries)
    const s2 = map.update(s1, { key: 'b', set: '2' }, makeCtx('alice', 2))
    expect(Object.keys(s1.entries)).toEqual(['a'])
    const m = map.merge(s1, s2)
    expect(Object.keys(s1.entries)).toEqual(['a'])
    expect(Object.keys(m.entries)).toEqual(['a', 'b'])
  })

  it('keeps entries sorted by key no matter the insertion order', () => {
    const ctx = makeCtx('alice', 1)
    const s = map.update(
      map.update(map.init('alice'), { key: 'zeta', set: 'z' }, ctx),
      { key: 'alpha', set: 'a' },
      ctx.at(2),
    )
    expect(Object.keys(s.entries)).toEqual(['alpha', 'zeta'])
    expect(Object.keys(map.value(s))).toEqual(['alpha', 'zeta'])
    expect(lwwMapFields(s).map((f) => f.key)).toEqual(['alpha', 'zeta'])
    // same two writes in the other order, on another replica, merge to the same state
    const other = map.update(
      map.update(map.init('bob'), { key: 'alpha', set: 'a' }, makeCtx('bob', 2)),
      { key: 'zeta', set: 'z' },
      makeCtx('bob', 1),
    )
    expect(Object.keys(map.merge(other, s).entries)).toEqual(['alpha', 'zeta'])
  })

  it('a write with a stale stamp is ignored and returns the same state object', () => {
    const s1 = map.update(map.init('alice'), { key: 'a', set: '1' }, makeCtx('alice', 5))
    const s2 = map.update(s1, { key: 'a', set: '2' }, makeCtx('alice', 4))
    expect(s2).toBe(s1)
  })

  it('merge with an empty map is the identity (structurally)', () => {
    const s = map.update(map.init('alice'), { key: 'a', set: '1' }, makeCtx('alice', 1))
    expect(map.merge(s, map.init('bob'))).toEqual(s)
    expect(map.merge(map.init('bob'), s)).toEqual(s)
  })

  it('states are JSON-safe', () => {
    const s = map.update(map.init('alice'), { key: 'a', set: '1' }, makeCtx('alice', 1))
    expect(JSON.parse(JSON.stringify(s))).toEqual(s)
  })
})
