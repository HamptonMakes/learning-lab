/**
 * LWW Register — Last-Writer-Wins register.
 *
 * Algorithm: the register holds one value plus the stamp of the write that produced it: `ts` (the
 * writer's clock) and `node` (who wrote). A local write replaces both. `merge(a, b)` keeps the side
 * with the greater stamp, compared with `compareStamp`: higher `ts` wins; on an equal `ts` the
 * greater `node` id wins. The tie-break is arbitrary but deterministic, and that is the whole point:
 * every replica picks the same winner, so they converge. "Last" means "greatest stamp", not
 * "happened last in real time" — skewed wall clocks can make an older write win (see Unit IV).
 *
 * Sidecar (the metadata the stage shows next to the value): `ts` and `node` of the winning write.
 * A fresh register is `{ value: null, ts: -1, node: '' }` ("never written"; -1 instead of -Infinity
 * because the state must be JSON-safe). Every real write uses ts >= 0, so it beats the empty stamp.
 *
 * Op-based use: the op carries the same stamp. `effect` ignores an op whose stamp is not greater,
 * so a replayed op is a no-op (duplicate delivery is harmless) and effects commute. A node must
 * advance `ts` between its writes: two different writes with the same (ts, node) stamp are treated
 * as the same write, and only the first one applied is kept.
 *
 * Usage: `lwwRegister` is generic in the value type V (any JSON value) through its methods, e.g.
 * `lwwRegister.init<string>('alice')`; `const t: LwwRegisterType<string> = lwwRegister` also works.
 */
import { compareStamp, type CrdtType, type Ctx, type NodeId } from './types'

export interface LwwRegisterState<V> {
  /** The winning value; null until the first write (or when V itself allows null). */
  value: V | null
  /** Clock of the winning write; -1 means "never written". */
  ts: number
  /** Node that made the winning write; '' means "never written". */
  node: NodeId
}

export interface LwwRegisterUpdate<V> {
  set: V
}

export interface LwwRegisterOp<V> {
  set: V
  ts: number
  node: NodeId
}

export type LwwRegisterValue<V> = V | null

export type LwwRegisterType<V> = CrdtType<
  LwwRegisterState<V>,
  LwwRegisterUpdate<V>,
  LwwRegisterOp<V>,
  LwwRegisterValue<V>
>

/** The stamp of a register nobody has written yet. Every real write (ts >= 0) beats it. */
export const UNWRITTEN_TS = -1

function init<V>(_node: NodeId): LwwRegisterState<V> {
  return { value: null, ts: UNWRITTEN_TS, node: '' }
}

function prepare<V>(
  _state: LwwRegisterState<V>,
  u: LwwRegisterUpdate<V>,
  ctx: Ctx,
): LwwRegisterOp<V> {
  return { set: u.set, ts: ctx.ts, node: ctx.node }
}

/**
 * Apply a stamped write (value may be null: that is how lww-map writes a tombstone). Returns the
 * input state unchanged when the stamp does not beat the current one.
 */
export function lwwWrite<V>(
  state: LwwRegisterState<V>,
  newValue: V | null,
  stamp: { ts: number; node: NodeId },
): LwwRegisterState<V> {
  if (compareStamp(stamp, state) <= 0) return state
  return { value: newValue, ts: stamp.ts, node: stamp.node }
}

function effect<V>(state: LwwRegisterState<V>, op: LwwRegisterOp<V>): LwwRegisterState<V> {
  return lwwWrite(state, op.set, op)
}

function update<V>(
  state: LwwRegisterState<V>,
  u: LwwRegisterUpdate<V>,
  ctx: Ctx,
): LwwRegisterState<V> {
  return effect(state, prepare(state, u, ctx))
}

/** Returns the winning side itself (states are immutable, so sharing is safe). Equal stamps keep `a`. */
function merge<V>(a: LwwRegisterState<V>, b: LwwRegisterState<V>): LwwRegisterState<V> {
  return compareStamp(b, a) > 0 ? b : a
}

function value<V>(state: LwwRegisterState<V>): LwwRegisterValue<V> {
  return state.value
}

/** True once any write has been applied. */
export function lwwIsWritten<V>(state: LwwRegisterState<V>): boolean {
  return state.ts !== UNWRITTEN_TS
}

export const lwwRegister = {
  name: 'lww-register' as const,
  init,
  update,
  prepare,
  effect,
  merge,
  value,
}
