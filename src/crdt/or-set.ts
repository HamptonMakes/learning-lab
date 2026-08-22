/**
 * OR-Set (Observed-Remove Set), add-wins. Generic in the element type E (JSON-serializable).
 *
 * Plain words: every `add` mints a unique tag (a Dot, `node:seq`) and attaches it to the element.
 * A `remove` deletes nothing — it tombstones exactly the tags the remover has *seen* for that
 * element. An element is present while at least one of its tags is not tombstoned. A concurrent
 * re-add carries a fresh tag the remover never saw, so it survives: "add wins". Unlike a 2P-Set,
 * a removed element can be added again. Merge is a union of entries + tags and a union of
 * tombstones: a tag tombstoned anywhere is dead everywhere.
 *
 * Sidecar metadata (what the stage shows): per element, every tag ever observed for it, each
 * marked alive or dead, and whether the element is present (`orSetRows`); plus the global set of
 * tombstones. Supports both state-based use (merge) and op-based use (prepare/effect): an add op
 * carries its new tag; a remove op carries the tags observed at the source.
 *
 * Elements are keyed by `keyOf(e)`: a string is its own key, anything else is keyed by canonical
 * JSON (object keys sorted), so `{ a: 1, b: 2 }` and `{ b: 2, a: 1 }` are the same element.
 */
import { dot, parseDot, type CrdtType, type Ctx, type Dot, type NodeId } from './types'

/** Element key: the string itself, or canonical JSON for non-string elements. See `keyOf`. */
export type OrSetKey = string

export interface OrSetEntry<E> {
  /** The element as first seen by this replica. */
  e: E
  /** Every tag ever observed for this element (alive or dead), sorted by (node, seq). */
  tags: Record<Dot, true>
}

export interface OrSetState<E> {
  /** Every element ever added, keyed by `keyOf(e)`; keys sorted. Presence is decided per tag. */
  entries: Record<OrSetKey, OrSetEntry<E>>
  /** Tags that have been removed, anywhere; sorted by (node, seq). */
  tombstones: Record<Dot, true>
}

export type OrSetUpdate<E> = { add: E } | { remove: E }

/** An add carries its freshly minted tag; a remove carries the tags observed at the source. */
export type OrSetOp<E> = { add: E; tag: Dot } | { remove: OrSetKey; tags: Dot[] }

/** The user-visible value: present elements, sorted by key. */
export type OrSetValue<E> = E[]

export interface OrSetArgs<E> {
  /** Elements present from the start, with their tags (lessons seed scenes this way). */
  seed?: ReadonlyArray<{ tag: Dot; e: E }>
}

/** The OR-Set contract for a concrete element type. */
export type OrSetCrdt<E> = CrdtType<
  OrSetState<E>,
  OrSetUpdate<E>,
  OrSetOp<E>,
  OrSetValue<E>,
  OrSetArgs<E> | undefined
>

/** A row per element for the stage: every tag with its alive flag, and the presence verdict. */
export interface OrSetRow<E> {
  key: OrSetKey
  e: E
  tags: Array<{ tag: Dot; alive: boolean }>
  present: boolean
}

// ---------------------------------------------------------------------------------------------
// Keys and ordering

/** Canonical key for an element: the string itself, otherwise canonical JSON (keys sorted). */
export function keyOf(e: unknown): OrSetKey {
  return typeof e === 'string' ? e : JSON.stringify(sortKeysDeep(e))
}

function sortKeysDeep(x: unknown): unknown {
  if (Array.isArray(x)) return x.map(sortKeysDeep)
  if (x && typeof x === 'object') {
    const rec = x as Record<string, unknown>
    return Object.fromEntries(
      Object.keys(rec)
        .sort()
        .map((k) => [k, sortKeysDeep(rec[k])]),
    )
  }
  return x
}

/** Order tags by node, then by seq as a number (so `a:2` sorts before `a:10`). */
function compareDot(a: Dot, b: Dot): number {
  const da = parseDot(a)
  const db = parseDot(b)
  if (da.node !== db.node) return da.node < db.node ? -1 : 1
  return da.seq - db.seq
}

function compareKey(a: OrSetKey, b: OrSetKey): number {
  return a < b ? -1 : a > b ? 1 : 0
}

/** The tags of a `Record<Dot, true>`. Object.keys widens to string; keys are Dots by construction. */
function tagsOf(rec: Record<Dot, true>): Dot[] {
  return Object.keys(rec) as Dot[]
}

/** Build a canonical (sorted) tag record from any list of tags. */
function tagRecord(tags: Iterable<Dot>): Record<Dot, true> {
  return Object.fromEntries([...new Set(tags)].sort(compareDot).map((t) => [t, true] as const))
}

/** Build a canonical (sorted-key) entries record. */
function entryRecord<E>(
  pairs: Iterable<readonly [OrSetKey, OrSetEntry<E>]>,
): Record<OrSetKey, OrSetEntry<E>> {
  return Object.fromEntries([...pairs].sort(([a], [b]) => compareKey(a, b)))
}

// ---------------------------------------------------------------------------------------------
// The type

function init<E>(_node: NodeId, args?: OrSetArgs<E>): OrSetState<E> {
  let state: OrSetState<E> = { entries: {}, tombstones: {} }
  for (const { tag, e } of args?.seed ?? []) state = effect(state, { add: e, tag })
  return state
}

function prepare<E>(state: OrSetState<E>, u: OrSetUpdate<E>, ctx: Ctx): OrSetOp<E> {
  if ('add' in u) return { add: u.add, tag: dot(ctx.node, ctx.nextSeq()) }
  const key = keyOf(u.remove)
  return { remove: key, tags: aliveTags(state, key) }
}

function effect<E>(state: OrSetState<E>, op: OrSetOp<E>): OrSetState<E> {
  if ('add' in op) {
    const key = keyOf(op.add)
    const prev = state.entries[key]
    const entry: OrSetEntry<E> = {
      e: prev ? prev.e : op.add,
      tags: tagRecord([...tagsOf(prev?.tags ?? {}), op.tag]),
    }
    return {
      entries: entryRecord([...Object.entries(state.entries), [key, entry]]),
      tombstones: state.tombstones,
    }
  }
  if (op.tags.length === 0) return state // removing something never seen is a no-op
  return {
    entries: state.entries,
    tombstones: tagRecord([...tagsOf(state.tombstones), ...op.tags]),
  }
}

function update<E>(state: OrSetState<E>, u: OrSetUpdate<E>, ctx: Ctx): OrSetState<E> {
  return effect(state, prepare(state, u, ctx))
}

function merge<E>(a: OrSetState<E>, b: OrSetState<E>): OrSetState<E> {
  const keys = new Set([...Object.keys(a.entries), ...Object.keys(b.entries)])
  const pairs: Array<readonly [OrSetKey, OrSetEntry<E>]> = []
  for (const key of keys) {
    const ea = a.entries[key]
    const eb = b.entries[key]
    const first = ea ?? eb
    if (!first) continue
    pairs.push([
      key,
      { e: first.e, tags: tagRecord([...tagsOf(ea?.tags ?? {}), ...tagsOf(eb?.tags ?? {})]) },
    ])
  }
  return {
    entries: entryRecord(pairs),
    tombstones: tagRecord([...tagsOf(a.tombstones), ...tagsOf(b.tombstones)]),
  }
}

function value<E>(state: OrSetState<E>): OrSetValue<E> {
  return orSetRows(state)
    .filter((row) => row.present)
    .map((row) => row.e)
}

function aliveTags<E>(state: OrSetState<E>, key: OrSetKey): Dot[] {
  const entry = state.entries[key]
  if (!entry) return []
  return tagsOf(entry.tags).filter((t) => !(t in state.tombstones))
}

/** The OR-Set, usable for any element type: `orSet.merge(a, b)` infers E from its arguments. */
export interface OrSetType {
  readonly name: 'or-set'
  init<E>(node: NodeId, args?: OrSetArgs<E>): OrSetState<E>
  update<E>(state: OrSetState<E>, u: OrSetUpdate<E>, ctx: Ctx): OrSetState<E>
  prepare<E>(state: OrSetState<E>, u: OrSetUpdate<E>, ctx: Ctx): OrSetOp<E>
  effect<E>(state: OrSetState<E>, op: OrSetOp<E>): OrSetState<E>
  merge<E>(a: OrSetState<E>, b: OrSetState<E>): OrSetState<E>
  value<E>(state: OrSetState<E>): OrSetValue<E>
}

export const orSet: OrSetType = { name: 'or-set', init, update, prepare, effect, merge, value }

/** The same object, pinned to one element type so it satisfies `CrdtType` (e.g. in laws tests). */
export function orSetType<E>(): OrSetCrdt<E> {
  return orSet
}

// ---------------------------------------------------------------------------------------------
// Helpers for lessons and the stage

/** Is `e` present (has at least one live tag)? */
export function orSetHas<E>(state: OrSetState<E>, e: E): boolean {
  return aliveTags(state, keyOf(e)).length > 0
}

/** One row per element ever seen, sorted by key; tags sorted by (node, seq) with their alive flag. */
export function orSetRows<E>(state: OrSetState<E>): OrSetRow<E>[] {
  return Object.entries(state.entries)
    .sort(([a], [b]) => compareKey(a, b))
    .map(([key, entry]) => {
      const tags = tagsOf(entry.tags)
        .sort(compareDot)
        .map((tag) => ({ tag, alive: !(tag in state.tombstones) }))
      return { key, e: entry.e, tags, present: tags.some((t) => t.alive) }
    })
}
