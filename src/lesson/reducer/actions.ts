/**
 * Action labels (DSL §14 `Change.action`, stage-architecture §5.3): the operation that caused a
 * value change, as a translatable `stage.op.*` key + vars (+ the acting actor), pushed to the step
 * event log by the command modules and folded into the matching `value` change by `applyStep`.
 * The stage draws it as a small action chip next to the changed node ("this just happened here").
 *
 * `opLabelParts` (crdt-view) already names every CRDT op in exactly this form; this module only
 * flattens it (a doc part's `stage.op.at` wrapper is dropped — the chip sits on the part itself),
 * and diffs a slot's shown value around one op so the action lands on the node the op touched
 * (`alice.cart[milk]`, `bob.views[alice]`, `alice.note[alice:3]`) rather than on the whole slot.
 */
import type { OpLabelParts } from '../crdt-view'
import type { ActionLabel, ActorId, Path, SlotId, Value } from '../types'
import type { ReduceCtx } from './context'
import { diffValue } from './diff'

/** `{ key, vars?, by? }` from op label parts: the innermost parts, vars copied, empty vars omitted. */
export function actionOf(parts: OpLabelParts, by?: ActorId): ActionLabel {
  const leaf = parts.inner ?? parts
  const label: ActionLabel = { key: leaf.key }
  if (Object.keys(leaf.vars).length > 0) label.vars = { ...leaf.vars }
  if (by !== undefined) label.by = by
  return label
}

/** A plain (non-CRDT) action: `stage.op.setPlain`, `stage.op.merge` … with optional vars / actor. */
export function plainAction(
  key: string,
  vars?: Record<string, string | number>,
  by?: ActorId,
): ActionLabel {
  const label: ActionLabel = { key }
  if (vars !== undefined && Object.keys(vars).length > 0) label.vars = { ...vars }
  if (by !== undefined) label.by = by
  return label
}

export function pushAction(ctx: ReduceCtx, path: Path, label: ActionLabel): void {
  ctx.log.push({ kind: 'action', path, label })
}

/** `alice.card` + a doc part path (`items[alice:1].qty`, `title`, `''`) → the part's stage path. */
export function docPartPath(actor: ActorId, slot: SlotId, docPath: string | undefined): Path {
  const base = `${actor}.${slot}`
  if (docPath === undefined || docPath === '') return base
  return docPath.startsWith('[') ? `${base}${docPath}` : `${base}.${docPath}`
}

/**
 * The paths under `slotPath` whose shown value differs between `before` and `after` (the slot's
 * `holds` around one op), in diff order; `[slotPath]` when the op changed nothing visible (the
 * action then folds into whatever else changed the slot this step, or into nothing).
 */
export function touchedPaths(
  before: Value | undefined,
  after: Value | undefined,
  slotPath: Path,
): Path[] {
  if (before === undefined || after === undefined) return [slotPath]
  const out: Parameters<typeof diffValue>[3] = []
  diffValue(before, after, slotPath, out)
  const values = out.filter((c) => c.kind === 'value')
  // A root sidecar refresh (`vc` / `applied` / `stats` exposed as meta) rides along with the real
  // change; the chip belongs on the node that changed, so meta-only changes count only when alone.
  const real = values.filter((c) => c.op !== 'meta')
  const paths = (real.length > 0 ? real : values).map((c) => c.path)
  return paths.length === 0 ? [slotPath] : paths
}
