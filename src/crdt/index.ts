/**
 * Public surface of `src/crdt/`: every CRDT type, the clocks, the composed document, the shared
 * contract (`types.ts`) and the name → implementation registry for the lesson reducer
 * (`registry.ts`: `CRDT_NAMES`, `CrdtName`, `crdtRegistry`, `getCrdtType`, `isCrdtName`, and
 * `DOC_NAME` for the composed document, which is `docCrdt` in `doc.ts`).
 *
 * Each type's own module keeps the precise types; import from there (or from here — everything is
 * re-exported) when you know which type you are working with. The registry erases types to
 * `unknown` for the reducer's world table.
 */
export * from './types'
export * from './registry'
export * from './max-register'
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
export * from './doc'
