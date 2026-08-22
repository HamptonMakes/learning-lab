/**
 * 2P-Set — a two-phase set (a G-Set of adds plus a G-Set of removes).
 *
 * Adding puts the element in `added`; removing puts its key in `removed` (a tombstone). An element
 * is in the set when it is in `added` and not in `removed`. Both records only grow, so merging is
 * two unions. The cost: "gone is gone" — once an element's tombstone exists it can never come back,
 * no matter how many times it is added again. Remove has a precondition: the element must already
 * be in `added` at the source (you can only remove what you have seen); `prepare`/`update` throw
 * otherwise. Downstream, `effect(remove)` needs no precondition — a tombstone is safe to record even
 * before its add arrives (so delivery need not be causal), but the classic type assumes it is.
 *
 * Sidecar the stage visualizes: `added` — every element ever added, keyed by `keyOf(element)`;
 * `removed` — the keys of every element ever removed (`true` per key). Both keep sorted keys. The
 * value is `added − removed`, sorted by key.
 */
import { gSetHas, keyOf, sortRecord, sortedEntries } from './g-set'
import type { CrdtType, Ctx, NodeId } from './types'

export interface TwoPhaseSetState<E> {
  /** Every element ever added, keyed by `keyOf(element)`, keys sorted. Never shrinks. */
  added: Record<string, E>
  /** Tombstones: the key of every element ever removed, keys sorted. Never shrinks. */
  removed: Record<string, true>
}

export type TwoPhaseSetUpdate<E> = { add: E } | { remove: E }

/** Mirrors the update. Adds are unions; removes record a tombstone. Both are idempotent. */
export type TwoPhaseSetOp<E> = { add: E } | { remove: E }

/** `added − removed`, sorted by canonical key. */
export type TwoPhaseSetValue<E> = E[]

/** One row per element ever added, for tables and the stage. `removed` rows are the tombstones. */
export interface TwoPhaseSetRow<E> {
  key: string
  e: E
  removed: boolean
}

/** True when `e` is in `added` and not in `removed`. */
export function twoPhaseSetHas<E>(state: TwoPhaseSetState<E>, e: E): boolean {
  const k = keyOf(e)
  return Object.hasOwn(state.added, k) && !Object.hasOwn(state.removed, k)
}

/** `[{ key, e, removed }]` for every element ever added, sorted by key. */
export function twoPhaseSetRows<E>(state: TwoPhaseSetState<E>): TwoPhaseSetRow<E>[] {
  return sortedEntries(state.added).map(([key, e]) => ({
    key,
    e,
    removed: Object.hasOwn(state.removed, key),
  }))
}

/** Builds a 2P-Set type for elements of type `E`. Lessons with string elements can use `twoPhaseSet`. */
export function twoPhaseSetType<E>(): CrdtType<
  TwoPhaseSetState<E>,
  TwoPhaseSetUpdate<E>,
  TwoPhaseSetOp<E>,
  TwoPhaseSetValue<E>
> {
  const type: CrdtType<
    TwoPhaseSetState<E>,
    TwoPhaseSetUpdate<E>,
    TwoPhaseSetOp<E>,
    TwoPhaseSetValue<E>
  > = {
    name: 'two-phase-set',

    init(_node: NodeId): TwoPhaseSetState<E> {
      return { added: {}, removed: {} }
    },

    update(state: TwoPhaseSetState<E>, u: TwoPhaseSetUpdate<E>, ctx: Ctx): TwoPhaseSetState<E> {
      return type.effect(state, type.prepare(state, u, ctx))
    },

    /** Throws if a remove targets an element that is not in `added` (the classic precondition). */
    prepare(state: TwoPhaseSetState<E>, u: TwoPhaseSetUpdate<E>, _ctx: Ctx): TwoPhaseSetOp<E> {
      if ('add' in u) return { add: u.add }
      if (!gSetHas({ items: state.added }, u.remove)) {
        throw new Error(
          `2P-Set: cannot remove ${keyOf(u.remove)} — it was never added on this replica`,
        )
      }
      return { remove: u.remove }
    },

    effect(state: TwoPhaseSetState<E>, op: TwoPhaseSetOp<E>): TwoPhaseSetState<E> {
      if ('add' in op) {
        const k = keyOf(op.add)
        if (Object.hasOwn(state.added, k)) return state
        return { added: sortRecord({ ...state.added, [k]: op.add }), removed: state.removed }
      }
      const k = keyOf(op.remove)
      if (Object.hasOwn(state.removed, k)) return state
      return { added: state.added, removed: sortRecord({ ...state.removed, [k]: true }) }
    },

    merge(a: TwoPhaseSetState<E>, b: TwoPhaseSetState<E>): TwoPhaseSetState<E> {
      return {
        added: sortRecord({ ...a.added, ...b.added }),
        removed: sortRecord({ ...a.removed, ...b.removed }),
      }
    },

    value(state: TwoPhaseSetState<E>): TwoPhaseSetValue<E> {
      return sortedEntries(state.added)
        .filter(([k]) => !Object.hasOwn(state.removed, k))
        .map(([, e]) => e)
    },
  }
  return type
}

/** 2P-Set of strings — the common case in lessons. For other element types call `twoPhaseSetType<E>()`. */
export const twoPhaseSet: CrdtType<
  TwoPhaseSetState<string>,
  TwoPhaseSetUpdate<string>,
  TwoPhaseSetOp<string>,
  TwoPhaseSetValue<string>
> = twoPhaseSetType<string>()
