import { describe, expect, it } from 'vitest'
import { plainValueAt } from '../path'
import { ReducerError, type World } from '../types'
import {
  bytesOf,
  ctx,
  fixtureWorld,
  list,
  rec,
  run,
  scalar,
  sset,
  table,
  textOf,
} from './test-utils'

function withSlots(extra: Record<string, ReturnType<typeof scalar>>): World {
  const w = fixtureWorld()
  const alice = w.actors.alice
  if (!alice) throw new Error('fixture')
  return { ...w, actors: { ...w.actors, alice: { ...alice, holds: { ...alice.holds, ...extra } } } }
}

describe('set', () => {
  it('replaces a scalar, keeping its meta; a full Value replaces meta too', () => {
    const w = withSlots({ doc: scalar('hello', { ts: 1, node: 'alice' }) })
    const a = run(w, [{ t: 'set', path: 'alice.doc', value: 'bye' }]).world
    expect(a.actors.alice?.holds.doc).toEqual(scalar('bye', { ts: 1, node: 'alice' }))
    const b = run(w, [{ t: 'set', path: 'alice.doc', value: scalar('bye') }]).world
    expect(b.actors.alice?.holds.doc).toEqual(scalar('bye'))
  })

  it('creates a missing slot (appended), record field and list item', () => {
    const w = withSlots({ r: rec({ a: scalar(1) }), l: list(['x']) })
    const out = run(w, [
      { t: 'set', path: 'alice.fresh', value: 7 },
      { t: 'set', path: 'alice.r.b', value: 'two' },
      { t: 'set', path: 'alice.l[y]', value: 'y' },
    ]).world
    expect(Object.keys(out.actors.alice?.holds ?? {})).toEqual(['doc', 'n', 'r', 'l', 'fresh'])
    expect(plainValueAt(out, 'alice.r')).toEqual({ a: 1, b: 'two' })
    expect(plainValueAt(out, 'alice.l')).toEqual(['x', 'y'])
  })

  it('sets one byte and a byte range; board roots; counter rows and clock entries', () => {
    const w = withSlots({ id: bytesOf('00112233'), c: { kind: 'clock', entries: { alice: 1 } } })
    const out = run(w, [
      { t: 'set', path: 'alice.id[1]', value: 0xff },
      { t: 'set', path: 'alice.id[2..4]', value: [0xaa, 0xbb] as never },
      { t: 'set', path: 'board.rule', value: textOf('new rule') },
      { t: 'set', path: 'alice.c.bob', value: 4 },
    ]).world
    expect(plainValueAt(out, 'alice.id')).toBe('00ffaabb')
    expect(plainValueAt(out, 'board.rule')).toBe('new rule')
    expect(plainValueAt(out, 'alice.c')).toEqual({ alice: 1, bob: 4 })
    expect(() => run(w, [{ t: 'set', path: 'alice.id[0..2]', value: 'zz' }])).toThrow(/number\[\]/)
    expect(() => run(w, [{ t: 'set', path: 'alice.id[9]', value: 1 }])).toThrow(ReducerError)
  })

  it('throws on CRDT-managed and engine-written slots, bad paths and messages', () => {
    const w = fixtureWorld()
    const crdt: World = { ...w, replicas: { alice: { doc: {} as never } } }
    expect(() => run(crdt, [{ t: 'set', path: 'alice.doc', value: 'x' }])).toThrow(
      /CRDT-managed; use crdt.update/,
    )
    expect(() => run(crdt, [{ t: 'patch', path: 'alice.doc', meta: { ts: 1 } }])).toThrow(
      /CRDT-managed/,
    )
    const engine: World = {
      ...w,
      engines: { alice: {} },
      actors: {
        ...w.actors,
        alice: {
          ...(w.actors.alice as NonNullable<World['actors'][string]>),
          holds: { text: textOf('abc') },
        },
      },
    }
    expect(() => run(engine, [{ t: 'set', path: 'alice.text', value: 'x' }])).toThrow(
      /regex engine/,
    )
    expect(() => run(w, [{ t: 'set', path: 'alice.doc.title', value: 'x' }])).toThrow(ReducerError)
    expect(() => run(w, [{ t: 'set', path: 'msg:m1', value: 'x' }])).toThrow(/immutable/)
    expect(() => run(w, [{ t: 'set', path: 'zed.doc', value: 'x' }])).toThrow(/no actor/)
    let err: unknown
    try {
      run(w, [{ t: 'set', path: 'alice.doc@ts', value: 1 }], ctx({ stepId: 's09' }))
    } catch (e) {
      err = e
    }
    expect(err).toBeInstanceOf(ReducerError)
    expect((err as ReducerError).ctx).toMatchObject({ stepId: 's09', path: 'alice.doc@ts' })
    expect((err as ReducerError).ctx?.command).toEqual({ t: 'set', path: 'alice.doc@ts', value: 1 })
  })

  it('records quiet paths in the step scratch', () => {
    const c = ctx()
    run(
      fixtureWorld(),
      [
        { t: 'set', path: 'alice.doc', value: 'x', quiet: true },
        { t: 'set', path: 'alice.n', value: 2 },
      ],
      c,
    )
    expect(c.scratch?.quiet).toEqual(['alice.doc'])
  })
})

describe('patch', () => {
  it('merges meta, removes undefined keys, drops an empty meta', () => {
    const w = withSlots({ doc: scalar('hello', { ts: 1 }) })
    const a = run(w, [{ t: 'patch', path: 'alice.doc', meta: { node: 'alice' } }]).world
    expect(a.actors.alice?.holds.doc).toEqual(scalar('hello', { ts: 1, node: 'alice' }))
    const b = run(a, [
      { t: 'patch', path: 'alice.doc', meta: { ts: undefined, node: undefined } },
    ]).world
    expect(b.actors.alice?.holds.doc).toEqual(scalar('hello'))
    expect(() => run(w, [{ t: 'patch', path: 'alice.nope', meta: { ts: 1 } }])).toThrow(
      ReducerError,
    )
  })
})

describe('insert', () => {
  it('appends scalar items (id = String(value)), honours index, accepts Items', () => {
    const w = withSlots({ l: list(['a', 'c']), s: sset(['x']) })
    const out = run(w, [
      { t: 'insert', path: 'alice.l', item: 'd' },
      { t: 'insert', path: 'alice.l', item: 'b', index: 1 },
      { t: 'insert', path: 'alice.l', item: { id: 'z', value: scalar(26) }, index: 0 },
      { t: 'insert', path: 'alice.s', item: 7 },
    ]).world
    expect(plainValueAt(out, 'alice.l')).toEqual([26, 'a', 'b', 'c', 'd'])
    expect(out.actors.alice?.holds.l).toMatchObject({
      items: [{ id: 'z' }, { id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }],
    })
    expect(plainValueAt(out, 'alice.s')).toEqual([7, 'x'])
  })

  it('inserts table rows, checks columns, rejects duplicates, bad indexes and wrong shapes', () => {
    const w = withSlots({
      t: table(['how', 'use'], [['r1', { how: 'a', use: 'b' }]]),
      l: list(['a']),
    })
    const out = run(w, [
      { t: 'insert', path: 'alice.t', item: { id: 'r0', cells: { how: scalar('z') } }, index: 0 },
    ]).world
    expect(plainValueAt(out, 'alice.t')).toEqual([{ how: 'z' }, { how: 'a', use: 'b' }])
    expect(() =>
      run(w, [{ t: 'insert', path: 'alice.t', item: { id: 'r2', cells: { nope: scalar(1) } } }]),
    ).toThrow(/no column/)
    expect(() => run(w, [{ t: 'insert', path: 'alice.t', item: 'scalar' }])).toThrow(/row/)
    expect(() => run(w, [{ t: 'insert', path: 'alice.t', item: { id: 'r1', cells: {} } }])).toThrow(
      /already has row/,
    )
    expect(() => run(w, [{ t: 'insert', path: 'alice.l', item: 'a' }])).toThrow(/already has item/)
    expect(() => run(w, [{ t: 'insert', path: 'alice.l', item: 'b', index: 5 }])).toThrow(
      /out of range/,
    )
    expect(() => run(w, [{ t: 'insert', path: 'alice.l', item: 'x]y' }])).toThrow(/"\]"/)
    expect(() => run(w, [{ t: 'insert', path: 'alice.doc', item: 'x' }])).toThrow(
      /lists, sets and tables/,
    )
    expect(() => run(w, [{ t: 'insert', path: 'alice.l', item: { id: 'q', cells: {} } }])).toThrow(
      /item or a scalar/,
    )
  })

  it('records the item path as quiet', () => {
    const c = ctx()
    run(
      withSlots({ l: list(['a']) }),
      [{ t: 'insert', path: 'alice.l', item: 'b', quiet: true }],
      c,
    )
    expect(c.scratch?.quiet).toEqual(['alice.l[b]'])
  })
})

describe('delete', () => {
  it('removes items, record fields, table rows and whole slots; tombstones keep items struck-through', () => {
    const w = withSlots({
      l: list(['a', 'b']),
      r: rec({ x: scalar(1), y: scalar(2) }),
      t: table(
        ['c'],
        [
          ['r1', { c: 1 }],
          ['r2', { c: 2 }],
        ],
      ),
    })
    const out = run(w, [
      { t: 'delete', path: 'alice.l[a]' },
      { t: 'delete', path: 'alice.r.x' },
      { t: 'delete', path: 'alice.t[r1]' },
      { t: 'delete', path: 'alice.n' },
    ]).world
    expect(plainValueAt(out, 'alice.l')).toEqual(['b'])
    expect(plainValueAt(out, 'alice.r')).toEqual({ y: 2 })
    expect(plainValueAt(out, 'alice.t')).toEqual([{ c: 2 }])
    expect(Object.keys(out.actors.alice?.holds ?? {})).toEqual(['doc', 'l', 'r', 't'])
    const tomb = run(w, [
      { t: 'delete', path: 'alice.l[a]', tombstone: true },
      { t: 'delete', path: 'alice.r.x', tombstone: true },
    ]).world
    expect(plainValueAt(tomb, 'alice.l')).toEqual(['b'])
    expect(plainValueAt(tomb, 'alice.l[a]@tomb')).toBe(true)
    expect(plainValueAt(tomb, 'alice.r.x@tombstone')).toBe(true)
  })

  it('throws on missing targets, selectors, ranges, cards and tombstoned rows/slots', () => {
    const w = withSlots({ l: list(['a']), t: table(['c'], [['r1', { c: 1 }]]) })
    expect(() => run(w, [{ t: 'delete', path: 'alice.l[zzz]' }])).toThrow(/does not resolve/)
    expect(() => run(w, [{ t: 'delete', path: 'alice.l[a]@ts' }])).toThrow(/selector/)
    expect(() => run(w, [{ t: 'delete', path: 'alice' }])).toThrow(/whole card/)
    expect(() => run(w, [{ t: 'delete', path: 'alice.t[r1]', tombstone: true }])).toThrow(
      /tombstoned/,
    )
    expect(() => run(w, [{ t: 'delete', path: 'alice.l', tombstone: true }])).toThrow(
      /slot cannot be tombstoned/,
    )
    expect(() => run(w, [{ t: 'delete', path: 'alice.nope' }])).toThrow(ReducerError)
  })
})

describe('move / sort', () => {
  it('move reorders list items and table rows (quiet records the container)', () => {
    const c = ctx()
    const w = withSlots({
      l: list(['a', 'b', 'c']),
      t: table(
        ['c'],
        [
          ['r1', { c: 1 }],
          ['r2', { c: 2 }],
        ],
      ),
    })
    const out = run(
      w,
      [
        { t: 'move', path: 'alice.l[c]', to: 0, quiet: true },
        { t: 'move', path: 'alice.t[r1]', to: 1 },
      ],
      c,
    ).world
    expect(plainValueAt(out, 'alice.l')).toEqual(['c', 'a', 'b'])
    expect(plainValueAt(out, 'alice.t')).toEqual([{ c: 2 }, { c: 1 }])
    expect(c.scratch?.quiet).toEqual(['alice.l'])
    expect(() => run(w, [{ t: 'move', path: 'alice.l[c]', to: 3 }])).toThrow(/out of range/)
    expect(() => run(w, [{ t: 'move', path: 'alice.l', to: 0 }])).toThrow(/item path/)
    expect(() => run(w, [{ t: 'move', path: 'alice.l[zzz]', to: 0 }])).toThrow(ReducerError)
  })

  it('sort by value / id / @meta / .field on lists and by .column on tables', () => {
    const w = withSlots({
      l: {
        kind: 'list',
        items: [
          { id: 'p', value: scalar(3, { ts: 2 }) },
          { id: 'q', value: scalar(1, { ts: 3 }) },
          { id: 'r', value: scalar(2, { ts: 1 }) },
        ],
      },
      recs: list([
        ['a', rec({ price: scalar(9) })],
        ['b', rec({ price: scalar(4) })],
      ]),
      strs: list(['b', 'B', 'a']),
      t: table(
        ['n'],
        [
          ['r1', { n: 5 }],
          ['r2', { n: 2 }],
          ['r3', { n: 9 }],
        ],
      ),
    })
    expect(
      plainValueAt(run(w, [{ t: 'sort', path: 'alice.l', by: ['value'] }]).world, 'alice.l'),
    ).toEqual([1, 2, 3])
    expect(
      plainValueAt(run(w, [{ t: 'sort', path: 'alice.l', by: ['@ts'] }]).world, 'alice.l'),
    ).toEqual([2, 3, 1])
    expect(
      plainValueAt(run(w, [{ t: 'sort', path: 'alice.l', by: ['id'] }]).world, 'alice.l'),
    ).toEqual([3, 1, 2])
    expect(
      plainValueAt(run(w, [{ t: 'sort', path: 'alice.recs', by: ['.price'] }]).world, 'alice.recs'),
    ).toEqual([{ price: 4 }, { price: 9 }])
    expect(
      plainValueAt(run(w, [{ t: 'sort', path: 'alice.strs', by: ['value'] }]).world, 'alice.strs'),
    ).toEqual(['B', 'a', 'b'])
    expect(
      plainValueAt(run(w, [{ t: 'sort', path: 'alice.t', by: ['.n'] }]).world, 'alice.t'),
    ).toEqual([{ n: 2 }, { n: 5 }, { n: 9 }])
    expect(() => run(w, [{ t: 'sort', path: 'alice.t', by: ['value'] }])).toThrow(/table sorts by/)
    expect(() => run(w, [{ t: 'sort', path: 'alice.doc', by: ['value'] }])).toThrow(
      /lists and tables/,
    )
    expect(() => run(w, [{ t: 'sort', path: 'alice.l', by: [] }])).toThrow(/at least one key/)
    expect(() => run(w, [{ t: 'sort', path: 'alice.l', by: ['@nope'] }])).toThrow(
      /unknown meta key/,
    )
  })

  it('sort by value is bytewise for bytes and stable across keys', () => {
    const w = withSlots({
      l: list([
        ['x', bytesOf('0102')],
        ['y', bytesOf('0101')],
        ['z', bytesOf('01')],
      ]),
    })
    const out = run(w, [{ t: 'sort', path: 'alice.l', by: ['value', 'id'] }]).world
    expect(out.actors.alice?.holds.l).toMatchObject({
      items: [{ id: 'z' }, { id: 'y' }, { id: 'x' }],
    })
  })
})

describe('annotate / unannotate / view', () => {
  it('annotate appends (or replaces by id) on bytes and text, with range checks', () => {
    const w = withSlots({ id: bytesOf('00112233'), txt: textOf('the cat') })
    const out = run(w, [
      { t: 'annotate', path: 'alice.id', from: 0, to: 2, label: 'time', id: 'time', tone: 'info' },
      { t: 'annotate', path: 'alice.id', from: 8, to: 12, unit: 'bit', label: 'ver' },
      { t: 'annotate', path: 'alice.id', from: 1, to: 2, label: 'time2', id: 'time' },
      { t: 'annotate', path: 'alice.txt', from: 4, to: 7, tone: 'ok' },
    ]).world
    expect(out.actors.alice?.holds.id).toMatchObject({
      annotations: [
        { id: 'time', from: 1, to: 2, label: 'time2' },
        { from: 8, to: 12, unit: 'bit', label: 'ver' },
      ],
    })
    expect(out.actors.alice?.holds.txt).toMatchObject({
      annotations: [{ from: 4, to: 7, tone: 'ok' }],
    })
    expect(() => run(w, [{ t: 'annotate', path: 'alice.id', from: 0, to: 5 }])).toThrow(
      /out of range/,
    )
    expect(() =>
      run(w, [{ t: 'annotate', path: 'alice.id', from: 0, to: 33, unit: 'bit' }]),
    ).toThrow(/out of range/)
    expect(() => run(w, [{ t: 'annotate', path: 'alice.id', from: 2, to: 2 }])).toThrow(
      /out of range/,
    )
    expect(() =>
      run(w, [{ t: 'annotate', path: 'alice.txt', from: 0, to: 1, unit: 'bit' }]),
    ).toThrow(/drop "unit"/)
    expect(() => run(w, [{ t: 'annotate', path: 'alice.doc', from: 0, to: 1 }])).toThrow(
      /bytes and text/,
    )
  })

  it('unannotate removes one or all; view sets display and range', () => {
    const w = withSlots({ id: bytesOf('00112233') })
    const a = run(w, [
      { t: 'annotate', path: 'alice.id', from: 0, to: 1, id: 'x' },
      { t: 'annotate', path: 'alice.id', from: 1, to: 2, id: 'y' },
      { t: 'unannotate', path: 'alice.id', id: 'x' },
    ]).world
    expect(a.actors.alice?.holds.id).toMatchObject({ annotations: [{ id: 'y' }] })
    const b = run(a, [{ t: 'unannotate', path: 'alice.id' }]).world
    expect(b.actors.alice?.holds.id).toMatchObject({ annotations: [] })
    expect(() => run(b, [{ t: 'unannotate', path: 'alice.id', id: 'x' }])).toThrow(/no annotation/)
    const v = run(b, [{ t: 'view', path: 'alice.id', display: 'bits', range: [1, 3] }]).world
    expect(v.actors.alice?.holds.id).toMatchObject({ display: 'bits', range: [1, 3] })
    const v2 = run(v, [{ t: 'view', path: 'alice.id', display: 'canonical' }]).world
    expect(v2.actors.alice?.holds.id).toEqual({
      kind: 'bytes',
      bytes: [0, 0x11, 0x22, 0x33],
      display: 'canonical',
      annotations: [],
    })
    expect(() => run(v, [{ t: 'view', path: 'alice.id', display: 'bits', range: [3, 9] }])).toThrow(
      /out of range/,
    )
    expect(() => run(v, [{ t: 'view', path: 'alice.doc', display: 'hex' }])).toThrow(/bytes/)
  })
})

describe('action events (the mutation points a value change shows)', () => {
  const actions = (c: ReturnType<typeof ctx>) =>
    c.log.events.flatMap((e) => (e.kind === 'action' ? [{ path: e.path, ...e.label }] : []))

  it('set / insert / append / add / delete / move / sort name their operation; patch, annotate and view do not', () => {
    const w = withSlots({
      l: list(['a', 'b']),
      s: sset(['x']),
      t: table(['use'], [['r1', { use: 1 }]]),
      id: bytesOf('0011'),
    })
    const c = ctx()
    run(
      w,
      [
        { t: 'set', path: 'alice.doc', value: 'x' },
        { t: 'patch', path: 'alice.doc', meta: { ts: 2 } },
        { t: 'insert', path: 'alice.l', item: 'c' },
        { t: 'insert', path: 'alice.l', item: 'z', index: 0 },
        { t: 'insert', path: 'alice.s', item: 'y' },
        { t: 'insert', path: 'alice.t', item: { id: 'r2', cells: { use: scalar(2) } } },
        { t: 'delete', path: 'alice.l[a]' },
        { t: 'move', path: 'alice.l[b]', to: 0 },
        { t: 'sort', path: 'alice.l', by: ['value'] },
        { t: 'annotate', path: 'alice.id', from: 0, to: 1 },
        { t: 'view', path: 'alice.id', display: 'bits' },
      ],
      c,
    )
    expect(actions(c)).toEqual([
      { path: 'alice.doc', key: 'stage.op.setPlain' },
      { path: 'alice.l[c]', key: 'stage.op.append', vars: { value: 'c' } },
      { path: 'alice.l[z]', key: 'stage.op.insertPlain', vars: { value: 'z' } },
      { path: 'alice.s[y]', key: 'stage.op.add', vars: { value: 'y' } },
      { path: 'alice.t[r2]', key: 'stage.op.append', vars: { value: 'r2' } },
      { path: 'alice.l[a]', key: 'stage.op.deletePlain', vars: { value: 'a' } },
      { path: 'alice.l[b]', key: 'stage.op.move', vars: { value: 'b' } },
      { path: 'alice.l', key: 'stage.op.sort' },
    ])
  })
})
