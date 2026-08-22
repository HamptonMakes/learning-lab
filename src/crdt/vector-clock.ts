/**
 * Vector clock — one counter per node, kept together in a record `{ node → count }`. The rules,
 * in plain words:
 *   - Local event or send on node n: vc[n] = vc[n] + 1.
 *   - Receive a remote clock r on node n: take the per-node max of vc and r, then vc[n] += 1.
 *   - Compare a and b (a missing entry counts as 0): a is "before" b when every entry of a is ≤ the
 *     matching entry of b and at least one is smaller; "after" when the reverse; "equal" when all
 *     match; otherwise "concurrent". Detecting "concurrent" is the whole point — a Lamport clock
 *     cannot do that.
 *
 * Metadata ("sidecar") the type carries: the record itself — one row per node that has ever
 * ticked or been merged in, keys sorted so equal clocks serialize equally. The stage shows exactly
 * this table next to each actor and on each message.
 *
 * `vectorClock` is the CrdtType view: `update(s, { tick: true })` or `update(s, { receive: r })`
 * (the acting node comes from `ctx.node`), `merge` = per-node max (a join: commutative,
 * associative, idempotent), `value` = the record. The op-based view mirrors real systems: the op
 * that travels is the sender's clock; `effect` merges it in.
 */
import type { CrdtType, NodeId } from './types'

export type VectorClock = Record<NodeId, number>

export type VcOrder = 'equal' | 'before' | 'after' | 'concurrent'

/** A canonical copy of `entries`: keys sorted, values as given. */
export function vcOf(entries: Record<NodeId, number>): VectorClock {
  const out: VectorClock = {}
  for (const node of Object.keys(entries).sort()) out[node] = entries[node] ?? 0
  return out
}

/** A clock that knows `nodes` and has seen nothing: every entry is 0. */
export function vcFromNodes(nodes: readonly NodeId[]): VectorClock {
  const out: VectorClock = {}
  for (const node of [...nodes].sort()) out[node] = 0
  return out
}

/** Entry for `node`; a missing entry is 0. */
export function vcGet(vc: VectorClock, node: NodeId): number {
  return vc[node] ?? 0
}

/** Local event or send on `node`: bump only that entry. */
export function vcTick(vc: VectorClock, node: NodeId): VectorClock {
  return vcOf({ ...vc, [node]: vcGet(vc, node) + 1 })
}

/** Per-node max over the union of nodes. */
export function vcMerge(a: VectorClock, b: VectorClock): VectorClock {
  const out: VectorClock = {}
  for (const node of Object.keys({ ...a, ...b }).sort()) {
    out[node] = Math.max(vcGet(a, node), vcGet(b, node))
  }
  return out
}

/** Receive `remote` on `node`: merge, then tick our own entry. */
export function vcReceive(local: VectorClock, remote: VectorClock, node: NodeId): VectorClock {
  return vcTick(vcMerge(local, remote), node)
}

/** Partial order. `a` before `b` means every event in `a` is also in `b` and `b` has more. */
export function vcCompare(a: VectorClock, b: VectorClock): VcOrder {
  let aHasMore = false
  let bHasMore = false
  for (const node of Object.keys({ ...a, ...b })) {
    const x = vcGet(a, node)
    const y = vcGet(b, node)
    if (x > y) aHasMore = true
    else if (x < y) bHasMore = true
  }
  if (aHasMore && bHasMore) return 'concurrent'
  if (aHasMore) return 'after'
  if (bHasMore) return 'before'
  return 'equal'
}

/** True when `a` ≥ `b` in every entry: `a` has seen everything `b` has seen (equal counts). */
export function vcDominates(a: VectorClock, b: VectorClock): boolean {
  const order = vcCompare(a, b)
  return order === 'equal' || order === 'after'
}

/** Same clock, ignoring entries that are 0 on one side and absent on the other. */
export function vcEquals(a: VectorClock, b: VectorClock): boolean {
  return vcCompare(a, b) === 'equal'
}

// ---------------------------------------------------------------------------------------------
// CrdtType view
// ---------------------------------------------------------------------------------------------

export type VcUpdate = { tick: true } | { receive: VectorClock }
/** What travels between replicas: the sender and the sender's clock after its event. */
export interface VcOp {
  from: NodeId
  clock: VectorClock
}
/** Optional init args: list the nodes up front so the stage shows a full table of zeros. */
export interface VcArgs {
  nodes?: readonly NodeId[]
}

function vcUpdate(state: VectorClock, u: VcUpdate, node: NodeId): VectorClock {
  return 'tick' in u ? vcTick(state, node) : vcReceive(state, u.receive, node)
}

export const vectorClock: CrdtType<VectorClock, VcUpdate, VcOp, VectorClock, VcArgs | void> = {
  name: 'vector-clock',
  // `{}` by default: a clock only knows nodes it has heard from. Pass `{ nodes }` to pre-fill
  // zero rows for every actor in the scene (the node itself is always included).
  init: (node, args) => (args?.nodes ? vcFromNodes([...args.nodes, node]) : {}),
  update: (state, u, ctx) => vcUpdate(state, u, ctx.node),
  prepare: (state, u, ctx) => ({ from: ctx.node, clock: vcUpdate(state, u, ctx.node) }),
  effect: (state, op) => vcMerge(state, op.clock),
  merge: vcMerge,
  value: (state) => state,
  equals: vcEquals,
}
