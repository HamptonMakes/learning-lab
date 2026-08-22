/**
 * Value commands (DSL §4.2): set / patch / insert / delete / move / sort / annotate / unannotate /
 * view on plain slots and boards — never on CRDT-managed or engine-written slots (those throw).
 * The lenses of `../path.ts` do the tree surgery (structural sharing, §4.2 creation rules); this
 * module adds the per-command rules and records `quiet` paths in the step scratch.
 */
import { SLOT_NAMES } from '../../regex'
import {
  formatPath,
  getAt,
  META_SELECTORS,
  parsePath,
  patchMetaAt,
  plainValue,
  resolvePath,
  setAt,
  setBytesRange,
  updateAt,
  type ParsedPath,
} from '../path'
import {
  type ActorId,
  type Annotation,
  type Item,
  type Path,
  type SlotId,
  type SortKey,
  type TableRow,
  type Value,
  type ValueCommand,
  type World,
} from '../types'
import { fail, markQuiet, type ReduceCtxX } from './scratch'
import { isScalar } from './world'

// ─── Slot guards (shared with messages.ts: `deliver … into`) ───────────────────────────────────

export function isCrdtSlot(w: World, actor: ActorId, slot: SlotId): boolean {
  return w.replicas[actor]?.[slot] !== undefined
}

export function isEngineSlot(w: World, actor: ActorId, slot: SlotId): boolean {
  return w.engines[actor] !== undefined && (SLOT_NAMES as readonly string[]).includes(slot)
}

/** The `{ actor, slot }` a path writes into, or undefined for board / root-only paths. */
export function slotOfPath(parsed: ParsedPath): { actor: ActorId; slot: SlotId } | undefined {
  if (parsed.root.kind !== 'actor') return undefined
  const first = parsed.segments[0]
  if (!first || !('key' in first)) return undefined
  return { actor: parsed.root.id, slot: first.key }
}

/** Throws when a value write at `path` would touch a CRDT replica, an engine slot or a message. */
export function assertPlainTarget(w: World, path: Path, ctx: ReduceCtxX, cmd: unknown): ParsedPath {
  const parsed = parsePath(path)
  if (parsed.root.kind === 'msg') {
    throw fail(ctx, cmd, `cannot write to "${path}": messages are immutable`, path)
  }
  const at = slotOfPath(parsed)
  if (at) {
    if (isCrdtSlot(w, at.actor, at.slot)) {
      throw fail(
        ctx,
        cmd,
        `slot "${at.slot}" of "${at.actor}" is CRDT-managed; use crdt.update`,
        path,
      )
    }
    if (isEngineSlot(w, at.actor, at.slot)) {
      throw fail(
        ctx,
        cmd,
        `slot "${at.slot}" of "${at.actor}" is written by the regex engine; use regex.advance`,
        path,
      )
    }
  }
  return parsed
}

// ─── Helpers ─────────────────────────────────────────────────────────────────────────────────

function parentOf(parsed: ParsedPath): Path {
  return formatPath({ root: parsed.root, segments: parsed.segments.slice(0, -1) })
}

function insertAtIndex<T>(items: readonly T[], item: T, index: number | undefined): T[] {
  if (index === undefined) return [...items, item]
  return [...items.slice(0, index), item, ...items.slice(index)]
}

function checkIndex(ctx: ReduceCtxX, cmd: unknown, index: number, max: number, what: string): void {
  if (!Number.isInteger(index) || index < 0 || index > max) {
    throw fail(ctx, cmd, `${what}: index ${index} is out of range (0..${max})`)
  }
}

function withTombstone(v: Value): Value {
  return { ...v, meta: { ...v.meta, tombstone: true } }
}

function moveItem<T>(items: readonly T[], from: number, to: number): T[] {
  const out = [...items]
  const [it] = out.splice(from, 1)
  out.splice(to, 0, it as T)
  return out
}

/** What `sort` compares for a list item value: bytes bytewise, everything else by plain value. */
function sortable(v: Value): unknown {
  return v.kind === 'bytes' ? v.bytes : plainValue(v)
}

function compareSortable(a: unknown, b: unknown): number {
  if (a === undefined && b === undefined) return 0
  if (a === undefined) return 1
  if (b === undefined) return -1
  if (a === null && b === null) return 0
  if (a === null) return 1
  if (b === null) return -1
  if (typeof a === 'number' && typeof b === 'number') return a - b
  if (typeof a === 'string' && typeof b === 'string') return a < b ? -1 : a > b ? 1 : 0
  if (typeof a === 'boolean' && typeof b === 'boolean') return Number(a) - Number(b)
  if (Array.isArray(a) && Array.isArray(b)) {
    const n = Math.min(a.length, b.length)
    for (let i = 0; i < n; i += 1) {
      const c = compareSortable(a[i], b[i])
      if (c !== 0) return c
    }
    return a.length - b.length
  }
  const ja = JSON.stringify(a) ?? ''
  const jb = JSON.stringify(b) ?? ''
  return ja < jb ? -1 : ja > jb ? 1 : 0
}

function itemKey(item: Item, key: SortKey, ctx: ReduceCtxX, cmd: unknown): unknown {
  if (key === 'value') return sortable(item.value)
  if (key === 'id') return item.id
  if (key.startsWith('@')) {
    const metaKey = META_SELECTORS[key.slice(1)]
    if (metaKey === undefined) throw fail(ctx, cmd, `sort: unknown meta key "${key}"`)
    return item.value.meta?.[metaKey]
  }
  if (key.startsWith('.')) {
    const field = key.slice(1)
    if (item.value.kind !== 'record') return undefined
    const f = item.value.fields.find((x) => x.key === field)
    return f ? sortable(f.value) : undefined
  }
  throw fail(ctx, cmd, `sort: bad key "${key}"`)
}

function rowKey(row: TableRow, key: SortKey, ctx: ReduceCtxX, cmd: unknown): unknown {
  if (key === 'id') return row.id
  if (key.startsWith('.')) {
    const cell = row.cells[key.slice(1)]
    return cell ? sortable(cell) : undefined
  }
  throw fail(ctx, cmd, `sort: a table sorts by ".column" or "id", not "${key}"`)
}

function sortBy<T>(
  items: readonly T[],
  keys: SortKey[],
  keyOf: (t: T, k: SortKey) => unknown,
): T[] {
  return [...items].sort((a, b) => {
    for (const k of keys) {
      const c = compareSortable(keyOf(a, k), keyOf(b, k))
      if (c !== 0) return c
    }
    return 0
  })
}

function annotationOf(cmd: Extract<ValueCommand, { t: 'annotate' }>): Annotation {
  const ann: Annotation = { from: cmd.from, to: cmd.to }
  if (cmd.id !== undefined) ann.id = cmd.id
  if (cmd.unit !== undefined) ann.unit = cmd.unit
  if (cmd.label !== undefined) ann.label = cmd.label
  if (cmd.tone !== undefined) ann.tone = cmd.tone
  return ann
}

function rangeBytes(value: unknown, ctx: ReduceCtxX, cmd: unknown, path: Path): number[] {
  if (Array.isArray(value) && value.every((b) => typeof b === 'number')) return value as number[]
  if (typeof value === 'object' && value !== null && (value as Value).kind === 'bytes') {
    return (value as Extract<Value, { kind: 'bytes' }>).bytes
  }
  throw fail(ctx, cmd, `set on a byte range takes a number[] (or a bytes value)`, path)
}

// ─── Reducer ─────────────────────────────────────────────────────────────────────────────────

export function reduceValues(w: World, cmd: ValueCommand, ctx: ReduceCtxX): World {
  switch (cmd.t) {
    case 'set': {
      const parsed = assertPlainTarget(w, cmd.path, ctx, cmd)
      const last = parsed.segments[parsed.segments.length - 1]
      let next: World
      if (last && 'range' in last) {
        next = setBytesRange(w, cmd.path, rangeBytes(cmd.value, ctx, cmd, cmd.path))
      } else {
        let value: Value
        if (isScalar(cmd.value)) {
          const existing = getAt(w, cmd.path)
          value =
            existing?.kind === 'scalar' && existing.meta !== undefined
              ? { kind: 'scalar', value: cmd.value, meta: existing.meta }
              : { kind: 'scalar', value: cmd.value }
        } else {
          value = cmd.value
        }
        next = setAt(w, cmd.path, value)
      }
      if (cmd.quiet) markQuiet(ctx, cmd.path)
      return next
    }
    case 'patch': {
      assertPlainTarget(w, cmd.path, ctx, cmd)
      const next = patchMetaAt(w, cmd.path, cmd.meta)
      if (cmd.quiet) markQuiet(ctx, cmd.path)
      return next
    }
    case 'insert': {
      assertPlainTarget(w, cmd.path, ctx, cmd)
      let insertedId = ''
      const next = updateAt(w, cmd.path, (container) => {
        if (container.kind === 'list' || container.kind === 'set') {
          const raw = cmd.item
          let item: Item
          if (isScalar(raw)) item = { id: String(raw), value: { kind: 'scalar', value: raw } }
          else if ('value' in raw && 'id' in raw) item = raw
          else throw fail(ctx, cmd, `insert into a ${container.kind} takes an item or a scalar`)
          if (item.id.includes(']')) throw fail(ctx, cmd, `item id "${item.id}" contains "]"`)
          if (container.items.some((it) => it.id === item.id)) {
            throw fail(ctx, cmd, `${container.kind} "${cmd.path}" already has item "${item.id}"`)
          }
          if (cmd.index !== undefined) {
            checkIndex(ctx, cmd, cmd.index, container.items.length, 'insert')
          }
          insertedId = item.id
          return { ...container, items: insertAtIndex(container.items, item, cmd.index) }
        }
        if (container.kind === 'table') {
          const raw = cmd.item
          if (isScalar(raw) || !('cells' in raw)) {
            throw fail(ctx, cmd, `insert into a table takes a row { id, cells }`)
          }
          if (raw.id.includes(']')) throw fail(ctx, cmd, `row id "${raw.id}" contains "]"`)
          if (container.rows.some((r) => r.id === raw.id)) {
            throw fail(ctx, cmd, `table "${cmd.path}" already has row "${raw.id}"`)
          }
          for (const key of Object.keys(raw.cells)) {
            if (!container.columns.some((c) => c.key === key)) {
              throw fail(ctx, cmd, `table "${cmd.path}" has no column "${key}"`)
            }
          }
          if (cmd.index !== undefined) {
            checkIndex(ctx, cmd, cmd.index, container.rows.length, 'insert')
          }
          insertedId = raw.id
          return { ...container, rows: insertAtIndex(container.rows, raw, cmd.index) }
        }
        throw fail(ctx, cmd, `insert works on lists, sets and tables, not a ${container.kind}`)
      })
      if (cmd.quiet) markQuiet(ctx, `${cmd.path}[${insertedId}]`)
      return next
    }
    case 'delete': {
      const parsed = assertPlainTarget(w, cmd.path, ctx, cmd)
      if (parsed.selector !== undefined) {
        throw fail(ctx, cmd, `delete takes no selector (use patch to drop meta)`, cmd.path)
      }
      const last = parsed.segments[parsed.segments.length - 1]
      if (!last) {
        throw fail(
          ctx,
          cmd,
          `delete takes an item, a record field, a table row or a slot, not a whole card`,
          cmd.path,
        )
      }
      if ('range' in last) throw fail(ctx, cmd, `delete cannot take a range`, cmd.path)
      resolvePath(w, cmd.path) // must exist (never a silent no-op)
      let next: World
      if (parsed.root.kind === 'actor' && parsed.segments.length === 1 && 'key' in last) {
        if (cmd.tombstone) throw fail(ctx, cmd, `a slot cannot be tombstoned`, cmd.path)
        const actor = w.actors[parsed.root.id] as NonNullable<World['actors'][string]>
        const holds: Record<SlotId, Value> = {}
        for (const [k, v] of Object.entries(actor.holds)) if (k !== last.key) holds[k] = v
        next = { ...w, actors: { ...w.actors, [actor.id]: { ...actor, holds } } }
      } else {
        next = updateAt(w, parentOf(parsed), (container) => {
          if ('key' in last) {
            if (container.kind === 'record') {
              return cmd.tombstone
                ? {
                    ...container,
                    fields: container.fields.map((f) =>
                      f.key === last.key ? { key: f.key, value: withTombstone(f.value) } : f,
                    ),
                  }
                : { ...container, fields: container.fields.filter((f) => f.key !== last.key) }
            }
            throw fail(ctx, cmd, `cannot delete ".${last.key}" of a ${container.kind}`, cmd.path)
          }
          const id = last.id
          if (container.kind === 'list' || container.kind === 'set') {
            return cmd.tombstone
              ? {
                  ...container,
                  items: container.items.map((it) =>
                    it.id === id ? { ...it, value: withTombstone(it.value) } : it,
                  ),
                }
              : { ...container, items: container.items.filter((it) => it.id !== id) }
          }
          if (container.kind === 'table') {
            if (cmd.tombstone) throw fail(ctx, cmd, `a table row cannot be tombstoned`, cmd.path)
            return { ...container, rows: container.rows.filter((r) => r.id !== id) }
          }
          throw fail(ctx, cmd, `cannot delete "[${id}]" of a ${container.kind}`, cmd.path)
        })
      }
      if (cmd.quiet) markQuiet(ctx, cmd.path)
      return next
    }
    case 'move': {
      const parsed = assertPlainTarget(w, cmd.path, ctx, cmd)
      const last = parsed.segments[parsed.segments.length - 1]
      if (!last || !('id' in last) || parsed.selector !== undefined) {
        throw fail(ctx, cmd, `move takes an item path ("list[id]")`, cmd.path)
      }
      resolvePath(w, cmd.path)
      const parent = parentOf(parsed)
      const next = updateAt(w, parent, (container) => {
        if (container.kind === 'list' || container.kind === 'set') {
          const from = container.items.findIndex((it) => it.id === last.id)
          checkIndex(ctx, cmd, cmd.to, container.items.length - 1, 'move')
          return { ...container, items: moveItem(container.items, from, cmd.to) }
        }
        if (container.kind === 'table') {
          const from = container.rows.findIndex((r) => r.id === last.id)
          checkIndex(ctx, cmd, cmd.to, container.rows.length - 1, 'move')
          return { ...container, rows: moveItem(container.rows, from, cmd.to) }
        }
        throw fail(ctx, cmd, `move works on list, set and table items`, cmd.path)
      })
      if (cmd.quiet) markQuiet(ctx, parent)
      return next
    }
    case 'sort': {
      assertPlainTarget(w, cmd.path, ctx, cmd)
      if (cmd.by.length === 0) throw fail(ctx, cmd, `sort needs at least one key`, cmd.path)
      return updateAt(w, cmd.path, (container) => {
        if (container.kind === 'list') {
          return {
            ...container,
            items: sortBy(container.items, cmd.by, (it, k) => itemKey(it, k, ctx, cmd)),
          }
        }
        if (container.kind === 'table') {
          return {
            ...container,
            rows: sortBy(container.rows, cmd.by, (r, k) => rowKey(r, k, ctx, cmd)),
          }
        }
        throw fail(ctx, cmd, `sort works on lists and tables, not a ${container.kind}`, cmd.path)
      })
    }
    case 'annotate': {
      assertPlainTarget(w, cmd.path, ctx, cmd)
      return updateAt(w, cmd.path, (v) => {
        let max: number
        if (v.kind === 'bytes') {
          max = (cmd.unit ?? 'byte') === 'bit' ? v.bytes.length * 8 : v.bytes.length
        } else if (v.kind === 'text') {
          if (cmd.unit !== undefined) {
            throw fail(ctx, cmd, `text annotations count characters; drop "unit"`, cmd.path)
          }
          max = v.text.length
        } else {
          throw fail(ctx, cmd, `annotate works on bytes and text, not a ${v.kind}`, cmd.path)
        }
        if (
          !Number.isInteger(cmd.from) ||
          !Number.isInteger(cmd.to) ||
          cmd.from < 0 ||
          cmd.from >= cmd.to ||
          cmd.to > max
        ) {
          throw fail(
            ctx,
            cmd,
            `annotation [${cmd.from}, ${cmd.to}) is out of range (0..${max})`,
            cmd.path,
          )
        }
        const ann = annotationOf(cmd)
        const idx = ann.id === undefined ? -1 : v.annotations.findIndex((a) => a.id === ann.id)
        const annotations =
          idx < 0 ? [...v.annotations, ann] : v.annotations.map((a, i) => (i === idx ? ann : a))
        return { ...v, annotations }
      })
    }
    case 'unannotate': {
      assertPlainTarget(w, cmd.path, ctx, cmd)
      return updateAt(w, cmd.path, (v) => {
        if (v.kind !== 'bytes' && v.kind !== 'text') {
          throw fail(ctx, cmd, `unannotate works on bytes and text, not a ${v.kind}`, cmd.path)
        }
        if (cmd.id === undefined) return v.annotations.length === 0 ? v : { ...v, annotations: [] }
        if (!v.annotations.some((a) => a.id === cmd.id)) {
          throw fail(ctx, cmd, `no annotation "${cmd.id}" on "${cmd.path}"`, cmd.path)
        }
        return { ...v, annotations: v.annotations.filter((a) => a.id !== cmd.id) }
      })
    }
    case 'view': {
      assertPlainTarget(w, cmd.path, ctx, cmd)
      return updateAt(w, cmd.path, (v) => {
        if (v.kind !== 'bytes')
          throw fail(ctx, cmd, `view works on bytes, not a ${v.kind}`, cmd.path)
        const next = { ...v, display: cmd.display }
        if (cmd.range) {
          const [a, b] = cmd.range
          if (
            !Number.isInteger(a) ||
            !Number.isInteger(b) ||
            a < 0 ||
            a >= b ||
            b > v.bytes.length
          ) {
            throw fail(
              ctx,
              cmd,
              `view range [${a}, ${b}) is out of range (0..${v.bytes.length})`,
              cmd.path,
            )
          }
          next.range = [a, b]
        } else {
          delete next.range
        }
        return next
      })
    }
  }
}
