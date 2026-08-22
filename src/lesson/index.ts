/**
 * Public surface of `src/lesson/`: the DSL types, the Zod schema, the path lenses and the reducer
 * (`reduce`, `applyStep`, `buildTimeline`, `initWorld`, …). Builders, lint, player and the CRDT
 * views are re-exported here as they land.
 */
export * from './types'
export * from './schema'
export * from './path'
export * from './reducer'
export { buildTimeline, frameAt, type TimelineOptions } from './reducer/timeline'
export * from './builders'
export * from './lint'
export * from './player'
export * from './crdt-view'
// Both the builders (`toValue(valueLike)`, authoring) and the CRDT views (`toValue(type, state,
// ctx)`, §5.2) export a `toValue`; the barrel keeps the authoring one under its name and exposes
// the view projection as `replicaToValue` so neither star export is ambiguous.
export { toValue } from './builders'
export { toValue as replicaToValue } from './crdt-view'
