import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import { assertConvergence, assertMergeLaws, assertOpConvergence, canon } from './laws'
import { keyOf } from './g-set'
import {
  orSet,
  orSetHas,
  orSetRows,
  orSetType,
  type OrSetCrdt,
  type OrSetOp,
  type OrSetState,
  type OrSetUpdate,
} from './or-set'
import { makeCtx, type CrdtType } from './types'

const groceries = orSetType<string>()

function freshPair() {
  return {
    alice: groceries.init('alice', undefined),
    bob: groceries.init('bob', undefined),
    ctxA: makeCtx('alice'),
    ctxB: makeCtx('bob'),
  }
}

describe('OR-Set: lesson scenarios', () => {
  it('headline: concurrent remove and re-add — add wins, and re-add works (unlike 2P-Set)', () => {
    let { alice, bob } = freshPair()
    const { ctxA, ctxB } = freshPair()

    // Alice adds milk; it gets the unique tag alice:1. Bob syncs and sees it.
    alice = groceries.update(alice, { add: 'milk' }, ctxA)
    expect(alice.entries).toEqual({ milk: { e: 'milk', tags: { 'alice:1': true } } })
    bob = groceries.merge(bob, alice)
    expect(groceries.value(bob)).toEqual(['milk'])

    // Alice removes milk: she tombstones the one tag she saw.
    alice = groceries.update(alice, { remove: 'milk' }, ctxA)
    expect(alice.tombstones).toEqual({ 'alice:1': true })
    expect(groceries.value(alice)).toEqual([])
    // The entry stays (the stage shows the dead tag); only presence changes.
    expect(orSetRows(alice)).toEqual([
      { key: 'milk', e: 'milk', tags: [{ tag: 'alice:1', alive: false }], present: false },
    ])

    // Concurrently Bob re-adds milk. His add mints a fresh tag bob:1.
    bob = groceries.update(bob, { add: 'milk' }, ctxB)
    expect(bob.entries).toEqual({
      milk: { e: 'milk', tags: { 'alice:1': true, 'bob:1': true } },
    })

    // Merge both directions: milk is present, with only bob:1 alive.
    const ab = groceries.merge(alice, bob)
    const ba = groceries.merge(bob, alice)
    expect(canon(ab)).toBe(canon(ba))
    expect(groceries.value(ab)).toEqual(['milk'])
    expect(orSetRows(ab)).toEqual([
      {
        key: 'milk',
        e: 'milk',
        tags: [
          { tag: 'alice:1', alive: false },
          { tag: 'bob:1', alive: true },
        ],
        present: true,
      },
    ])
    expect(ab.tombstones).toEqual({ 'alice:1': true })
  })

  it('concurrent add and remove of the same element: the add that was not observed survives', () => {
    let { alice, bob } = freshPair()
    const { ctxA, ctxB } = freshPair()
    // Both start with eggs (alice:1) after a sync.
    alice = groceries.update(alice, { add: 'eggs' }, ctxA)
    bob = groceries.merge(bob, alice)
    // Concurrently: Alice removes eggs; Bob adds eggs again (bob:1).
    alice = groceries.update(alice, { remove: 'eggs' }, ctxA)
    bob = groceries.update(bob, { add: 'eggs' }, ctxB)
    expect(groceries.value(alice)).toEqual([])
    expect(groceries.value(bob)).toEqual(['eggs'])
    const merged = groceries.merge(alice, bob)
    expect(groceries.value(merged)).toEqual(['eggs'])
    expect(orSetHas(merged, 'eggs')).toBe(true)
    expect(canon(groceries.merge(bob, alice))).toBe(canon(merged))
  })

  it('concurrent add and add: both tags are kept; one remove later kills only the tags it saw', () => {
    let { alice, bob } = freshPair()
    const { ctxA, ctxB } = freshPair()
    alice = groceries.update(alice, { add: 'bread' }, ctxA) // alice:1
    bob = groceries.update(bob, { add: 'bread' }, ctxB) // bob:1
    // Alice removes bread before seeing Bob's add: only alice:1 dies.
    alice = groceries.update(alice, { remove: 'bread' }, ctxA)
    const merged = groceries.merge(alice, bob)
    expect(orSetRows(merged)).toEqual([
      {
        key: 'bread',
        e: 'bread',
        tags: [
          { tag: 'alice:1', alive: false },
          { tag: 'bob:1', alive: true },
        ],
        present: true,
      },
    ])
    // Now that Alice has seen bob:1, a second remove kills it too.
    const gone = groceries.update(merged, { remove: 'bread' }, ctxA)
    expect(groceries.value(gone)).toEqual([])
    expect(gone.tombstones).toEqual({ 'alice:1': true, 'bob:1': true })
  })

  it('both replicas remove the same element concurrently: it is gone, and the states agree', () => {
    let { alice, bob } = freshPair()
    const { ctxA, ctxB } = freshPair()
    alice = groceries.update(alice, { add: 'milk' }, ctxA)
    bob = groceries.merge(bob, alice)
    alice = groceries.update(alice, { remove: 'milk' }, ctxA)
    bob = groceries.update(bob, { remove: 'milk' }, ctxB)
    const merged = groceries.merge(alice, bob)
    expect(groceries.value(merged)).toEqual([])
    expect(canon(merged)).toBe(canon(groceries.merge(bob, alice)))
    expect(merged.tombstones).toEqual({ 'alice:1': true })
  })

  it('add → remove → add on one replica re-adds with a fresh tag (a 2P-Set could not)', () => {
    const ctx = makeCtx('alice')
    let s = groceries.init('alice', undefined)
    s = groceries.update(s, { add: 'milk' }, ctx)
    s = groceries.update(s, { remove: 'milk' }, ctx)
    expect(groceries.value(s)).toEqual([])
    s = groceries.update(s, { add: 'milk' }, ctx)
    expect(groceries.value(s)).toEqual(['milk'])
    expect(orSetRows(s)[0]?.tags).toEqual([
      { tag: 'alice:1', alive: false },
      { tag: 'alice:2', alive: true },
    ])
  })

  it('merge is a union of entries/tags and of tombstones; a tombstone kills its tag everywhere', () => {
    let { alice, bob } = freshPair()
    const { ctxA, ctxB } = freshPair()
    alice = groceries.update(alice, { add: 'milk' }, ctxA)
    alice = groceries.update(alice, { add: 'eggs' }, ctxA)
    bob = groceries.update(bob, { add: 'bread' }, ctxB)
    const merged = groceries.merge(alice, bob)
    expect(groceries.value(merged)).toEqual(['bread', 'eggs', 'milk'])
    expect(Object.keys(merged.entries)).toEqual(['bread', 'eggs', 'milk'])
    // Carol has only the tombstone for alice:1 (say, via a gossip path that skipped the entry).
    const carol: OrSetState<string> = { entries: {}, tombstones: { 'alice:1': true } }
    const withCarol = groceries.merge(merged, carol)
    expect(groceries.value(withCarol)).toEqual(['bread', 'eggs'])
    expect(withCarol.entries['milk']).toEqual({ e: 'milk', tags: { 'alice:1': true } })
  })
})

describe('OR-Set: op-based use (prepare / effect)', () => {
  it('prepare(add) mints a tag; prepare(remove) lists the observed live tags', () => {
    const ctx = makeCtx('alice')
    let s = groceries.init('alice', undefined)
    const addOp = groceries.prepare(s, { add: 'milk' }, ctx)
    expect(addOp).toEqual({ add: 'milk', tag: 'alice:1' })
    s = groceries.effect(s, addOp)
    const rmOp = groceries.prepare(s, { remove: 'milk' }, ctx)
    expect(rmOp).toEqual({ remove: 'milk', tags: ['alice:1'] })
    s = groceries.effect(s, rmOp)
    expect(groceries.value(s)).toEqual([])
    // Dead tags are not "observed" any more: a second remove has nothing to tombstone.
    expect(groceries.prepare(s, { remove: 'milk' }, ctx)).toEqual({ remove: 'milk', tags: [] })
  })

  it('prepare(remove) of an absent element yields tags: [] and its effect is a no-op', () => {
    const ctx = makeCtx('alice')
    const s = groceries.init('alice', undefined)
    const op = groceries.prepare(s, { remove: 'ghost' }, ctx)
    expect(op).toEqual({ remove: 'ghost', tags: [] })
    const after = groceries.effect(s, op)
    expect(after).toBe(s)
    expect(ctx.seq).toBe(0) // removes do not consume sequence numbers
  })

  it('update(state, u) equals effect(state, prepare(state, u))', () => {
    const ctx1 = makeCtx('alice')
    const ctx2 = makeCtx('alice')
    let a = groceries.init('alice', undefined)
    let b = groceries.init('alice', undefined)
    for (const u of [
      { add: 'milk' },
      { add: 'eggs' },
      { remove: 'milk' },
      { add: 'milk' },
    ] satisfies OrSetUpdate<string>[]) {
      a = groceries.update(a, u, ctx1)
      b = groceries.effect(b, groceries.prepare(b, u, ctx2))
    }
    expect(canon(a)).toBe(canon(b))
  })

  it('concurrent ops commute: remove(alice:1) and add(bob:1) in either order', () => {
    let { alice, bob } = freshPair()
    const { ctxA, ctxB } = freshPair()
    const add1 = groceries.prepare(alice, { add: 'milk' }, ctxA)
    alice = groceries.effect(alice, add1)
    bob = groceries.effect(bob, add1)
    const rm = groceries.prepare(alice, { remove: 'milk' }, ctxA)
    const add2 = groceries.prepare(bob, { add: 'milk' }, ctxB)
    const x = groceries.effect(groceries.effect(alice, rm), add2)
    const y = groceries.effect(groceries.effect(alice, add2), rm)
    expect(canon(x)).toBe(canon(y))
    expect(groceries.value(x)).toEqual(['milk'])
  })

  it('effect is idempotent for a redelivered op', () => {
    const ctx = makeCtx('alice')
    const s0 = groceries.init('alice', undefined)
    const add = groceries.prepare(s0, { add: 'milk' }, ctx)
    const s1 = groceries.effect(s0, add)
    expect(canon(groceries.effect(s1, add))).toBe(canon(s1))
    const rm = groceries.prepare(s1, { remove: 'milk' }, ctx)
    const s2 = groceries.effect(s1, rm)
    expect(canon(groceries.effect(s2, rm))).toBe(canon(s2))
  })

  it('a remove that arrives before its add still wins over that exact tag (tombstones are global)', () => {
    const s0 = groceries.init('carol', undefined)
    const rm: OrSetOp<string> = { remove: 'milk', tags: ['alice:1'] }
    const add: OrSetOp<string> = { add: 'milk', tag: 'alice:1' }
    const s = groceries.effect(groceries.effect(s0, rm), add)
    expect(groceries.value(s)).toEqual([])
    expect(orSetRows(s)).toEqual([
      { key: 'milk', e: 'milk', tags: [{ tag: 'alice:1', alive: false }], present: false },
    ])
  })
})

describe('OR-Set: laws', () => {
  const elements = ['milk', 'eggs', 'bread'] as const
  const updateArb = () =>
    fc.oneof(
      fc.constantFrom(...elements).map((e): OrSetUpdate<string> => ({ add: e })),
      fc.constantFrom(...elements).map((e): OrSetUpdate<string> => ({ remove: e })),
    )
  const cfg = { type: groceries, args: undefined, updateArb }

  it('merge is commutative, associative, idempotent, inflationary', () => {
    assertMergeLaws(cfg)
  })
  it('state-based replicas converge', () => {
    assertConvergence(cfg)
  })
  it('op-based replicas converge under causal delivery', () => {
    assertOpConvergence(cfg)
  })

  it('holds for object elements too', () => {
    type Label = { name: string; color: string }
    const labels = orSetType<Label>()
    const labelArb = () =>
      fc.oneof(
        fc.constantFrom<Label>({ name: 'bug', color: 'red' }, { color: 'blue', name: 'docs' }),
        fc.constantFrom<Label>({ name: 'bug', color: 'red' }, { color: 'blue', name: 'docs' }),
      )
    const labelCfg = {
      type: labels,
      args: undefined,
      updateArb: () =>
        fc.oneof(
          labelArb().map((e): OrSetUpdate<Label> => ({ add: e })),
          labelArb().map((e): OrSetUpdate<Label> => ({ remove: e })),
        ),
      numRuns: 60,
    }
    assertMergeLaws(labelCfg)
    assertConvergence(labelCfg)
    assertOpConvergence(labelCfg)
  })
})

describe('OR-Set: edge cases', () => {
  it('init is empty, has a stable name, and satisfies the CrdtType contract', () => {
    const t: CrdtType<
      OrSetState<string>,
      OrSetUpdate<string>,
      OrSetOp<string>,
      string[],
      { seed?: ReadonlyArray<{ tag: `${string}:${number}`; e: string }> } | undefined
    > = groceries
    const c: OrSetCrdt<number> = orSetType<number>()
    expect(t.name).toBe('or-set')
    expect(c.name).toBe('or-set')
    expect(orSet.init('alice')).toEqual({ entries: {}, tombstones: {} })
    expect(groceries.value(groceries.init('alice', undefined))).toEqual([])
    expect(orSetRows(groceries.init('alice', undefined))).toEqual([])
  })

  it('seeds elements with explicit tags (lessons start scenes this way)', () => {
    const s = groceries.init('alice', { seed: [{ tag: 'seed:1', e: 'bug' }] })
    expect(s).toEqual({ entries: { bug: { e: 'bug', tags: { 'seed:1': true } } }, tombstones: {} })
    const ctx = makeCtx('alice')
    const removed = groceries.update(s, { remove: 'bug' }, ctx)
    expect(removed.tombstones).toEqual({ 'seed:1': true })
    expect(groceries.value(removed)).toEqual([])
  })

  it('value is sorted by key; rows sort tags by node then numeric seq', () => {
    const ctx = makeCtx('alice')
    let s = groceries.init('alice', undefined)
    for (const e of ['pear', 'apple', 'fig']) s = groceries.update(s, { add: e }, ctx)
    expect(groceries.value(s)).toEqual(['apple', 'fig', 'pear'])
    // Force a:10 vs a:2 ordering via explicit ops.
    let t = groceries.init('x', undefined)
    t = groceries.effect(t, { add: 'k', tag: 'a:10' })
    t = groceries.effect(t, { add: 'k', tag: 'a:2' })
    t = groceries.effect(t, { add: 'k', tag: 'b:1' })
    expect(orSetRows(t)[0]?.tags.map((x) => x.tag)).toEqual(['a:2', 'a:10', 'b:1'])
    expect(Object.keys(t.entries['k']?.tags ?? {})).toEqual(['a:2', 'a:10', 'b:1'])
  })

  it('keys: strings are their own key; objects are keyed by canonical JSON regardless of key order', () => {
    expect(keyOf('milk')).toBe('milk')
    expect(keyOf({ b: 2, a: 1 })).toBe('{"a":1,"b":2}')
    expect(keyOf([1, { z: 0, y: 1 }])).toBe('[1,{"y":1,"z":0}]')
    expect(keyOf(42)).toBe('42')
    const labels = orSetType<{ name: string; color: string }>()
    const ctxA = makeCtx('alice')
    const ctxB = makeCtx('bob')
    let a = labels.init('alice', undefined)
    let b = labels.init('bob', undefined)
    a = labels.update(a, { add: { name: 'bug', color: 'red' } }, ctxA)
    b = labels.update(b, { add: { color: 'red', name: 'bug' } }, ctxB)
    const m = labels.merge(a, b)
    expect(Object.keys(m.entries)).toEqual(['{"color":"red","name":"bug"}'])
    expect(labels.value(m)).toEqual([{ name: 'bug', color: 'red' }])
    // Removing with a differently-ordered but equal object removes it.
    const gone = labels.update(m, { remove: { color: 'red', name: 'bug' } }, ctxA)
    expect(labels.value(gone)).toEqual([])
  })

  it('never mutates its inputs', () => {
    const ctx = makeCtx('alice')
    const s0 = groceries.init('alice', undefined)
    const s1 = groceries.update(s0, { add: 'milk' }, ctx)
    const snap1 = canon(s1)
    const s2 = groceries.update(s1, { add: 'eggs' }, ctx)
    const s3 = groceries.update(s2, { remove: 'milk' }, ctx)
    const snap3 = canon(s3)
    groceries.merge(s1, s3)
    groceries.merge(s3, s1)
    groceries.effect(s3, { add: 'milk', tag: 'zed:9' })
    groceries.effect(s3, { remove: 'eggs', tags: ['alice:2'] })
    orSetRows(s3)
    groceries.value(s3)
    expect(canon(s0)).toBe('{"entries":{},"tombstones":{}}')
    expect(canon(s1)).toBe(snap1)
    expect(canon(s3)).toBe(snap3)
  })

  it('states are plain JSON: a round trip through JSON.stringify is lossless', () => {
    const ctx = makeCtx('alice')
    let s = groceries.init('alice', undefined)
    s = groceries.update(s, { add: 'milk' }, ctx)
    s = groceries.update(s, { remove: 'milk' }, ctx)
    s = groceries.update(s, { add: 'milk' }, ctx)
    const back = JSON.parse(JSON.stringify(s)) as OrSetState<string>
    expect(back).toEqual(s)
    expect(groceries.value(back)).toEqual(['milk'])
  })

  it('the same CrdtType object works for any element type', () => {
    const ctx = makeCtx('n')
    const nums = orSet.update(orSet.init<number>('n'), { add: 7 }, ctx)
    expect(orSet.value(nums)).toEqual([7])
    expect(orSetRows(nums)).toEqual([
      { key: '7', e: 7, tags: [{ tag: 'n:1', alive: true }], present: true },
    ])
  })
})
