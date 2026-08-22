/**
 * G-Set — a grow-only set.
 *
 * Elements can be added but never removed. Every replica keeps the elements it has seen; to merge
 * two replicas, take the union. Adding twice is the same as adding once, and unions can be taken in
 * any order, any number of times — that is the whole CRDT. The op simply carries the element, so
 * applying an op twice (or applying it before/after any other op) changes nothing.
 *
 * Sidecar the stage visualizes: `items` — a record keyed by each element's canonical key (see
 * `keyOf`) holding the element itself, keys sorted. There is no other hidden metadata: nothing is
 * stamped, nothing is ever forgotten.
 *
 * Elements must be JSON-serializable. Two elements are "the same element" when `keyOf` agrees, so
 * `{ a: 1, b: 2 }` and `{ b: 2, a: 1 }` are one element. Do not mix strings with non-strings in
 * one set: the string "1" and the number 1 share the key "1".
 */
import type { CrdtType, Ctx, NodeId } from './types'

export interface GSetState<E> {
  /** Every element seen so far, keyed by `keyOf(element)`, keys sorted. */
  items: Record<string, E>
}

export interface GSetUpdate<E> {
  add: E
}

/** The element itself; `effect` is a union with one element, so it is idempotent. */
export interface GSetOp<E> {
  add: E
}

/** The elements, sorted by canonical key. */
export type GSetValue<E> = E[]

/**
 * Canonical identity of a set element: strings are themselves; everything else is canonical JSON
 * (object keys sorted recursively). Shared by every element-set CRDT in this folder.
 */
export function keyOf(e: unknown): string {
  return typeof e === 'string' ? e : canonicalJson(e)
}

function canonicalJson(x: unknown): string {
  return JSON.stringify(sortKeysDeep(x))
}

function sortKeysDeep(x: unknown): unknown {
  if (Array.isArray(x)) return x.map(sortKeysDeep)
  if (x && typeof x === 'object') {
    const src = x as Record<string, unknown>
    const out: Record<string, unknown> = {}
    for (const k of Object.keys(src).sort(compareKeys)) out[k] = sortKeysDeep(src[k])
    return out
  }
  return x
}

/** Plain code-unit order on keys (what `Array.prototype.sort()` does for strings). */
export function compareKeys(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

/** Returns a copy of `rec` with keys inserted in sorted order (canonical form). */
export function sortRecord<T>(rec: Record<string, T>): Record<string, T> {
  const out: Record<string, T> = {}
  for (const [k, v] of Object.entries(rec).sort(([a], [b]) => compareKeys(a, b))) out[k] = v
  return out
}

/** `[key, value]` pairs of a record, sorted by key. Safe under `noUncheckedIndexedAccess`. */
export function sortedEntries<T>(rec: Record<string, T>): Array<[string, T]> {
  return Object.entries(rec).sort(([a], [b]) => compareKeys(a, b))
}

/** True when `e` (by canonical key) is in the set. */
export function gSetHas<E>(state: GSetState<E>, e: E): boolean {
  return Object.hasOwn(state.items, keyOf(e))
}

/** Builds a G-Set type for elements of type `E`. Lessons with string elements can use `gSet`. */
export function gSetType<E>(): CrdtType<GSetState<E>, GSetUpdate<E>, GSetOp<E>, GSetValue<E>> {
  const type: CrdtType<GSetState<E>, GSetUpdate<E>, GSetOp<E>, GSetValue<E>> = {
    name: 'g-set',

    init(_node: NodeId): GSetState<E> {
      return { items: {} }
    },

    update(state: GSetState<E>, u: GSetUpdate<E>, ctx: Ctx): GSetState<E> {
      return type.effect(state, type.prepare(state, u, ctx))
    },

    prepare(_state: GSetState<E>, u: GSetUpdate<E>, _ctx: Ctx): GSetOp<E> {
      return { add: u.add }
    },

    effect(state: GSetState<E>, op: GSetOp<E>): GSetState<E> {
      const k = keyOf(op.add)
      if (Object.hasOwn(state.items, k)) return state
      return { items: sortRecord({ ...state.items, [k]: op.add }) }
    },

    merge(a: GSetState<E>, b: GSetState<E>): GSetState<E> {
      return { items: sortRecord({ ...a.items, ...b.items }) }
    },

    value(state: GSetState<E>): GSetValue<E> {
      return sortedEntries(state.items).map(([, e]) => e)
    },
  }
  return type
}

/** G-Set of strings — the common case in lessons. For other element types call `gSetType<E>()`. */
export const gSet: CrdtType<
  GSetState<string>,
  GSetUpdate<string>,
  GSetOp<string>,
  GSetValue<string>
> = gSetType<string>()
