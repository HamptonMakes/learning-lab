import { describe, expect, it } from 'vitest'
import {
  formatPath,
  getAt,
  isValidPath,
  parsePath,
  patchMetaAt,
  plainValue,
  plainValueAt,
  resolvePath,
  setAt,
  setBytesRange,
  updateAt,
  type ParsedPath,
} from './path'
import { ReducerError, type Meta, type Scalar, type Value, type World } from './types'

// ─── Fixture: a world with every node kind ────────────────────────────────────────────────────

const scalar = (value: Scalar, meta?: Meta): Value =>
  meta ? { kind: 'scalar', value, meta } : { kind: 'scalar', value }

function deepFreeze<T>(v: T): T {
  if (typeof v === 'object' && v !== null && !Object.isFrozen(v)) {
    Object.freeze(v)
    for (const k of Object.keys(v)) deepFreeze((v as Record<string, unknown>)[k])
  }
  return v
}

const world: World = deepFreeze<World>({
  layout: { preset: 'pair' },
  clock: { now: 3, show: true, format: 'counter' },
  actors: {
    alice: {
      id: 'alice',
      kind: 'person',
      label: 'Alice',
      color: 'a',
      online: true,
      skew: 2,
      status: 'lock',
      holds: {
        doc: {
          kind: 'record',
          fields: [
            { key: 'title', value: scalar('Q3 plan', { ts: 1, node: 'alice' }) },
            { key: 'owner', value: scalar('Bob') },
          ],
        },
        list: {
          kind: 'list',
          display: 'row',
          items: [
            { id: 'milk', value: scalar('milk', { tombstone: true }) },
            { id: 'eggs', value: scalar('eggs') },
          ],
        },
        cart: {
          kind: 'set',
          items: [
            { id: 'milk', value: scalar('milk', { tags: [{ tag: 'alice:1', alive: true }] }) },
            { id: 'bread', value: scalar('bread') },
          ],
        },
        views: {
          kind: 'counter',
          rows: [
            { node: 'alice', inc: 2, dec: 1 },
            { node: 'bob', inc: 1 },
          ],
          total: 2,
          meta: { vc: { alice: 2, bob: 1 } },
        },
        vc: { kind: 'clock', entries: { alice: 2, bob: 1 } },
        id: {
          kind: 'bytes',
          bytes: [0x01, 0xa0, 0x28, 0xe9, 0xb5, 0x00],
          display: 'hex',
          annotations: [],
        },
        text: { kind: 'text', text: 'the cat sat', cursor: 4, annotations: [] },
        pattern: {
          kind: 'pattern',
          tokens: [
            { id: 'p0', src: 'c', kind: 'literal' },
            { id: 'p1', src: '.', kind: 'any' },
            { id: 'p2', src: 't', kind: 'literal' },
          ],
          cursor: 1,
        },
        tries: { kind: 'meter', value: 6, max: 24, label: 'tests' },
        status: scalar('Lunch', { ts: 2, node: 'bob' }),
      },
      outbox: [{ slot: 'cart', id: 'alice:1', label: 'add milk #alice:1' }],
    },
    bob: {
      id: 'bob',
      kind: 'person',
      label: 'Bob',
      color: 'b',
      online: false,
      holds: {},
      outbox: [],
    },
  },
  boards: {
    rule: { id: 'rule', value: { kind: 'text', text: 'merge: newer ts wins', annotations: [] } },
    table: {
      id: 'table',
      value: {
        kind: 'table',
        columns: [
          { key: 'how', label: 'How' },
          { key: 'use', label: 'Use' },
        ],
        rows: [
          { id: 'r1', cells: { how: scalar('replaces'), use: scalar('LWW register') } },
          { id: 'r2', cells: { how: scalar('adds') } },
        ],
      },
    },
    events: {
      id: 'events',
      value: { kind: 'record', fields: [{ key: 'price', value: scalar(3) }] },
    },
  },
  messages: [
    { id: 'm1', from: 'alice', to: 'bob', payload: scalar('hi'), state: 'flying' },
    { id: 'alice:3@bob', from: 'alice', to: 'bob', payload: scalar('op'), state: 'parked' },
  ],
  marks: [],
  replicas: {},
  engines: {},
  ids: 2,
})
const snapshot = JSON.stringify(world)

const fails = (fn: () => unknown, pattern?: RegExp) => {
  expect(fn).toThrow(ReducerError)
  if (pattern) expect(fn).toThrow(pattern)
}

// ─── Grammar ──────────────────────────────────────────────────────────────────────────────────

describe('parsePath (§3 examples)', () => {
  const table: Array<[string, ParsedPath]> = [
    [
      'alice.doc.title',
      { root: { kind: 'actor', id: 'alice' }, segments: [{ key: 'doc' }, { key: 'title' }] },
    ],
    [
      'server.list[item-3]',
      { root: { kind: 'actor', id: 'server' }, segments: [{ key: 'list' }, { id: 'item-3' }] },
    ],
    [
      'bob.views[bob]@inc',
      {
        root: { kind: 'actor', id: 'bob' },
        segments: [{ key: 'views' }, { id: 'bob' }],
        selector: 'inc',
      },
    ],
    [
      'alice.likes[alice]@dec',
      {
        root: { kind: 'actor', id: 'alice' },
        segments: [{ key: 'likes' }, { id: 'alice' }],
        selector: 'dec',
      },
    ],
    [
      'bob.fav[jazz]@removeTs',
      {
        root: { kind: 'actor', id: 'bob' },
        segments: [{ key: 'fav' }, { id: 'jazz' }],
        selector: 'removeTs',
      },
    ],
    [
      'alice.cart[milk]@tags',
      {
        root: { kind: 'actor', id: 'alice' },
        segments: [{ key: 'cart' }, { id: 'milk' }],
        selector: 'tags',
      },
    ],
    [
      'alice.list.items[alice:1].qty',
      {
        root: { kind: 'actor', id: 'alice' },
        segments: [{ key: 'list' }, { key: 'items' }, { id: 'alice:1' }, { key: 'qty' }],
      },
    ],
    [
      'server.cart[s1]@vc',
      {
        root: { kind: 'actor', id: 'server' },
        segments: [{ key: 'cart' }, { id: 's1' }],
        selector: 'vc',
      },
    ],
    ['alice@clock', { root: { kind: 'actor', id: 'alice' }, segments: [], selector: 'clock' }],
    ['bob@inbox', { root: { kind: 'actor', id: 'bob' }, segments: [], selector: 'inbox' }],
    [
      'board.table[r1].use',
      { root: { kind: 'board', id: 'table' }, segments: [{ id: 'r1' }, { key: 'use' }] },
    ],
    ['board.events.price', { root: { kind: 'board', id: 'events' }, segments: [{ key: 'price' }] }],
    [
      'laptop.id[6]',
      { root: { kind: 'actor', id: 'laptop' }, segments: [{ key: 'id' }, { id: '6' }] },
    ],
    [
      'matcher.text[4..7]',
      { root: { kind: 'actor', id: 'matcher' }, segments: [{ key: 'text' }, { range: [4, 7] }] },
    ],
    [
      'matcher.text@cursor',
      { root: { kind: 'actor', id: 'matcher' }, segments: [{ key: 'text' }], selector: 'cursor' },
    ],
    [
      'matcher.pattern[p2]',
      { root: { kind: 'actor', id: 'matcher' }, segments: [{ key: 'pattern' }, { id: 'p2' }] },
    ],
    ['msg:alice:3@bob', { root: { kind: 'msg', id: 'alice:3@bob' }, segments: [] }],
    ['msg:m1', { root: { kind: 'msg', id: 'm1' }, segments: [] }],
    ['alice', { root: { kind: 'actor', id: 'alice' }, segments: [] }],
    ['board.rule', { root: { kind: 'board', id: 'rule' }, segments: [] }],
    ['edge-us.doc', { root: { kind: 'actor', id: 'edge-us' }, segments: [{ key: 'doc' }] }],
    [
      'a.b[id with spaces]',
      { root: { kind: 'actor', id: 'a' }, segments: [{ key: 'b' }, { id: 'id with spaces' }] },
    ],
  ]

  it.each(table)('parses %s', (p, parsed) => {
    expect(parsePath(p)).toEqual(parsed)
    expect(isValidPath(p)).toBe(true)
  })

  it.each(table)('round-trips %s', (p, parsed) => {
    expect(formatPath(parsePath(p))).toBe(p)
    expect(formatPath(parsed)).toBe(p)
  })

  it.each([
    ['', /empty path/],
    ['board', /reserved root/],
    ['msg', /reserved root/],
    ['msg:', /missing message id/],
    ['board.', /missing board id/],
    ['alice.', /expected a key/],
    ['alice..doc', /expected a key/],
    ['alice[', /unclosed/],
    ['alice[]', /empty "\[\]"/],
    ['alice.doc@', /letters only/],
    ['alice.doc@t-s', /letters only/],
    ['alice.doc@ts.x', /letters only/],
    ['alice.id[3..3]', /empty or reversed/],
    ['alice.id[5..2]', /empty or reversed/],
    ['alice.id[0..6].x', /last segment/],
    ['alice.id[0..6]@ts', /last segment/],
    ['.doc', /expected an actor id/],
    ['alice doc', /unexpected " "/],
    ['@clock', /expected an actor id/],
    ['alice]', /unexpected "\]"/],
  ])('rejects malformed %j', (p, why) => {
    fails(() => parsePath(p), /malformed path/)
    fails(() => parsePath(p), why)
    expect(isValidPath(p)).toBe(false)
  })

  it('isValidPath rejects non-strings', () => {
    expect(isValidPath(42)).toBe(false)
    expect(isValidPath(undefined)).toBe(false)
  })
})

// ─── Resolution ───────────────────────────────────────────────────────────────────────────────

describe('resolvePath', () => {
  it('roots: actor, board, message', () => {
    expect(resolvePath(world, 'alice')).toMatchObject({ kind: 'actor', actor: { id: 'alice' } })
    expect(resolvePath(world, 'board.rule')).toMatchObject({ kind: 'board', board: { id: 'rule' } })
    expect(resolvePath(world, 'msg:m1')).toMatchObject({
      kind: 'message',
      message: { state: 'flying' },
    })
    expect(resolvePath(world, 'msg:alice:3@bob')).toMatchObject({
      kind: 'message',
      message: { state: 'parked' },
    })
    fails(() => resolvePath(world, 'carol'), /no actor "carol"/)
    fails(() => resolvePath(world, 'board.nope'), /no board "nope"/)
    fails(() => resolvePath(world, 'msg:m9'), /no message "m9"/)
  })

  it('actor selectors', () => {
    expect(resolvePath(world, 'alice@clock')).toMatchObject({
      kind: 'actorSelector',
      selector: 'clock',
    })
    expect(resolvePath(world, 'alice@status')).toMatchObject({
      kind: 'actorSelector',
      selector: 'status',
    })
    expect(resolvePath(world, 'alice@outbox')).toMatchObject({
      kind: 'actorSelector',
      selector: 'outbox',
    })
    expect(resolvePath(world, 'bob@inbox')).toMatchObject({
      kind: 'actorSelector',
      selector: 'inbox',
    })
    fails(() => resolvePath(world, 'bob@clock'), /no clock badge/)
    fails(() => resolvePath(world, 'bob@status'), /no status badge/)
    fails(() => resolvePath(world, 'alice@ts'), /@clock, @status, @outbox or @inbox/)
    fails(() => resolvePath(world, 'alice[x]'), /takes "\.slot"/)
    fails(() => resolvePath(world, 'alice.nope'), /no slot "nope"/)
  })

  it('slots, records and scalar meta', () => {
    const slot = resolvePath(world, 'alice.doc')
    expect(slot).toMatchObject({
      kind: 'value',
      value: { kind: 'record' },
      owner: { kind: 'actor', slot: 'doc' },
    })
    expect(resolvePath(world, 'alice.doc.title')).toMatchObject({
      kind: 'value',
      value: { value: 'Q3 plan' },
    })
    expect(resolvePath(world, 'alice.doc.title@ts')).toMatchObject({
      kind: 'meta',
      key: 'ts',
      value: 1,
    })
    expect(resolvePath(world, 'alice.doc.title@node')).toMatchObject({
      kind: 'meta',
      value: 'alice',
    })
    expect(resolvePath(world, 'alice.status@ts')).toMatchObject({ kind: 'meta', value: 2 })
    fails(() => resolvePath(world, 'alice.doc.missing'), /no field "missing"/)
    fails(() => resolvePath(world, 'alice.doc[x]'), /cannot apply "\[x\]" to the record/)
    fails(() => resolvePath(world, 'alice.doc.title@tomb'), /no @tomb/)
    fails(() => resolvePath(world, 'alice.doc.title@bogus'), /unknown selector @bogus/)
    fails(() => resolvePath(world, 'alice.doc.title.x'), /cannot apply "\.x" to the scalar/)
  })

  it('lists and sets: items by id, meta on items and on the collection', () => {
    const item = resolvePath(world, 'alice.list[milk]')
    expect(item).toMatchObject({ kind: 'value', value: { value: 'milk' }, item: { id: 'milk' } })
    expect(resolvePath(world, 'alice.list[milk]@tomb')).toMatchObject({
      kind: 'meta',
      key: 'tombstone',
      value: true,
    })
    expect(resolvePath(world, 'alice.list[milk]@tombstone')).toMatchObject({
      kind: 'meta',
      value: true,
    })
    expect(resolvePath(world, 'alice.cart[milk]@tags')).toMatchObject({
      kind: 'meta',
      value: [{ tag: 'alice:1', alive: true }],
    })
    expect(resolvePath(world, 'alice.views@vc')).toMatchObject({
      kind: 'meta',
      value: { alice: 2, bob: 1 },
    })
    fails(() => resolvePath(world, 'alice.list[nope]'), /no item "nope"/)
    fails(() => resolvePath(world, 'alice.list.x'), /cannot apply "\.x" to the list/)
  })

  it('counters: rows and @inc / @dec', () => {
    expect(resolvePath(world, 'alice.views[alice]')).toMatchObject({
      kind: 'counterRow',
      row: { node: 'alice' },
    })
    expect(resolvePath(world, 'alice.views[alice]@inc')).toMatchObject({
      kind: 'counterField',
      field: 'inc',
      value: 2,
    })
    expect(resolvePath(world, 'alice.views[alice]@dec')).toMatchObject({
      kind: 'counterField',
      value: 1,
    })
    fails(() => resolvePath(world, 'alice.views[bob]@dec'), /has no dec/)
    fails(() => resolvePath(world, 'alice.views[carol]'), /no row for node "carol"/)
    fails(() => resolvePath(world, 'alice.views[alice]@ts'), /@inc or @dec/)
    fails(() => resolvePath(world, 'alice.views[alice].x'), /nothing lies below/)
    fails(() => resolvePath(world, 'alice.views.alice'), /cannot apply "\.alice" to the counter/)
  })

  it('clocks: entries by node', () => {
    expect(resolvePath(world, 'alice.vc.alice')).toMatchObject({
      kind: 'clockEntry',
      node: 'alice',
      value: 2,
    })
    fails(() => resolvePath(world, 'alice.vc.carol'), /no entry for "carol"/)
    fails(() => resolvePath(world, 'alice.vc.alice@ts'), /takes no selector/)
    fails(() => resolvePath(world, 'alice.vc[alice]'), /cannot apply "\[alice\]" to the clock/)
  })

  it('tables: columns, rows, cells', () => {
    expect(resolvePath(world, 'board.table.how')).toMatchObject({
      kind: 'tableColumn',
      column: { key: 'how' },
    })
    expect(resolvePath(world, 'board.table[r1]')).toMatchObject({
      kind: 'tableRow',
      row: { id: 'r1' },
    })
    expect(resolvePath(world, 'board.table[r1].use')).toMatchObject({
      kind: 'value',
      value: { value: 'LWW register' },
      owner: { kind: 'board' },
    })
    fails(() => resolvePath(world, 'board.table[r2].use'), /no cell "use"/)
    fails(() => resolvePath(world, 'board.table.nope'), /no column "nope"/)
    fails(() => resolvePath(world, 'board.table[r9]'), /no row "r9"/)
    fails(() => resolvePath(world, 'board.table[r1][x]'), /takes "\.column"/)
    fails(() => resolvePath(world, 'board.table.how.x'), /nothing lies below/)
  })

  it('bytes: one byte, a range', () => {
    expect(resolvePath(world, 'alice.id[0]')).toMatchObject({ kind: 'byte', index: 0, value: 1 })
    expect(resolvePath(world, 'alice.id[5]')).toMatchObject({ kind: 'byte', value: 0 })
    expect(resolvePath(world, 'alice.id[0..2]')).toMatchObject({
      kind: 'range',
      from: 0,
      to: 2,
      value: [0x01, 0xa0],
    })
    fails(() => resolvePath(world, 'alice.id[6]'), /out of range/)
    fails(() => resolvePath(world, 'alice.id[x]'), /numeric index/)
    fails(() => resolvePath(world, 'alice.id[2..9]'), /exceeds 6 bytes/)
    fails(() => resolvePath(world, 'alice.id.x'), /cannot apply "\.x" to the bytes/)
  })

  it('text and pattern: ranges, tokens, cursors', () => {
    expect(resolvePath(world, 'alice.text[4..7]')).toMatchObject({ kind: 'range', value: 'cat' })
    expect(resolvePath(world, 'alice.text@cursor')).toMatchObject({ kind: 'cursor', index: 4 })
    expect(resolvePath(world, 'alice.pattern[p2]')).toMatchObject({
      kind: 'token',
      token: { src: 't' },
    })
    expect(resolvePath(world, 'alice.pattern@cursor')).toMatchObject({ kind: 'cursor', index: 1 })
    fails(() => resolvePath(world, 'alice.text[0..99]'), /exceeds 11 characters/)
    fails(() => resolvePath(world, 'alice.text[2]'), /cannot apply "\[2\]" to the text/)
    fails(() => resolvePath(world, 'alice.pattern[p9]'), /no token "p9"/)
    fails(() => resolvePath(world, 'board.rule@cursor'), /has no cursor/)
    fails(() => resolvePath(world, 'alice.doc@cursor'), /only defined on text and pattern/)
  })

  it('meter and boards below the root', () => {
    expect(resolvePath(world, 'alice.tries')).toMatchObject({
      kind: 'value',
      value: { kind: 'meter', value: 6 },
    })
    expect(resolvePath(world, 'board.events.price')).toMatchObject({
      kind: 'value',
      value: { value: 3 },
    })
    fails(() => resolvePath(world, 'alice.tries@ts'), /no @ts/)
    fails(() => resolvePath(world, 'alice.tries[x]'), /cannot apply "\[x\]" to the meter/)
  })

  it('errors carry the path in ctx', () => {
    try {
      resolvePath(world, 'alice.nope')
      expect.unreachable()
    } catch (e) {
      expect(e).toBeInstanceOf(ReducerError)
      expect((e as ReducerError).ctx?.path).toBe('alice.nope')
    }
  })
})

describe('getAt', () => {
  it('returns the value node, the board value, or undefined', () => {
    expect(getAt(world, 'alice.doc')).toBe(world.actors.alice?.holds.doc)
    expect(getAt(world, 'board.rule')).toBe(world.boards.rule?.value)
    expect(getAt(world, 'alice.doc.title@ts')).toBeUndefined()
    expect(getAt(world, 'alice.nope')).toBeUndefined()
    expect(getAt(world, 'alice')).toBeUndefined()
    expect(getAt(world, 'alice.views[alice]')).toBeUndefined()
  })
  it('still throws on malformed paths', () => {
    fails(() => getAt(world, 'alice..x'), /malformed/)
  })
})

// ─── Plain values (§4.5) ──────────────────────────────────────────────────────────────────────

describe('plainValueAt', () => {
  it.each<[string, unknown]>([
    ['alice.doc.title', 'Q3 plan'],
    ['alice.doc', { title: 'Q3 plan', owner: 'Bob' }],
    ['alice.list', ['eggs']], // tombstone excluded
    ['alice.cart', ['bread', 'milk']], // sorted
    ['alice.views', 2],
    ['alice.vc', { alice: 2, bob: 1 }],
    ['alice.id', '01a028e9b500'],
    ['alice.id[0..2]', '01a0'],
    ['alice.id[1]', 0xa0],
    ['board.table', [{ how: 'replaces', use: 'LWW register' }, { how: 'adds' }]],
    ['board.table[r1]', { how: 'replaces', use: 'LWW register' }],
    ['board.table.use', ['LWW register', null]],
    ['board.rule', 'merge: newer ts wins'],
    ['alice.text', 'the cat sat'],
    ['alice.text[4..7]', 'cat'],
    ['alice.text@cursor', 4],
    ['alice.pattern', 'c.t'],
    ['alice.pattern[p1]', '.'],
    ['alice.pattern@cursor', 1],
    ['alice.tries', 6],
    ['alice.doc.title@ts', 1],
    ['alice.cart[milk]@tags', [{ tag: 'alice:1', alive: true }]],
    ['alice.list[milk]@tomb', true],
    ['alice.views[alice]', { inc: 2, dec: 1 }],
    ['alice.views[bob]', { inc: 1 }],
    ['alice.views[alice]@inc', 2],
    ['alice.views@vc', { alice: 2, bob: 1 }],
    ['alice.vc.alice', 2],
    ['alice@clock', 5],
    ['alice@status', 'lock'],
    ['alice@outbox', ['alice:1']],
    ['bob@inbox', ['alice:3@bob']],
    ['alice@inbox', []],
  ])('%s → %j', (p, expected) => {
    expect(plainValueAt(world, p)).toEqual(expected)
  })

  it('actor cards and messages have no plain value; unresolved paths throw', () => {
    fails(() => plainValueAt(world, 'alice'), /no plain value/)
    fails(() => plainValueAt(world, 'msg:m1'), /not addressable/)
    fails(() => plainValueAt(world, 'alice.nope'), /does not resolve/)
  })

  it('plainValue sorts sets by value (numbers numerically)', () => {
    expect(
      plainValue({
        kind: 'set',
        items: [
          { id: '10', value: scalar(10) },
          { id: '2', value: scalar(2) },
          { id: 'x', value: scalar('x') },
        ],
      }),
    ).toEqual([2, 10, 'x'])
  })
})

// ─── Lenses ───────────────────────────────────────────────────────────────────────────────────

describe('setAt', () => {
  it('replaces an existing value with structural sharing', () => {
    const next = setAt(world, 'alice.doc.title', scalar('v2'))
    expect(plainValueAt(next, 'alice.doc.title')).toBe('v2')
    expect(plainValueAt(world, 'alice.doc.title')).toBe('Q3 plan')
    expect(next.actors.bob).toBe(world.actors.bob)
    expect(next.boards).toBe(world.boards)
    expect(next.actors.alice?.holds.list).toBe(world.actors.alice?.holds.list)
    expect(
      next.actors.alice?.holds.doc?.kind === 'record' && next.actors.alice.holds.doc.fields[1],
    ).toBe(
      world.actors.alice?.holds.doc?.kind === 'record'
        ? world.actors.alice.holds.doc.fields[1]
        : null,
    )
  })

  it('returns the same world when the same value reference is set', () => {
    const title = getAt(world, 'alice.doc.title') as Value
    expect(setAt(world, 'alice.doc.title', title)).toBe(world)
  })

  it('creates a missing slot, appended to holds', () => {
    const next = setAt(world, 'alice.fresh', scalar(1))
    expect(Object.keys(next.actors.alice?.holds ?? {}).at(-1)).toBe('fresh')
    expect(plainValueAt(next, 'alice.fresh')).toBe(1)
    fails(() => setAt(world, 'alice.fresh.x', scalar(1)), /no slot "fresh"/)
    fails(() => setAt(world, 'alice.fresh@ts', scalar(1)), /no slot "fresh"/)
  })

  it('creates a missing record field at the end', () => {
    const next = setAt(world, 'alice.doc.due', scalar('Fri'))
    expect(plainValueAt(next, 'alice.doc')).toEqual({ title: 'Q3 plan', owner: 'Bob', due: 'Fri' })
    fails(() => setAt(world, 'alice.doc.due.x', scalar(1)), /no field "due"/)
  })

  it('creates a missing list / set item', () => {
    const next = setAt(world, 'alice.list[bread]', scalar('bread'))
    expect(plainValueAt(next, 'alice.list')).toEqual(['eggs', 'bread'])
    const next2 = setAt(world, 'alice.cart[jam]', scalar('jam'))
    expect(plainValueAt(next2, 'alice.cart')).toEqual(['bread', 'jam', 'milk'])
    fails(() => setAt(world, 'alice.list[bread].x', scalar(1)), /no item "bread"/)
  })

  it('replaces one byte with a number', () => {
    const next = setAt(world, 'alice.id[0]', scalar(0x74))
    expect(plainValueAt(next, 'alice.id')).toBe('74a028e9b500')
    fails(() => setAt(world, 'alice.id[0]', scalar(300)), /not a byte/)
    fails(() => setAt(world, 'alice.id[0]', scalar('x')), /takes a number/)
    fails(() => setAt(world, 'alice.id[9]', scalar(1)), /out of range/)
    fails(() => setAt(world, 'alice.id[0..6]', scalar(1)), /setBytesRange/)
  })

  it('sets counter rows through @inc / @dec (creating the row when missing)', () => {
    const next = setAt(world, 'alice.views[alice]@inc', scalar(5))
    expect(plainValueAt(next, 'alice.views[alice]')).toEqual({ inc: 5, dec: 1 })
    expect(plainValueAt(next, 'alice.views')).toBe(5)
    const next2 = setAt(world, 'alice.views[carol]@inc', scalar(1))
    expect(plainValueAt(next2, 'alice.views[carol]')).toEqual({ inc: 1 })
    expect(plainValueAt(next2, 'alice.views')).toBe(3)
    fails(() => setAt(world, 'alice.views[alice]', scalar(1)), /@inc" or "\[node\]@dec/)
    fails(() => setAt(world, 'alice.views[alice]@dec', scalar('x')), /takes a number/)
    fails(() => setAt(world, 'alice.views[alice].x', scalar(1)), /nothing lies below/)
  })

  it('sets and creates clock entries', () => {
    const next = setAt(world, 'alice.vc.carol', scalar(1))
    expect(plainValueAt(next, 'alice.vc')).toEqual({ alice: 2, bob: 1, carol: 1 })
    expect(plainValueAt(setAt(world, 'alice.vc.alice', scalar(3)), 'alice.vc.alice')).toBe(3)
    fails(() => setAt(world, 'alice.vc.alice', scalar('x')), /takes a number/)
  })

  it('sets table cells (creating a missing cell of a known column)', () => {
    const next = setAt(world, 'board.table[r2].use', scalar('x'))
    expect(plainValueAt(next, 'board.table[r2]')).toEqual({ how: 'adds', use: 'x' })
    expect(
      plainValueAt(setAt(world, 'board.table[r1].how', scalar('y')), 'board.table[r1].how'),
    ).toBe('y')
    fails(() => setAt(world, 'board.table[r1].nope', scalar(1)), /no column "nope"/)
    fails(() => setAt(world, 'board.table[r9].how', scalar(1)), /no row "r9"/)
    fails(() => setAt(world, 'board.table[r1]', scalar(1)), /cell by cell/)
    fails(() => setAt(world, 'board.table.how', scalar(1)), /column cannot be set/)
  })

  it('replaces a board value at the board root', () => {
    const next = setAt(world, 'board.rule', scalar('new'))
    expect(plainValueAt(next, 'board.rule')).toBe('new')
    expect(next.boards.table).toBe(world.boards.table)
    fails(() => setAt(world, 'board.nope', scalar(1)), /no board "nope"/)
  })

  it('rejects cards, messages, meta, cursors, engine tokens and text ranges', () => {
    fails(() => setAt(world, 'alice', scalar(1)), /not a value/)
    fails(() => setAt(world, 'alice@clock', scalar(1)), /not assignable/)
    fails(() => setAt(world, 'msg:m1', scalar(1)), /immutable/)
    fails(() => setAt(world, 'alice.doc.title@ts', scalar(1)), /use patch/)
    fails(() => setAt(world, 'alice.text@cursor', scalar(1)), /not assignable/)
    fails(() => setAt(world, 'alice.pattern[p0]', scalar(1)), /regex engine/)
    fails(() => setAt(world, 'alice.text[0..3]', scalar(1)), /text range/)
    fails(() => setAt(world, 'carol.doc', scalar(1)), /no actor "carol"/)
    fails(() => setAt(world, 'alice.doc.title.x', scalar(1)), /cannot apply "\.x" to the scalar/)
  })
})

describe('updateAt', () => {
  it('applies f to the current value', () => {
    const next = updateAt(world, 'board.events.price', (v) =>
      v.kind === 'scalar' && typeof v.value === 'number' ? scalar(v.value + 1) : v,
    )
    expect(plainValueAt(next, 'board.events.price')).toBe(4)
    expect(
      plainValueAt(
        updateAt(world, 'board.rule', () => scalar('r')),
        'board.rule',
      ),
    ).toBe('r')
  })
  it('requires an existing value node', () => {
    fails(() => updateAt(world, 'alice.nope', (v) => v), /does not resolve/)
    fails(() => updateAt(world, 'alice.doc.title@ts', (v) => v), /addresses a meta/)
    fails(() => updateAt(world, 'alice', (v) => v), /addresses a actor/)
  })
})

describe('setBytesRange', () => {
  it('replaces a half-open byte range', () => {
    const next = setBytesRange(world, 'alice.id[0..2]', [0xaa, 0xbb])
    expect(plainValueAt(next, 'alice.id')).toBe('aabb28e9b500')
    expect(plainValueAt(setBytesRange(world, 'alice.id[4..6]', [1, 2]), 'alice.id')).toBe(
      '01a028e90102',
    )
  })
  it('checks the path, the length and the bytes', () => {
    fails(() => setBytesRange(world, 'alice.id[0..2]', [1]), /expected 2 bytes/)
    fails(() => setBytesRange(world, 'alice.id[0..2]', [1, 256]), /not a byte/)
    fails(() => setBytesRange(world, 'alice.id', [1]), /needs a "\[a\.\.b\]" path/)
    fails(() => setBytesRange(world, 'alice.text[0..1]', [1]), /not bytes/)
    fails(() => setBytesRange(world, 'alice.id[4..9]', [1, 2, 3, 4, 5]), /exceeds 6 bytes/)
  })
})

describe('patchMetaAt', () => {
  it('merges meta, removes undefined keys, drops an empty sidecar', () => {
    const next = patchMetaAt(world, 'alice.doc.title', { ts: 9, tag: 'alice:2' })
    expect(getAt(next, 'alice.doc.title')?.meta).toEqual({ ts: 9, node: 'alice', tag: 'alice:2' })
    const cleared = patchMetaAt(next, 'alice.doc.title', {
      ts: undefined,
      node: undefined,
      tag: undefined,
    })
    expect(getAt(cleared, 'alice.doc.title')).toEqual({ kind: 'scalar', value: 'Q3 plan' })
    expect('meta' in (getAt(cleared, 'alice.doc.title') ?? {})).toBe(false)
  })
  it('is a no-op on a value without meta when nothing is patched', () => {
    expect(patchMetaAt(world, 'alice.doc.owner', {})).toBe(world)
  })
  it('patches list items and boards; rejects non-values', () => {
    expect(
      getAt(patchMetaAt(world, 'alice.list[eggs]', { ts: 3 }), 'alice.list[eggs]')?.meta,
    ).toEqual({ ts: 3 })
    expect(getAt(patchMetaAt(world, 'board.rule', { note: 'n' }), 'board.rule')?.meta).toEqual({
      note: 'n',
    })
    fails(() => patchMetaAt(world, 'alice.views[alice]', { ts: 1 }), /addresses a counterRow/)
    fails(() => patchMetaAt(world, 'alice.nope', { ts: 1 }), /does not resolve/)
  })
})

describe('immutability', () => {
  it('never mutates the input world (deep-frozen fixture survives every lens)', () => {
    setAt(world, 'alice.doc.title', scalar('v2'))
    setAt(world, 'alice.fresh', scalar(1))
    setAt(world, 'alice.list[bread]', scalar('bread'))
    setAt(world, 'alice.views[carol]@inc', scalar(1))
    setBytesRange(world, 'alice.id[0..2]', [0, 0])
    patchMetaAt(world, 'alice.doc.title', { ts: 9 })
    expect(JSON.stringify(world)).toBe(snapshot)
  })
})
