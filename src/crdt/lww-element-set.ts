/**
 * LWW-Element-Set — a set where, per element, the latest add or remove wins.
 *
 * Each add and each remove is stamped with the logical time and node that did it. Per element the
 * replica keeps only the newest add stamp and the newest remove stamp; merging two replicas keeps
 * the newer stamp on each side. An element is in the set when its add stamp beats its remove stamp.
 * Unlike the 2P-Set, an element can be removed and added back: a newer add wins over an older
 * remove. Removes need no precondition — removing something you have never seen just records a
 * stamp, which later hides any add that is older than it. Ops carry their stamp, so they can arrive
 * in any order and any number of times.
 *
 * Tie rule (exact): stamps are compared with `compareStamp` — by `ts`, then by `node` (the larger
 * node id wins). So an add and a remove at the same `ts` from *different* nodes are decided by node
 * id, not by bias. Only when add and remove carry the very same stamp (same `ts` AND same `node` —
 * one node adding and removing in one tick) does `bias` decide: `'add'` keeps the element,
 * `'remove'` drops it. `bias` is fixed at `init` and both replicas in a merge must agree.
 *
 * Sidecar the stage visualizes: `adds` — per key the element plus its newest add stamp
 * `{ e, ts, node }`; `removes` — per key the newest remove stamp `{ ts, node }` (a key may appear in
 * `removes` with no matching add); `bias`. Keys are kept sorted. `lwwElementSetRows(state)` lays
 * this out as one row per added element with a `present` flag.
 */
import { keyOf, sortRecord, sortedEntries } from './g-set'
import { compareStamp, type CrdtType, type Ctx, type NodeId } from './types'

export type LwwBias = 'add' | 'remove'

export interface LwwStamp {
  ts: number
  node: NodeId
}

export interface LwwElementSetState<E> {
  /** Newest add per element: the element and its stamp, keyed by `keyOf(element)`, keys sorted. */
  adds: Record<string, { e: E; ts: number; node: NodeId }>
  /** Newest remove per element key, keys sorted. May hold keys that have no add (yet). */
  removes: Record<string, { ts: number; node: NodeId }>
  /** Who wins when add and remove carry the identical stamp. Fixed at init. */
  bias: LwwBias
}

export interface LwwElementSetArgs {
  bias: LwwBias
}

export type LwwElementSetUpdate<E> = { add: E } | { remove: E }

/** The update stamped with the source's `(ts, node)`. Idempotent and order-independent. */
export type LwwElementSetOp<E> =
  { add: E; ts: number; node: NodeId } | { remove: E; ts: number; node: NodeId }

/** Present elements, sorted by canonical key. */
export type LwwElementSetValue<E> = E[]

/** One row per added element, for tables and the stage. Remove-only tombstones are not rows. */
export interface LwwElementSetRow<E> {
  key: string
  e: E
  addTs: number
  addNode: NodeId
  removeTs?: number
  removeNode?: NodeId
  present: boolean
}

/** The value rule: add present, and add stamp beats remove stamp (or equal stamps with bias 'add'). */
function isPresent(
  add: LwwStamp | undefined,
  remove: LwwStamp | undefined,
  bias: LwwBias,
): boolean {
  if (!add) return false
  if (!remove) return true
  const c = compareStamp(add, remove)
  return c > 0 || (c === 0 && bias === 'add')
}

/** True when `e` is currently in the set. */
export function lwwElementSetHas<E>(state: LwwElementSetState<E>, e: E): boolean {
  const k = keyOf(e)
  return isPresent(state.adds[k], state.removes[k], state.bias)
}

/** `[{ key, e, addTs, addNode, removeTs?, removeNode?, present }]` for every added element, sorted by key. */
export function lwwElementSetRows<E>(state: LwwElementSetState<E>): LwwElementSetRow<E>[] {
  return sortedEntries(state.adds).map(([key, add]) => {
    const remove = state.removes[key]
    const row: LwwElementSetRow<E> = {
      key,
      e: add.e,
      addTs: add.ts,
      addNode: add.node,
      present: isPresent(add, remove, state.bias),
    }
    if (remove) {
      row.removeTs = remove.ts
      row.removeNode = remove.node
    }
    return row
  })
}

/** Builds an LWW-Element-Set type for elements of type `E`. Lessons with string elements can use `lwwElementSet`. */
export function lwwElementSetType<E>(): CrdtType<
  LwwElementSetState<E>,
  LwwElementSetUpdate<E>,
  LwwElementSetOp<E>,
  LwwElementSetValue<E>,
  LwwElementSetArgs
> {
  const type: CrdtType<
    LwwElementSetState<E>,
    LwwElementSetUpdate<E>,
    LwwElementSetOp<E>,
    LwwElementSetValue<E>,
    LwwElementSetArgs
  > = {
    name: 'lww-element-set',

    init(_node: NodeId, args: LwwElementSetArgs): LwwElementSetState<E> {
      return { adds: {}, removes: {}, bias: args.bias }
    },

    update(
      state: LwwElementSetState<E>,
      u: LwwElementSetUpdate<E>,
      ctx: Ctx,
    ): LwwElementSetState<E> {
      return type.effect(state, type.prepare(state, u, ctx))
    },

    prepare(
      _state: LwwElementSetState<E>,
      u: LwwElementSetUpdate<E>,
      ctx: Ctx,
    ): LwwElementSetOp<E> {
      if ('add' in u) return { add: u.add, ts: ctx.ts, node: ctx.node }
      return { remove: u.remove, ts: ctx.ts, node: ctx.node }
    },

    effect(state: LwwElementSetState<E>, op: LwwElementSetOp<E>): LwwElementSetState<E> {
      if ('add' in op) {
        const k = keyOf(op.add)
        const current = state.adds[k]
        if (current && compareStamp(current, op) >= 0) return state
        return {
          adds: sortRecord({ ...state.adds, [k]: { e: op.add, ts: op.ts, node: op.node } }),
          removes: state.removes,
          bias: state.bias,
        }
      }
      const k = keyOf(op.remove)
      const current = state.removes[k]
      if (current && compareStamp(current, op) >= 0) return state
      return {
        adds: state.adds,
        removes: sortRecord({ ...state.removes, [k]: { ts: op.ts, node: op.node } }),
        bias: state.bias,
      }
    },

    /** Throws if the two replicas were initialized with different biases. */
    merge(a: LwwElementSetState<E>, b: LwwElementSetState<E>): LwwElementSetState<E> {
      if (a.bias !== b.bias) {
        throw new Error(`LWW-Element-Set: cannot merge bias '${a.bias}' with bias '${b.bias}'`)
      }
      const adds: Record<string, { e: E; ts: number; node: NodeId }> = { ...a.adds }
      for (const [k, add] of Object.entries(b.adds)) {
        const current = adds[k]
        if (!current || compareStamp(add, current) > 0) adds[k] = add
      }
      const removes: Record<string, { ts: number; node: NodeId }> = { ...a.removes }
      for (const [k, remove] of Object.entries(b.removes)) {
        const current = removes[k]
        if (!current || compareStamp(remove, current) > 0) removes[k] = remove
      }
      return { adds: sortRecord(adds), removes: sortRecord(removes), bias: a.bias }
    },

    value(state: LwwElementSetState<E>): LwwElementSetValue<E> {
      return sortedEntries(state.adds)
        .filter(([k, add]) => isPresent(add, state.removes[k], state.bias))
        .map(([, add]) => add.e)
    },
  }
  return type
}

/** LWW-Element-Set of strings — the common case in lessons. For other element types call `lwwElementSetType<E>()`. */
export const lwwElementSet: CrdtType<
  LwwElementSetState<string>,
  LwwElementSetUpdate<string>,
  LwwElementSetOp<string>,
  LwwElementSetValue<string>,
  LwwElementSetArgs
> = lwwElementSetType<string>()
