/**
 * Op-Counter — the purely operation-based counter.
 *
 * Each replica keeps one running total. To change it, a node mints an op `{ id, add }` and sends it
 * to everyone; every replica (the source too) just adds `add` to its total. Addition commutes, so
 * ops may arrive in any order and all replicas still agree. But addition is NOT idempotent: apply
 * the same op twice and the total is wrong. That is the lesson — an op-based CRDT leans on the
 * delivery layer to deliver every op exactly once (the `id` is what lets it deduplicate).
 *
 * This type is op-based only. It is not a CvRDT: `merge(a, b)` returns `a` unchanged and must not be
 * used to sync replicas. Do not run the state-based merge laws against it.
 *
 * Sidecar the stage visualizes: `total` (the running sum), `node` (which replica this is), and `seq`
 * (the sequence number of the last op this replica minted, so op ids read as `node:seq`).
 */
import { dot, parseDot, type CrdtType, type Ctx, type Dot, type NodeId } from './types'

export interface OpCounterState {
  total: number
  node: NodeId
  /** Seq of the latest op minted by this replica (0 if none). */
  seq: number
}

/** Add `add` (any non-zero integer; negative to subtract). */
export interface OpCounterUpdate {
  add: number
}

/** A unique op id (`node:seq`) and the delta to apply. */
export interface OpCounterOp {
  id: Dot
  add: number
}

export type OpCounterValue = number

/** Throws RangeError unless `add` is a non-zero integer. */
function assertDelta(add: number): void {
  if (!Number.isInteger(add) || add === 0) {
    throw new RangeError(`Op-Counter delta must be a non-zero integer, got ${String(add)}`)
  }
}

export const opCounter: CrdtType<OpCounterState, OpCounterUpdate, OpCounterOp, OpCounterValue> = {
  name: 'op-counter',

  init(node: NodeId): OpCounterState {
    return { total: 0, node, seq: 0 }
  },

  update(state: OpCounterState, u: OpCounterUpdate, ctx: Ctx): OpCounterState {
    return opCounter.effect(state, opCounter.prepare(state, u, ctx))
  },

  prepare(_state: OpCounterState, u: OpCounterUpdate, ctx: Ctx): OpCounterOp {
    assertDelta(u.add)
    return { id: dot(ctx.node, ctx.nextSeq()), add: u.add }
  },

  /** Adds the delta. Deliberately not idempotent — deliver each op exactly once. */
  effect(state: OpCounterState, op: OpCounterOp): OpCounterState {
    const { node, seq } = parseDot(op.id)
    const ownSeq = node === state.node ? Math.max(state.seq, seq) : state.seq
    return { total: state.total + op.add, node: state.node, seq: ownSeq }
  },

  /** Not a CvRDT: there is no meaningful state join. Returns `a` unchanged. */
  merge(a: OpCounterState, _b: OpCounterState): OpCounterState {
    return a
  },

  value(state: OpCounterState): OpCounterValue {
    return state.total
  },
}
