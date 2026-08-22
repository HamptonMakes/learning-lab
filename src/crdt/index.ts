/**
 * Public surface of `src/crdt/`: every CRDT type, the clocks, the shared contract (`types.ts`) and a
 * name → implementation registry for the lesson reducer.
 *
 * The registry erases each type's parameters to `unknown` so the reducer can hold replicas of any
 * type in one table; `crdt.init` commands name the type by its `name`, the reducer looks it up here,
 * and the stage gets real state back. Each type's own module keeps the precise types; import from
 * there when you know which type you are working with.
 */
import { gCounter } from './g-counter'
import { gSetType } from './g-set'
import { lamportClock } from './lamport-clock'
import { lwwElementSetType } from './lww-element-set'
import { lwwMap, type LwwMapType } from './lww-map'
import { lwwRegister, type LwwRegisterType } from './lww-register'
import { mvRegister, type MvRegisterType } from './mv-register'
import { opCounter } from './op-counter'
import { orSetType } from './or-set'
import { pnCounter } from './pn-counter'
import { rgaType } from './rga'
import { twoPhaseSetType } from './two-phase-set'
import type { CrdtType } from './types'
import { vectorClock } from './vector-clock'

export * from './types'
export * from './lww-register'
export * from './lww-map'
export * from './mv-register'
export * from './g-counter'
export * from './pn-counter'
export * from './op-counter'
export * from './g-set'
export * from './two-phase-set'
export * from './lww-element-set'
export * from './or-set'
export * from './rga'
export * from './lamport-clock'
export * from './vector-clock'
export * from './hlc'
export * from './clock-skew'

/** A CRDT with its type parameters erased — what the registry hands to the reducer. */
export type AnyCrdtType = CrdtType<unknown, unknown, unknown, unknown, unknown>

/** Every registered CRDT name, in curriculum order. `CrdtName` is derived from this list. */
export const CRDT_NAMES = [
  'lww-register',
  'lww-map',
  'mv-register',
  'g-counter',
  'pn-counter',
  'op-counter',
  'g-set',
  'two-phase-set',
  'lww-element-set',
  'or-set',
  'rga',
  'lamport-clock',
  'vector-clock',
] as const

export type CrdtName = (typeof CRDT_NAMES)[number]

/**
 * Erase a concrete `CrdtType<S, U, O, V, A>` to `AnyCrdtType`. This is the one place the precise
 * types are dropped; the reducer re-narrows by `name` (and lesson data is validated by Zod), so
 * the cast is the boundary between typed implementations and the untyped world table.
 */
function erase<S, U, O, V, A>(type: CrdtType<S, U, O, V, A>): AnyCrdtType {
  return type as unknown as AnyCrdtType
}

// The generic-method objects (`lwwRegister`, `lwwMap`, `mvRegister`) are pinned to V = unknown
// through their `XxxType<V>` aliases; the factory types (`gSetType<E>()` …) are instantiated once.
const lwwRegisterAny: LwwRegisterType<unknown> = lwwRegister
const lwwMapAny: LwwMapType<unknown> = lwwMap
const mvRegisterAny: MvRegisterType<unknown> = mvRegister

/** name → implementation. Keys equal each implementation's own `name` (checked in index.test.ts). */
export const crdtRegistry: Readonly<Record<CrdtName, AnyCrdtType>> = {
  'lww-register': erase(lwwRegisterAny),
  'lww-map': erase(lwwMapAny),
  'mv-register': erase(mvRegisterAny),
  'g-counter': erase(gCounter),
  'pn-counter': erase(pnCounter),
  'op-counter': erase(opCounter),
  'g-set': erase(gSetType<unknown>()),
  'two-phase-set': erase(twoPhaseSetType<unknown>()),
  'lww-element-set': erase(lwwElementSetType<unknown>()),
  'or-set': erase(orSetType<unknown>()),
  rga: erase(rgaType<unknown>()),
  'lamport-clock': erase(lamportClock),
  'vector-clock': erase(vectorClock),
}

/** Type guard for strings coming from lesson data. */
export function isCrdtName(name: string): name is CrdtName {
  return (CRDT_NAMES as readonly string[]).includes(name)
}

/** Look up a registered type; throws a clear error for an unknown name. */
export function getCrdtType(name: CrdtName): AnyCrdtType {
  return crdtRegistry[name]
}
