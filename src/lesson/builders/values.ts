/**
 * Value builders (docs/animation-dsl.md §8.2): plain `Value` trees for actor slots, boards, `set`
 * payloads and `expect`-free illustrations. Every function returns plain data.
 */
import { uuidV4, uuidV7 } from '@/uuid'
import { hexToBytes } from '@/uuid/format'
import type {
  Annotation,
  CounterRow,
  Item,
  Meta,
  NodeId,
  Scalar,
  TableRow,
  Tone,
  Value,
  ValueOf,
} from '../types'
import { compact, isScalar, isValue } from './internal'

/**
 * Anything `toValue` can turn into a `Value`: a scalar, a ready `Value`, an array (→ list) or a
 * plain object (→ record). A record field literally named `kind` with one of the eleven value
 * kinds as its value must be wrapped with `rec()` explicitly.
 */
export type ValueLike =
  Scalar | Value | ReadonlyArray<ValueLike> | { readonly [key: string]: ValueLike }

/** Wrap `v` into a `Value` (scalars → scalar, arrays → list, objects → record; Values pass through). */
export function toValue(v: ValueLike): Value {
  if (isValue(v)) return v
  if (isScalar(v)) return { kind: 'scalar', value: v }
  if (Array.isArray(v)) return list(v as ReadonlyArray<ValueLike>)
  return rec(v as { readonly [key: string]: ValueLike })
}

/** A scalar value with an optional sidecar (`scalar('Lunch', { ts: 2, node: 'bob' })`). */
export function scalar(value: Scalar, meta?: Meta): ValueOf<'scalar'> {
  return compact({ kind: 'scalar', value, meta })
}

export type RecOpts = { display?: 'card' | 'tree'; meta?: Meta }

function record(fields: { readonly [key: string]: ValueLike }, opts?: RecOpts): ValueOf<'record'> {
  return compact({
    kind: 'record',
    fields: Object.entries(fields).map(([key, value]) => ({ key, value: toValue(value) })),
    display: opts?.display,
    meta: opts?.meta,
  })
}

/** `rec({ title: 'Q3 plan', owner: 'Bob' })` — a record of scalars (nestable); `rec.tree({...})` draws it as a tree. */
export const rec = Object.assign(record, {
  tree: (fields: { readonly [key: string]: ValueLike }, opts?: Omit<RecOpts, 'display'>) =>
    record(fields, { ...opts, display: 'tree' }),
})

export type ListOpts = {
  /** Explicit item ids (by position); default: `String(value)` for scalars, `i0`, `i1` … for Values. */
  ids?: ReadonlyArray<string>
  display?: 'row' | 'column' | 'text'
  meta?: Meta
}

function items(values: ReadonlyArray<ValueLike>, ids?: ReadonlyArray<string>): Item[] {
  return values.map((v, i) => ({
    id: ids?.[i] ?? (isScalar(v) ? String(v) : `i${i}`),
    value: toValue(v),
  }))
}

/** `list(['bread', 'milk'])` — scalar items take `String(value)` as id; Value items `i0`… or `opts.ids`. */
export function list(values: ReadonlyArray<ValueLike>, opts?: ListOpts): ValueOf<'list'> {
  return compact({
    kind: 'list',
    items: items(values, opts?.ids),
    display: opts?.display,
    meta: opts?.meta,
  })
}

/** `sset(['a', 'b'])` — a set value (same id rules as `list`). */
export function sset(
  values: ReadonlyArray<ValueLike>,
  opts?: Omit<ListOpts, 'display'>,
): ValueOf<'set'> {
  return compact({ kind: 'set', items: items(values, opts?.ids), meta: opts?.meta })
}

/** `cnt({ alice: 2, bob: 1 })` or `cnt({ alice: { inc: 2, dec: 1 } })` — counter rows (plain illustration). */
export function cnt(
  rows: { readonly [node: NodeId]: number | { inc: number; dec?: number } },
  meta?: Meta,
): ValueOf<'counter'> {
  const out: CounterRow[] = Object.entries(rows).map(([node, r]) =>
    typeof r === 'number' ? { node, inc: r } : compact({ node, inc: r.inc, dec: r.dec }),
  )
  const total = out.reduce((sum, r) => sum + r.inc - (r.dec ?? 0), 0)
  return compact({ kind: 'counter', rows: out, total, meta })
}

/** `clockOf({ alice: 2, bob: 1 })` — a clock value. */
export function clockOf(
  entries: { readonly [node: NodeId]: number },
  meta?: Meta,
): ValueOf<'clock'> {
  return compact({ kind: 'clock', entries: { ...entries }, meta })
}

export type TextOpts = { cursor?: number; annotations?: ReadonlyArray<Annotation>; meta?: Meta }

/** `text('the cat sat')` — a text value. */
export function text(s: string, opts?: TextOpts): ValueOf<'text'> {
  return compact({
    kind: 'text',
    text: s,
    cursor: opts?.cursor,
    annotations: [...(opts?.annotations ?? [])],
    meta: opts?.meta,
  })
}

/** `row('r1', { how: 'replaces', use: 'LWW register' })` — a table row. */
export function row(id: string, cells: { readonly [column: string]: ValueLike }): TableRow {
  const out: Record<string, Value> = {}
  for (const [key, v] of Object.entries(cells)) out[key] = toValue(v)
  return { id, cells: out }
}

/** `table(['how', 'use'], [row('r1', {...})])` — column labels default to their keys. */
export function table(
  columns: ReadonlyArray<string | { key: string; label: string }>,
  rows: ReadonlyArray<TableRow>,
  meta?: Meta,
): ValueOf<'table'> {
  return compact({
    kind: 'table',
    columns: columns.map((c) => (typeof c === 'string' ? { key: c, label: c } : { ...c })),
    rows: [...rows],
    meta,
  })
}

/** `meter(6, 24, 'values read')` — a meter value. */
export function meter(
  value: number,
  max?: number,
  label?: string,
  opts?: { tone?: Tone; meta?: Meta },
): ValueOf<'meter'> {
  return compact({ kind: 'meter', value, max, label, tone: opts?.tone, meta: opts?.meta })
}

export type BytesOpts = {
  display?: 'hex' | 'bits' | 'canonical' | 'dec'
  range?: [number, number]
  annotations?: ReadonlyArray<Annotation>
  meta?: Meta
}

/** `bytes('9c017e55…')` — bytes from a hex string (or a byte array); display defaults to `hex`. */
export function bytes(src: string | ReadonlyArray<number>, opts?: BytesOpts): ValueOf<'bytes'> {
  return compact({
    kind: 'bytes',
    bytes: typeof src === 'string' ? hexToBytes(src) : [...src],
    display: opts?.display ?? 'hex',
    range: opts?.range,
    annotations: [...(opts?.annotations ?? [])],
    meta: opts?.meta,
  })
}

/**
 * UUID bytes computed by `src/uuid/` at build time (§5.4), pre-annotated with `time` (v7), `ver`,
 * `var` and `rand`. `uuid.v4(rand)` takes 32 hex characters; `uuid.v7({ ms, rand })` takes the Unix
 * milliseconds and 20 hex characters for bytes 6–15.
 */
export const uuid = {
  v4(rand: string): ValueOf<'bytes'> {
    return uuidV4(rand)
  },
  v7({ ms, rand }: { ms: number; rand: string }): ValueOf<'bytes'> {
    return uuidV7({ ms, rand20hex: rand })
  },
}
