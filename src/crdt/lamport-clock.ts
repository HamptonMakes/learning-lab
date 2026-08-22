/**
 * Lamport clock — the simplest logical clock. Each node keeps one integer. The rules, in plain
 * words:
 *   - Before a local event or a send, tick: c = c + 1.
 *   - On receiving a message stamped r: c = max(c, r) + 1. The receive lands "after" both the
 *     sender's event and everything the receiver already did.
 * If event x happened before event y, then stamp(x) < stamp(y). The reverse is NOT true: a smaller
 * stamp does not prove "happened before" — that gap is what vector clocks close.
 *
 * Metadata ("sidecar") the type carries: the counter itself (`Lamport`, a plain number), and a
 * `LamportStamp { ts, node }` when a value needs a total order. Ties on `ts` are broken by node id
 * via `compareStamp`, so every replica agrees on which stamp is larger. The stage shows the number
 * on each actor and the `ts@node` stamp on each message.
 *
 * `lamportClock` also exposes the clock as a CrdtType (merge = max) so the stage can drive it like
 * any other type: `update(s, { tick: true })`, `update(s, { receive: 7 })`, `merge(a, b)`.
 */
import { compareStamp, type CrdtType, type NodeId } from './types'

export { compareStamp }

/** A Lamport counter: a non-negative integer. */
export type Lamport = number

/** A value's stamp: the counter at the time of the write plus the writer, for a total order. */
export interface LamportStamp {
  ts: Lamport
  node: NodeId
}

export const LAMPORT_ZERO: Lamport = 0

/** Local event or send: advance by one. */
export function tick(c: Lamport): Lamport {
  return c + 1
}

/** Receive a message carrying `remote`: jump past both clocks. */
export function receive(local: Lamport, remote: Lamport): Lamport {
  return Math.max(local, remote) + 1
}

/** Attach the node id so two equal counters can still be ordered (see `compareStamp`). */
export function stamp(c: Lamport, node: NodeId): LamportStamp {
  return { ts: c, node }
}

/** Total order on stamps: by `ts`, then by node id. Returns >0 when `a` wins. */
export function compareLamportStamp(a: LamportStamp, b: LamportStamp): number {
  return compareStamp(a, b)
}

// ---------------------------------------------------------------------------------------------
// CrdtType view (merge = max). Handy for the stage; the op that travels is the sender's counter.
// ---------------------------------------------------------------------------------------------

export type LamportUpdate = { tick: true } | { receive: Lamport }
export type LamportOp = Lamport

function lamportUpdate(state: Lamport, u: LamportUpdate): Lamport {
  return 'tick' in u ? tick(state) : receive(state, u.receive)
}

export const lamportClock: CrdtType<Lamport, LamportUpdate, LamportOp, Lamport> = {
  name: 'lamport-clock',
  init: () => LAMPORT_ZERO,
  update: (state, u) => lamportUpdate(state, u),
  prepare: (state, u) => lamportUpdate(state, u),
  effect: (state, op) => Math.max(state, op),
  merge: (a, b) => Math.max(a, b),
  value: (state) => state,
}
