/**
 * Max Register — the simplest possible register: it only ever goes up.
 *
 * Plain words: the register holds one number. A write replaces the value only if the new number is
 * bigger; a smaller write is silently ignored. To merge two replicas, keep the bigger number. "Max"
 * is commutative, associative and idempotent, so any two replicas that have seen the same writes
 * agree — no stamps, no node ids, no tie-breaks needed. The price: the register cannot go down, and
 * it cannot tell you who wrote the winning number or when.
 *
 * A fresh register holds `null` ("never set"); null loses to every number, so the first write always
 * lands. Values must be finite numbers (NaN and ±Infinity are rejected: they break `max` and are
 * not JSON-safe).
 *
 * Sidecar metadata: none — the whole state is the one number. Op-based use: the op carries the
 * number and `effect` is the same max, so replays and reordering are harmless.
 */
import type { CrdtType, Ctx, NodeId } from './types'

export interface MaxRegisterState {
  /** The largest number written so far; null until the first write. */
  value: number | null
}

export interface MaxRegisterUpdate {
  set: number
}

/** The number itself. `effect` is a max, so applying the op twice changes nothing. */
export interface MaxRegisterOp {
  set: number
}

export type MaxRegisterValue = number | null

export type MaxRegisterType = CrdtType<
  MaxRegisterState,
  MaxRegisterUpdate,
  MaxRegisterOp,
  MaxRegisterValue
>

/** Throws RangeError unless `n` is a finite number. */
function assertFinite(n: number): void {
  if (typeof n !== 'number' || !Number.isFinite(n)) {
    throw new RangeError(`Max-Register value must be a finite number, got ${String(n)}`)
  }
}

/** The bigger of two readings; null (never set) loses to any number. */
function maxOf(a: number | null, b: number | null): number | null {
  if (a === null) return b
  if (b === null) return a
  return Math.max(a, b)
}

export const maxRegister: MaxRegisterType = {
  name: 'max-register',

  init(_node: NodeId): MaxRegisterState {
    return { value: null }
  },

  update(state: MaxRegisterState, u: MaxRegisterUpdate, ctx: Ctx): MaxRegisterState {
    return maxRegister.effect(state, maxRegister.prepare(state, u, ctx))
  },

  prepare(_state: MaxRegisterState, u: MaxRegisterUpdate, _ctx: Ctx): MaxRegisterOp {
    assertFinite(u.set)
    return { set: u.set }
  },

  effect(state: MaxRegisterState, op: MaxRegisterOp): MaxRegisterState {
    if (state.value !== null && op.set <= state.value) return state
    return { value: op.set }
  },

  merge(a: MaxRegisterState, b: MaxRegisterState): MaxRegisterState {
    const value = maxOf(a.value, b.value)
    if (value === a.value) return a
    return b.value === value ? b : { value }
  },

  value(state: MaxRegisterState): MaxRegisterValue {
    return state.value
  },
}
