/**
 * Hybrid Logical Clock (Kulkarni et al., 2014). A timestamp that looks like wall-clock time but
 * never goes backwards and always orders causally-related events. The rules, in plain words:
 *   - `wall` is the largest physical time this node has seen (its own clock or a message's).
 *   - `counter` breaks ties when `wall` cannot move: it resets to 0 whenever `wall` grows, and
 *     counts up when two events share the same `wall`.
 *   - Local event (`hlcNow`): wall = max(prev.wall, physical now); counter = prev.counter + 1 if
 *     wall stayed put, else 0.
 *   - Receive (`hlcReceive`): wall = max(prev.wall, remote.wall, physical now); counter = one more
 *     than the larger counter among the clocks that share the new wall, or 0 if physical now won.
 * Result: each node's clock is strictly increasing, receive lands after both prev and remote, and
 * `wall` stays within the real clock skew of physical time (the counter stays small).
 *
 * Metadata ("sidecar") the type carries: `{ wall, counter, node }`. The stage shows it as
 * `wall.counter@node` (see `hlcToString`); `node` is only a tie-breaker so two nodes never mint
 * the same stamp.
 *
 * `hlcClock` is the CrdtType view (registered as 'hlc') so the reducer can hold an HLC like any
 * other replica. See the comment above it for what `update` / `effect` / `merge` mean here.
 */
import type { CrdtType, Ctx, NodeId } from './types'

export interface Hlc {
  /** Largest physical time seen so far (ms). */
  wall: number
  /** Logical ticks since `wall` last advanced. */
  counter: number
  node: NodeId
}

/** A fresh clock for `node` that has seen no time yet. */
export function hlcInit(node: NodeId): Hlc {
  return { wall: 0, counter: 0, node }
}

/** Local event or send at physical time `wallNow`. */
export function hlcNow(prev: Hlc, wallNow: number): Hlc {
  const wall = Math.max(prev.wall, wallNow)
  const counter = wall === prev.wall ? prev.counter + 1 : 0
  return { wall, counter, node: prev.node }
}

/** Receive a message stamped `remote` at physical time `wallNow`. */
export function hlcReceive(prev: Hlc, remote: Hlc, wallNow: number): Hlc {
  const wall = Math.max(prev.wall, remote.wall, wallNow)
  let counter: number
  if (wall === prev.wall && wall === remote.wall)
    counter = Math.max(prev.counter, remote.counter) + 1
  else if (wall === prev.wall) counter = prev.counter + 1
  else if (wall === remote.wall) counter = remote.counter + 1
  else counter = 0
  return { wall, counter, node: prev.node }
}

/** Total order: by wall, then counter, then node id. Returns >0 when `a` is later. */
export function hlcCompare(a: Hlc, b: Hlc): number {
  if (a.wall !== b.wall) return a.wall - b.wall
  if (a.counter !== b.counter) return a.counter - b.counter
  return a.node < b.node ? -1 : a.node > b.node ? 1 : 0
}

/** `wall.counter@node`, e.g. `1700000000000.2@alice`. */
export function hlcToString(h: Hlc): string {
  return `${h.wall}.${h.counter}@${h.node}`
}

// ---------------------------------------------------------------------------------------------
// CrdtType view
// ---------------------------------------------------------------------------------------------

/** The only local update: a local event / send. The physical time is `ctx.ts` (set by the reducer). */
export type HlcUpdate = { tick: true }

/** What travels: the sender's clock right after its event. */
export interface HlcOp {
  stamp: Hlc
}

/** The clock reading the stage shows — `node` is the holder's identity, not part of the reading. */
export interface HlcValue {
  wall: number
  counter: number
}

/** Same reading (wall and counter); the node field is who holds the clock, not what it reads. */
export function hlcSameReading(a: Hlc, b: Hlc): boolean {
  return a.wall === b.wall && a.counter === b.counter
}

/**
 * The HLC as a `CrdtType<Hlc, HlcUpdate, HlcOp, HlcValue>`, name 'hlc'.
 *
 *  - `init(node)` = `{ wall: 0, counter: 0, node }` (a clock that has seen no time).
 *  - `update(s, { tick }, ctx)` = `hlcNow(s, ctx.ts)`: `ctx.ts` is the physical (wall) time the
 *    reducer supplies for this actor. `prepare` returns the new reading as the op.
 *  - `effect(s, op)`: at the source (op.stamp.node === s.node) the clock simply adopts its own
 *    stamp, so `update` equals `effect(prepare(...))` as the contract requires. At any other
 *    replica it is a *receive*: `hlcReceive(s, op.stamp, wallNow)` with wallNow =
 *    max(s.wall, op.stamp.wall) — `effect` has no ctx, so no fresh physical time is available and
 *    the receive is driven purely by the two clocks (the counter climbs, the wall never resets).
 *    The lesson reducer runs explicit receive rules (`deliver` recv/stamp) through its own path
 *    with the real actor time; this effect is the stand-alone, ctx-free version of the same rule.
 *    Like a Lamport receive it is NOT idempotent: every receive moves the clock, so the delivery
 *    layer must deliver each op once. Op-based convergence therefore does not hold and is not
 *    asserted — replicas legitimately end with different readings (each receive is an event).
 *  - `merge(a, b)`: a join — the greater reading by `hlcCompare`, keeping `a`'s node: a replica's
 *    clock never changes who it belongs to. Commutative, associative, idempotent on the reading,
 *    which is what `equals` compares (see `hlcSameReading`).
 *  - `value(s)` = `{ wall, counter }`.
 */
export const hlcClock: CrdtType<Hlc, HlcUpdate, HlcOp, HlcValue> = {
  name: 'hlc',
  init: (node: NodeId) => hlcInit(node),
  update: (state: Hlc, _u: HlcUpdate, ctx: Ctx) => hlcNow(state, ctx.ts),
  prepare: (state: Hlc, _u: HlcUpdate, ctx: Ctx) => ({ stamp: hlcNow(state, ctx.ts) }),
  effect: (state: Hlc, op: HlcOp) => {
    if (op.stamp.node === state.node) {
      // Our own event (the source applying its op, or a replay): adopt the later reading.
      return hlcCompare(op.stamp, state) > 0 ? op.stamp : state
    }
    return hlcReceive(state, op.stamp, Math.max(state.wall, op.stamp.wall))
  },
  merge: (a: Hlc, b: Hlc) => {
    if (hlcCompare(b, a) <= 0 || hlcSameReading(a, b)) return a
    return { wall: b.wall, counter: b.counter, node: a.node }
  },
  value: (state: Hlc) => ({ wall: state.wall, counter: state.counter }),
  equals: hlcSameReading,
}
