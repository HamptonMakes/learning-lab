/**
 * G-Counter — a grow-only counter.
 *
 * Every node keeps its own tally and only ever raises its own entry. The value is the sum of all
 * tallies. To merge two replicas, keep the larger tally per node. A per-node max is safe to apply
 * twice and in any order, which is exactly what makes this a CRDT. Because the op carries the
 * node's *new total* (not a delta), `effect` is also a max, so a duplicated op changes nothing.
 *
 * Sidecar the stage visualizes: `counts` — one positive integer per node id that has incremented
 * (a node that never incremented has no entry). Keys are kept sorted so equal states are
 * structurally equal. There is no other hidden metadata.
 */
import type { CrdtType, Ctx, NodeId } from './types'

export interface GCounterState {
  /** Per-node tally, keyed by node id, keys sorted. */
  counts: Record<NodeId, number>
}

/** Raise this node's tally by `inc` (an integer ≥ 1). */
export interface GCounterUpdate {
  inc: number
}

/** The node's NEW total. Applying it is a per-node max, so it is idempotent. */
export interface GCounterOp {
  node: NodeId
  count: number
}

export type GCounterValue = number

/** Throws RangeError unless `inc` is an integer ≥ 1. */
function assertIncrement(inc: number): void {
  if (!Number.isInteger(inc) || inc < 1) {
    throw new RangeError(`G-Counter increment must be an integer >= 1, got ${String(inc)}`)
  }
}

/** Returns a copy of `counts` with keys in sorted order (canonical form). */
function sortedCounts(counts: Record<NodeId, number>): Record<NodeId, number> {
  const out: Record<NodeId, number> = {}
  for (const node of Object.keys(counts).sort()) out[node] = counts[node] ?? 0
  return out
}

function withCount(state: GCounterState, node: NodeId, count: number): GCounterState {
  return { counts: sortedCounts({ ...state.counts, [node]: count }) }
}

/** `[{ node, count }]` sorted by node — handy for tables and the stage. */
export function gCounterEntries(state: GCounterState): Array<{ node: NodeId; count: number }> {
  return Object.keys(state.counts)
    .sort()
    .map((node) => ({ node, count: state.counts[node] ?? 0 }))
}

export const gCounter: CrdtType<GCounterState, GCounterUpdate, GCounterOp, GCounterValue> = {
  name: 'g-counter',

  init(): GCounterState {
    return { counts: {} }
  },

  update(state: GCounterState, u: GCounterUpdate, ctx: Ctx): GCounterState {
    return gCounter.effect(state, gCounter.prepare(state, u, ctx))
  },

  prepare(state: GCounterState, u: GCounterUpdate, ctx: Ctx): GCounterOp {
    assertIncrement(u.inc)
    return { node: ctx.node, count: (state.counts[ctx.node] ?? 0) + u.inc }
  },

  effect(state: GCounterState, op: GCounterOp): GCounterState {
    const current = state.counts[op.node] ?? 0
    if (op.count <= current) return state
    return withCount(state, op.node, op.count)
  },

  merge(a: GCounterState, b: GCounterState): GCounterState {
    const nodes = [...new Set([...Object.keys(a.counts), ...Object.keys(b.counts)])].sort()
    const counts: Record<NodeId, number> = {}
    for (const node of nodes) counts[node] = Math.max(a.counts[node] ?? 0, b.counts[node] ?? 0)
    return { counts }
  },

  value(state: GCounterState): GCounterValue {
    let sum = 0
    for (const node of Object.keys(state.counts)) sum += state.counts[node] ?? 0
    return sum
  },
}
