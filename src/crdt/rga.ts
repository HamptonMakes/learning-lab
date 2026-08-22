/**
 * RGA — Replicated Growable Array. A sequence CRDT for collaborative text and lists.
 *
 * How it works, in plain words:
 *  - Every inserted element gets a unique id (`node:seq`) and remembers the id of the element it
 *    was inserted *after* — its anchor (`'HEAD'` means "at the front"). Deleting never removes an
 *    element; it only flips `tombstone` to true, so inserts that point at it keep their anchor.
 *  - The list you see is rebuilt from those facts: start at HEAD and, after each element, place its
 *    children (the elements that named it as anchor), each followed by its own children. When several
 *    elements share one anchor — concurrent inserts at the same spot — the one with the higher `ts`
 *    goes first (leftmost). Equal `ts`: higher node id first; same node: higher seq first.
 *  - That rule looks only at ids, anchors and timestamps, never at arrival order, so every replica
 *    that holds the same set of elements shows the same sequence.
 *
 * Sidecar metadata the stage shows per element: `id`, `after` (the anchor), `ts`, `tombstone`, and
 * `visibleIndex` (null once deleted) — see `rgaRows()`. `state.order` is the materialized linear
 * order of ALL elements, tombstones included; it is recomputed from `nodes` on every change, so two
 * replicas with the same elements have structurally equal states.
 */
import {
  compareStamp,
  dot,
  parseDot,
  type CrdtType,
  type Ctx,
  type Dot,
  type NodeId,
} from './types'

/** Where an element was inserted: after another element, or at the front. */
export type RgaAnchor = Dot | 'HEAD'

/** One element of the sequence. `nodes` in the state maps id → element (tree nodes, not replicas). */
export interface RgaElement<E> {
  id: Dot
  value: E
  /** The element this one was inserted after, or 'HEAD' for the front. */
  after: RgaAnchor
  /** Deleted elements stay as tombstones so concurrent inserts anchored on them still resolve. */
  tombstone: boolean
  /** Logical time of the insert (ctx.ts). Decides who goes first among concurrent inserts. */
  ts: number
}

export interface RgaState<E> {
  /** Every element ever inserted, keyed by id. Keys are kept sorted so the state is canonical. */
  nodes: Record<Dot, RgaElement<E>>
  /** All element ids (visible and tombstoned) in sequence order. Derived from `nodes`. */
  order: Dot[]
}

export type RgaUpdate<E> =
  /** Insert after a known element id, or at the front with 'HEAD'. */
  | { insertAfter: RgaAnchor; value: E }
  /** Insert at an index among the VISIBLE elements (0 = front). Out-of-range indexes are clamped. */
  | { insertAt: number; value: E }
  /** Delete by element id. */
  | { delete: Dot }
  /** Delete the visible element at an index. Out-of-range indexes are clamped. */
  | { deleteAt: number }

export type RgaOp<E> =
  | { insert: { id: Dot; value: E; after: RgaAnchor; ts: number } }
  | { delete: Dot }
  /** Produced by `deleteAt` on a list with no visible elements: there is nothing to delete. */
  | { noop: true }

export type RgaValue<E> = E[]

/** One row for the stage: the element plus its position among visible elements (null if deleted). */
export interface RgaRow<E> extends RgaElement<E> {
  visibleIndex: number | null
}

// ---------------------------------------------------------------------------------------------
// Ordering
// ---------------------------------------------------------------------------------------------

/**
 * Order among elements that share one anchor (concurrent inserts at the same spot). Negative means
 * `x` comes before `y`. Higher `ts` first; equal `ts` → higher node id first; same node → higher
 * seq first. Because the whole decision depends only on (ts, id), every replica agrees.
 */
function compareSiblings(x: RgaElement<unknown>, y: RgaElement<unknown>): number {
  const dx = parseDot(x.id)
  const dy = parseDot(y.id)
  const byStamp = compareStamp({ ts: y.ts, node: dy.node }, { ts: x.ts, node: dx.node })
  return byStamp !== 0 ? byStamp : dy.seq - dx.seq
}

/** Rebuild the linear order of all elements from the anchors and timestamps in `nodes`. */
function linearize<E>(nodes: Record<Dot, RgaElement<E>>): Dot[] {
  // 1. Group elements by anchor and sort every group into sibling order.
  const children = new Map<RgaAnchor, RgaElement<E>[]>()
  for (const el of Object.values(nodes)) {
    const group = children.get(el.after)
    if (group) group.push(el)
    else children.set(el.after, [el])
  }
  for (const group of children.values()) group.sort(compareSiblings)

  // 2. Depth-first walk from HEAD: an element, then everything under it, then its next sibling.
  //    Iterative so a long document (one long chain of anchors) cannot overflow the call stack.
  const order: Dot[] = []
  const stack: RgaElement<E>[] = []
  const pushChildren = (anchor: RgaAnchor) => {
    const group = children.get(anchor) ?? []
    for (let i = group.length - 1; i >= 0; i--) {
      const child = group[i]
      if (child) stack.push(child) // pushed right-to-left so the leftmost sibling pops first
    }
  }
  pushChildren('HEAD')
  for (let el = stack.pop(); el; el = stack.pop()) {
    order.push(el.id)
    pushChildren(el.id)
  }
  return order
}

/** Build a canonical state from a node table: keys sorted by id, `order` recomputed. */
function fromNodes<E>(nodes: Record<Dot, RgaElement<E>>): RgaState<E> {
  const sorted: Record<Dot, RgaElement<E>> = {}
  const byId = Object.values(nodes).sort((x, y) => (x.id < y.id ? -1 : x.id > y.id ? 1 : 0))
  for (const el of byId) sorted[el.id] = el
  return { nodes: sorted, order: linearize(sorted) }
}

function getElement<E>(state: RgaState<E>, id: Dot): RgaElement<E> {
  const el = state.nodes[id]
  if (!el) throw new Error(`RGA: state is inconsistent — order references unknown element ${id}`)
  return el
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n))
}

// ---------------------------------------------------------------------------------------------
// Public helpers (used by lessons and the stage)
// ---------------------------------------------------------------------------------------------

/** Ids of the visible (not deleted) elements, in sequence order. */
export function rgaVisibleIds<E>(state: RgaState<E>): Dot[] {
  return state.order.filter((id) => !getElement(state, id).tombstone)
}

/** Every element in sequence order, with its index among visible elements (null if deleted). */
export function rgaRows<E>(state: RgaState<E>): RgaRow<E>[] {
  const rows: RgaRow<E>[] = []
  let visibleIndex = 0
  for (const id of state.order) {
    const el = getElement(state, id)
    rows.push({ ...el, visibleIndex: el.tombstone ? null : visibleIndex })
    if (!el.tombstone) visibleIndex += 1
  }
  return rows
}

/** For text documents (E = string): the visible characters joined into one string. */
export function rgaText(state: RgaState<string>): string {
  return rga.value(state).join('')
}

// ---------------------------------------------------------------------------------------------
// The CRDT
// ---------------------------------------------------------------------------------------------

/**
 * The RGA operations, generic in the element type E. One shared object serves every E; use
 * `rgaType<E>()` when you need it as a `CrdtType` for a fixed E (e.g. in the law tests).
 */
export interface RgaCrdt {
  readonly name: 'rga'
  init<E>(node: NodeId): RgaState<E>
  update<E>(state: RgaState<E>, u: RgaUpdate<E>, ctx: Ctx): RgaState<E>
  prepare<E>(state: RgaState<E>, u: RgaUpdate<E>, ctx: Ctx): RgaOp<E>
  effect<E>(state: RgaState<E>, op: RgaOp<E>): RgaState<E>
  merge<E>(a: RgaState<E>, b: RgaState<E>): RgaState<E>
  value<E>(state: RgaState<E>): RgaValue<E>
}

export const rga: RgaCrdt = {
  name: 'rga',

  init() {
    return { nodes: {}, order: [] }
  },

  update(state, u, ctx) {
    return rga.effect(state, rga.prepare(state, u, ctx))
  },

  /**
   * Turn a local intent into an op. Index-based updates are resolved here, at the source, into
   * anchor-based ops: `insertAt(i)` becomes "insert after the visible element at i-1" (or HEAD),
   * `deleteAt(i)` becomes "delete the visible element at i". The new element's ts is `ctx.ts`;
   * lessons advance the clock so a fresh insert outranks the concurrent inserts it has already seen.
   */
  prepare(state, u, ctx) {
    if ('insertAfter' in u) {
      const after = u.insertAfter
      if (after !== 'HEAD' && !state.nodes[after]) {
        throw new Error(`RGA: cannot insert after ${after} — this replica has no such element`)
      }
      return { insert: { id: dot(ctx.node, ctx.nextSeq()), value: u.value, after, ts: ctx.ts } }
    }
    if ('insertAt' in u) {
      const visible = rgaVisibleIds(state)
      const i = clamp(u.insertAt, 0, visible.length)
      // Anchor on the visible element just before the slot (the `?? 'HEAD'` only satisfies the
      // type checker: for i ≥ 1 that element always exists).
      const after: RgaAnchor = i === 0 ? 'HEAD' : (visible[i - 1] ?? 'HEAD')
      return { insert: { id: dot(ctx.node, ctx.nextSeq()), value: u.value, after, ts: ctx.ts } }
    }
    if ('delete' in u) {
      if (!state.nodes[u.delete]) {
        throw new Error(`RGA: cannot delete ${u.delete} — this replica has no such element`)
      }
      return { delete: u.delete }
    }
    const visible = rgaVisibleIds(state)
    const target = visible[clamp(u.deleteAt, 0, visible.length - 1)]
    return target === undefined ? { noop: true } : { delete: target }
  },

  /**
   * Apply an op at any replica. Assumes causal delivery: an insert's anchor and a delete's target
   * must already be here, otherwise this throws. Re-delivered ops are harmless (idempotent).
   */
  effect(state, op) {
    if ('noop' in op) return state
    if ('insert' in op) {
      const { id, value, after, ts } = op.insert
      if (state.nodes[id]) return state // already applied
      if (after !== 'HEAD' && !state.nodes[after]) {
        throw new Error(
          `RGA: cannot insert ${id} after ${after} — the anchor has not arrived yet (ops must be delivered causally)`,
        )
      }
      return fromNodes({ ...state.nodes, [id]: { id, value, after, tombstone: false, ts } })
    }
    const el = state.nodes[op.delete]
    if (!el) {
      throw new Error(
        `RGA: cannot delete ${op.delete} — it has not arrived yet (ops must be delivered causally)`,
      )
    }
    if (el.tombstone) return state // already deleted
    return fromNodes({ ...state.nodes, [el.id]: { ...el, tombstone: true } })
  },

  /** Union of the two element tables; an element deleted on either side stays deleted. */
  merge(a, b) {
    const nodes = { ...a.nodes }
    for (const el of Object.values(b.nodes)) {
      const mine = nodes[el.id]
      nodes[el.id] = mine ? { ...mine, tombstone: mine.tombstone || el.tombstone } : el
    }
    return fromNodes(nodes)
  },

  value(state) {
    return rgaVisibleIds(state).map((id) => getElement(state, id).value)
  },
}

/** The RGA viewed as a `CrdtType` for one element type E (same shared functions, fixed types). */
export function rgaType<E>(): CrdtType<RgaState<E>, RgaUpdate<E>, RgaOp<E>, RgaValue<E>> {
  return rga
}
