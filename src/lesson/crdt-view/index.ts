/**
 * Lesson-side view contract for CRDT replicas (docs/animation-dsl.md §5.2, stage-architecture
 * §7.2): `views` / `viewFor` / `toValue` project real `src/crdt` state into the DSL `Value` tree;
 * `opLabel` / `opLabelParts` caption outbox chips and op tokens (t()-ready); `fromJson` turns
 * register payloads into values; `summarizeState` is the compact text of a state token; the HLC
 * stamp codec is shared with the reducer's delivery layer (`src/lesson/reducer/crdt.ts`).
 */
export { fmtQuoted, fmtValue, joinFit, orderNodes, SUMMARY_MAX, truncate } from './format'
export { fromJson } from './from-json'
export { decodeHlcStamp, encodeHlcStamp, HLC_STAMP_BASE } from './hlc-stamp'
export {
  leafTypeAt,
  OP_LABEL_TEMPLATES,
  opLabel,
  opLabelParts,
  renderOpLabel,
  type OpLabelKey,
  type OpLabelParts,
  type OpLabelVars,
} from './op-label'
export { EMPTY_SUMMARY, summarizeState, type StateSummary } from './summary'
export { orderedVc, toValue, viewFor, views, type LessonCrdtView } from './to-value'
