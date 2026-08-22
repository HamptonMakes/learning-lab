/**
 * Core CRDT contract. Every CRDT in this folder is a pure, framework-free TypeScript module.
 * State is immutable: every function returns a new state. Lessons drive these implementations; the
 * stage visualizes their real state — no lesson ever hand-writes a merge result.
 *
 * Two usage styles, both supported by each type where it makes sense:
 *  - State-based (CvRDT): `update()` locally, then `merge()` replica states (a join: commutative,
 *    associative, idempotent).
 *  - Operation-based (CmRDT): `prepare()` at the source to produce an Op, then `effect()` at every
 *    replica, including the source. Delivery is assumed at-most-once and causal unless a type says
 *    otherwise in its docs.
 */

export type NodeId = string

/** Who is acting, and at what logical time. Lessons set `ts` explicitly from the scene clock. */
export interface Ctx {
  node: NodeId
  /** Timestamp for LWW-style decisions. */
  ts: number
  /** Monotonic per-node counter; used to mint unique tags / op ids. */
  nextSeq(): number
}

/** A unique id minted by a node: `${node}:${seq}`. */
export type Dot = `${string}:${number}`

export function dot(node: NodeId, seq: number): Dot {
  return `${node}:${seq}`
}

export function parseDot(d: Dot): { node: NodeId; seq: number } {
  const i = d.lastIndexOf(':')
  return { node: d.slice(0, i), seq: Number(d.slice(i + 1)) }
}

/** Total order on (ts, node) used to break ties deterministically. Returns >0 if a wins. */
export function compareStamp(a: { ts: number; node: NodeId }, b: { ts: number; node: NodeId }): number {
  if (a.ts !== b.ts) return a.ts - b.ts
  return a.node < b.node ? -1 : a.node > b.node ? 1 : 0
}

export interface CrdtType<S, U, O, V, A = void> {
  /** Stable machine name, e.g. 'lww-register'. */
  readonly name: string
  /** Fresh replica state for `node`. */
  init(node: NodeId, args: A): S
  /** Local update (state-based view). Equivalent to effect(state, prepare(state, u, ctx)). */
  update(state: S, u: U, ctx: Ctx): S
  /** Op-based: build the operation at the source. May read state (e.g. observed tags). */
  prepare(state: S, u: U, ctx: Ctx): O
  /** Op-based: apply an operation at any replica. Must commute with other concurrent ops. */
  effect(state: S, op: O): S
  /** State-based join. Pure; commutative, associative, idempotent. */
  merge(a: S, b: S): S
  /** The user-visible value. */
  value(state: S): V
  /** Structural equality (defaults to canonical JSON comparison in tests if omitted). */
  equals?(a: S, b: S): boolean
}

/** Helper for tests and tooling: a deterministic Ctx whose seq counter advances per call. */
export function makeCtx(node: NodeId, ts = 0, startSeq = 0): Ctx & { seq: number; at(ts: number): Ctx } {
  const ctx = {
    node,
    ts,
    seq: startSeq,
    nextSeq() {
      ctx.seq += 1
      return ctx.seq
    },
    at(nextTs: number) {
      ctx.ts = nextTs
      return ctx
    },
  }
  return ctx
}
