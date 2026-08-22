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
 */
import type { NodeId } from './types'

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
