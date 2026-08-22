/**
 * Paths (docs/animation-dsl.md §3): the one way commands and marks point at things on the stage.
 *
 *   Path      := Root Segment* Selector?
 *   Root      := ActorId | 'board.' BoardId | 'msg:' MessageId   ('msg:' takes the rest verbatim)
 *   Segment   := '.' Key | '[' Id ']' | '[' Int '..' Int ']'     (Id = any chars except ']'; a range is the last segment)
 *   Selector  := '@' Name                                         (Name = [A-Za-z]+)
 *
 * This module has three layers:
 *  - grammar: `parsePath` / `formatPath` / `isValidPath` (malformed paths throw `ReducerError`);
 *  - resolution: `resolvePath` follows the §3 table through a `World` and throws when a path does
 *    not resolve (never a silent no-op); `getAt` is the soft probe; `plainValueAt` / `plainValue`
 *    implement the §4.5 "plain value" rules used by `expect`;
 *  - lenses: `setAt` / `updateAt` / `setBytesRange` / `patchMetaAt` return a new `World` with
 *    structural sharing and the creation rules of §4.2. Values are never mutated.
 */
import {
  ReducerError,
  type Actor,
  type ActorId,
  type Board,
  type BoardId,
  type CounterRow,
  type Item,
  type Message,
  type MessageId,
  type Meta,
  type NodeId,
  type Path,
  type PatternToken,
  type SlotId,
  type TableRow,
  type Value,
  type ValueOf,
  type World,
} from './types'

// ─── Grammar ──────────────────────────────────────────────────────────────────────────────────

export type PathRoot =
  { kind: 'actor'; id: ActorId } | { kind: 'board'; id: BoardId } | { kind: 'msg'; id: MessageId }
export type PathSegment = { key: string } | { id: string } | { range: [number, number] }
export type ParsedPath = { root: PathRoot; segments: PathSegment[]; selector?: string }

/** Ids used as roots and keys: anything but the delimiters `.`, `[`, `]`, `@` and whitespace. */
const KEY_CHAR = /[^.[\]@\s]/
const RANGE = /^(\d+)\.\.(\d+)$/
const SELECTOR = /^[A-Za-z]+$/
/** `board` and `msg` are reserved roots and cannot be actor ids. */
export const RESERVED_IDS: readonly string[] = ['board', 'msg']

function malformed(p: string, why: string): ReducerError {
  return new ReducerError(`malformed path "${p}": ${why}`, { path: p })
}

function readKey(p: string, from: number): string {
  let i = from
  while (i < p.length && KEY_CHAR.test(p.charAt(i))) i += 1
  return p.slice(from, i)
}

/** Parse a path into its root, segments and selector. Throws `ReducerError` on a malformed path. */
export function parsePath(p: Path): ParsedPath {
  if (typeof p !== 'string' || p.length === 0) throw malformed(String(p), 'empty path')
  if (p.startsWith('msg:')) {
    const id = p.slice(4)
    if (id.length === 0) throw malformed(p, 'missing message id after "msg:"')
    return { root: { kind: 'msg', id }, segments: [] }
  }
  let root: PathRoot
  let i: number
  if (p.startsWith('board.')) {
    const id = readKey(p, 6)
    if (id.length === 0) throw malformed(p, 'missing board id after "board."')
    root = { kind: 'board', id }
    i = 6 + id.length
  } else {
    const id = readKey(p, 0)
    if (id.length === 0) throw malformed(p, `expected an actor id at 0`)
    if (RESERVED_IDS.includes(id)) throw malformed(p, `"${id}" is a reserved root`)
    root = { kind: 'actor', id }
    i = id.length
  }
  const segments: PathSegment[] = []
  let selector: string | undefined
  while (i < p.length) {
    const c = p.charAt(i)
    if (c === '.') {
      const key = readKey(p, i + 1)
      if (key.length === 0) throw malformed(p, `expected a key after "." at ${i}`)
      segments.push({ key })
      i += 1 + key.length
    } else if (c === '[') {
      const close = p.indexOf(']', i + 1)
      if (close < 0) throw malformed(p, `unclosed "[" at ${i}`)
      const inner = p.slice(i + 1, close)
      if (inner.length === 0) throw malformed(p, `empty "[]" at ${i}`)
      const m = RANGE.exec(inner)
      if (m) {
        const from = Number(m[1])
        const to = Number(m[2])
        if (from >= to) throw malformed(p, `empty or reversed range [${inner}]`)
        segments.push({ range: [from, to] })
        i = close + 1
        if (i !== p.length) throw malformed(p, 'a range must be the last segment')
      } else {
        segments.push({ id: inner })
        i = close + 1
      }
    } else if (c === '@') {
      const name = p.slice(i + 1)
      if (!SELECTOR.test(name)) throw malformed(p, 'a selector is "@" followed by letters only')
      selector = name
      i = p.length
    } else {
      throw malformed(p, `unexpected "${c}" at ${i}`)
    }
  }
  return selector === undefined ? { root, segments } : { root, segments, selector }
}

/** Inverse of `parsePath`: `formatPath(parsePath(p)) === p` for every valid path. */
export function formatPath(parsed: ParsedPath): Path {
  const { root, segments, selector } = parsed
  if (root.kind === 'msg') return `msg:${root.id}`
  let out = root.kind === 'board' ? `board.${root.id}` : root.id
  for (const seg of segments) {
    if ('key' in seg) out += `.${seg.key}`
    else if ('id' in seg) out += `[${seg.id}]`
    else out += `[${seg.range[0]}..${seg.range[1]}]`
  }
  if (selector !== undefined) out += `@${selector}`
  return out
}

/** Grammar check for the Zod schema (§13): true when `parsePath` accepts the string. */
export function isValidPath(p: unknown): p is Path {
  if (typeof p !== 'string') return false
  try {
    parsePath(p)
    return true
  } catch {
    return false
  }
}

function describeSegment(seg: PathSegment): string {
  if ('key' in seg) return `".${seg.key}"`
  if ('id' in seg) return `"[${seg.id}]"`
  return `"[${seg.range[0]}..${seg.range[1]}]"`
}

// ─── Resolution ───────────────────────────────────────────────────────────────────────────────

/** Who holds the value a path reached: an actor slot or a board. */
export type Owner = { kind: 'actor'; actor: Actor; slot: SlotId } | { kind: 'board'; board: Board }

export type ActorSelector = 'clock' | 'status' | 'outbox' | 'inbox'
export const ACTOR_SELECTORS: readonly ActorSelector[] = ['clock', 'status', 'outbox', 'inbox']

/** `@name` → `Meta` key; `@tomb` is short for `@tombstone`. */
export const META_SELECTORS: Readonly<Record<string, keyof Meta>> = {
  ts: 'ts',
  node: 'node',
  hlc: 'hlc',
  tag: 'tag',
  tags: 'tags',
  tomb: 'tombstone',
  tombstone: 'tombstone',
  addTs: 'addTs',
  removeTs: 'removeTs',
  vc: 'vc',
  applied: 'applied',
  stats: 'stats',
  type: 'type',
  note: 'note',
}

/** What a path points at (§3 table). Non-root kinds carry the `owner` of the value tree. */
export type Resolved =
  | { kind: 'actor'; actor: Actor } // root-only path: the whole card
  | { kind: 'board'; board: Board } // root-only path: the whole board card
  | { kind: 'message'; message: Message } // msg:<id>: a token in flight or parked
  | { kind: 'actorSelector'; actor: Actor; selector: ActorSelector } // <actor>@clock / @status / @outbox / @inbox
  | { kind: 'value'; value: Value; owner: Owner; item?: Item } // a value node; `item` when reached through `[id]` on a list/set
  | { kind: 'meta'; on: Value; key: keyof Meta; value: unknown; owner: Owner } // <value>@ts, @node, @tomb …
  | { kind: 'counterRow'; on: ValueOf<'counter'>; row: CounterRow; owner: Owner } // counter[node]
  | {
      kind: 'counterField'
      on: ValueOf<'counter'>
      row: CounterRow
      field: 'inc' | 'dec'
      value: number
      owner: Owner
    } // counter[node]@inc / @dec
  | { kind: 'clockEntry'; on: ValueOf<'clock'>; node: NodeId; value: number; owner: Owner } // clock.node
  | {
      kind: 'tableColumn'
      on: ValueOf<'table'>
      column: { key: string; label: string }
      owner: Owner
    } // table.column (vertical band)
  | { kind: 'tableRow'; on: ValueOf<'table'>; row: TableRow; owner: Owner } // table[id]
  | { kind: 'byte'; on: ValueOf<'bytes'>; index: number; value: number; owner: Owner } // bytes[i]
  | {
      kind: 'range'
      on: ValueOf<'bytes'> | ValueOf<'text'>
      from: number
      to: number
      value: number[] | string
      owner: Owner
    } // bytes[a..b] / text[a..b], half-open
  | { kind: 'token'; on: ValueOf<'pattern'>; token: PatternToken; owner: Owner } // pattern[p0]
  | { kind: 'cursor'; on: ValueOf<'text'> | ValueOf<'pattern'>; index: number; owner: Owner } // text@cursor / pattern@cursor

function unresolved(p: Path, why: string): ReducerError {
  return new ReducerError(`path "${p}" does not resolve: ${why}`, { path: p })
}

function isAlive(item: Item): boolean {
  return item.value.meta?.tombstone !== true
}

/** Walk `segments` + `selector` down a value tree (§3 table, rows below actor/board). */
function walk(start: Value, parsed: ParsedPath, from: number, owner: Owner, p: Path): Resolved {
  const { segments, selector } = parsed
  const prefixAt = (i: number): string =>
    formatPath({ root: parsed.root, segments: segments.slice(0, i) })
  let node: Value = start
  let item: Item | undefined
  for (let i = from; i < segments.length; i += 1) {
    const seg = segments[i] as PathSegment
    const last = i === segments.length - 1
    const here = prefixAt(i)
    const below = (): never => {
      throw unresolved(
        p,
        `nothing lies below ${describeSegment(seg)} on the ${node.kind} at "${here}"`,
      )
    }
    switch (node.kind) {
      case 'record':
        if ('key' in seg) {
          const field = node.fields.find((f) => f.key === seg.key)
          if (!field) throw unresolved(p, `record "${here}" has no field "${seg.key}"`)
          node = field.value
          item = undefined
          continue
        }
        break
      case 'list':
      case 'set':
        if ('id' in seg) {
          const found = node.items.find((it) => it.id === seg.id)
          if (!found) throw unresolved(p, `${node.kind} "${here}" has no item "${seg.id}"`)
          node = found.value
          item = found
          continue
        }
        break
      case 'counter':
        if ('id' in seg) {
          const row = node.rows.find((r) => r.node === seg.id)
          if (!row) throw unresolved(p, `counter "${here}" has no row for node "${seg.id}"`)
          if (!last) below()
          if (selector === undefined) return { kind: 'counterRow', on: node, row, owner }
          if (selector === 'inc' || selector === 'dec') {
            const value = row[selector]
            if (value === undefined)
              throw unresolved(p, `row "${seg.id}" of "${here}" has no ${selector}`)
            return { kind: 'counterField', on: node, row, field: selector, value, owner }
          }
          throw unresolved(p, `a counter row takes @inc or @dec, not @${selector}`)
        }
        break
      case 'clock':
        if ('key' in seg) {
          const value = node.entries[seg.key]
          if (value === undefined)
            throw unresolved(p, `clock "${here}" has no entry for "${seg.key}"`)
          if (!last) below()
          if (selector !== undefined)
            throw unresolved(p, `a clock entry takes no selector (@${selector})`)
          return { kind: 'clockEntry', on: node, node: seg.key, value, owner }
        }
        break
      case 'table':
        if ('key' in seg) {
          const column = node.columns.find((c) => c.key === seg.key)
          if (!column) throw unresolved(p, `table "${here}" has no column "${seg.key}"`)
          if (!last) below()
          if (selector !== undefined)
            throw unresolved(p, `a table column takes no selector (@${selector})`)
          return { kind: 'tableColumn', on: node, column, owner }
        }
        if ('id' in seg) {
          const row = node.rows.find((r) => r.id === seg.id)
          if (!row) throw unresolved(p, `table "${here}" has no row "${seg.id}"`)
          if (last) {
            if (selector !== undefined)
              throw unresolved(p, `a table row takes no selector (@${selector})`)
            return { kind: 'tableRow', on: node, row, owner }
          }
          const next = segments[i + 1] as PathSegment
          if (!('key' in next)) {
            throw unresolved(p, `a table row takes ".column", not ${describeSegment(next)}`)
          }
          const cell = row.cells[next.key]
          if (!cell)
            throw unresolved(p, `row "${seg.id}" of table "${here}" has no cell "${next.key}"`)
          node = cell
          item = undefined
          i += 1
          continue
        }
        break
      case 'bytes':
        if ('id' in seg) {
          if (!/^\d+$/.test(seg.id))
            throw unresolved(p, `bytes take a numeric index, not "[${seg.id}]"`)
          const index = Number(seg.id)
          const value = node.bytes[index]
          if (value === undefined) {
            throw unresolved(
              p,
              `byte index ${index} is out of range (${node.bytes.length} bytes at "${here}")`,
            )
          }
          if (!last) below()
          if (selector !== undefined) throw unresolved(p, `a byte takes no selector (@${selector})`)
          return { kind: 'byte', on: node, index, value, owner }
        }
        if ('range' in seg) {
          const [a, b] = seg.range
          if (b > node.bytes.length) {
            throw unresolved(
              p,
              `range [${a}..${b}] exceeds ${node.bytes.length} bytes at "${here}"`,
            )
          }
          return { kind: 'range', on: node, from: a, to: b, value: node.bytes.slice(a, b), owner }
        }
        break
      case 'text':
        if ('range' in seg) {
          const [a, b] = seg.range
          if (b > node.text.length) {
            throw unresolved(
              p,
              `range [${a}..${b}] exceeds ${node.text.length} characters at "${here}"`,
            )
          }
          return { kind: 'range', on: node, from: a, to: b, value: node.text.slice(a, b), owner }
        }
        break
      case 'pattern':
        if ('id' in seg) {
          const token = node.tokens.find((t) => t.id === seg.id)
          if (!token) throw unresolved(p, `pattern "${here}" has no token "${seg.id}"`)
          if (!last) below()
          if (selector !== undefined)
            throw unresolved(p, `a pattern token takes no selector (@${selector})`)
          return { kind: 'token', on: node, token, owner }
        }
        break
      case 'scalar':
      case 'meter':
        break
    }
    throw unresolved(p, `cannot apply ${describeSegment(seg)} to the ${node.kind} at "${here}"`)
  }
  if (selector === undefined) {
    return item
      ? { kind: 'value', value: node, owner, item }
      : { kind: 'value', value: node, owner }
  }
  if (selector === 'cursor') {
    if (node.kind !== 'text' && node.kind !== 'pattern') {
      throw unresolved(p, `@cursor is only defined on text and pattern values, not ${node.kind}`)
    }
    if (node.cursor === undefined) throw unresolved(p, `the ${node.kind} has no cursor`)
    return { kind: 'cursor', on: node, index: node.cursor, owner }
  }
  const key = META_SELECTORS[selector]
  if (key === undefined) throw unresolved(p, `unknown selector @${selector}`)
  const value = node.meta?.[key]
  if (value === undefined) throw unresolved(p, `no @${selector} on this ${node.kind}`)
  return { kind: 'meta', on: node, key, value, owner }
}

/** Resolve a path in a world (§3). Throws `ReducerError` when it is malformed or does not resolve. */
export function resolvePath(world: World, p: Path): Resolved {
  const parsed = parsePath(p)
  const { root, segments, selector } = parsed
  switch (root.kind) {
    case 'msg': {
      const message = world.messages.find((m) => m.id === root.id)
      if (!message) throw unresolved(p, `no message "${root.id}" is in flight or parked`)
      return { kind: 'message', message }
    }
    case 'board': {
      const board = world.boards[root.id]
      if (!board) throw unresolved(p, `no board "${root.id}"`)
      if (segments.length === 0 && selector === undefined) return { kind: 'board', board }
      return walk(board.value, parsed, 0, { kind: 'board', board }, p)
    }
    case 'actor': {
      const actor = world.actors[root.id]
      if (!actor) throw unresolved(p, `no actor "${root.id}"`)
      if (segments.length === 0) {
        if (selector === undefined) return { kind: 'actor', actor }
        if (!(ACTOR_SELECTORS as readonly string[]).includes(selector)) {
          throw unresolved(p, `an actor takes @clock, @status, @outbox or @inbox, not @${selector}`)
        }
        const sel = selector as ActorSelector
        if (sel === 'clock' && actor.skew === undefined) {
          throw unresolved(p, `actor "${actor.id}" draws no clock badge (no skew set)`)
        }
        if (sel === 'status' && actor.status === undefined) {
          throw unresolved(p, `actor "${actor.id}" has no status badge`)
        }
        return { kind: 'actorSelector', actor, selector: sel }
      }
      const first = segments[0] as PathSegment
      if (!('key' in first)) {
        throw unresolved(p, `an actor root takes ".slot", not ${describeSegment(first)}`)
      }
      const value = actor.holds[first.key]
      if (!value) throw unresolved(p, `actor "${actor.id}" has no slot "${first.key}"`)
      return walk(value, parsed, 1, { kind: 'actor', actor, slot: first.key }, p)
    }
  }
}

/**
 * Soft probe: the `Value` at `p`, or `undefined` when the path resolves to nothing or to a node that
 * is not a value (a card, a meta badge, a byte …). A board root yields the board's value.
 * Malformed paths still throw.
 */
export function getAt(world: World, p: Path): Value | undefined {
  parsePath(p)
  let r: Resolved
  try {
    r = resolvePath(world, p)
  } catch (e) {
    if (e instanceof ReducerError) return undefined
    throw e
  }
  if (r.kind === 'value') return r.value
  if (r.kind === 'board') return r.board.value
  return undefined
}

// ─── Plain values (§4.5) ──────────────────────────────────────────────────────────────────────

/** Lower-case hex of a byte array (`[1, 160]` → `"01a0"`). */
export function toHex(bytes: readonly number[]): string {
  return bytes.map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** Deterministic order for set plain values: numbers first (numerically), then strings (code unit), then the rest by JSON. */
function comparePlain(a: unknown, b: unknown): number {
  if (typeof a === 'number' && typeof b === 'number') return a - b
  if (typeof a === 'number') return -1
  if (typeof b === 'number') return 1
  if (typeof a === 'string' && typeof b === 'string') return a < b ? -1 : a > b ? 1 : 0
  if (typeof a === 'string') return -1
  if (typeof b === 'string') return 1
  const ja = JSON.stringify(a) ?? ''
  const jb = JSON.stringify(b) ?? ''
  return ja < jb ? -1 : ja > jb ? 1 : 0
}

function rowObject(row: TableRow): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, cell] of Object.entries(row.cells)) out[key] = plainValue(cell)
  return out
}

/**
 * The plain value of a `Value` (§4.5): scalar → its value; record → object; list → array of plain
 * values (tombstones excluded); set → sorted array; counter → total; clock → entries; bytes →
 * lower-case hex; table → array of row objects (cells only); text → the string; pattern → its
 * source; meter → its value.
 */
export function plainValue(v: Value): unknown {
  switch (v.kind) {
    case 'scalar':
      return v.value
    case 'record': {
      const out: Record<string, unknown> = {}
      for (const f of v.fields) out[f.key] = plainValue(f.value)
      return out
    }
    case 'list':
      return v.items.filter(isAlive).map((it) => plainValue(it.value))
    case 'set':
      return v.items
        .filter(isAlive)
        .map((it) => plainValue(it.value))
        .sort(comparePlain)
    case 'counter':
      return v.total
    case 'clock':
      return { ...v.entries }
    case 'bytes':
      return toHex(v.bytes)
    case 'table':
      return v.rows.map(rowObject)
    case 'text':
      return v.text
    case 'pattern':
      return v.tokens.map((t) => t.src).join('')
    case 'meter':
      return v.value
  }
}

/**
 * The plain value of the node at `p` (§4.5) — what `expect.equals` is compared with. Beyond
 * `plainValue`: `@meta` → the meta value; `@cursor` → the index; a counter row → `{ inc, dec? }`;
 * `[node]@inc` / a clock entry / a byte → the number; a byte range → hex, a text range → the
 * substring; a table row → its cells, a column → its cells down the rows; a pattern token → its
 * source; `<actor>@clock` → the actor's wall time, `@status` → the status word (or null),
 * `@outbox` → pending op ids, `@inbox` → parked message ids; a board root → its value's plain value.
 * Actor cards and messages have no plain value (throws).
 */
export function plainValueAt(world: World, p: Path): unknown {
  const r = resolvePath(world, p)
  switch (r.kind) {
    case 'value':
      return plainValue(r.value)
    case 'board':
      return plainValue(r.board.value)
    case 'meta':
      return r.value
    case 'cursor':
      return r.index
    case 'counterRow':
      return r.row.dec === undefined ? { inc: r.row.inc } : { inc: r.row.inc, dec: r.row.dec }
    case 'counterField':
    case 'clockEntry':
    case 'byte':
      return r.value
    case 'range':
      return typeof r.value === 'string' ? r.value : toHex(r.value)
    case 'tableRow':
      return rowObject(r.row)
    case 'tableColumn':
      return r.on.rows.map((row) => {
        const cell = row.cells[r.column.key]
        return cell ? plainValue(cell) : null
      })
    case 'token':
      return r.token.src
    case 'actorSelector':
      switch (r.selector) {
        case 'clock':
          return world.clock.now + (r.actor.skew ?? 0)
        case 'status':
          return r.actor.status ?? null
        case 'outbox':
          return r.actor.outbox.map((chip) => chip.id)
        case 'inbox':
          return world.messages
            .filter((m) => m.state === 'parked' && m.to === r.actor.id)
            .map((m) => m.id)
      }
      break
    case 'actor':
      throw new ReducerError(`path "${p}" is a whole actor card; it has no plain value`, {
        path: p,
      })
    case 'message':
      throw new ReducerError(`path "${p}" is a message; its payload is not addressable`, {
        path: p,
      })
  }
  // Exhaustiveness guard: every kind above returns or throws.
  throw new ReducerError(`path "${p}" has no plain value`, { path: p })
}

// ─── Lenses ───────────────────────────────────────────────────────────────────────────────────

function cannotSet(p: Path, why: string): ReducerError {
  return new ReducerError(`cannot set "${p}": ${why}`, { path: p })
}

function isNumberScalar(v: Value): v is ValueOf<'scalar'> & { value: number } {
  return v.kind === 'scalar' && typeof v.value === 'number'
}

function checkByte(p: Path, n: number): void {
  if (!Number.isInteger(n) || n < 0 || n > 255) throw cannotSet(p, `${n} is not a byte (0–255)`)
}

function counterTotal(rows: readonly CounterRow[]): number {
  return rows.reduce((sum, r) => sum + r.inc - (r.dec ?? 0), 0)
}

/**
 * Replace the node addressed by `segments[at..]` + `selector` inside `node` (§4.2 rules):
 * a missing record field / list or set item / clock entry / counter row / table cell is created at
 * the leaf; a byte index takes a number; meta and cursors are not assignable here.
 */
function setIn(node: Value, parsed: ParsedPath, at: number, v: Value, p: Path): Value {
  const { segments, selector } = parsed
  if (at >= segments.length) {
    if (selector === undefined) return v
    throw cannotSet(p, `"@${selector}" is not assignable (use patch for meta)`)
  }
  const seg = segments[at] as PathSegment
  const rest = at + 1
  const leaf = rest === segments.length && selector === undefined
  const here = formatPath({ root: parsed.root, segments: segments.slice(0, at) })
  switch (node.kind) {
    case 'record':
      if ('key' in seg) {
        const idx = node.fields.findIndex((f) => f.key === seg.key)
        const field = node.fields[idx]
        if (!field) {
          if (!leaf) throw cannotSet(p, `record "${here}" has no field "${seg.key}"`)
          return { ...node, fields: [...node.fields, { key: seg.key, value: v }] }
        }
        const next = setIn(field.value, parsed, rest, v, p)
        if (next === field.value) return node
        return {
          ...node,
          fields: node.fields.map((f, i) => (i === idx ? { key: f.key, value: next } : f)),
        }
      }
      break
    case 'list':
    case 'set':
      if ('id' in seg) {
        const idx = node.items.findIndex((it) => it.id === seg.id)
        const found = node.items[idx]
        if (!found) {
          if (!leaf) throw cannotSet(p, `${node.kind} "${here}" has no item "${seg.id}"`)
          return { ...node, items: [...node.items, { id: seg.id, value: v }] }
        }
        const next = setIn(found.value, parsed, rest, v, p)
        if (next === found.value) return node
        return {
          ...node,
          items: node.items.map((it, i) => (i === idx ? { ...it, value: next } : it)),
        }
      }
      break
    case 'counter':
      if ('id' in seg) {
        if (rest !== segments.length) throw cannotSet(p, `nothing lies below a counter row`)
        if (selector !== 'inc' && selector !== 'dec') {
          throw cannotSet(p, `a counter row is set through "[node]@inc" or "[node]@dec"`)
        }
        if (!isNumberScalar(v)) throw cannotSet(p, `@${selector} takes a number`)
        const idx = node.rows.findIndex((r) => r.node === seg.id)
        const rows =
          idx < 0
            ? [...node.rows, { node: seg.id, inc: 0, [selector]: v.value } as CounterRow]
            : node.rows.map((r, i) => (i === idx ? { ...r, [selector]: v.value } : r))
        return { ...node, rows, total: counterTotal(rows) }
      }
      break
    case 'clock':
      if ('key' in seg) {
        if (!leaf) throw cannotSet(p, `nothing lies below a clock entry`)
        if (!isNumberScalar(v)) throw cannotSet(p, `a clock entry takes a number`)
        if (node.entries[seg.key] === v.value) return node
        return { ...node, entries: { ...node.entries, [seg.key]: v.value } }
      }
      break
    case 'table':
      if ('key' in seg) throw cannotSet(p, `a table column cannot be set as a whole`)
      if ('id' in seg) {
        const idx = node.rows.findIndex((r) => r.id === seg.id)
        const row = node.rows[idx]
        if (!row) throw cannotSet(p, `table "${here}" has no row "${seg.id}" (use insert)`)
        const cellSeg = segments[rest]
        if (cellSeg === undefined)
          throw cannotSet(p, `a table row is set cell by cell ("[id].column")`)
        if (!('key' in cellSeg))
          throw cannotSet(p, `a table row takes ".column", not ${describeSegment(cellSeg)}`)
        if (!node.columns.some((c) => c.key === cellSeg.key)) {
          throw cannotSet(p, `table "${here}" has no column "${cellSeg.key}"`)
        }
        const cur = row.cells[cellSeg.key]
        let next: Value
        if (cur === undefined) {
          if (rest + 1 !== segments.length || selector !== undefined) {
            throw cannotSet(p, `row "${seg.id}" of table "${here}" has no cell "${cellSeg.key}"`)
          }
          next = v
        } else {
          next = setIn(cur, parsed, rest + 1, v, p)
          if (next === cur) return node
        }
        return {
          ...node,
          rows: node.rows.map((r, i) =>
            i === idx ? { ...r, cells: { ...r.cells, [cellSeg.key]: next } } : r,
          ),
        }
      }
      break
    case 'bytes':
      if ('id' in seg) {
        if (!/^\d+$/.test(seg.id))
          throw cannotSet(p, `bytes take a numeric index, not "[${seg.id}]"`)
        const index = Number(seg.id)
        if (index >= node.bytes.length) {
          throw cannotSet(p, `byte index ${index} is out of range (${node.bytes.length} bytes)`)
        }
        if (!leaf) throw cannotSet(p, `nothing lies below a byte`)
        if (!isNumberScalar(v)) throw cannotSet(p, `a byte takes a number`)
        checkByte(p, v.value)
        if (node.bytes[index] === v.value) return node
        return { ...node, bytes: node.bytes.map((b, i) => (i === index ? v.value : b)) }
      }
      if ('range' in seg) throw cannotSet(p, `a byte range is set with setBytesRange`)
      break
    case 'text':
      if ('range' in seg) throw cannotSet(p, `a text range cannot be set; set the whole text`)
      break
    case 'pattern':
      if ('id' in seg) throw cannotSet(p, `pattern tokens are written by the regex engine`)
      break
    case 'scalar':
    case 'meter':
      break
  }
  throw cannotSet(p, `cannot apply ${describeSegment(seg)} to the ${node.kind} at "${here}"`)
}

/**
 * Return a new world with `v` at `p` (structural sharing; `world` is untouched). Creation rules of
 * §4.2: `<actor>.<slot>` with no such slot appends the slot to `holds`; a missing record field,
 * list/set item, clock entry, counter row or table cell is created at the leaf; `bytes[i]` takes a
 * number. A board root replaces the board's value. Anything else that does not resolve throws.
 */
export function setAt(world: World, p: Path, v: Value): World {
  const parsed = parsePath(p)
  const { root, segments, selector } = parsed
  switch (root.kind) {
    case 'msg':
      throw cannotSet(p, `messages are immutable`)
    case 'board': {
      const board = world.boards[root.id]
      if (!board)
        throw cannotSet(p, `no board "${root.id}" (boards are created by note or the scene world)`)
      const value = setIn(board.value, parsed, 0, v, p)
      if (value === board.value) return world
      return { ...world, boards: { ...world.boards, [root.id]: { ...board, value } } }
    }
    case 'actor': {
      const actor = world.actors[root.id]
      if (!actor) throw cannotSet(p, `no actor "${root.id}"`)
      if (segments.length === 0) {
        throw cannotSet(
          p,
          selector === undefined
            ? `an actor card is not a value`
            : `"@${selector}" is not assignable`,
        )
      }
      const first = segments[0] as PathSegment
      if (!('key' in first))
        throw cannotSet(p, `an actor root takes ".slot", not ${describeSegment(first)}`)
      const slot = first.key
      const existing = actor.holds[slot]
      let value: Value
      if (existing === undefined) {
        if (segments.length > 1 || selector !== undefined) {
          throw cannotSet(p, `actor "${actor.id}" has no slot "${slot}"`)
        }
        value = v
      } else {
        value = setIn(existing, parsed, 1, v, p)
        if (value === existing) return world
      }
      return {
        ...world,
        actors: {
          ...world.actors,
          [root.id]: { ...actor, holds: { ...actor.holds, [slot]: value } },
        },
      }
    }
  }
}

/** `setAt(world, p, f(current))` — the value at `p` must exist (a board root counts as its value). */
export function updateAt(world: World, p: Path, f: (v: Value) => Value): World {
  const r = resolvePath(world, p)
  if (r.kind === 'value') return setAt(world, p, f(r.value))
  if (r.kind === 'board') return setAt(world, p, f(r.board.value))
  throw new ReducerError(`cannot update "${p}": it addresses a ${r.kind}, not a value`, { path: p })
}

/** Replace the byte range `[a..b]` (half-open) of a bytes value with exactly `b - a` bytes (§4.2). */
export function setBytesRange(world: World, p: Path, bytes: readonly number[]): World {
  const parsed = parsePath(p)
  const last = parsed.segments[parsed.segments.length - 1]
  if (!last || !('range' in last)) throw cannotSet(p, `setBytesRange needs a "[a..b]" path`)
  const [from, to] = last.range
  const base = formatPath({ root: parsed.root, segments: parsed.segments.slice(0, -1) })
  return updateAt(world, base, (cur) => {
    if (cur.kind !== 'bytes') throw cannotSet(p, `"${base}" is a ${cur.kind}, not bytes`)
    if (to > cur.bytes.length) throw cannotSet(p, `range exceeds ${cur.bytes.length} bytes`)
    if (bytes.length !== to - from) {
      throw cannotSet(p, `expected ${to - from} bytes for [${from}..${to}], got ${bytes.length}`)
    }
    for (const b of bytes) checkByte(p, b)
    return { ...cur, bytes: [...cur.bytes.slice(0, from), ...bytes, ...cur.bytes.slice(to)] }
  })
}

/**
 * Merge `meta` into the sidecar of the value at `p` (§4.2 `patch`). Keys set to `undefined` are
 * removed; an empty result drops `meta` altogether.
 */
export function patchMetaAt(world: World, p: Path, meta: Partial<Meta>): World {
  return updateAt(world, p, (cur) => {
    const merged: Record<string, unknown> = { ...cur.meta }
    for (const [key, val] of Object.entries(meta)) {
      if (val === undefined) delete merged[key]
      else merged[key] = val
    }
    if (Object.keys(merged).length === 0) {
      if (cur.meta === undefined) return cur
      const copy = { ...cur }
      delete copy.meta
      return copy
    }
    return { ...cur, meta: merged as Meta }
  })
}
