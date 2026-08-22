/**
 * PN-Counter — a counter that can go up and down.
 *
 * It is two G-Counters side by side: `p` counts increments, `n` counts decrements. Each is
 * grow-only, so each merges safely with a per-node max. The value is sum(p) − sum(n). Note that a
 * PN-Counter can go below zero when concurrent decrements overlap (two people both "unlike" the
 * same single like) — it cannot enforce a floor. If a lower bound matters, it is the wrong tool.
 *
 * Sidecar the stage visualizes: `p.counts` and `n.counts` — one positive integer per node id on
 * each side (no entry until that node has used that side). Keys are kept sorted so equal states are
 * structurally equal.
 */
import { gCounter, type GCounterOp, type GCounterState } from './g-counter'
import type { CrdtType, Ctx, NodeId } from './types'

export interface PNCounterState {
  /** Increments (grow-only). */
  p: GCounterState
  /** Decrements (grow-only). */
  n: GCounterState
}

/** Raise by `inc` or lower by `dec` (each an integer ≥ 1). */
export type PNCounterUpdate = { inc: number } | { dec: number }

/** Which side changed, and that node's NEW total on that side (idempotent to apply). */
export type PNCounterOp = GCounterOp & { side: 'p' | 'n' }

export type PNCounterValue = number

/** `[{ node, inc, dec }]` sorted by node — the union of nodes seen on either side. */
export function pnCounterEntries(
  state: PNCounterState,
): Array<{ node: NodeId; inc: number; dec: number }> {
  const nodes = [
    ...new Set([...Object.keys(state.p.counts), ...Object.keys(state.n.counts)]),
  ].sort()
  return nodes.map((node) => ({
    node,
    inc: state.p.counts[node] ?? 0,
    dec: state.n.counts[node] ?? 0,
  }))
}

function sideOf(u: PNCounterUpdate): { side: 'p' | 'n'; inc: number } {
  return 'inc' in u ? { side: 'p', inc: u.inc } : { side: 'n', inc: u.dec }
}

export const pnCounter: CrdtType<PNCounterState, PNCounterUpdate, PNCounterOp, PNCounterValue> = {
  name: 'pn-counter',

  init(node: NodeId): PNCounterState {
    return { p: gCounter.init(node), n: gCounter.init(node) }
  },

  update(state: PNCounterState, u: PNCounterUpdate, ctx: Ctx): PNCounterState {
    return pnCounter.effect(state, pnCounter.prepare(state, u, ctx))
  },

  prepare(state: PNCounterState, u: PNCounterUpdate, ctx: Ctx): PNCounterOp {
    const { side, inc } = sideOf(u)
    return { side, ...gCounter.prepare(state[side], { inc }, ctx) }
  },

  effect(state: PNCounterState, op: PNCounterOp): PNCounterState {
    const next = gCounter.effect(state[op.side], { node: op.node, count: op.count })
    if (next === state[op.side]) return state
    return { ...state, [op.side]: next }
  },

  merge(a: PNCounterState, b: PNCounterState): PNCounterState {
    return { p: gCounter.merge(a.p, b.p), n: gCounter.merge(a.n, b.n) }
  },

  value(state: PNCounterState): PNCounterValue {
    return gCounter.value(state.p) - gCounter.value(state.n)
  },
}
