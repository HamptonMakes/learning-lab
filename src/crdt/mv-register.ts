/**
 * MV Register — Multi-Value register (Dynamo / Riak style).
 *
 * Algorithm: instead of picking one winner, the register keeps every write that no other write has
 * seen. Each version carries a vector clock (a per-node counter map). A write at node n takes the
 * max of the clocks of all versions it currently holds, then bumps n's own counter: the new version
 * is causally after ("dominates") everything it saw, and those versions are dropped. `merge` is the
 * union of both sides' versions minus every version dominated by another one. Versions whose clocks
 * are concurrent (neither dominates) both survive — these are the *siblings*, a conflict the
 * application must resolve. A later write made after seeing all siblings collapses them into one.
 *
 * Sidecar (what the stage shows): one row per version — its value and its vector clock, e.g.
 * `{ alice: 2, bob: 1 }`. More than one row means siblings. Versions are kept sorted by the canonical
 * JSON of their clock (then value) so equal states are structurally equal; `value()` lists the
 * sibling values in that same order. `mvRegisterClock(state)` is the merged clock of all versions —
 * the "context" a Dynamo client hands back with its next write.
 *
 * Op-based use: the op is the new version itself; `effect` merges it in, so it commutes and a
 * replayed op is a no-op. Generic in V through its methods, like `lwwRegister`.
 */
import type { CrdtType, Ctx, NodeId } from './types'

/** Per-node counters. Nodes with count 0 are omitted; keys are sorted. */
export type MvClock = Record<NodeId, number>

export interface MvVersion<V> {
  value: V
  clock: MvClock
}

export interface MvRegisterState<V> {
  /** All concurrent versions (siblings), sorted canonically. Empty until the first write. */
  versions: MvVersion<V>[]
}

export interface MvRegisterUpdate<V> {
  set: V
}

export interface MvRegisterOp<V> {
  version: MvVersion<V>
}

/** The sibling values, one per version, in canonical order. One element when there is no conflict. */
export type MvRegisterValue<V> = V[]

export type MvRegisterType<V> = CrdtType<
  MvRegisterState<V>,
  MvRegisterUpdate<V>,
  MvRegisterOp<V>,
  MvRegisterValue<V>
>

type VcOrder = 'lt' | 'eq' | 'gt' | 'concurrent'

/** Tiny private vector-clock comparison (kept local so this file has no dependency on vector-clock.ts). */
function vcCompare(a: MvClock, b: MvClock): VcOrder {
  let aBigger = false
  let bBigger = false
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const x = a[k] ?? 0
    const y = b[k] ?? 0
    if (x > y) aBigger = true
    else if (x < y) bBigger = true
  }
  if (aBigger && bBigger) return 'concurrent'
  if (aBigger) return 'gt'
  if (bBigger) return 'lt'
  return 'eq'
}

/** Componentwise max of clocks, with zero entries dropped and keys sorted. */
function joinClocks(clocks: MvClock[]): MvClock {
  const max: Record<string, number> = {}
  for (const c of clocks) {
    for (const [k, v] of Object.entries(c)) {
      if (v > (max[k] ?? 0)) max[k] = v
    }
  }
  const out: MvClock = {}
  for (const k of Object.keys(max).sort()) {
    const v = max[k]
    if (v !== undefined && v > 0) out[k] = v
  }
  return out
}

/** Canonical JSON (keys sorted recursively), used only to order versions deterministically. */
function canonJson(x: unknown): string {
  return JSON.stringify(sortKeys(x))
}
function sortKeys(x: unknown): unknown {
  if (Array.isArray(x)) return x.map(sortKeys)
  if (x && typeof x === 'object') {
    const rec = x as Record<string, unknown>
    return Object.fromEntries(
      Object.keys(rec)
        .sort()
        .map((k) => [k, sortKeys(rec[k])]),
    )
  }
  return x
}

function versionKey<V>(v: MvVersion<V>): string {
  return `${canonJson(v.clock)}|${canonJson(v.value)}`
}

/** Drop dominated and duplicate versions, then sort canonically. The result is an antichain. */
function normalize<V>(all: MvVersion<V>[]): MvVersion<V>[] {
  const keyed = all.map((v) => ({ v, key: versionKey(v) }))
  const seen = new Set<string>()
  const kept: { v: MvVersion<V>; key: string }[] = []
  for (const item of keyed) {
    if (seen.has(item.key)) continue
    const dominated = keyed.some((other) => vcCompare(item.v.clock, other.v.clock) === 'lt')
    if (dominated) continue
    seen.add(item.key)
    kept.push(item)
  }
  kept.sort((p, q) => (p.key < q.key ? -1 : p.key > q.key ? 1 : 0))
  return kept.map((item) => item.v)
}

function init<V>(_node: NodeId): MvRegisterState<V> {
  return { versions: [] }
}

function prepare<V>(state: MvRegisterState<V>, u: MvRegisterUpdate<V>, ctx: Ctx): MvRegisterOp<V> {
  const seen = joinClocks(state.versions.map((v) => v.clock))
  const clock = joinClocks([seen, { [ctx.node]: (seen[ctx.node] ?? 0) + 1 }])
  return { version: { value: u.set, clock } }
}

function effect<V>(state: MvRegisterState<V>, op: MvRegisterOp<V>): MvRegisterState<V> {
  return { versions: normalize([...state.versions, op.version]) }
}

function update<V>(
  state: MvRegisterState<V>,
  u: MvRegisterUpdate<V>,
  ctx: Ctx,
): MvRegisterState<V> {
  return effect(state, prepare(state, u, ctx))
}

function merge<V>(a: MvRegisterState<V>, b: MvRegisterState<V>): MvRegisterState<V> {
  return { versions: normalize([...a.versions, ...b.versions]) }
}

function value<V>(state: MvRegisterState<V>): MvRegisterValue<V> {
  return state.versions.map((v) => v.value)
}

/** The merged clock of all current versions — what the next write at this replica will build on. */
export function mvRegisterClock<V>(state: MvRegisterState<V>): MvClock {
  return joinClocks(state.versions.map((v) => v.clock))
}

/** True when the register holds more than one concurrent version (a conflict to resolve). */
export function mvHasSiblings<V>(state: MvRegisterState<V>): boolean {
  return state.versions.length > 1
}

export const mvRegister = {
  name: 'mv-register' as const,
  init,
  update,
  prepare,
  effect,
  merge,
  value,
}
