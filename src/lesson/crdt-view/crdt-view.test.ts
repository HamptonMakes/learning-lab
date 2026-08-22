import { describe, expect, it } from 'vitest'
import { docCrdt, type DocState } from '../../crdt/doc'
import { gCounter } from '../../crdt/g-counter'
import { gSet } from '../../crdt/g-set'
import { hlcClock } from '../../crdt/hlc'
import { lamportClock } from '../../crdt/lamport-clock'
import { lwwElementSet } from '../../crdt/lww-element-set'
import { lwwMap } from '../../crdt/lww-map'
import { lwwRegister } from '../../crdt/lww-register'
import { maxRegister } from '../../crdt/max-register'
import { mvRegister } from '../../crdt/mv-register'
import { opCounter } from '../../crdt/op-counter'
import { orSet } from '../../crdt/or-set'
import { pnCounter } from '../../crdt/pn-counter'
import { rga } from '../../crdt/rga'
import { twoPhaseSet } from '../../crdt/two-phase-set'
import { makeCtx } from '../../crdt/types'
import { vectorClock } from '../../crdt/vector-clock'
import type { CrdtArgs, CrdtName, CrdtSchema, Replica, ViewCtx } from '../types'
import {
  decodeHlcStamp,
  encodeHlcStamp,
  fmtValue,
  fromJson,
  joinFit,
  OP_LABEL_TEMPLATES,
  opLabel,
  opLabelParts,
  renderOpLabel,
  summarizeState,
  toValue,
  truncate,
  viewFor,
  views,
} from './index'

const ACTORS = ['alice', 'bob', 'carol']

function replica(type: CrdtName | 'doc', state: unknown, extra: Partial<Replica> = {}): Replica {
  return {
    type,
    args: {},
    state,
    seq: 0,
    version: {},
    applied: [],
    log: [],
    pending: [],
    ...extra,
  }
}

function ctxFor(
  type: CrdtName | 'doc',
  state: unknown,
  opts: {
    args?: CrdtArgs
    actors?: string[]
    replica?: Partial<Replica>
    schema?: CrdtSchema
  } = {},
): ViewCtx {
  const args = opts.args ?? {}
  const r = replica(type, state, { args, ...opts.replica })
  if (opts.schema) r.schema = opts.schema
  const ctx: ViewCtx = { actors: opts.actors ?? ACTORS, replica: r, expose: args.expose ?? [] }
  if (args.display) ctx.display = args.display
  return ctx
}

const value = (type: CrdtName | 'doc', state: unknown, opts?: Parameters<typeof ctxFor>[2]) =>
  toValue(type, state, ctxFor(type, state, opts))

describe('fromJson', () => {
  it('scalar → scalar, array → list with index ids, object → record, nested', () => {
    expect(fromJson('x')).toEqual({ kind: 'scalar', value: 'x' })
    expect(fromJson(3)).toEqual({ kind: 'scalar', value: 3 })
    expect(fromJson(null)).toEqual({ kind: 'scalar', value: null })
    expect(fromJson(undefined)).toEqual({ kind: 'scalar', value: null })
    expect(fromJson(['a', 1])).toEqual({
      kind: 'list',
      items: [
        { id: '0', value: { kind: 'scalar', value: 'a' } },
        { id: '1', value: { kind: 'scalar', value: 1 } },
      ],
    })
    expect(fromJson({ title: 'Q3', tags: ['x'] })).toEqual({
      kind: 'record',
      fields: [
        { key: 'title', value: { kind: 'scalar', value: 'Q3' } },
        {
          key: 'tags',
          value: { kind: 'list', items: [{ id: '0', value: { kind: 'scalar', value: 'x' } }] },
        },
      ],
    })
  })
})

describe('format helpers', () => {
  it('fmtValue reads strings bare, objects as {k: v}, arrays as [a, b]', () => {
    expect(fmtValue('milk')).toBe('milk')
    expect(fmtValue({ name: 'milk', qty: 2 })).toBe('{name: milk, qty: 2}')
    expect(fmtValue(['a', 1, null])).toBe('[a, 1, null]')
    expect(fmtValue(true)).toBe('true')
  })
  it('truncate middle-ellipsizes to 24 and joinFit appends +n', () => {
    expect(truncate('abcdefghijklmnopqrstuvwxyz')).toBe('abcdefghijkl…pqrstuvwxyz')
    expect(truncate('short')).toBe('short')
    expect(joinFit(['bread', 'milk'])).toBe('bread, milk')
    expect(joinFit(['strawberries', 'blueberries', 'raspberries', 'cherries'])).toBe(
      'strawberries +3',
    )
    expect(joinFit(['a-very-long-single-element-name-here'])).toHaveLength(24)
  })
  it('hlc stamp codec round-trips', () => {
    expect(encodeHlcStamp({ wall: 3, counter: 2 })).toBe(3 * 65536 + 2)
    expect(decodeHlcStamp(3 * 65536 + 2)).toEqual({ wall: 3, counter: 2 })
  })
})

describe('toValue — registers', () => {
  it('max-register: scalar, null until written', () => {
    expect(value('max-register', maxRegister.init('alice'))).toEqual({
      kind: 'scalar',
      value: null,
    })
    const s = maxRegister.update(maxRegister.init('alice'), { set: 3 }, makeCtx('alice'))
    expect(value('max-register', s)).toEqual({ kind: 'scalar', value: 3 })
  })
  it('lww-register: fromJson(v) with ts/node; no stamp until written; hlc decoded when args.clock', () => {
    expect(value('lww-register', lwwRegister.init('alice'))).toEqual({
      kind: 'scalar',
      value: null,
    })
    const s = lwwRegister.update(lwwRegister.init('alice'), { set: 'Lunch' }, makeCtx('bob', 2))
    expect(value('lww-register', s)).toEqual({
      kind: 'scalar',
      value: 'Lunch',
      meta: { ts: 2, node: 'bob' },
    })
    const obj = lwwRegister.update(lwwRegister.init('alice'), { set: { a: 1 } }, makeCtx('seed', 0))
    expect(value('lww-register', obj)).toEqual({
      kind: 'record',
      fields: [{ key: 'a', value: { kind: 'scalar', value: 1 } }],
      meta: { ts: 0, node: 'seed' },
    })
    const h = lwwRegister.update(
      lwwRegister.init('alice'),
      { set: 'x' },
      makeCtx('alice', 3 * 65536 + 1),
    )
    expect(value('lww-register', h, { args: { clock: { slot: 'hlc' } } })).toEqual({
      kind: 'scalar',
      value: 'x',
      meta: { ts: 3 * 65536 + 1, node: 'alice', hlc: { wall: 3, counter: 1 } },
    })
  })
  it('lww-map: record, fields by key, per-field ts/node/tombstone', () => {
    let s = lwwMap.init<unknown>('alice')
    s = lwwMap.update(s, { key: 'title', set: 'Q3' }, makeCtx('alice', 1))
    s = lwwMap.update(s, { key: 'due', set: 'Fri' }, makeCtx('bob', 2))
    s = lwwMap.update(s, { key: 'due', remove: true }, makeCtx('alice', 3))
    expect(value('lww-map', s)).toEqual({
      kind: 'record',
      fields: [
        {
          key: 'due',
          value: { kind: 'scalar', value: null, meta: { ts: 3, node: 'alice', tombstone: true } },
        },
        { key: 'title', value: { kind: 'scalar', value: 'Q3', meta: { ts: 1, node: 'alice' } } },
      ],
    })
  })
  it('mv-register: one version carries its vc; siblings s1… with per-item vc and root vc = join', () => {
    const a = mvRegister.update(mvRegister.init<string>('alice'), { set: 'milk' }, makeCtx('alice'))
    expect(value('mv-register', a)).toEqual({
      kind: 'scalar',
      value: 'milk',
      meta: { vc: { alice: 1 } },
    })
    const b = mvRegister.update(mvRegister.init<string>('bob'), { set: 'eggs' }, makeCtx('bob'))
    const both = mvRegister.merge(a, b)
    expect(value('mv-register', both)).toEqual({
      kind: 'set',
      items: [
        { id: 's1', value: { kind: 'scalar', value: 'milk', meta: { vc: { alice: 1 } } } },
        { id: 's2', value: { kind: 'scalar', value: 'eggs', meta: { vc: { bob: 1 } } } },
      ],
      meta: { vc: { alice: 1, bob: 1 } },
    })
    expect(value('mv-register', mvRegister.init('alice'))).toEqual({ kind: 'scalar', value: null })
  })
})

describe('toValue — counters (rows in actors order, then unknown nodes by id)', () => {
  it('g-counter', () => {
    let s = gCounter.init('alice')
    s = gCounter.update(s, { inc: 2 }, makeCtx('bob'))
    s = gCounter.update(s, { inc: 1 }, makeCtx('alice'))
    s = gCounter.update(s, { inc: 5 }, makeCtx('zed'))
    s = gCounter.update(s, { inc: 4 }, makeCtx('seed'))
    expect(value('g-counter', s)).toEqual({
      kind: 'counter',
      rows: [
        { node: 'alice', inc: 1 },
        { node: 'bob', inc: 2 },
        { node: 'seed', inc: 4 },
        { node: 'zed', inc: 5 },
      ],
      total: 12,
    })
    expect(value('g-counter', s, { actors: ['bob', 'alice'] })).toMatchObject({
      rows: [{ node: 'bob' }, { node: 'alice' }, { node: 'seed' }, { node: 'zed' }],
    })
    expect(
      value('g-counter', s, {
        args: { expose: ['vc'] },
        replica: { version: { bob: 1, alice: 2 } },
      }),
    ).toMatchObject({
      meta: { vc: { alice: 2, bob: 1 } },
    })
  })
  it('pn-counter rows carry dec; op-counter is a scalar total with exposed applied', () => {
    let s = pnCounter.init('alice')
    s = pnCounter.update(s, { inc: 3 }, makeCtx('alice'))
    s = pnCounter.update(s, { dec: 1 }, makeCtx('bob'))
    expect(value('pn-counter', s)).toEqual({
      kind: 'counter',
      rows: [
        { node: 'alice', inc: 3, dec: 0 },
        { node: 'bob', inc: 0, dec: 1 },
      ],
      total: 2,
    })
    const o = opCounter.update(opCounter.init('alice'), { add: 2 }, makeCtx('alice'))
    expect(
      value('op-counter', o, { args: { expose: ['applied'] }, replica: { applied: ['alice:1'] } }),
    ).toEqual({ kind: 'scalar', value: 2, meta: { applied: ['alice:1'] } })
  })
})

describe('toValue — sets (items by canonical key)', () => {
  it('g-set and two-phase-set (removed items stay as tombstones)', () => {
    let g = gSet.init('alice')
    g = gSet.update(g, { add: 'milk' }, makeCtx('alice'))
    g = gSet.update(g, { add: 'bread' }, makeCtx('bob'))
    expect(value('g-set', g)).toEqual({
      kind: 'set',
      items: [
        { id: 'bread', value: { kind: 'scalar', value: 'bread' } },
        { id: 'milk', value: { kind: 'scalar', value: 'milk' } },
      ],
    })
    let t = twoPhaseSet.init('alice')
    t = twoPhaseSet.update(t, { add: 'dan' }, makeCtx('alice'))
    t = twoPhaseSet.update(t, { remove: 'dan' }, makeCtx('bob'))
    expect(value('two-phase-set', t)).toEqual({
      kind: 'set',
      items: [{ id: 'dan', value: { kind: 'scalar', value: 'dan', meta: { tombstone: true } } }],
    })
  })
  it('lww-element-set: addTs / removeTs / tombstone', () => {
    let s = lwwElementSet.init('alice', { bias: 'add' })
    s = lwwElementSet.update(s, { add: 'jazz' }, makeCtx('alice', 1))
    s = lwwElementSet.update(s, { add: 'rock' }, makeCtx('alice', 1))
    s = lwwElementSet.update(s, { remove: 'rock' }, makeCtx('bob', 2))
    expect(value('lww-element-set', s)).toEqual({
      kind: 'set',
      items: [
        { id: 'jazz', value: { kind: 'scalar', value: 'jazz', meta: { addTs: 1 } } },
        {
          id: 'rock',
          value: {
            kind: 'scalar',
            value: 'rock',
            meta: { addTs: 1, removeTs: 2, tombstone: true },
          },
        },
      ],
    })
  })
  it('or-set: every tag with alive; tombstone when no tag is alive', () => {
    let a = orSet.init<string>('alice')
    a = orSet.update(a, { add: 'milk' }, makeCtx('alice'))
    let b = orSet.merge(orSet.init<string>('bob'), a)
    b = orSet.update(b, { remove: 'milk' }, makeCtx('bob'))
    expect(value('or-set', b)).toEqual({
      kind: 'set',
      items: [
        {
          id: 'milk',
          value: {
            kind: 'scalar',
            value: 'milk',
            meta: { tags: [{ tag: 'alice:1', alive: false }], tombstone: true },
          },
        },
      ],
    })
    a = orSet.update(a, { add: 'milk' }, makeCtx('alice', 0, 1))
    const merged = orSet.merge(a, b)
    expect(value('or-set', merged)).toEqual({
      kind: 'set',
      items: [
        {
          id: 'milk',
          value: {
            kind: 'scalar',
            value: 'milk',
            meta: {
              tags: [
                { tag: 'alice:1', alive: false },
                { tag: 'alice:2', alive: true },
              ],
            },
          },
        },
      ],
    })
  })
})

describe('toValue — rga', () => {
  it('list in sequence order, item id = element id, ts/node/tombstone, display from ctx, stats/vc exposed', () => {
    let s = rga.init<string>('alice')
    s = rga.update(s, { insertAfter: 'HEAD', value: 'c' }, makeCtx('alice', 1))
    s = rga.update(s, { insertAfter: 'alice:1', value: 'a' }, makeCtx('alice', 2, 1))
    s = rga.update(s, { insertAfter: 'alice:2', value: 't' }, makeCtx('bob', 3))
    s = rga.update(s, { delete: 'alice:2' }, makeCtx('bob', 3))
    const v = value('rga', s, {
      args: { display: 'text', expose: ['stats', 'vc'] },
      replica: { version: { alice: 2, bob: 2 } },
    })
    expect(v).toEqual({
      kind: 'list',
      display: 'text',
      items: [
        { id: 'alice:1', value: { kind: 'scalar', value: 'c', meta: { ts: 1, node: 'alice' } } },
        {
          id: 'alice:2',
          value: { kind: 'scalar', value: 'a', meta: { ts: 2, node: 'alice', tombstone: true } },
        },
        { id: 'bob:1', value: { kind: 'scalar', value: 't', meta: { ts: 3, node: 'bob' } } },
      ],
      meta: { vc: { alice: 2, bob: 2 }, stats: { stored: 3, visible: 2 } },
    })
    expect(value('rga', s)).toMatchObject({ display: 'row' })
  })
})

describe('toValue — clocks', () => {
  it('lamport scalar, vector clock entries in actors order, hlc record', () => {
    expect(
      value('lamport-clock', lamportClock.update(0, { tick: true }, makeCtx('alice'))),
    ).toEqual({
      kind: 'scalar',
      value: 1,
    })
    const vc = vectorClock.update(
      vectorClock.init('bob', { nodes: ['alice', 'bob'] }),
      { tick: true },
      makeCtx('bob'),
    )
    expect(value('vector-clock', vc)).toEqual({ kind: 'clock', entries: { alice: 0, bob: 1 } })
    expect(
      Object.keys(
        (value('vector-clock', vc, { actors: ['bob', 'alice'] }) as { entries: object }).entries,
      ),
    ).toEqual(['bob', 'alice'])
    const h = hlcClock.update(hlcClock.init('alice'), { tick: true }, makeCtx('alice', 5))
    expect(value('hlc', h)).toEqual({
      kind: 'record',
      fields: [
        { key: 'wall', value: { kind: 'scalar', value: 5 } },
        { key: 'counter', value: { kind: 'scalar', value: 0 } },
      ],
    })
  })
})

describe('toValue — doc', () => {
  const schema: CrdtSchema = {
    map: {
      title: 'lww-register',
      items: { set: { map: { name: 'lww-register', qty: 'pn-counter' } } },
      log: { list: 'lww-register' },
    },
  }
  it("composes record / set / list with each part's meta plus meta.type", () => {
    let s: DocState = docCrdt.init('alice', { schema: schema as never })
    s = docCrdt.update(s, { path: 'title', op: 'set', args: ['Groceries'] }, makeCtx('seed', 0))
    s = docCrdt.update(
      s,
      { path: 'items', op: 'add', args: [{ name: 'milk' }] },
      makeCtx('alice', 1),
    )
    s = docCrdt.update(s, { path: 'items[alice:1].qty', op: 'inc', args: [2] }, makeCtx('bob', 2))
    s = docCrdt.update(s, { path: 'log', op: 'insertAt', args: [0, {}] }, makeCtx('bob', 3, 0))
    const v = value('doc', s, {
      schema,
      args: { expose: ['vc'] },
      replica: { version: { alice: 1, bob: 2 } },
    })
    expect(v).toEqual({
      kind: 'record',
      fields: [
        {
          key: 'items',
          value: {
            kind: 'set',
            meta: { type: 'or-set' },
            items: [
              {
                id: 'alice:1',
                value: {
                  kind: 'record',
                  fields: [
                    {
                      key: 'name',
                      value: {
                        kind: 'scalar',
                        value: 'milk',
                        meta: { ts: 1, node: 'alice', type: 'lww-register' },
                      },
                    },
                    {
                      key: 'qty',
                      value: {
                        kind: 'counter',
                        rows: [{ node: 'bob', inc: 2, dec: 0 }],
                        total: 2,
                        meta: { type: 'pn-counter' },
                      },
                    },
                  ],
                  meta: { tags: [{ tag: 'alice:1', alive: true }] },
                },
              },
            ],
          },
        },
        {
          key: 'log',
          value: {
            kind: 'list',
            meta: { type: 'rga' },
            items: [
              {
                id: 'bob:1',
                value: {
                  kind: 'scalar',
                  value: null,
                  meta: { type: 'lww-register', ts: 3, node: 'bob' },
                },
              },
            ],
          },
        },
        {
          key: 'title',
          value: {
            kind: 'scalar',
            value: 'Groceries',
            meta: { ts: 0, node: 'seed', type: 'lww-register' },
          },
        },
      ],
      meta: { vc: { alice: 1, bob: 2 } },
    })
  })
  it('views / viewFor cover every type', () => {
    for (const t of Object.keys(views))
      expect(viewFor(t as CrdtName | 'doc')).toBe(views[t as CrdtName | 'doc'])
    expect(() => viewFor('nope' as CrdtName)).toThrow()
  })
})

describe('opLabel — §5.2 formats', () => {
  it('counters', () => {
    const g0 = gCounter.init('alice')
    const g1 = gCounter.update(g0, { inc: 2 }, makeCtx('alice'))
    expect(opLabel('g-counter', gCounter.prepare(g1, { inc: 1 }, makeCtx('alice')), g1)).toBe(
      'inc 1',
    )
    expect(opLabel('g-counter', gCounter.prepare(g0, { inc: 2 }, makeCtx('alice')))).toBe('inc 2')
    const p0 = pnCounter.init('alice')
    expect(opLabel('pn-counter', pnCounter.prepare(p0, { dec: 2 }, makeCtx('alice')), p0)).toBe(
      'dec 2',
    )
    expect(opLabel('op-counter', { id: 'alice:1', add: 1 })).toBe('inc 1')
    expect(opLabel('op-counter', { id: 'alice:2', add: -3 })).toBe('dec 3')
  })
  it('registers and maps', () => {
    expect(opLabel('lww-register', { set: 'Lunch', ts: 1, node: 'bob' })).toBe('set Lunch')
    expect(opLabel('max-register', { set: 3 })).toBe('set 3')
    expect(opLabel('mv-register', { version: { value: 'milk, eggs', clock: { alice: 1 } } })).toBe(
      'set milk, eggs',
    )
    expect(opLabel('lww-map', { key: 'title', set: 'Q3', ts: 1, node: 'a' })).toBe('set title = Q3')
    expect(opLabel('lww-map', { key: 'title', remove: true, ts: 1, node: 'a' })).toBe(
      'remove title',
    )
  })
  it('sets', () => {
    expect(opLabel('g-set', { add: 'milk' })).toBe('add milk')
    expect(opLabel('two-phase-set', { remove: 'dan' })).toBe('remove dan')
    expect(opLabel('lww-element-set', { add: 'jazz', ts: 1, node: 'a' })).toBe('add jazz')
    expect(opLabel('or-set', { add: 'milk', tag: 'alice:1' })).toBe('add milk #alice:1')
    expect(opLabel('or-set', { remove: 'milk', tags: ['alice:1'] })).toBe('remove milk {alice:1}')
    expect(opLabel('or-set', { remove: 'milk', tags: ['alice:1', 'bob:2'] })).toBe(
      'remove milk {alice:1, bob:2}',
    )
  })
  it('rga and clocks', () => {
    expect(opLabel('rga', { insert: { id: 'bob:1', value: 'h', after: 'alice:1', ts: 2 } })).toBe(
      'insert "h" after alice:1',
    )
    expect(opLabel('rga', { insert: { id: 'bob:1', value: 'h', after: 'HEAD', ts: 2 } })).toBe(
      'insert "h" after HEAD',
    )
    expect(opLabel('rga', { delete: 'alice:1' })).toBe('delete alice:1')
    expect(opLabel('rga', { noop: true })).toBe('no-op')
    expect(opLabel('lamport-clock', 3)).toBe('tick')
    expect(opLabel('vector-clock', { from: 'alice', clock: { alice: 1 } })).toBe('tick')
    expect(opLabel('hlc', { stamp: { wall: 1, counter: 0, node: 'alice' } })).toBe('tick')
  })
  it('doc parts: add {…} #id · remove id · path: leaf label (with and without the schema)', () => {
    const schema: CrdtSchema = {
      map: { items: { set: { map: { name: 'lww-register', qty: 'pn-counter' } } } },
    }
    let s: DocState = docCrdt.init('alice', { schema: schema as never })
    const add = docCrdt.prepare(
      s,
      { path: 'items', op: 'add', args: [{ name: 'milk' }] },
      makeCtx('alice'),
    )
    expect(opLabel('doc', add, s)).toBe('items: add {name: milk} #alice:1')
    s = docCrdt.effect(s, add)
    const inc = docCrdt.prepare(
      s,
      { path: 'items[alice:1].qty', op: 'inc', args: [1] },
      makeCtx('bob'),
    )
    expect(opLabel('doc', inc, s)).toBe('items[alice:1].qty: inc 1')
    expect(opLabel('doc', inc)).toBe('items[alice:1].qty: inc 1') // shape-sniffed without the schema
    const rm = docCrdt.prepare(
      s,
      { path: 'items', op: 'remove', args: ['alice:1'] },
      makeCtx('bob'),
    )
    expect(opLabel('doc', rm, s)).toBe('items: remove alice:1')
    const bare = docCrdt.prepare(s, { path: 'items', op: 'add' }, makeCtx('carol'))
    expect(opLabel('doc', bare, s)).toBe('items: add #carol:1')
    expect(opLabelParts('doc', inc, s)).toEqual({
      key: 'stage.op.at',
      vars: { path: 'items[alice:1].qty' },
      inner: { key: 'stage.op.inc', vars: { n: 1 } },
    })
  })
  it('opLabelParts are t()-ready and renderOpLabel rebuilds the English string', () => {
    const parts = opLabelParts('or-set', { add: 'milk', tag: 'alice:1' })
    expect(parts).toEqual({ key: 'stage.op.addTag', vars: { value: 'milk', tag: 'alice:1' } })
    expect(renderOpLabel(parts)).toBe('add milk #alice:1')
    expect(OP_LABEL_TEMPLATES['stage.op.removeTags']).toBe('remove {value} {{tags}}')
    expect(views['or-set'].opLabel({ remove: 'milk', tags: ['alice:1'] })).toBe(
      'remove milk {alice:1}',
    )
  })
})

describe('summarizeState', () => {
  it('lww-register: ≤24 chars with stamp meta; empty sets read as ∅; rga text joins characters', () => {
    const s = lwwRegister.update(
      lwwRegister.init('a'),
      { set: 'In a meeting' },
      makeCtx('alice', 1),
    )
    expect(summarizeState('lww-register', s)).toEqual({
      value: 'In a meeting',
      meta: { type: 'lww-register', ts: 1, node: 'alice' },
    })
    expect(summarizeState('or-set', orSet.init('a'))).toEqual({
      value: '∅',
      meta: { type: 'or-set' },
    })
    let r = rga.init<string>('a')
    for (const [i, ch] of [...'cat'].entries())
      r = rga.update(r, { insertAt: i, value: ch }, makeCtx('alice', i + 1, i))
    expect(summarizeState('rga', r).value).toBe('cat')
    let g = gCounter.init('a')
    g = gCounter.update(g, { inc: 2 }, makeCtx('alice'))
    g = gCounter.update(g, { inc: 1 }, makeCtx('bob'))
    expect(summarizeState('g-counter', g).value).toBe('3 · alice 2 · bob 1')
    const mv = mvRegister.merge(
      mvRegister.update(mvRegister.init<string>('a'), { set: 'milk' }, makeCtx('alice')),
      mvRegister.update(mvRegister.init<string>('b'), { set: 'eggs' }, makeCtx('bob')),
    )
    expect(summarizeState('mv-register', mv)).toEqual({
      value: 'milk | eggs',
      meta: { type: 'mv-register', vc: { alice: 1, bob: 1 } },
    })
    expect(summarizeState('vector-clock', { alice: 2, bob: 1 }).value).toBe('alice 2 · bob 1')
    expect(summarizeState('hlc', { wall: 5, counter: 2, node: 'a' }).value).toBe('5.2')
  })
  it('many elements collapse with +n and every summary fits 24 characters', () => {
    let s = gSet.init('a')
    for (const e of ['strawberries', 'blueberries', 'raspberries', 'cherries'])
      s = gSet.update(s, { add: e }, makeCtx('a'))
    const v = summarizeState('g-set', s).value
    expect(v).toBe('blueberries, cherries +2')
    expect(v.length).toBeLessThanOrEqual(24)
  })
})
