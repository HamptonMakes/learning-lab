/** Composed documents: the shopping-list scenario, lists, paths, op-based delivery, and the laws. */
import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import {
  docCrdt,
  docEquals,
  docPartAt,
  docParts,
  docSchemaAt,
  formatDocPath,
  leafUpdateFor,
  normalizeDocSchema,
  parseDocPath,
  type DocOp,
  type DocSchema,
  type DocState,
  type DocUpdate,
} from './doc'
import { assertConvergence, assertMergeLaws, assertOpConvergence, canon } from './laws'
import { makeCtx, type CrdtType, type Ctx, type Dot, type NodeId } from './types'

const shopping: DocSchema = {
  map: {
    title: 'lww-register',
    items: { set: { map: { name: 'lww-register', qty: 'pn-counter' } } },
  },
}

const todo: DocSchema = { list: { map: { text: 'lww-register', done: 'max-register' } } }

const init = (node: NodeId, schema: DocSchema = shopping) => docCrdt.init(node, { schema })
const up = (s: DocState, u: DocUpdate, ctx: Ctx) => docCrdt.update(s, u, ctx)
const value = (s: DocState) => docCrdt.value(s)

describe('doc: the shopping list', () => {
  it('starts empty: every part is the empty state of its type', () => {
    const s = init('alice')
    expect(value(s)).toEqual({ title: null, items: [] })
    expect(s.root.kind).toBe('map')
    expect(docPartAt(s, 'title')).toEqual({
      kind: 'leaf',
      type: 'lww-register',
      state: { value: null, ts: -1, node: '' },
    })
    expect(docPartAt(s, 'items')?.kind).toBe('set')
  })

  it('add(init) creates a sub-document whose id is the add tag; init writes the registers', () => {
    const ctx = makeCtx('alice', 1)
    const s = up(init('alice'), { path: 'items', op: 'add', args: [{ name: 'milk' }] }, ctx)
    expect(ctx.seq).toBe(1) // exactly one seq minted: the sub-document id is alice:1
    expect(value(s)).toEqual({ title: null, items: [{ id: 'alice:1', name: 'milk', qty: 0 }] })
    expect(docPartAt(s, 'items[alice:1].name')).toEqual({
      kind: 'leaf',
      type: 'lww-register',
      state: { value: 'milk', ts: 1, node: 'alice' }, // the adder's stamp
    })
    expect(docPartAt(s, 'items[alice:1].qty')).toEqual({
      kind: 'leaf',
      type: 'pn-counter',
      state: { p: { counts: {} }, n: { counts: {} } }, // counters start at 0
    })
  })

  it('alice adds milk, bob adds bread, alice bumps milk — merge both ways gives the same list', () => {
    const ca = makeCtx('alice', 1)
    const cb = makeCtx('bob', 1)
    let alice = up(init('alice'), { path: 'items', op: 'add', args: [{ name: 'milk' }] }, ca)
    let bob = up(init('bob'), { path: 'items', op: 'add', args: [{ name: 'bread' }] }, cb)
    alice = up(alice, { path: 'items[alice:1].qty', op: 'inc' }, ca.at(2))
    alice = up(alice, { path: 'items[alice:1].qty', op: 'inc', args: [2] }, ca.at(3))
    alice = up(alice, { path: 'title', op: 'set', args: ['Saturday'] }, ca.at(4))

    const ab = docCrdt.merge(alice, bob)
    const ba = docCrdt.merge(bob, alice)
    const expected = {
      title: 'Saturday',
      items: [
        { id: 'alice:1', name: 'milk', qty: 3 },
        { id: 'bob:1', name: 'bread', qty: 0 },
      ],
    }
    expect(value(ab)).toEqual(expected)
    expect(value(ba)).toEqual(expected)
    expect(canon(ab)).toBe(canon(ba))
    expect(docEquals(ab, ba)).toBe(true)
    // a sub-document only one side knew is copied, the shared structure is merged
    expect(docPartAt(ab, 'items[bob:1].name')).toEqual(docPartAt(bob, 'items[bob:1].name'))
  })

  it('remove(id) takes the item out of the value; its sub-document stays as a tombstone', () => {
    const ca = makeCtx('alice', 1)
    let alice = up(init('alice'), { path: 'items', op: 'add', args: [{ name: 'milk' }] }, ca)
    alice = up(alice, { path: 'items', op: 'add', args: [{ name: 'eggs' }] }, ca)
    const bob = docCrdt.merge(init('bob'), alice)
    const bob2 = up(bob, { path: 'items', op: 'remove', args: ['alice:1'] }, makeCtx('bob', 5))
    expect(value(bob2)).toEqual({ title: null, items: [{ id: 'alice:2', name: 'eggs', qty: 0 }] })
    expect(docPartAt(bob2, 'items[alice:1]')).toBeDefined()
    const parts = docParts(bob2)
    expect(parts.find((p) => p.path === 'items[alice:1]')?.alive).toBe(false)
    expect(parts.find((p) => p.path === 'items[alice:1].name')?.alive).toBe(false)
    expect(parts.find((p) => p.path === 'items[alice:2]')?.alive).toBe(true)
    // the remove reaches alice by merge
    expect(value(docCrdt.merge(alice, bob2))).toEqual(value(bob2))
  })

  it('a concurrent edit to a removed item lands in the tombstone; the remove still wins', () => {
    const ca = makeCtx('alice', 1)
    let alice = up(init('alice'), { path: 'items', op: 'add', args: [{ name: 'milk' }] }, ca)
    let bob = docCrdt.merge(init('bob'), alice)
    bob = up(bob, { path: 'items', op: 'remove', args: ['alice:1'] }, makeCtx('bob', 2))
    alice = up(alice, { path: 'items[alice:1].qty', op: 'inc', args: [4] }, ca.at(3))
    const m1 = docCrdt.merge(alice, bob)
    const m2 = docCrdt.merge(bob, alice)
    expect(value(m1)).toEqual({ title: null, items: [] })
    expect(canon(m1)).toBe(canon(m2))
    const qty = docPartAt(m1, 'items[alice:1].qty')
    expect(qty).toEqual({
      kind: 'leaf',
      type: 'pn-counter',
      state: { p: { counts: { alice: 4 } }, n: { counts: {} } },
    })
  })

  it('nested path updates: set a register inside a sub-document, LWW decides the name', () => {
    const ca = makeCtx('alice', 1)
    const cb = makeCtx('bob', 1)
    let alice = up(init('alice'), { path: 'items', op: 'add', args: [{ name: 'milk' }] }, ca)
    let bob = docCrdt.merge(init('bob'), alice)
    alice = up(alice, { path: 'items[alice:1].name', op: 'set', args: ['oat milk'] }, ca.at(5))
    bob = up(bob, { path: 'items[alice:1].name', op: 'set', args: ['soy milk'] }, cb.at(4))
    expect(value(docCrdt.merge(alice, bob))).toEqual({
      title: null,
      items: [{ id: 'alice:1', name: 'oat milk', qty: 0 }],
    })
    expect(value(docCrdt.merge(bob, alice))).toEqual(value(docCrdt.merge(alice, bob)))
  })

  it('removing an unknown id is a no-op (like the OR-Set); the state object is kept', () => {
    const s = init('alice')
    expect(up(s, { path: 'items', op: 'remove', args: ['bob:9'] }, makeCtx('alice', 1))).toBe(s)
  })

  it('docParts walks in canonical order with the backing type and state of each part', () => {
    const ca = makeCtx('alice', 1)
    let s = up(init('alice'), { path: 'items', op: 'add', args: [{ name: 'milk' }] }, ca)
    s = up(s, { path: 'title', op: 'set', args: ['Sat'] }, ca.at(2))
    const parts = docParts(s)
    expect(parts.map((p) => [p.path, p.kind, p.type ?? null])).toEqual([
      ['', 'map', null],
      ['items', 'set', 'or-set'],
      ['items[alice:1]', 'map', null],
      ['items[alice:1].name', 'leaf', 'lww-register'],
      ['items[alice:1].qty', 'leaf', 'pn-counter'],
      ['title', 'leaf', 'lww-register'],
    ])
    expect(parts[1]?.state).toBe((docPartAt(s, 'items') as { membership: unknown }).membership)
    expect(parts[5]?.state).toEqual({ value: 'Sat', ts: 2, node: 'alice' })
    expect(parts.every((p) => p.alive)).toBe(true)
  })
})

describe('doc: lists', () => {
  it('insertAt / insertAfter keep sequence order; delete by id', () => {
    const ca = makeCtx('alice', 1)
    let s = init('alice', todo)
    expect(value(s)).toEqual([])
    s = up(s, { op: 'insertAt', args: [0, { text: 'buy milk' }] }, ca.at(1)) // alice:1
    s = up(s, { op: 'insertAt', args: [1, { text: 'call mum' }] }, ca.at(2)) // alice:2
    s = up(s, { op: 'insertAfter', args: ['HEAD', { text: 'wake up' }] }, ca.at(3)) // alice:3
    expect(value(s)).toEqual([
      { id: 'alice:3', text: 'wake up', done: null },
      { id: 'alice:1', text: 'buy milk', done: null },
      { id: 'alice:2', text: 'call mum', done: null },
    ])
    s = up(s, { path: '[alice:1].done', op: 'set', args: [1] }, ca.at(4))
    s = up(s, { op: 'delete', args: ['alice:3'] }, ca.at(5))
    expect(value(s)).toEqual([
      { id: 'alice:1', text: 'buy milk', done: 1 },
      { id: 'alice:2', text: 'call mum', done: null },
    ])
    // the deleted element keeps its sub-document, flagged dead
    expect(docParts(s).find((p) => p.path === '[alice:3].text')?.alive).toBe(false)
    expect(docParts(s)[0]?.type).toBe('rga')
  })

  it('concurrent inserts at the same spot merge the same way on both sides', () => {
    const ca = makeCtx('alice', 1)
    const cb = makeCtx('bob', 1)
    let alice = up(init('alice', todo), { op: 'insertAt', args: [0, { text: 'a' }] }, ca.at(1))
    let bob = docCrdt.merge(init('bob', todo), alice)
    alice = up(alice, { op: 'insertAt', args: [1, { text: 'a2' }] }, ca.at(2))
    bob = up(bob, { op: 'insertAt', args: [1, { text: 'b2' }] }, cb.at(3))
    const ab = docCrdt.merge(alice, bob)
    const ba = docCrdt.merge(bob, alice)
    expect(canon(ab)).toBe(canon(ba))
    expect((value(ab) as Array<{ text: string }>).map((x) => x.text)).toEqual(['a', 'b2', 'a2'])
  })

  it('items that are not maps are shown as { id, value }', () => {
    const s = up(
      init('alice', { list: 'lww-register' }),
      { op: 'insertAt', args: [0] },
      makeCtx('alice', 1),
    )
    const s2 = up(s, { path: '[alice:1]', op: 'set', args: ['x'] }, makeCtx('alice', 2))
    expect(value(s2)).toEqual([{ id: 'alice:1', value: 'x' }])
  })
})

describe('doc: schema shapes', () => {
  it('a leaf at the root: the document is that leaf', () => {
    const s = up(init('alice', 'g-counter'), { op: 'inc', args: [3] }, makeCtx('alice', 1))
    expect(value(s)).toBe(3)
    expect(docParts(s)).toHaveLength(1)
  })

  it('const parts are fixed labels and cannot be updated', () => {
    const poll: DocSchema = { map: { question: { const: 'Lunch?' }, yes: 'g-counter' } }
    const s = up(init('alice', poll), { path: 'yes', op: 'inc' }, makeCtx('alice', 1))
    expect(value(s)).toEqual({ question: 'Lunch?', yes: 1 })
    expect(() => up(s, { path: 'question', op: 'set', args: ['x'] }, makeCtx('alice', 2))).toThrow(
      /const/,
    )
    const m = docCrdt.merge(s, init('bob', poll))
    expect(value(m)).toEqual({ question: 'Lunch?', yes: 1 })
  })

  it('leaf args reach the leaf init; dotted init keys write nested registers', () => {
    const schema: DocSchema = {
      map: {
        tags: { type: 'lww-element-set', args: { bias: 'add' } },
        people: { set: { map: { meta: { map: { color: 'lww-register' } }, n: 'g-counter' } } },
      },
    }
    const ca = makeCtx('alice', 1)
    let s = up(init('alice', schema), { path: 'tags', op: 'add', args: ['x'] }, ca)
    expect((docPartAt(s, 'tags') as { state: { bias: string } }).state.bias).toBe('add')
    s = up(s, { path: 'people', op: 'add', args: [{ 'meta.color': 'red' }] }, ca.at(2))
    expect(value(s)).toEqual({
      tags: ['x'],
      people: [{ id: 'alice:1', meta: { color: 'red' }, n: 0 }],
    })
  })

  it('init may only write registers; non-register fields throw before a seq is minted', () => {
    const ctx = makeCtx('alice', 1)
    expect(() => up(init('alice'), { path: 'items', op: 'add', args: [{ qty: 2 }] }, ctx)).toThrow(
      /register/,
    )
    expect(() =>
      up(init('alice'), { path: 'items', op: 'add', args: [{ name: { a: 1 } }] }, ctx),
    ).toThrow(/scalar/)
    expect(ctx.seq).toBe(0)
  })

  it('normalizeDocSchema sorts map keys and rejects bad shapes', () => {
    expect(normalizeDocSchema({ map: { b: 'g-counter', a: 'lww-register' } })).toEqual({
      map: { a: 'lww-register', b: 'g-counter' },
    })
    expect(
      Object.keys(
        (normalizeDocSchema({ map: { b: 'g-counter', a: 'lww-register' } }) as { map: object }).map,
      ),
    ).toEqual(['a', 'b'])
    expect(() => normalizeDocSchema('doc' as DocSchema)).toThrow(/unknown type/)
    expect(() => normalizeDocSchema({ map: { 'a.b': 'g-counter' } })).toThrow(/bad field name/)
    expect(() => normalizeDocSchema({ const: { x: 1 } as unknown as string })).toThrow(/scalar/)
    expect(() => init('alice', { items: 'g-counter' } as unknown as DocSchema)).toThrow(/expected/)
  })

  it('docSchemaAt resolves item schemas through [id] segments', () => {
    expect(docSchemaAt(shopping, 'items[alice:1].qty')).toBe('pn-counter')
    expect(docSchemaAt(todo, '[x:1]')).toEqual({
      map: { text: 'lww-register', done: 'max-register' },
    })
    expect(() => docSchemaAt(shopping, 'items.qty')).toThrow(/does not fit/)
  })

  it('merging documents with different schemas throws', () => {
    expect(() => docCrdt.merge(init('alice'), init('bob', todo))).toThrow(/different schemas/)
  })
})

describe('doc: paths and the op vocabulary', () => {
  it('parseDocPath / formatDocPath round-trip', () => {
    expect(parseDocPath('')).toEqual([])
    expect(parseDocPath('title')).toEqual([{ key: 'title' }])
    expect(parseDocPath('items[alice:1].qty')).toEqual([
      { key: 'items' },
      { id: 'alice:1' },
      { key: 'qty' },
    ])
    expect(parseDocPath('[bob:2][carol:3]')).toEqual([{ id: 'bob:2' }, { id: 'carol:3' }])
    for (const p of ['', 'a', 'a.b', 'a[x:1]', '[x:1].b.c', 'a[x:1][y:2].z']) {
      expect(formatDocPath(parseDocPath(p))).toBe(p)
    }
    expect(() => parseDocPath('.a')).toThrow(/bad path/)
    expect(() => parseDocPath('a..b')).toThrow(/bad path/)
    expect(() => parseDocPath('a[x:1')).toThrow(/bad path/)
    expect(() => parseDocPath('a[1]')).toThrow(/not an id/)
    expect(() => parseDocPath('a b')).not.toThrow()
  })

  it('unknown paths, ops and arities throw clear errors', () => {
    const ctx = makeCtx('alice', 1)
    expect(() => up(init('alice'), { path: 'nope', op: 'set', args: [1] }, ctx)).toThrow(
      /does not resolve/,
    )
    expect(() => up(init('alice'), { path: 'items[bob:1].qty', op: 'inc' }, ctx)).toThrow(
      /does not resolve/,
    )
    expect(() => up(init('alice'), { path: 'title', op: 'inc' }, ctx)).toThrow(/unknown op/)
    expect(() => up(init('alice'), { path: 'title', op: 'set' }, ctx)).toThrow(/argument/)
    expect(() => up(init('alice'), { path: 'items', op: 'insertAt', args: [0] }, ctx)).toThrow(
      /unknown op/,
    )
    expect(() => up(init('alice'), { path: '', op: 'set', args: [1] }, ctx)).toThrow(/map/)
    expect(() => up(init('alice', todo), { op: 'insertAfter', args: ['zed:9'] }, ctx)).toThrow(
      /no such element/,
    )
  })

  it('leafUpdateFor follows the per-type vocabulary', () => {
    expect(leafUpdateFor('lww-register', 'set', ['x'])).toEqual({ set: 'x' })
    expect(leafUpdateFor('max-register', 'set', [3])).toEqual({ set: 3 })
    expect(leafUpdateFor('lww-map', 'set', ['k', 1])).toEqual({ key: 'k', set: 1 })
    expect(leafUpdateFor('lww-map', 'remove', ['k'])).toEqual({ key: 'k', remove: true })
    expect(leafUpdateFor('g-counter', 'inc', [])).toEqual({ inc: 1 })
    expect(leafUpdateFor('pn-counter', 'dec', [2])).toEqual({ dec: 2 })
    expect(leafUpdateFor('op-counter', 'dec', [2])).toEqual({ add: -2 })
    expect(leafUpdateFor('op-counter', 'inc', [])).toEqual({ add: 1 })
    expect(leafUpdateFor('or-set', 'remove', ['milk'])).toEqual({ remove: 'milk' })
    expect(leafUpdateFor('rga', 'insertAfter', ['HEAD', 'a'])).toEqual({
      insertAfter: 'HEAD',
      value: 'a',
    })
    expect(leafUpdateFor('rga', 'deleteAt', [0])).toEqual({ deleteAt: 0 })
    expect(leafUpdateFor('vector-clock', 'tick', [])).toEqual({ tick: true })
    expect(leafUpdateFor('hlc', 'tick', [])).toEqual({ tick: true })
    expect(() => leafUpdateFor('hlc', 'receive', [1])).toThrow(/unknown op/)
    expect(() => leafUpdateFor('g-counter', 'inc', [1, 2])).toThrow(/argument/)
    expect(() => leafUpdateFor('g-set', 'remove', ['x'])).toThrow(/unknown op/)
  })
})

describe('doc: op-based', () => {
  it('the add op carries the sub-document; effect recreates it exactly at another replica', () => {
    const ca = makeCtx('alice', 7)
    const a0 = init('alice')
    const op = docCrdt.prepare(a0, { path: 'items', op: 'add', args: [{ name: 'milk' }] }, ca)
    expect(op.kind).toBe('set')
    if (op.kind !== 'set') throw new Error('unreachable')
    expect(op.op).toEqual({ add: 'alice:1', tag: 'alice:1' })
    expect(op.sub).toEqual({
      id: 'alice:1',
      init: { name: 'milk' },
      ops: [{ path: 'name', op: { set: 'milk', ts: 7, node: 'alice' } }],
    })
    const a1 = docCrdt.effect(a0, op)
    const b1 = docCrdt.effect(init('bob'), op)
    expect(canon(a1)).toBe(canon(b1))
    expect(canon(a1)).toBe(
      canon(up(a0, { path: 'items', op: 'add', args: [{ name: 'milk' }] }, makeCtx('alice', 7))),
    )
    // replaying the add changes nothing, and later edits are not undone by a replay
    const a2 = up(a1, { path: 'items[alice:1].qty', op: 'inc' }, ca.at(8))
    expect(canon(docCrdt.effect(a2, op))).toBe(canon(a2))
    expect(JSON.parse(JSON.stringify(op))).toEqual(op)
  })

  it('leaf ops travel with their path; concurrent effects commute', () => {
    const ca = makeCtx('alice', 1)
    const cb = makeCtx('bob', 1)
    const add = docCrdt.prepare(
      init('alice'),
      { path: 'items', op: 'add', args: [{ name: 'milk' }] },
      ca,
    )
    const alice = docCrdt.effect(init('alice'), add)
    const bob = docCrdt.effect(init('bob'), add)
    const incA: DocOp = docCrdt.prepare(alice, { path: 'items[alice:1].qty', op: 'inc' }, ca.at(2))
    const incB: DocOp = docCrdt.prepare(
      bob,
      { path: 'items[alice:1].qty', op: 'inc', args: [5] },
      cb.at(2),
    )
    const titleB = docCrdt.prepare(bob, { path: 'title', op: 'set', args: ['Sat'] }, cb.at(3))
    const x = [incA, incB, titleB].reduce((s, o) => docCrdt.effect(s, o), alice)
    const y = [titleB, incB, incA].reduce((s, o) => docCrdt.effect(s, o), bob)
    expect(canon(x)).toBe(canon(y))
    expect(value(x)).toEqual({ title: 'Sat', items: [{ id: 'alice:1', name: 'milk', qty: 6 }] })
  })

  it('an op for a sub-document that has not arrived yet throws (causal delivery required)', () => {
    const ca = makeCtx('alice', 1)
    const add = docCrdt.prepare(
      init('alice'),
      { path: 'items', op: 'add', args: [{ name: 'milk' }] },
      ca,
    )
    const alice = docCrdt.effect(init('alice'), add)
    const inc = docCrdt.prepare(alice, { path: 'items[alice:1].qty', op: 'inc' }, ca.at(2))
    expect(() => docCrdt.effect(init('bob'), inc)).toThrow(/delivered causally/)
  })

  it('states and ops are JSON-safe and round-trip structurally', () => {
    const ca = makeCtx('alice', 1)
    let s = up(init('alice'), { path: 'items', op: 'add', args: [{ name: 'milk' }] }, ca)
    s = up(s, { path: 'items[alice:1].qty', op: 'inc' }, ca.at(2))
    expect(JSON.parse(JSON.stringify(s))).toEqual(s)
  })
})

// ---------------------------------------------------------------------------------------------
// Laws. Random updates must not name sub-documents that do not exist, so the arbitrary produces
// *symbolic* updates ("bump the qty of the n-th known item") and a thin wrapper resolves them
// against the local state right before calling the real doc. The wrapper only translates: the
// document under test is `docCrdt` itself.
// ---------------------------------------------------------------------------------------------

type SymUpdate =
  | { kind: 'title'; v: string }
  | { kind: 'add'; name: string }
  | { kind: 'inc'; pick: number; n: number }
  | { kind: 'remove'; pick: number }
  | { kind: 'insertAt'; i: number; text: string }
  | { kind: 'done'; pick: number; v: number }
  | { kind: 'delete'; pick: number }

function knownIds(state: DocState, path: string): Dot[] {
  const part = docPartAt(state, path)
  return part && (part.kind === 'set' || part.kind === 'list')
    ? (Object.keys(part.subs) as Dot[])
    : []
}

/** Turn a symbolic update into a concrete one for this state; falls back to a harmless op. */
function concrete(state: DocState, u: SymUpdate): DocUpdate {
  const pickFrom = (path: string, pick: number) => {
    const ids = knownIds(state, path)
    return ids.length === 0 ? undefined : ids[pick % ids.length]
  }
  switch (u.kind) {
    case 'title':
      return { path: 'title', op: 'set', args: [u.v] }
    case 'add':
      return { path: 'items', op: 'add', args: [{ name: u.name }] }
    case 'inc': {
      const id = pickFrom('items', u.pick)
      return id
        ? { path: `items[${id}].qty`, op: 'inc', args: [u.n] }
        : { path: 'title', op: 'set', args: ['(no item)'] }
    }
    case 'remove': {
      const id = pickFrom('items', u.pick)
      return id
        ? { path: 'items', op: 'remove', args: [id] }
        : { path: 'items', op: 'add', args: [{}] }
    }
    case 'insertAt':
      return { path: '', op: 'insertAt', args: [u.i, { text: u.text }] }
    case 'done': {
      const id = pickFrom('', u.pick)
      return id
        ? { path: `[${id}].done`, op: 'set', args: [u.v] }
        : { path: '', op: 'insertAt', args: [0, {}] }
    }
    case 'delete': {
      const id = pickFrom('', u.pick)
      return id
        ? { path: '', op: 'delete', args: [id] }
        : { path: '', op: 'insertAt', args: [0, {}] }
    }
  }
}

/** `docCrdt` with symbolic updates: prepare/update resolve against the local state, the rest is the real thing. */
const symDoc: CrdtType<DocState, SymUpdate, DocOp, unknown, { schema: DocSchema }> = {
  name: 'doc',
  init: docCrdt.init,
  update: (s, u, ctx) => docCrdt.update(s, concrete(s, u), ctx),
  prepare: (s, u, ctx) => docCrdt.prepare(s, concrete(s, u), ctx),
  effect: docCrdt.effect,
  merge: docCrdt.merge,
  value: docCrdt.value,
  equals: docEquals,
}

const shoppingArb = (): fc.Arbitrary<SymUpdate> =>
  fc.oneof(
    {
      weight: 2,
      arbitrary: fc.constantFrom('Sat', 'Sun', 'Mon').map((v): SymUpdate => ({ kind: 'title', v })),
    },
    {
      weight: 3,
      arbitrary: fc
        .constantFrom('milk', 'eggs', 'bread')
        .map((name): SymUpdate => ({ kind: 'add', name })),
    },
    {
      weight: 3,
      arbitrary: fc
        .tuple(fc.nat(9), fc.integer({ min: 1, max: 3 }))
        .map(([pick, n]): SymUpdate => ({ kind: 'inc', pick, n })),
    },
    { weight: 2, arbitrary: fc.nat(9).map((pick): SymUpdate => ({ kind: 'remove', pick })) },
  )

const todoArb = (): fc.Arbitrary<SymUpdate> =>
  fc.oneof(
    {
      weight: 3,
      arbitrary: fc
        .tuple(fc.nat(5), fc.constantFrom('a', 'b', 'c'))
        .map(([i, text]): SymUpdate => ({ kind: 'insertAt', i, text })),
    },
    {
      weight: 2,
      arbitrary: fc
        .tuple(fc.nat(9), fc.nat(5))
        .map(([pick, v]): SymUpdate => ({ kind: 'done', pick, v })),
    },
    { weight: 1, arbitrary: fc.nat(9).map((pick): SymUpdate => ({ kind: 'delete', pick })) },
  )

describe('doc: laws (shopping list: set of maps)', () => {
  const cfg = { type: symDoc, args: { schema: shopping }, updateArb: shoppingArb, numRuns: 80 }

  it('merge is commutative, associative, idempotent', () => {
    assertMergeLaws(cfg)
  })
  it('state-based replicas converge', () => {
    assertConvergence(cfg)
  })
  it('op-based replicas converge under causal delivery', () => {
    assertOpConvergence(cfg)
  })
})

describe('doc: laws (todo: list of maps)', () => {
  const cfg = { type: symDoc, args: { schema: todo }, updateArb: todoArb, numRuns: 80 }

  it('merge is commutative, associative, idempotent', () => {
    assertMergeLaws(cfg)
  })
  it('state-based replicas converge', () => {
    assertConvergence(cfg)
  })
  it('op-based replicas converge under causal delivery', () => {
    assertOpConvergence(cfg)
  })
})
