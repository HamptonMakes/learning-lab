/**
 * LWW Map — a map of LWW Registers, one per key.
 *
 * Algorithm: each key is its own LWW Register (value + stamp), so keys never interfere: two replicas
 * that edit different keys both keep their edits after a merge. Setting a key writes that key's
 * register. Removing a key does not delete it — it writes a tombstone (value null) stamped with the
 * remove, so a concurrent older set loses to the remove and a later set revives the key. `merge` is
 * a per-key LWW merge over the union of both sides' keys. Tombstones are kept forever; that is the
 * price of removal in a state-based map (see the-cost-of-state / tradeoffs).
 *
 * Sidecar (what the stage shows per field): the `ts` and `node` of the winning write for that key,
 * and whether the field is a tombstone (`value === null`). `lwwMapFields(state)` returns exactly
 * that list, sorted by key. `entries` is built with sorted keys so equal maps are structurally equal.
 *
 * Op-based use: the op is the per-key register op with its stamp; replayed ops are no-ops.
 * Generic in V through its methods, like `lwwRegister`.
 */
import { lwwRegister, lwwWrite, type LwwRegisterState } from './lww-register'
import type { CrdtType, Ctx, NodeId } from './types'

export interface LwwMapState<V> {
  /** One LWW register per key that was ever set or removed. Keys sorted. */
  entries: Record<string, LwwRegisterState<V>>
}

export type LwwMapUpdate<V> = { key: string; set: V } | { key: string; remove: true }

export type LwwMapOp<V> =
  | { key: string; set: V; ts: number; node: NodeId }
  | { key: string; remove: true; ts: number; node: NodeId }

/** Only live (non-tombstone) fields. */
export type LwwMapValue<V> = Record<string, V>

export type LwwMapType<V> = CrdtType<LwwMapState<V>, LwwMapUpdate<V>, LwwMapOp<V>, LwwMapValue<V>>

/** One row per key for the stage: the field, its value (null = tombstone) and its winning stamp. */
export interface LwwMapField<V> {
  key: string
  value: V | null
  ts: number
  node: NodeId
  tombstone: boolean
}

function sortedEntries<V>(
  entries: Record<string, LwwRegisterState<V>>,
): Record<string, LwwRegisterState<V>> {
  const out: Record<string, LwwRegisterState<V>> = {}
  for (const key of Object.keys(entries).sort()) {
    const entry = entries[key]
    if (entry !== undefined) out[key] = entry
  }
  return out
}

function init<V>(_node: NodeId): LwwMapState<V> {
  return { entries: {} }
}

function prepare<V>(_state: LwwMapState<V>, u: LwwMapUpdate<V>, ctx: Ctx): LwwMapOp<V> {
  if ('remove' in u) return { key: u.key, remove: true, ts: ctx.ts, node: ctx.node }
  return { key: u.key, set: u.set, ts: ctx.ts, node: ctx.node }
}

function effect<V>(state: LwwMapState<V>, op: LwwMapOp<V>): LwwMapState<V> {
  const current = state.entries[op.key] ?? lwwRegister.init<V>(op.node)
  const next = lwwWrite(current, 'remove' in op ? null : op.set, op)
  if (next === current) return state
  return { entries: sortedEntries({ ...state.entries, [op.key]: next }) }
}

function update<V>(state: LwwMapState<V>, u: LwwMapUpdate<V>, ctx: Ctx): LwwMapState<V> {
  return effect(state, prepare(state, u, ctx))
}

function merge<V>(a: LwwMapState<V>, b: LwwMapState<V>): LwwMapState<V> {
  const entries: Record<string, LwwRegisterState<V>> = {}
  const keys = new Set([...Object.keys(a.entries), ...Object.keys(b.entries)])
  for (const key of [...keys].sort()) {
    const ea = a.entries[key]
    const eb = b.entries[key]
    if (ea !== undefined && eb !== undefined) entries[key] = lwwRegister.merge(ea, eb)
    else if (ea !== undefined) entries[key] = ea
    else if (eb !== undefined) entries[key] = eb
  }
  return { entries }
}

function value<V>(state: LwwMapState<V>): LwwMapValue<V> {
  const out: Record<string, V> = {}
  for (const key of Object.keys(state.entries).sort()) {
    const entry = state.entries[key]
    if (entry !== undefined && entry.value !== null) out[key] = entry.value
  }
  return out
}

/** Every key the map has ever seen, including tombstones, sorted by key — for the stage. */
export function lwwMapFields<V>(state: LwwMapState<V>): LwwMapField<V>[] {
  return Object.keys(state.entries)
    .sort()
    .flatMap((key) => {
      const entry = state.entries[key]
      if (entry === undefined) return []
      return [
        {
          key,
          value: entry.value,
          ts: entry.ts,
          node: entry.node,
          tombstone: entry.value === null,
        },
      ]
    })
}

export const lwwMap = {
  name: 'lww-map' as const,
  init,
  update,
  prepare,
  effect,
  merge,
  value,
}
