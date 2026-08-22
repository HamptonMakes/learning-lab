import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { assertConvergence, assertMergeLaws, assertOpConvergence, canon } from './laws'
import {
  lwwElementSet,
  lwwElementSetHas,
  lwwElementSetRows,
  lwwElementSetType,
  type LwwBias,
  type LwwElementSetUpdate,
} from './lww-element-set'
import { makeCtx } from './types'

const ITEMS = ['apple', 'bread', 'milk', 'eggs'] as const
const itemArb = fc.constantFrom(...ITEMS)
const updateArb = (): fc.Arbitrary<LwwElementSetUpdate<string>> =>
  fc.oneof(
    itemArb.map((add) => ({ add })),
    itemArb.map((remove) => ({ remove })),
  )
const BIASES: LwwBias[] = ['add', 'remove']

function deepFreeze<T>(x: T): T {
  if (x && typeof x === 'object') {
    for (const v of Object.values(x as object)) deepFreeze(v)
    Object.freeze(x)
  }
  return x
}

describe('LWW-Element-Set: lesson examples', () => {
  it('add at t=1, remove at t=2 → gone; add again at t=3 → back (unlike the 2P-Set)', () => {
    const alice = makeCtx('alice')
    let a = lwwElementSet.init('alice', { bias: 'add' })
    a = lwwElementSet.update(a, { add: 'milk' }, alice.at(1))
    expect(lwwElementSet.value(a)).toEqual(['milk'])
    a = lwwElementSet.update(a, { remove: 'milk' }, alice.at(2))
    expect(lwwElementSet.value(a)).toEqual([])
    a = lwwElementSet.update(a, { add: 'milk' }, alice.at(3))
    expect(lwwElementSet.value(a)).toEqual(['milk'])
    expect(a).toEqual({
      adds: { milk: { e: 'milk', ts: 3, node: 'alice' } },
      removes: { milk: { ts: 2, node: 'alice' } },
      bias: 'add',
    })
  })

  it('concurrent add (Alice t=5) vs remove (Bob t=7): the later stamp wins, either merge order', () => {
    const alice = makeCtx('alice')
    const bob = makeCtx('bob')
    let a = lwwElementSet.init('alice', { bias: 'add' })
    let b = lwwElementSet.init('bob', { bias: 'add' })
    a = lwwElementSet.update(a, { add: 'milk' }, alice.at(1))
    b = lwwElementSet.merge(b, a)
    a = lwwElementSet.update(a, { add: 'milk' }, alice.at(5))
    b = lwwElementSet.update(b, { remove: 'milk' }, bob.at(7))
    const ab = lwwElementSet.merge(a, b)
    const ba = lwwElementSet.merge(b, a)
    expect(canon(ab)).toBe(canon(ba))
    expect(lwwElementSet.value(ab)).toEqual([])
    // and the other way round: a later add beats an earlier remove
    const a2 = lwwElementSet.update(a, { add: 'milk' }, alice.at(9))
    expect(lwwElementSet.value(lwwElementSet.merge(a2, b))).toEqual(['milk'])
    expect(lwwElementSet.value(lwwElementSet.merge(b, a2))).toEqual(['milk'])
  })

  it('removing something you never saw is allowed: it hides older adds and yields to newer ones', () => {
    const bob = makeCtx('bob')
    let b = lwwElementSet.init('bob', { bias: 'add' })
    b = lwwElementSet.update(b, { remove: 'eggs' }, bob.at(5))
    expect(lwwElementSet.value(b)).toEqual([])
    expect(b.removes).toEqual({ eggs: { ts: 5, node: 'bob' } })
    const alice = makeCtx('alice')
    const older = lwwElementSet.update(
      lwwElementSet.init('alice', { bias: 'add' }),
      { add: 'eggs' },
      alice.at(3),
    )
    const newer = lwwElementSet.update(
      lwwElementSet.init('alice', { bias: 'add' }),
      { add: 'eggs' },
      alice.at(8),
    )
    expect(lwwElementSet.value(lwwElementSet.merge(b, older))).toEqual([])
    expect(lwwElementSet.value(lwwElementSet.merge(b, newer))).toEqual(['eggs'])
  })

  it('tie at the same ts from different nodes: bias decides, not node id', () => {
    const alice = makeCtx('alice')
    const bob = makeCtx('bob')
    for (const bias of BIASES) {
      const expected = bias === 'add' ? ['milk'] : []
      // Alice adds, Bob removes, both at t=4
      const a = lwwElementSet.update(
        lwwElementSet.init('alice', { bias }),
        { add: 'milk' },
        alice.at(4),
      )
      const b = lwwElementSet.update(
        lwwElementSet.init('bob', { bias }),
        { remove: 'milk' },
        bob.at(4),
      )
      expect(lwwElementSet.value(lwwElementSet.merge(a, b))).toEqual(expected)
      expect(lwwElementSet.value(lwwElementSet.merge(b, a))).toEqual(expected)
      // swap roles: Bob adds, Alice removes → same answer, because node ids do not matter here
      const a2 = lwwElementSet.update(
        lwwElementSet.init('alice', { bias }),
        { remove: 'milk' },
        alice.at(4),
      )
      const b2 = lwwElementSet.update(
        lwwElementSet.init('bob', { bias }),
        { add: 'milk' },
        bob.at(4),
      )
      expect(lwwElementSet.value(lwwElementSet.merge(a2, b2))).toEqual(expected)
      expect(lwwElementSet.value(lwwElementSet.merge(b2, a2))).toEqual(expected)
    }
  })

  it('identical stamps (same node, same ts): bias decides here too', () => {
    const alice = makeCtx('alice')
    let add = lwwElementSet.init('alice', { bias: 'add' })
    add = lwwElementSet.update(add, { add: 'milk' }, alice.at(4))
    add = lwwElementSet.update(add, { remove: 'milk' }, alice.at(4))
    expect(lwwElementSet.value(add)).toEqual(['milk'])
    expect(lwwElementSetHas(add, 'milk')).toBe(true)

    let rm = lwwElementSet.init('alice', { bias: 'remove' })
    rm = lwwElementSet.update(rm, { remove: 'milk' }, alice.at(4))
    rm = lwwElementSet.update(rm, { add: 'milk' }, alice.at(4))
    expect(lwwElementSet.value(rm)).toEqual([])
    expect(lwwElementSetHas(rm, 'milk')).toBe(false)
  })

  it('op-based: ops carry their stamp; any delivery order and duplicates give the same state', () => {
    const alice = makeCtx('alice')
    const bob = makeCtx('bob')
    const a0 = lwwElementSet.init('alice', { bias: 'add' })
    const addOp = lwwElementSet.prepare(a0, { add: 'bread' }, alice.at(2))
    expect(addOp).toEqual({ add: 'bread', ts: 2, node: 'alice' })
    const removeOp = lwwElementSet.prepare(a0, { remove: 'bread' }, bob.at(6))
    expect(removeOp).toEqual({ remove: 'bread', ts: 6, node: 'bob' })

    const c0 = lwwElementSet.init('carol', { bias: 'add' })
    const addFirst = lwwElementSet.effect(lwwElementSet.effect(c0, addOp), removeOp)
    const removeFirst = lwwElementSet.effect(lwwElementSet.effect(c0, removeOp), addOp)
    expect(canon(addFirst)).toBe(canon(removeFirst))
    expect(lwwElementSet.value(addFirst)).toEqual([])
    expect(lwwElementSet.effect(addFirst, addOp)).toBe(addFirst)
    expect(lwwElementSet.effect(addFirst, removeOp)).toBe(addFirst)
    // update ≡ effect(prepare())
    expect(canon(lwwElementSet.update(a0, { add: 'bread' }, alice.at(2)))).toBe(
      canon(lwwElementSet.effect(a0, addOp)),
    )
  })

  it('an older add arriving later does not overwrite a newer add (per-side max)', () => {
    const alice = makeCtx('alice')
    const bob = makeCtx('bob')
    const s0 = lwwElementSet.init('carol', { bias: 'add' })
    const newer = lwwElementSet.effect(s0, lwwElementSet.prepare(s0, { add: 'milk' }, bob.at(9)))
    const both = lwwElementSet.effect(
      newer,
      lwwElementSet.prepare(s0, { add: 'milk' }, alice.at(3)),
    )
    expect(both).toBe(newer)
    expect(both.adds).toEqual({ milk: { e: 'milk', ts: 9, node: 'bob' } })
  })
})

describe.each(BIASES)('LWW-Element-Set: laws (bias %s)', (bias) => {
  it('merge is commutative, associative, idempotent', () => {
    assertMergeLaws({ type: lwwElementSet, args: { bias }, updateArb })
  })
  it('replicas converge under random gossip', () => {
    assertConvergence({ type: lwwElementSet, args: { bias }, updateArb })
  })
  it('ops converge in any order', () => {
    assertOpConvergence({ type: lwwElementSet, args: { bias }, updateArb })
  })
})

describe('LWW-Element-Set: edge cases', () => {
  it('fresh state carries only the bias', () => {
    expect(lwwElementSet.init('alice', { bias: 'add' })).toEqual({
      adds: {},
      removes: {},
      bias: 'add',
    })
    expect(lwwElementSet.init('alice', { bias: 'remove' })).toEqual({
      adds: {},
      removes: {},
      bias: 'remove',
    })
    expect(lwwElementSet.value(lwwElementSet.init('alice', { bias: 'add' }))).toEqual([])
  })

  it('merging replicas with different biases is a programming error', () => {
    const a = lwwElementSet.init('alice', { bias: 'add' })
    const b = lwwElementSet.init('bob', { bias: 'remove' })
    expect(() => lwwElementSet.merge(a, b)).toThrow(/bias/)
  })

  it('never mutates its inputs', () => {
    const alice = makeCtx('alice')
    let a = lwwElementSet.init('alice', { bias: 'add' })
    a = lwwElementSet.update(a, { add: 'milk' }, alice.at(1))
    a = lwwElementSet.update(a, { remove: 'eggs' }, alice.at(2))
    deepFreeze(a)
    const b = deepFreeze(
      lwwElementSet.update(
        lwwElementSet.init('bob', { bias: 'add' }),
        { add: 'eggs' },
        makeCtx('bob', 3),
      ),
    )
    expect(() => lwwElementSet.update(a, { remove: 'milk' }, alice.at(5))).not.toThrow()
    expect(() => lwwElementSet.update(a, { add: 'bread' }, alice.at(5))).not.toThrow()
    expect(() => lwwElementSet.merge(a, b)).not.toThrow()
    expect(() => lwwElementSet.effect(a, { add: 'milk', ts: 9, node: 'zed' })).not.toThrow()
    expect(lwwElementSet.value(a)).toEqual(['milk'])
  })

  it('state is canonical and JSON-serializable', () => {
    const alice = makeCtx('alice')
    let s = lwwElementSet.init('alice', { bias: 'add' })
    for (const e of ['milk', 'apple', 'eggs']) s = lwwElementSet.update(s, { add: e }, alice.at(1))
    for (const e of ['milk', 'apple']) s = lwwElementSet.update(s, { remove: e }, alice.at(2))
    expect(Object.keys(s.adds)).toEqual(['apple', 'eggs', 'milk'])
    expect(Object.keys(s.removes)).toEqual(['apple', 'milk'])
    expect(JSON.parse(JSON.stringify(s))).toEqual(s)
  })

  it('rows: one per added element with stamps and presence, sorted by key', () => {
    const alice = makeCtx('alice')
    const bob = makeCtx('bob')
    let s = lwwElementSet.init('alice', { bias: 'add' })
    s = lwwElementSet.update(s, { add: 'milk' }, alice.at(1))
    s = lwwElementSet.update(s, { add: 'apple' }, alice.at(2))
    s = lwwElementSet.effect(s, { remove: 'milk', ts: 3, node: 'bob' })
    s = lwwElementSet.effect(s, { remove: 'bread', ts: 4, node: 'bob' }) // remove-only: not a row
    s = lwwElementSet.update(s, { add: 'eggs' }, bob.at(5))
    s = lwwElementSet.update(s, { remove: 'eggs' }, bob.at(5)) // identical stamp → bias 'add' keeps it
    expect(lwwElementSetRows(s)).toEqual([
      { key: 'apple', e: 'apple', addTs: 2, addNode: 'alice', present: true },
      {
        key: 'eggs',
        e: 'eggs',
        addTs: 5,
        addNode: 'bob',
        removeTs: 5,
        removeNode: 'bob',
        present: true,
      },
      {
        key: 'milk',
        e: 'milk',
        addTs: 1,
        addNode: 'alice',
        removeTs: 3,
        removeNode: 'bob',
        present: false,
      },
    ])
    expect(Object.keys(s.removes)).toEqual(['bread', 'eggs', 'milk'])
  })

  it('generic elements: objects identified by canonical JSON', () => {
    type Item = { id: number; name: string }
    const items = lwwElementSetType<Item>()
    const alice = makeCtx('alice')
    let s = items.init('alice', { bias: 'add' })
    s = items.update(s, { add: { id: 1, name: 'milk' } }, alice.at(1))
    s = items.update(s, { remove: { name: 'milk', id: 1 } }, alice.at(2))
    expect(items.value(s)).toEqual([])
    s = items.update(s, { add: { name: 'milk', id: 1 } }, alice.at(3))
    expect(items.value(s)).toEqual([{ name: 'milk', id: 1 }])
    expect(Object.keys(s.adds)).toEqual(['{"id":1,"name":"milk"}'])
  })

  it('property: value matches a brute-force "latest ts per side, bias on ties" model (both biases)', () => {
    type Stamp = { ts: number; node: string }
    const cmp = (a: Stamp, b: Stamp) =>
      a.ts !== b.ts ? a.ts - b.ts : a.node < b.node ? -1 : a.node > b.node ? 1 : 0
    const eventArb = fc.record({
      node: fc.constantFrom('alice', 'bob', 'carol'),
      ts: fc.integer({ min: 1, max: 4 }),
      u: updateArb(),
    })
    for (const bias of BIASES) {
      fc.assert(
        fc.property(fc.array(eventArb, { maxLength: 20 }), (events) => {
          let s = lwwElementSet.init('x', { bias })
          const adds = new Map<string, Stamp>()
          const removes = new Map<string, Stamp>()
          for (const ev of events) {
            s = lwwElementSet.effect(s, lwwElementSet.prepare(s, ev.u, makeCtx(ev.node, ev.ts)))
            const side = 'add' in ev.u ? adds : removes
            const k = 'add' in ev.u ? ev.u.add : ev.u.remove
            const cur = side.get(k)
            if (!cur || cmp({ ts: ev.ts, node: ev.node }, cur) > 0)
              side.set(k, { ts: ev.ts, node: ev.node })
          }
          const expected = [...adds.entries()]
            .filter(([k, a]) => {
              const r = removes.get(k)
              if (!r) return true
              return a.ts !== r.ts ? a.ts > r.ts : bias === 'add'
            })
            .map(([k]) => k)
            .sort()
          expect(lwwElementSet.value(s)).toEqual(expected)
        }),
      )
    }
  })
})
