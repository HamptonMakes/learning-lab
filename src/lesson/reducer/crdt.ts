/**
 * The CRDT delivery layer (docs/animation-dsl.md §5.1 "Semantics (the delivery layer)";
 * stage-architecture §7.2). The CRDT is the data type (`src/crdt/`: `init` / `prepare` / `effect`
 * / `merge`); this module is everything around it: replicas per actor, op ids and seqs, the stamp
 * (`Ctx.ts`) of every update, seeds, version vectors, dedupe and causal readiness of op delivery,
 * state snapshots on the wire, instant merges, gc with its stability proof, and the bookkeeping
 * the stage reads (`holds[slot] = toValue()`, outbox chips, `unchanged` / `flow` marks, `via`
 * and `sync` events). Pure; structural sharing; `ReducerError` on misuse.
 *
 * ──────────────────────────────────────────────────────────────────────────────────────────────
 * ROUTING NOTE FOR THE REDUCER CORE
 *
 *   - `reduceCrdt` handles `crdt.init` / `crdt.doc` / `crdt.update` / `crdt.merge` / `crdt.gc` and
 *     `crdt.sync` in state mode (the default).
 *   - `crdt.send` / `crdt.broadcast` go through `prepareOutgoing`: it returns the updated world
 *     (pending cleared, outbox chips refreshed) and one `OutgoingSpec` per recipient with FINAL
 *     ids; the core turns each spec into a `Message` (parked when the recipient is offline).
 *   - `crdt.sync` with `mode: 'ops'` creates messages too, so it must be routed through
 *     `prepareSyncOps(w, cmd, ctx)` exactly like `prepareOutgoing` (same return shape). `reduceCrdt`
 *     throws a `ReducerError` for that mode so a missed route is loud, never silent.
 *   - `deliver` of a message with `data` (state / op / stamp) or with `recv` goes through
 *     `applyIncoming`; `send.stamp` goes through `stampForSend`.
 * ──────────────────────────────────────────────────────────────────────────────────────────────
 *
 * Decisions on what the spec leaves open (each is also covered by a test):
 *   - `version[node]` is the seq of the latest op BY `node` applied here (the op id's number).
 *     `replica.seq` advances by the number of `nextSeq()` calls (at least 1) and is dense; every
 *     type in src/crdt calls it at most once, so the two coincide today.
 *   - Seeds by the pseudo-node `seed` are recorded in `applied` and `log` (they were applied) but
 *     never in `version`, `pending`, a broadcast or an ops-sync; gc drops their ids from `applied`.
 *     Seeds are prepared once per `crdt.init` against a scratch replica (so every replica gets the
 *     identical ops and ids) and applied with `effect` at every listed actor. Init on a slot that
 *     already exists rebuilds new replicas from the stored args (seeds included) and never touches
 *     existing ones; repeating different args is an error.
 *   - `crdt.send` clears `pending` in both modes; `size` = UTF-8 length of the canonical JSON of the
 *     carried state. A state token's payload is `{ kind: 'scalar', value: ≤24-char summary, meta:
 *     { type, ts?, node?, hlc?, vc? } }` (the renderer draws the chip from `meta.type`).
 *   - `unchanged` is judged on `toValue()` without the exposed root sidecar (`vc` / `applied` change
 *     on every op even when nothing visible did). `via` events are pushed only when the slot value
 *     changed.
 *   - Readiness of an op = `deps ≤ recipient.version` (deps = the creator's version before the op,
 *     which includes the creator's previous seq). Dedupe = `id ∈ applied` or `seq ≤ version[node]`
 *     (so gc-compacted `applied` still dedupes).
 *   - `crdt.sync mode:'ops'` requires both online (a sync implies a connection), emits the ops the
 *     other side lacks by node (world order, then unknown nodes) then seq, clears `pending` on both
 *     sides and marks a side that receives nothing `unchanged`.
 *   - gc: a dead item is stable when the op that killed it (the delete / remove record in this
 *     replica's log, else the item's own dot when the kill arrived inside a state merge) is ≤ `upTo`
 *     per node. RGA tombstones are dropped by re-anchoring their children on the tombstone's own
 *     anchor, and only when that keeps the visible order (checked). Supported: rga, or-set,
 *     two-phase-set, lww-element-set, lww-map, op-counter (applied compaction only) and docs
 *     (part by part); other types throw. `applied` is compacted for every type.
 *   - `lww-element-set` defaults `bias` to `'add'`; `vector-clock` pre-fills the init actors.
 */
import {
  docCrdt,
  docPartAt,
  docSchemaAt,
  formatDocPath,
  leafUpdateFor,
  parseDocPath,
  type DocPart,
  type DocSchema,
  type DocState,
} from '../../crdt/doc'
import { canonicalJson, keyOf } from '../../crdt/g-set'
import { hlcNow, hlcReceive, type Hlc } from '../../crdt/hlc'
import { receive as lamportReceive, tick as lamportTick } from '../../crdt/lamport-clock'
import type { LwwElementSetState } from '../../crdt/lww-element-set'
import { lwwElementSetRows } from '../../crdt/lww-element-set'
import type { LwwMapState } from '../../crdt/lww-map'
import type { LwwRegisterState } from '../../crdt/lww-register'
import type { OrSetEntry, OrSetState } from '../../crdt/or-set'
import { crdtRegistry, type AnyCrdtType } from '../../crdt/registry'
import { rga, type RgaElement, type RgaState } from '../../crdt/rga'
import type { TwoPhaseSetState } from '../../crdt/two-phase-set'
import { compareStamp, dot, parseDot, type Ctx, type Dot } from '../../crdt/types'
import { vcDominates, vcMerge, vcReceive, vcTick } from '../../crdt/vector-clock'
import {
  decodeHlcStamp,
  encodeHlcStamp,
  opLabel,
  orderedVc,
  summarizeState,
  toValue as viewValue,
} from '../crdt-view'
import { setAt } from '../path'
import {
  ReducerError,
  type Actor,
  type ActorId,
  type CrdtArgs,
  type CrdtCommand,
  type CrdtName,
  type CrdtSchema,
  type Mark,
  type Message,
  type MessageData,
  type MessageId,
  type Meta,
  type NodeId,
  type OpRecord,
  type OutboxChip,
  type Path,
  type Replica,
  type SeedOp,
  type SlotId,
  type Value,
  type VectorClock,
  type ViewCtx,
  type World,
} from '../types'
import type { ReduceCtx } from './context'
import { mintId } from './ids'
import { assertPlainTarget } from './values'

// ─── Contract types ───────────────────────────────────────────────────────────────────────────

/** One message `crdt.send` / `crdt.broadcast` / `crdt.sync mode:'ops'` wants created; ids are final. */
export type OutgoingSpec = {
  from: ActorId
  to: ActorId
  id: MessageId
  payload: Value
  label?: string
  size?: number
  data: MessageData
}

export type CrdtLocalCommand = Extract<
  CrdtCommand,
  { t: 'crdt.init' | 'crdt.doc' | 'crdt.update' | 'crdt.merge' | 'crdt.sync' | 'crdt.gc' }
>
export type CrdtWireCommand = Extract<CrdtCommand, { t: 'crdt.send' | 'crdt.broadcast' }>
export type CrdtSyncCommand = Extract<CrdtCommand, { t: 'crdt.sync' }>
type InitCommand = Extract<CrdtCommand, { t: 'crdt.init' | 'crdt.doc' }>
type UpdateCommand = Extract<CrdtCommand, { t: 'crdt.update' }>
type MergeCommand = Extract<CrdtCommand, { t: 'crdt.merge' }>
type GcCommand = Extract<CrdtCommand, { t: 'crdt.gc' }>
type SendCommand = Extract<CrdtCommand, { t: 'crdt.send' }>
type BroadcastCommand = Extract<CrdtCommand, { t: 'crdt.broadcast' }>

/** The pseudo-node of seeds nobody "wrote" (DSL §2 `NodeId`). */
export const SEED_NODE: NodeId = 'seed'

/** Types whose update stamp comes from the wall clock (autoTick applies; DSL §5.1 Time). */
const WALL_STAMPED: ReadonlySet<CrdtName> = new Set<CrdtName>([
  'lww-register',
  'lww-map',
  'lww-element-set',
])

type Rec = Record<string, unknown>
const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v)

// ─── Errors ───────────────────────────────────────────────────────────────────────────────────

function fail(ctx: ReduceCtx, command: unknown, message: string, path?: Path): ReducerError {
  return new ReducerError(
    message,
    path === undefined ? { stepId: ctx.stepId, command } : { stepId: ctx.stepId, command, path },
  )
}

/** Run a src/crdt call; anything it throws becomes a ReducerError with the step and command. */
function guard<T>(ctx: ReduceCtx, command: unknown, where: string, fn: () => T): T {
  try {
    return fn()
  } catch (e) {
    if (e instanceof ReducerError) throw e
    const msg = e instanceof Error ? e.message.replace(/^doc: /, '') : String(e)
    throw fail(ctx, command, `${where}: ${msg}`)
  }
}

function fmtVc(vc: VectorClock): string {
  const parts = Object.keys(vc).map((n) => `${n} ${vc[n] ?? 0}`)
  return `{${parts.join(', ')}}`
}

// ─── Lookup ───────────────────────────────────────────────────────────────────────────────────

/** The replica of `slot` at `actor`, if the slot is CRDT-managed there. */
export function replicaOf(w: World, actor: ActorId, slot: SlotId): Replica | undefined {
  return w.replicas[actor]?.[slot]
}

/** True when `<actor>.<slot>` is a CRDT replica (value commands on it are errors). */
export function isCrdtSlot(w: World, actor: ActorId, slot: SlotId): boolean {
  return replicaOf(w, actor, slot) !== undefined
}

function requireActor(w: World, id: ActorId, ctx: ReduceCtx, cmd: unknown): Actor {
  const actor = w.actors[id]
  if (!actor) throw fail(ctx, cmd, `no actor "${id}" is on stage`, id)
  return actor
}

function requireReplica(
  w: World,
  actor: ActorId,
  slot: SlotId,
  ctx: ReduceCtx,
  cmd: unknown,
): Replica {
  requireActor(w, actor, ctx, cmd)
  const replica = replicaOf(w, actor, slot)
  if (!replica) {
    throw fail(
      ctx,
      cmd,
      `"${actor}" has no CRDT slot "${slot}" (crdt.init it first)`,
      `${actor}.${slot}`,
    )
  }
  return replica
}

function typeOf(type: CrdtName | 'doc'): AnyCrdtType {
  if (type === 'doc') return docCrdt as unknown as AnyCrdtType
  const t = crdtRegistry[type]
  if (!t) throw new ReducerError(`unknown CRDT type "${String(type)}"`)
  return t
}

/** Every replica of `slot` on stage, by actor (world order). */
function replicasOfSlot(w: World, slot: SlotId): Array<[ActorId, Replica]> {
  const out: Array<[ActorId, Replica]> = []
  for (const actor of Object.keys(w.actors)) {
    const r = replicaOf(w, actor, slot)
    if (r) out.push([actor, r])
  }
  return out
}

// ─── Views, holds, outbox ─────────────────────────────────────────────────────────────────────

function viewCtxFor(w: World, replica: Replica, expose: boolean): ViewCtx {
  const ctx: ViewCtx = {
    actors: Object.keys(w.actors),
    replica,
    expose: expose ? (replica.args.expose ?? []) : [],
  }
  if (replica.args.display !== undefined) ctx.display = replica.args.display
  return ctx
}

/** `toValue()` of a replica; `expose: false` leaves the delivery-layer root sidecar out. */
function valueOf(w: World, replica: Replica, expose = true): Value {
  return viewValue(replica.type, replica.state, viewCtxFor(w, replica, expose))
}

function sameValue(a: Value, b: Value): boolean {
  return canonicalJson(a) === canonicalJson(b)
}

/** Outbox chips are drawn only for slots declared `wire: 'ops'` — on a state-driven slot the pending
 *  list is bookkeeping, not something the lesson talks about. */
function outboxOf(w: World, actor: ActorId): OutboxChip[] {
  const chips: OutboxChip[] = []
  for (const [slot, replica] of Object.entries(w.replicas[actor] ?? {})) {
    if (replica.args.wire !== 'ops') continue
    for (const id of replica.pending) {
      chips.push({ slot, id, label: replica.log.find((r) => r.id === id)?.label ?? id })
    }
  }
  return chips
}

/** Recompute `holds[slot]` (= toValue of the replica) and the actor's outbox chips. */
export function refreshHolds(w: World, actorId: ActorId, slot: SlotId): World {
  const actor = w.actors[actorId]
  const replica = replicaOf(w, actorId, slot)
  if (!actor || !replica) return w
  const value = valueOf(w, replica)
  return {
    ...w,
    actors: {
      ...w.actors,
      [actorId]: {
        ...actor,
        holds: { ...actor.holds, [slot]: value },
        outbox: outboxOf(w, actorId),
      },
    },
  }
}

function setReplica(w: World, actorId: ActorId, slot: SlotId, replica: Replica): World {
  const next: World = {
    ...w,
    replicas: { ...w.replicas, [actorId]: { ...w.replicas[actorId], [slot]: replica } },
  }
  return refreshHolds(next, actorId, slot)
}

// ─── Marks ────────────────────────────────────────────────────────────────────────────────────

function addUnchanged(w: World, actor: ActorId, slot: SlotId): World {
  const { world, id } = mintId(w, 'k')
  const mark: Mark = { id, kind: 'unchanged', path: `${actor}.${slot}` }
  return { ...world, marks: [...world.marks, mark] }
}

function addFlow(w: World, from: ActorId, to: ActorId, slot: SlotId, both: boolean): World {
  const { world, id } = mintId(w, 'k')
  const mark: Mark = { id, kind: 'flow', from: `${from}.${slot}`, to: `${to}.${slot}` }
  if (both) mark.both = true
  return { ...world, marks: [...world.marks, mark] }
}

// ─── Time (DSL §5.1 "Time") ───────────────────────────────────────────────────────────────────

function wallTime(w: World, actor: Actor): number {
  return w.clock.now + (actor.skew ?? 0)
}

type StampSource =
  | { kind: 'hlc'; slot: SlotId }
  | { kind: 'lamport'; max: number }
  | { kind: 'wall'; autoTick: boolean }

function maxRgaTs(state: RgaState<unknown>): number {
  let max = 0
  for (const el of Object.values(state.nodes)) if (el.ts > max) max = el.ts
  return max
}

function leafSource(type: CrdtName, args: CrdtArgs, state: unknown): StampSource {
  if (args.clock) return { kind: 'hlc', slot: args.clock.slot }
  if (type === 'rga') {
    if ((args.stamp ?? 'lamport') === 'lamport') {
      return { kind: 'lamport', max: maxRgaTs(state as RgaState<unknown>) }
    }
    return { kind: 'wall', autoTick: true }
  }
  return { kind: 'wall', autoTick: WALL_STAMPED.has(type) }
}

/** Leaf args (`{ type, args }`) of a doc schema node at `path`; `{}` for anything else. */
function leafArgsAt(schema: CrdtSchema | undefined, path: string): CrdtArgs {
  if (schema === undefined) return {}
  try {
    const s = docSchemaAt(schema as DocSchema, path)
    if (typeof s === 'string') return {}
    return 'type' in s ? ((s.args as CrdtArgs | undefined) ?? {}) : {}
  } catch {
    return {}
  }
}

function docPartOf(state: unknown, path: string): DocPart | undefined {
  try {
    return docPartAt(state as DocState, path)
  } catch {
    return undefined
  }
}

function stampSource(replica: Replica, path: string | undefined): StampSource {
  if (replica.type !== 'doc') return leafSource(replica.type, replica.args, replica.state)
  const p = path ?? ''
  const part = docPartOf(replica.state, p)
  if (!part) return { kind: 'wall', autoTick: false }
  if (part.kind === 'list') return { kind: 'lamport', max: maxRgaTs(part.seq) }
  if (part.kind === 'leaf') return leafSource(part.type, leafArgsAt(replica.schema, p), part.state)
  return { kind: 'wall', autoTick: false }
}

function requireHlcSlot(
  w: World,
  actor: Actor,
  slot: SlotId,
  ctx: ReduceCtx,
  cmd: unknown,
): Replica {
  const clock = replicaOf(w, actor.id, slot)
  if (!clock || clock.type !== 'hlc') {
    throw fail(
      ctx,
      cmd,
      `"${actor.id}.${slot}" is not an hlc replica (args.clock names it)`,
      `${actor.id}.${slot}`,
    )
  }
  return clock
}

/**
 * `Ctx.ts` for an update, in order: `ts` on the command; the slot's HLC (ticked with the actor's
 * wall time, stamp = wall·65536 + counter); Lamport for an RGA (max element ts here + 1); else the
 * actor's wall time, after `autoTick` when the stamp is wall-clock-stamped.
 */
function resolveTs(
  w: World,
  actor: Actor,
  replica: Replica,
  cmdTs: number | undefined,
  path: string | undefined,
  ctx: ReduceCtx,
  cmd: unknown,
): { world: World; ts: number } {
  if (cmdTs !== undefined) return { world: w, ts: cmdTs }
  const src = stampSource(replica, path)
  switch (src.kind) {
    case 'hlc': {
      const clock = requireHlcSlot(w, actor, src.slot, ctx, cmd)
      const next = hlcNow(clock.state as Hlc, wallTime(w, actor))
      return {
        world: setReplica(w, actor.id, src.slot, { ...clock, state: next }),
        ts: encodeHlcStamp(next),
      }
    }
    case 'lamport':
      return { world: w, ts: src.max + 1 }
    case 'wall': {
      const world =
        src.autoTick && w.clock.autoTick === true
          ? { ...w, clock: { ...w.clock, now: w.clock.now + 1 } }
          : w
      return { world, ts: wallTime(world, actor) }
    }
  }
}

// ─── Ids and ctx (DSL §5.1 "Ids") ─────────────────────────────────────────────────────────────

/** A `Ctx` whose `nextSeq()` returns `seqBase + 1` first and counts further calls. */
function makeCtx(node: NodeId, seqBase: number, ts: number): { ctx: Ctx; calls: () => number } {
  let n = 0
  return {
    ctx: {
      node,
      ts,
      nextSeq() {
        n += 1
        return seqBase + n
      },
    },
    calls: () => n,
  }
}

// ─── Updates (local ops, seeds, macros) ───────────────────────────────────────────────────────

type RealUpdate = { op: string; args: readonly unknown[]; path?: string }

/** The update object a type's `prepare` takes: the doc's `{ path, op, args }` or `leafUpdateFor`. */
function updateFor(
  type: CrdtName | 'doc',
  u: RealUpdate,
  ctx: ReduceCtx,
  cmd: unknown,
  slot: SlotId,
): unknown {
  if (type === 'doc') return { path: u.path ?? '', op: u.op, args: u.args }
  if (u.path !== undefined) {
    throw fail(ctx, cmd, `"path" is only for composed documents; "${slot}" is a ${type}`)
  }
  return guard(ctx, cmd, `crdt.update ${u.op}`, () => leafUpdateFor(type, u.op, u.args))
}

/** The RGA state a `type` / `deleteRange` macro targets: a plain rga slot or a doc leaf rga. */
function rgaTarget(
  type: CrdtName | 'doc',
  state: unknown,
  path: string | undefined,
): RgaState<unknown> | undefined {
  if (type === 'rga') return state as RgaState<unknown>
  if (type === 'doc') {
    const part = docPartOf(state, path ?? '')
    if (part?.kind === 'leaf' && part.type === 'rga') return part.state as RgaState<unknown>
  }
  return undefined
}

function rangeIds(
  state: RgaState<unknown>,
  from: unknown,
  to: unknown,
  ctx: ReduceCtx,
  cmd: unknown,
): Dot[] {
  const i = state.order.indexOf(from as Dot)
  const j = state.order.indexOf(to as Dot)
  if (i < 0) throw fail(ctx, cmd, `deleteRange: no element "${String(from)}" here`)
  if (j < 0) throw fail(ctx, cmd, `deleteRange: no element "${String(to)}" here`)
  if (j < i) throw fail(ctx, cmd, `deleteRange: "${String(to)}" comes before "${String(from)}"`)
  return state.order.slice(i, j + 1).filter((id) => state.nodes[id]?.tombstone !== true)
}

/**
 * Expand the lesson-side RGA macros (`type(anchor, text)` → one `insertAfter` per character, each
 * anchored on the id the previous one minted; `deleteRange(fromId, toId)` → one `delete` per live
 * element in sequence order) and run every real update through `apply`.
 */
function runWithMacros(
  type: CrdtName | 'doc',
  u: RealUpdate,
  currentState: () => unknown,
  apply: (real: RealUpdate) => Dot,
  ctx: ReduceCtx,
  cmd: unknown,
): void {
  if (u.op !== 'type' && u.op !== 'deleteRange') {
    apply(u)
    return
  }
  const target = rgaTarget(type, currentState(), u.path)
  if (!target) throw fail(ctx, cmd, `"${u.op}" is an rga macro; the target is not an rga`)
  if (u.args.length !== 2) throw fail(ctx, cmd, `${u.op} takes 2 arguments, got ${u.args.length}`)
  if (u.op === 'type') {
    const text = u.args[1]
    if (typeof text !== 'string') throw fail(ctx, cmd, `type(anchor, text): text must be a string`)
    let anchor: unknown = u.args[0]
    for (const ch of [...text]) {
      const real: RealUpdate = { op: 'insertAfter', args: [anchor, ch] }
      if (u.path !== undefined) real.path = u.path
      anchor = apply(real)
    }
    return
  }
  for (const id of rangeIds(target, u.args[0], u.args[1], ctx, cmd)) {
    const real: RealUpdate = { op: 'delete', args: [id] }
    if (u.path !== undefined) real.path = u.path
    apply(real)
  }
}

/** One real op at `actor.slot`: prepare → effect, one op id, bookkeeping, holds refreshed. */
function applyLocalOp(
  w: World,
  actorId: ActorId,
  slot: SlotId,
  u: RealUpdate,
  cmdTs: number | undefined,
  ctx: ReduceCtx,
  cmd: unknown,
): { world: World; id: Dot } {
  const actor = requireActor(w, actorId, ctx, cmd)
  const before = requireReplica(w, actorId, slot, ctx, cmd)
  const { world: w1, ts } = resolveTs(w, actor, before, cmdTs, u.path, ctx, cmd)
  const replica = requireReplica(w1, actorId, slot, ctx, cmd)
  const T = typeOf(replica.type)
  const lu = updateFor(replica.type, u, ctx, cmd, slot)
  const { ctx: cctx, calls } = makeCtx(actorId, replica.seq, ts)
  const where = `crdt.update ${actorId}.${slot}${u.path !== undefined ? ` at "${u.path}"` : ''} ${u.op}`
  const op = guard(ctx, cmd, where, () => T.prepare(replica.state, lu, cctx))
  const state = guard(ctx, cmd, where, () => T.effect(replica.state, op))
  const id = dot(actorId, replica.seq + 1)
  const used = Math.max(1, calls())
  const rec: OpRecord = {
    id,
    op,
    deps: replica.version,
    label: opLabel(replica.type, op, replica.state),
    ts,
  }
  if (u.path !== undefined) rec.path = u.path
  const next: Replica = {
    ...replica,
    state,
    seq: replica.seq + used,
    version: { ...replica.version, [actorId]: replica.seq + 1 },
    applied: [...replica.applied, id],
    log: [...replica.log, rec],
    pending: [...replica.pending, id],
  }
  return { world: setReplica(w1, actorId, slot, next), id }
}

function reduceUpdate(w: World, cmd: UpdateCommand, ctx: ReduceCtx): World {
  const replica = requireReplica(w, cmd.actor, cmd.slot, ctx, cmd)
  const before = valueOf(w, replica, false)
  let world = w
  const u: RealUpdate = { op: cmd.op, args: cmd.args ?? [] }
  if (cmd.path !== undefined) u.path = cmd.path
  runWithMacros(
    replica.type,
    u,
    () => requireReplica(world, cmd.actor, cmd.slot, ctx, cmd).state,
    (real) => {
      const r = applyLocalOp(world, cmd.actor, cmd.slot, real, cmd.ts, ctx, cmd)
      world = r.world
      return r.id
    },
    ctx,
    cmd,
  )
  const after = valueOf(world, requireReplica(world, cmd.actor, cmd.slot, ctx, cmd), false)
  if (sameValue(before, after)) world = addUnchanged(world, cmd.actor, cmd.slot)
  return world
}

// ─── Init and seeds ───────────────────────────────────────────────────────────────────────────

/** The `args` a type's `init(node, args)` takes, from the DSL `CrdtArgs`. */
function initArgsFor(
  type: CrdtName | 'doc',
  args: CrdtArgs,
  schema: CrdtSchema | undefined,
  vcNodes: readonly NodeId[],
): unknown {
  switch (type) {
    case 'lww-element-set':
      return { bias: args.bias ?? 'add' }
    case 'vector-clock':
      return { nodes: args.nodes ?? vcNodes }
    case 'doc':
      if (schema === undefined) throw new ReducerError('crdt.doc needs a schema')
      return { schema: toDocSchema(schema, vcNodes) }
    default:
      return undefined
  }
}

function leafDocSchema(type: CrdtName, args: CrdtArgs, vcNodes: readonly NodeId[]): DocSchema {
  const a = initArgsFor(type, args, undefined, vcNodes)
  return a === undefined ? type : { type, args: a as Record<string, unknown> }
}

/** The DSL schema (with view args) → the `src/crdt/doc` schema (with init args only). */
function toDocSchema(schema: CrdtSchema, vcNodes: readonly NodeId[]): DocSchema {
  if (typeof schema === 'string') return leafDocSchema(schema, {}, vcNodes)
  if ('type' in schema) return leafDocSchema(schema.type, schema.args ?? {}, vcNodes)
  if ('const' in schema) return { const: schema.const }
  if ('map' in schema) {
    const map: Record<string, DocSchema> = {}
    for (const [key, sub] of Object.entries(schema.map)) map[key] = toDocSchema(sub, vcNodes)
    return { map }
  }
  if ('list' in schema) return { list: toDocSchema(schema.list, vcNodes) }
  return { set: toDocSchema(schema.set, vcNodes) }
}

function vcNodesOf(replica: Replica): readonly NodeId[] {
  return replica.type === 'vector-clock' ? Object.keys(replica.state as VectorClock) : []
}

type SeedPlan = { records: OpRecord[]; seqs: Record<NodeId, number>; version: VectorClock }

/**
 * Prepare the seed ops once, against a scratch replica, so every replica applies identical ops:
 * `by` defaults to `seed` (ids `seed:1…`, invisible to version vectors), `ts` to 0; a seed by an
 * actor consumes that actor's seq (`alice:1…`). Macros expand like in `crdt.update`.
 */
function planSeeds(
  type: CrdtName | 'doc',
  T: AnyCrdtType,
  initArgs: unknown,
  seeds: readonly SeedOp[],
  scratchNode: NodeId,
  ctx: ReduceCtx,
  cmd: unknown,
): SeedPlan {
  let scratch = guard(ctx, cmd, 'crdt.init', () => T.init(scratchNode, initArgs))
  const seqs: Record<NodeId, number> = {}
  let version: VectorClock = {}
  const records: OpRecord[] = []
  for (const seed of seeds) {
    const node = seed.by ?? SEED_NODE
    const ts = seed.ts ?? 0
    const u: RealUpdate = { op: seed.op, args: seed.args ?? [] }
    if (seed.path !== undefined) u.path = seed.path
    runWithMacros(
      type,
      u,
      () => scratch,
      (real) => {
        const lu = updateFor(type, real, ctx, cmd, '(seed)')
        const base = seqs[node] ?? 0
        const { ctx: cctx, calls } = makeCtx(node, base, ts)
        const where = `seed ${real.op}${real.path !== undefined ? ` at "${real.path}"` : ''}`
        const op = guard(ctx, cmd, where, () => T.prepare(scratch, lu, cctx))
        const stateBefore = scratch
        scratch = guard(ctx, cmd, where, () => T.effect(scratch, op))
        const id = dot(node, base + 1)
        seqs[node] = base + Math.max(1, calls())
        const rec: OpRecord = { id, op, deps: version, label: opLabel(type, op, stateBefore), ts }
        if (real.path !== undefined) rec.path = real.path
        records.push(rec)
        if (node !== SEED_NODE) version = { ...version, [node]: base + 1 }
        return id
      },
      ctx,
      cmd,
    )
  }
  return { records, seqs, version }
}

function reduceInit(w: World, cmd: InitCommand, ctx: ReduceCtx): World {
  const slot = cmd.slot
  const type: CrdtName | 'doc' = cmd.t === 'crdt.doc' ? 'doc' : cmd.type
  if (cmd.actors.length === 0) throw fail(ctx, cmd, `${cmd.t} needs at least one actor`)
  for (const a of cmd.actors) requireActor(w, a, ctx, cmd)
  if (type !== 'doc' && !crdtRegistry[type])
    throw fail(ctx, cmd, `unknown CRDT type "${String(type)}"`)
  const template = replicasOfSlot(w, slot)[0]?.[1]
  if (template && template.type !== type) {
    throw fail(ctx, cmd, `slot "${slot}" is already a ${template.type}; cannot init it as ${type}`)
  }
  const newActors = cmd.actors.filter((a) => !replicaOf(w, a, slot))
  if (newActors.length === 0) {
    throw fail(ctx, cmd, `every listed actor already holds CRDT slot "${slot}"`)
  }
  let args: CrdtArgs
  let schema: CrdtSchema | undefined
  let vcNodes: readonly NodeId[]
  if (template) {
    args = template.args
    schema = template.schema
    vcNodes = [...new Set([...vcNodesOf(template), ...cmd.actors])]
    if (cmd.args !== undefined && canonicalJson(cmd.args) !== canonicalJson(args)) {
      throw fail(
        ctx,
        cmd,
        `${cmd.t} on the existing slot "${slot}" must repeat its args (or omit them)`,
      )
    }
    if (cmd.t === 'crdt.doc' && canonicalJson({ map: cmd.fields }) !== canonicalJson(schema)) {
      throw fail(ctx, cmd, `crdt.doc on the existing slot "${slot}" must repeat its fields`)
    }
  } else {
    args = cmd.args ?? {}
    schema = cmd.t === 'crdt.doc' ? { map: cmd.fields } : undefined
    vcNodes = cmd.actors
  }
  const T = typeOf(type)
  const initArgs = guard(ctx, cmd, cmd.t, () => initArgsFor(type, args, schema, vcNodes))
  const scratchNode = newActors[0] ?? SEED_NODE
  const plan = planSeeds(type, T, initArgs, args.seed ?? [], scratchNode, ctx, cmd)
  let world = w
  for (const actor of newActors) {
    let state = guard(ctx, cmd, `${cmd.t} ${actor}.${slot}`, () => T.init(actor, initArgs))
    for (const rec of plan.records) {
      state = guard(ctx, cmd, `seed ${rec.label} at ${actor}.${slot}`, () =>
        T.effect(state, rec.op),
      )
    }
    const replica: Replica = {
      type,
      args,
      state,
      seq: plan.seqs[actor] ?? 0,
      version: plan.version,
      applied: plan.records.map((r) => r.id),
      log: plan.records,
      pending: [],
    }
    if (schema !== undefined) replica.schema = schema
    world = setReplica(world, actor, slot, replica)
  }
  return world
}

// ─── Merges (state) ───────────────────────────────────────────────────────────────────────────

/** The greatest `(ts, node)` stamp a state carries (LWW register / map), for the HLC receive rule. */
function greatestStamp(
  type: CrdtName | 'doc',
  state: unknown,
): { ts: number; node: NodeId } | undefined {
  if (type === 'lww-register') {
    const s = state as LwwRegisterState<unknown>
    return s.ts >= 0 ? { ts: s.ts, node: s.node } : undefined
  }
  if (type === 'lww-map') {
    let best: { ts: number; node: NodeId } | undefined
    for (const e of Object.values((state as LwwMapState<unknown>).entries)) {
      if (e.ts >= 0 && (!best || compareStamp(e, best) > 0)) best = { ts: e.ts, node: e.node }
    }
    return best
  }
  return undefined
}

/** Merging a slot whose `args.clock` names an HLC runs that HLC's receive rule with the greatest stamp carried. */
function hlcReceiveFor(
  w: World,
  actor: Actor,
  replica: Replica,
  incoming: unknown,
  ctx: ReduceCtx,
  cmd: unknown,
): World {
  const clockSlot = replica.args.clock?.slot
  if (clockSlot === undefined) return w
  const stamp = greatestStamp(replica.type, incoming)
  if (!stamp) return w
  const clock = requireHlcSlot(w, actor, clockSlot, ctx, cmd)
  const remote: Hlc = { ...decodeHlcStamp(stamp.ts), node: stamp.node }
  const next = hlcReceive(clock.state as Hlc, remote, wallTime(w, actor))
  return setReplica(w, actor.id, clockSlot, { ...clock, state: next })
}

/** Real `merge()` of a carried `{ state, version }` into `into.slot`; version = join. */
function mergeInto(
  w: World,
  intoId: ActorId,
  slot: SlotId,
  incoming: { state: unknown; version: VectorClock },
  ctx: ReduceCtx,
  cmd: unknown,
  where: string,
): { world: World; changed: boolean } {
  const actor = requireActor(w, intoId, ctx, cmd)
  const replica = requireReplica(w, intoId, slot, ctx, cmd)
  const T = typeOf(replica.type)
  const before = valueOf(w, replica, false)
  const state = guard(ctx, cmd, where, () => T.merge(replica.state, incoming.state))
  const version = vcMerge(replica.version, incoming.version)
  let world = setReplica(w, intoId, slot, { ...replica, state, version })
  world = hlcReceiveFor(world, actor, replica, incoming.state, ctx, cmd)
  const after = valueOf(world, requireReplica(world, intoId, slot, ctx, cmd), false)
  return { world, changed: !sameValue(before, after) }
}

function requireOnlinePair(
  w: World,
  a: ActorId,
  b: ActorId,
  slot: SlotId,
  ctx: ReduceCtx,
  cmd: unknown,
): void {
  if (a === b) throw fail(ctx, cmd, `"${a}" cannot merge with itself`)
  const ra = requireReplica(w, a, slot, ctx, cmd)
  const rb = requireReplica(w, b, slot, ctx, cmd)
  if (ra.type !== rb.type) {
    throw fail(ctx, cmd, `"${a}.${slot}" is a ${ra.type} but "${b}.${slot}" is a ${rb.type}`)
  }
  for (const id of [a, b]) {
    const actor = requireActor(w, id, ctx, cmd)
    if (!actor.online) {
      throw fail(
        ctx,
        cmd,
        `"${id}" is offline: an instant merge implies a connection (use crdt.send, which parks)`,
        id,
      )
    }
  }
}

function reduceMerge(w: World, cmd: MergeCommand, ctx: ReduceCtx): World {
  requireOnlinePair(w, cmd.into, cmd.from, cmd.slot, ctx, cmd)
  const from = requireReplica(w, cmd.from, cmd.slot, ctx, cmd)
  const { world, changed } = mergeInto(
    w,
    cmd.into,
    cmd.slot,
    from,
    ctx,
    cmd,
    `crdt.merge ${cmd.into} ← ${cmd.from}`,
  )
  let out = addFlow(world, cmd.from, cmd.into, cmd.slot, false)
  ctx.log.push({ kind: 'sync', slot: cmd.slot, from: cmd.from, to: cmd.into, both: false })
  if (!changed) out = addUnchanged(out, cmd.into, cmd.slot)
  return out
}

function reduceSyncState(w: World, cmd: CrdtSyncCommand, ctx: ReduceCtx): World {
  requireOnlinePair(w, cmd.a, cmd.b, cmd.slot, ctx, cmd)
  const ra = requireReplica(w, cmd.a, cmd.slot, ctx, cmd)
  const rb = requireReplica(w, cmd.b, cmd.slot, ctx, cmd)
  const where = `crdt.sync ${cmd.a} ↔ ${cmd.b}`
  const ma = mergeInto(w, cmd.a, cmd.slot, rb, ctx, cmd, where)
  const mb = mergeInto(ma.world, cmd.b, cmd.slot, ra, ctx, cmd, where)
  let out = addFlow(mb.world, cmd.a, cmd.b, cmd.slot, true)
  ctx.log.push({ kind: 'sync', slot: cmd.slot, from: cmd.a, to: cmd.b, both: true })
  if (!ma.changed) out = addUnchanged(out, cmd.a, cmd.slot)
  if (!mb.changed) out = addUnchanged(out, cmd.b, cmd.slot)
  return out
}

// ─── gc ───────────────────────────────────────────────────────────────────────────────────────

/** The leaf-level op of a log record at doc `path` (or the raw op of a plain slot). */
function opAt(rec: OpRecord, isDoc: boolean, path: string): unknown {
  if (!isDoc) return rec.op
  const o = rec.op
  if (!isRec(o) || o.path !== path) return undefined
  return o.op
}

type GcPred = {
  rgaElement(path: string, el: RgaElement<unknown>): boolean
  orSetTag(path: string, tag: Dot): boolean
  removedKey(path: string, key: string): boolean
}

function gcPredicate(replica: Replica, upTo: VectorClock, unsafe: boolean): GcPred {
  const isDoc = replica.type === 'doc'
  // An item is stable when its kill record (or, failing that, its own dot) is covered by `upTo`.
  const stable = (d: Dot | undefined): boolean => {
    if (d === undefined) return unsafe
    const { node, seq } = parseDot(d)
    // Seed dots are outside every version vector, so a proof can never cover them: only an
    // unsafe gc may collect a seeded item (the "collect too early" lesson).
    if (node === SEED_NODE) return unsafe
    return seq <= (upTo[node] ?? 0)
  }
  const killer = (path: string, pred: (op: Rec) => boolean): Dot | undefined => {
    for (const rec of replica.log) {
      const op = opAt(rec, isDoc, path)
      if (isRec(op) && pred(op)) return rec.id
    }
    return undefined
  }
  return {
    rgaElement: (path, el) => stable(killer(path, (op) => op.delete === el.id) ?? el.id),
    orSetTag: (path, tag) =>
      stable(killer(path, (op) => Array.isArray(op.tags) && op.tags.includes(tag)) ?? tag),
    removedKey: (path, key) =>
      stable(
        killer(path, (op) =>
          'remove' in op ? (op.remove === true ? op.key === key : keyOf(op.remove) === key) : false,
        ),
      ),
  }
}

/** Drop stable RGA tombstones by re-anchoring their children on the tombstone's own anchor — only when the visible order is preserved. */
function gcRga<E>(state: RgaState<E>, droppable: (el: RgaElement<E>) => boolean): RgaState<E> {
  let current = state
  for (const id of state.order) {
    const el = current.nodes[id]
    if (!el || !el.tombstone || !droppable(el)) continue
    const nodes: Record<Dot, RgaElement<E>> = {}
    for (const [k, e] of Object.entries(current.nodes)) {
      if (k === id) continue
      nodes[k as Dot] = e.after === id ? { ...e, after: el.after } : e
    }
    const candidate = rga.merge(rga.init<E>('gc'), { nodes, order: [] })
    const expected = current.order.filter((x) => x !== id)
    const same =
      candidate.order.length === expected.length &&
      candidate.order.every((x, i) => x === expected[i])
    if (same) current = candidate
  }
  return current
}

function gcOrSet<E>(state: OrSetState<E>, droppable: (tag: Dot) => boolean): OrSetState<E> {
  const dead = new Set((Object.keys(state.tombstones) as Dot[]).filter(droppable))
  if (dead.size === 0) return state
  const entries: Record<string, OrSetEntry<E>> = {}
  for (const [key, e] of Object.entries(state.entries)) {
    const tags: Record<Dot, true> = {}
    for (const t of Object.keys(e.tags) as Dot[]) if (!dead.has(t)) tags[t] = true
    if (Object.keys(tags).length > 0) entries[key] = { e: e.e, tags }
  }
  const tombstones: Record<Dot, true> = {}
  for (const t of Object.keys(state.tombstones) as Dot[]) if (!dead.has(t)) tombstones[t] = true
  return { entries, tombstones }
}

function omit<T>(rec: Record<string, T>, keys: ReadonlySet<string>): Record<string, T> {
  const out: Record<string, T> = {}
  for (const [k, v] of Object.entries(rec)) if (!keys.has(k)) out[k] = v
  return out
}

const GC_TYPES: ReadonlySet<CrdtName> = new Set<CrdtName>([
  'rga',
  'or-set',
  'two-phase-set',
  'lww-element-set',
  'lww-map',
  'op-counter',
])

function gcLeaf(type: CrdtName, state: unknown, path: string, pred: GcPred): unknown {
  switch (type) {
    case 'rga':
      return gcRga(state as RgaState<unknown>, (el) => pred.rgaElement(path, el))
    case 'or-set':
      return gcOrSet(state as OrSetState<unknown>, (tag) => pred.orSetTag(path, tag))
    case 'two-phase-set': {
      const s = state as TwoPhaseSetState<unknown>
      const drop = new Set(Object.keys(s.removed).filter((k) => pred.removedKey(path, k)))
      if (drop.size === 0) return s
      return { added: omit(s.added, drop), removed: omit(s.removed, drop) }
    }
    case 'lww-element-set': {
      const s = state as LwwElementSetState<unknown>
      const present = new Set(
        lwwElementSetRows(s)
          .filter((r) => r.present)
          .map((r) => r.key),
      )
      const drop = new Set(
        Object.keys(s.removes).filter((k) => !present.has(k) && pred.removedKey(path, k)),
      )
      if (drop.size === 0) return s
      return { adds: omit(s.adds, drop), removes: omit(s.removes, drop), bias: s.bias }
    }
    case 'lww-map': {
      const s = state as LwwMapState<unknown>
      const drop = new Set(
        Object.keys(s.entries).filter(
          (k) => s.entries[k]?.value === null && pred.removedKey(path, k),
        ),
      )
      if (drop.size === 0) return s
      return { entries: omit(s.entries, drop) }
    }
    default:
      return state
  }
}

function gcPart(part: DocPart, path: string, pred: GcPred): DocPart {
  const sub = (seg: { key: string } | { id: Dot }): string =>
    formatDocPath([...parseDocPath(path), seg])
  switch (part.kind) {
    case 'const':
      return part
    case 'leaf': {
      const state = gcLeaf(part.type, part.state, path, pred)
      return state === part.state ? part : { ...part, state }
    }
    case 'map': {
      let changed = false
      const fields: Record<string, DocPart> = {}
      for (const [key, p] of Object.entries(part.fields)) {
        const q = gcPart(p, sub({ key }), pred)
        if (q !== p) changed = true
        fields[key] = q
      }
      return changed ? { kind: 'map', fields } : part
    }
    case 'set': {
      const membership = gcOrSet(part.membership, (tag) => pred.orSetTag(path, tag))
      const keep = new Set(Object.keys(membership.entries))
      let changed = membership !== part.membership
      const subs: Record<Dot, DocPart> = {}
      for (const [id, p] of Object.entries(part.subs) as Array<[Dot, DocPart]>) {
        if (!keep.has(id)) {
          changed = true
          continue
        }
        const q = gcPart(p, sub({ id }), pred)
        if (q !== p) changed = true
        subs[id] = q
      }
      return changed ? { kind: 'set', membership, subs } : part
    }
    case 'list': {
      const seq = gcRga(part.seq, (el) => pred.rgaElement(path, el))
      let changed = seq !== part.seq
      const subs: Record<Dot, DocPart> = {}
      for (const [id, p] of Object.entries(part.subs) as Array<[Dot, DocPart]>) {
        if (!seq.nodes[id]) {
          changed = true
          continue
        }
        const q = gcPart(p, sub({ id }), pred)
        if (q !== p) changed = true
        subs[id] = q
      }
      return changed ? { kind: 'list', seq, subs } : part
    }
  }
}

function compactApplied(applied: readonly Dot[], upTo: VectorClock): Dot[] {
  return applied.filter((id) => {
    const { node, seq } = parseDot(id)
    if (node === SEED_NODE) return false
    return seq > (upTo[node] ?? 0)
  })
}

function reduceGc(w: World, cmd: GcCommand, ctx: ReduceCtx): World {
  const replica = requireReplica(w, cmd.actor, cmd.slot, ctx, cmd)
  const unsafe = cmd.unsafe === true
  if (!unsafe) {
    if (!cmd.upTo) {
      throw fail(
        ctx,
        cmd,
        `crdt.gc needs "upTo" to prove stability (or unsafe: true, and say "(simplified)")`,
      )
    }
    for (const [actor, r] of replicasOfSlot(w, cmd.slot)) {
      if (!vcDominates(r.version, cmd.upTo)) {
        throw fail(
          ctx,
          cmd,
          `crdt.gc: upTo ${fmtVc(cmd.upTo)} is not stable — "${actor}.${cmd.slot}" has only seen ${fmtVc(r.version)}`,
          `${actor}.${cmd.slot}`,
        )
      }
    }
  }
  if (replica.type !== 'doc' && !GC_TYPES.has(replica.type)) {
    throw fail(
      ctx,
      cmd,
      `crdt.gc: a ${replica.type} has nothing to collect (no gc)`,
      `${cmd.actor}.${cmd.slot}`,
    )
  }
  const upTo = cmd.upTo ?? replica.version
  const pred = gcPredicate(replica, upTo, unsafe)
  const before = valueOf(w, replica, false)
  let state: unknown
  if (replica.type === 'doc') {
    const s = replica.state as DocState
    const root = gcPart(s.root, '', pred)
    state = root === s.root ? s : { schema: s.schema, root }
  } else {
    state = gcLeaf(replica.type, replica.state, '', pred)
  }
  const next: Replica = { ...replica, state, applied: compactApplied(replica.applied, upTo) }
  let world = setReplica(w, cmd.actor, cmd.slot, next)
  if (sameValue(before, valueOf(world, next, false)))
    world = addUnchanged(world, cmd.actor, cmd.slot)
  return world
}

// ─── reduceCrdt ───────────────────────────────────────────────────────────────────────────────

/** The local CRDT commands (everything that creates no message). */
export function reduceCrdt(w: World, cmd: CrdtLocalCommand, ctx: ReduceCtx): World {
  switch (cmd.t) {
    case 'crdt.init':
    case 'crdt.doc':
      return reduceInit(w, cmd, ctx)
    case 'crdt.update':
      return reduceUpdate(w, cmd, ctx)
    case 'crdt.merge':
      return reduceMerge(w, cmd, ctx)
    case 'crdt.sync':
      if (cmd.mode === 'ops') {
        throw fail(
          ctx,
          cmd,
          `crdt.sync mode 'ops' creates messages: route it through prepareSyncOps (see the header of reducer/crdt.ts)`,
        )
      }
      return reduceSyncState(w, cmd, ctx)
    case 'crdt.gc':
      return reduceGc(w, cmd, ctx)
  }
}

// ─── Wire: crdt.send / crdt.broadcast / crdt.sync mode 'ops' ──────────────────────────────────

function utf8Length(s: string): number {
  return new TextEncoder().encode(s).length
}

function opRecordOf(replica: Replica, id: Dot, ctx: ReduceCtx, cmd: unknown): OpRecord {
  const rec = replica.log.find((r) => r.id === id)
  if (!rec) throw fail(ctx, cmd, `op ${id} is pending but has no log record (bug)`)
  return rec
}

/** The tags an OR-Set remove (plain or inside a doc set) kills. */
function killedTags(op: unknown): Dot[] {
  if (!isRec(op)) return []
  const inner = op.kind === 'set' && isRec(op.op) ? op.op : op
  return 'remove' in inner && Array.isArray(inner.tags) ? (inner.tags as Dot[]) : []
}

/** The op token payload (DSL §5.1 crdt.broadcast): `{ scalar: opLabel, meta: { tag, ts, node, tags? } }`. */
function opPayload(rec: OpRecord): Value {
  const meta: Meta = { tag: rec.id, ts: rec.ts, node: parseDot(rec.id).node }
  const tags = killedTags(rec.op)
  if (tags.length > 0) meta.tags = tags.map((tag) => ({ tag, alive: false }))
  return { kind: 'scalar', value: rec.label, meta }
}

function checkFreshIds(
  w: World,
  specs: readonly OutgoingSpec[],
  generated: boolean,
  ctx: ReduceCtx,
  cmd: unknown,
): void {
  const seen = new Set<MessageId>()
  for (const m of specs) {
    if (w.messages.some((x) => x.id === m.id) || seen.has(m.id)) {
      throw fail(
        ctx,
        cmd,
        generated
          ? `generated message id "${m.id}" collides with a live message; give "id" explicitly`
          : `message id "${m.id}" is already in flight or parked`,
        `msg:${m.id}`,
      )
    }
    seen.add(m.id)
  }
}

function prepareSend(
  w: World,
  cmd: SendCommand,
  ctx: ReduceCtx,
): { world: World; messages: OutgoingSpec[] } {
  const replica = requireReplica(w, cmd.from, cmd.slot, ctx, cmd)
  const fanOut = Array.isArray(cmd.to)
  const recipients = Array.isArray(cmd.to) ? cmd.to : [cmd.to]
  if (recipients.length === 0) throw fail(ctx, cmd, `crdt.send needs at least one recipient`)
  for (const to of recipients) {
    requireActor(w, to, ctx, cmd)
    if (to === cmd.from) throw fail(ctx, cmd, `"${to}" cannot send state to itself`)
  }
  const T = typeOf(replica.type)
  let state = replica.state
  if (cmd.mode === 'delta') {
    state = guard(ctx, cmd, `crdt.send delta ${cmd.from}.${cmd.slot}`, () => {
      const initArgs = initArgsFor(replica.type, replica.args, replica.schema, vcNodesOf(replica))
      let s = T.init(cmd.from, initArgs)
      for (const id of replica.pending) s = T.effect(s, opRecordOf(replica, id, ctx, cmd).op)
      return s
    })
  }
  const summary = summarizeState(replica.type, state, replica.args)
  const payload: Value = { kind: 'scalar', value: summary.value }
  if (Object.keys(summary.meta).length > 0) payload.meta = summary.meta
  let world = w
  let base = cmd.id
  if (base === undefined) {
    const minted = mintId(world, 'm')
    world = minted.world
    base = minted.id
  }
  const data: MessageData = { kind: 'state', slot: cmd.slot, state, version: replica.version }
  const size = cmd.mode !== undefined ? utf8Length(canonicalJson(state)) : undefined
  const messages = recipients.map((to): OutgoingSpec => {
    const spec: OutgoingSpec = {
      from: cmd.from,
      to,
      id: fanOut ? `${base}@${to}` : base,
      payload,
      data,
    }
    if (cmd.label !== undefined) spec.label = cmd.label
    if (size !== undefined) spec.size = size
    return spec
  })
  checkFreshIds(world, messages, cmd.id === undefined, ctx, cmd)
  world = setReplica(world, cmd.from, cmd.slot, { ...replica, pending: [] })
  return { world, messages }
}

function prepareBroadcast(
  w: World,
  cmd: BroadcastCommand,
  ctx: ReduceCtx,
): { world: World; messages: OutgoingSpec[] } {
  const replica = requireReplica(w, cmd.from, cmd.slot, ctx, cmd)
  if (replica.pending.length === 0) {
    throw fail(
      ctx,
      cmd,
      `crdt.broadcast: the outbox of "${cmd.from}.${cmd.slot}" is empty`,
      `${cmd.from}@outbox`,
    )
  }
  let recipients: ActorId[]
  if (cmd.to !== undefined) {
    for (const to of cmd.to) {
      requireActor(w, to, ctx, cmd)
      if (to === cmd.from) throw fail(ctx, cmd, `"${to}" cannot broadcast to itself`)
    }
    recipients = [...cmd.to]
  } else {
    recipients = replicasOfSlot(w, cmd.slot)
      .map(([actor]) => actor)
      .filter((actor) => actor !== cmd.from)
  }
  if (recipients.length === 0) {
    throw fail(ctx, cmd, `crdt.broadcast: no other actor holds "${cmd.slot}"`)
  }
  if (cmd.id !== undefined && replica.pending.length !== 1) {
    throw fail(
      ctx,
      cmd,
      `crdt.broadcast id "${cmd.id}" needs exactly one pending op; "${cmd.from}.${cmd.slot}" has ${replica.pending.length}`,
    )
  }
  const messages: OutgoingSpec[] = []
  for (const opId of replica.pending) {
    const rec = opRecordOf(replica, opId, ctx, cmd)
    const base = cmd.id ?? opId
    const payload = opPayload(rec)
    for (const to of recipients) {
      messages.push({
        from: cmd.from,
        to,
        id: `${base}@${to}`,
        payload,
        data: { kind: 'op', slot: cmd.slot, op: rec },
      })
    }
  }
  checkFreshIds(w, messages, false, ctx, cmd)
  return { world: setReplica(w, cmd.from, cmd.slot, { ...replica, pending: [] }), messages }
}

/** `crdt.send` / `crdt.broadcast`: the updated world and the messages to create (final ids). */
export function prepareOutgoing(
  w: World,
  cmd: CrdtWireCommand,
  ctx: ReduceCtx,
): { world: World; messages: OutgoingSpec[] } {
  return cmd.t === 'crdt.send' ? prepareSend(w, cmd, ctx) : prepareBroadcast(w, cmd, ctx)
}

/**
 * `crdt.sync` with `mode: 'ops'` — the Yjs-style state-vector exchange: every op in `a.log` that
 * `b.version` lacks becomes an `${opId}@b` message and vice versa (by node in world order, then
 * seq). Both must be online; pending is cleared on both sides; a side that receives nothing gets an
 * `unchanged` mark. Route this exactly like `prepareOutgoing`.
 */
export function prepareSyncOps(
  w: World,
  cmd: CrdtSyncCommand,
  ctx: ReduceCtx,
): { world: World; messages: OutgoingSpec[] } {
  if (cmd.mode !== 'ops') {
    throw fail(
      ctx,
      cmd,
      `prepareSyncOps handles crdt.sync mode 'ops' only; use reduceCrdt for state mode`,
    )
  }
  requireOnlinePair(w, cmd.a, cmd.b, cmd.slot, ctx, cmd)
  const ra = requireReplica(w, cmd.a, cmd.slot, ctx, cmd)
  const rb = requireReplica(w, cmd.b, cmd.slot, ctx, cmd)
  const actors = Object.keys(w.actors)
  const rank = (node: NodeId): number => {
    const i = actors.indexOf(node)
    return i < 0 ? actors.length : i
  }
  const missing = (from: Replica, to: Replica): OpRecord[] =>
    from.log
      .filter((r) => {
        const { node, seq } = parseDot(r.id)
        return node !== SEED_NODE && seq > (to.version[node] ?? 0)
      })
      .sort((x, y) => {
        const dx = parseDot(x.id)
        const dy = parseDot(y.id)
        if (dx.node !== dy.node) {
          const byRank = rank(dx.node) - rank(dy.node)
          return byRank !== 0 ? byRank : dx.node < dy.node ? -1 : 1
        }
        return dx.seq - dy.seq
      })
  const messages: OutgoingSpec[] = []
  const emit = (from: ActorId, to: ActorId, recs: readonly OpRecord[]): void => {
    for (const rec of recs) {
      messages.push({
        from,
        to,
        id: `${rec.id}@${to}`,
        payload: opPayload(rec),
        data: { kind: 'op', slot: cmd.slot, op: rec },
      })
    }
  }
  const toB = missing(ra, rb)
  const toA = missing(rb, ra)
  emit(cmd.a, cmd.b, toB)
  emit(cmd.b, cmd.a, toA)
  checkFreshIds(w, messages, false, ctx, cmd)
  let world = setReplica(w, cmd.a, cmd.slot, { ...ra, pending: [] })
  world = setReplica(world, cmd.b, cmd.slot, { ...rb, pending: [] })
  if (toA.length === 0) world = addUnchanged(world, cmd.a, cmd.slot)
  if (toB.length === 0) world = addUnchanged(world, cmd.b, cmd.slot)
  return { world, messages }
}

// ─── Incoming: deliver of state / op / stamp messages ─────────────────────────────────────────

function applyState(
  w: World,
  msg: Message,
  data: Extract<MessageData, { kind: 'state' }>,
  opts: { into?: Path },
  ctx: ReduceCtx,
): World {
  if (opts.into !== undefined) {
    throw fail(ctx, msg, `"into" is not allowed for a state message ("${msg.id}")`, opts.into)
  }
  const { world, changed } = mergeInto(w, msg.to, data.slot, data, ctx, msg, `deliver ${msg.id}`)
  if (changed) {
    ctx.log.push({ kind: 'via', path: `${msg.to}.${data.slot}`, message: msg.id })
    return world
  }
  return addUnchanged(world, msg.to, data.slot)
}

function applyOp(
  w: World,
  msg: Message,
  data: Extract<MessageData, { kind: 'op' }>,
  opts: { into?: Path; park?: boolean },
  ctx: ReduceCtx,
): World {
  if (opts.into !== undefined) {
    throw fail(ctx, msg, `"into" is not allowed for an op message ("${msg.id}")`, opts.into)
  }
  const to = msg.to
  const replica = requireReplica(w, to, data.slot, ctx, msg)
  const rec = data.op
  const { node, seq } = parseDot(rec.id)
  if (replica.applied.includes(rec.id) || seq <= (replica.version[node] ?? 0)) {
    return addUnchanged(w, to, data.slot) // duplicate delivery: no effect, visibly
  }
  if (!vcDominates(replica.version, rec.deps)) {
    if (opts.park === true) return w
    throw fail(
      ctx,
      msg,
      `op ${rec.id} is not ready at "${to}": it depends on ${fmtVc(rec.deps)} but "${to}.${data.slot}" has seen ${fmtVc(replica.version)} (deliver the earlier ops first, or park it)`,
      `msg:${msg.id}`,
    )
  }
  const T = typeOf(replica.type)
  const before = valueOf(w, replica, false)
  const state = guard(ctx, msg, `deliver ${msg.id} (${rec.label})`, () =>
    T.effect(replica.state, rec.op),
  )
  const next: Replica = {
    ...replica,
    state,
    version: { ...replica.version, [node]: Math.max(replica.version[node] ?? 0, seq) },
    applied: [...replica.applied, rec.id],
    log: [...replica.log, rec],
  }
  const world = setReplica(w, to, data.slot, next)
  if (sameValue(before, valueOf(world, next, false))) return addUnchanged(world, to, data.slot)
  ctx.log.push({ kind: 'via', path: `${to}.${data.slot}`, message: msg.id })
  return world
}

type CarriedStamp = { ts?: number; vc?: VectorClock; hlc?: { wall: number; counter: number } }

/** Normalize what a stamp message / payload carries: the `Meta` from `stampForSend` or a raw reading. */
function carriedStamp(raw: unknown, meta: Meta | undefined): CarriedStamp {
  if (typeof raw === 'number') return { ts: raw }
  if (isRec(raw)) {
    if (typeof raw.wall === 'number' && typeof raw.counter === 'number') {
      return { hlc: { wall: raw.wall, counter: raw.counter } }
    }
    if ('ts' in raw || 'vc' in raw || 'hlc' in raw) return raw as CarriedStamp
    if (Object.values(raw).every((v) => typeof v === 'number')) return { vc: raw as VectorClock }
  }
  const out: CarriedStamp = {}
  if (meta?.ts !== undefined) out.ts = meta.ts
  if (meta?.vc !== undefined) out.vc = meta.vc
  if (meta?.hlc !== undefined) out.hlc = meta.hlc
  return out
}

/** The receive rule of a clock slot (lamport: max + 1; vector: vcReceive; hlc: hlcReceive with the actor's wall time). */
function applyStamp(w: World, msg: Message, slot: SlotId, raw: unknown, ctx: ReduceCtx): World {
  const actor = requireActor(w, msg.to, ctx, msg)
  const replica = requireReplica(w, msg.to, slot, ctx, msg)
  const stamp = carriedStamp(raw, msg.payload.meta)
  const missing = (what: string): ReducerError =>
    fail(
      ctx,
      msg,
      `message "${msg.id}" carries no ${what} for the ${replica.type} slot "${slot}"`,
      `msg:${msg.id}`,
    )
  let next: unknown
  switch (replica.type) {
    case 'lamport-clock': {
      if (stamp.ts === undefined) throw missing('ts stamp')
      next = lamportReceive(replica.state as number, stamp.ts)
      break
    }
    case 'vector-clock': {
      if (stamp.vc === undefined) throw missing('vector clock')
      next = vcReceive(replica.state as VectorClock, stamp.vc, msg.to)
      break
    }
    case 'hlc': {
      if (stamp.hlc === undefined) throw missing('hlc stamp')
      next = hlcReceive(replica.state as Hlc, { ...stamp.hlc, node: msg.from }, wallTime(w, actor))
      break
    }
    default:
      throw fail(
        ctx,
        msg,
        `"${msg.to}.${slot}" is a ${replica.type}; a receive rule needs a lamport-clock, vector-clock or hlc`,
        `${msg.to}.${slot}`,
      )
  }
  const world = setReplica(w, msg.to, slot, { ...replica, state: next })
  if (canonicalJson(next) !== canonicalJson(replica.state)) {
    ctx.log.push({ kind: 'via', path: `${msg.to}.${slot}`, message: msg.id })
  }
  return world
}

/**
 * Apply a delivered message at its recipient (the core has already taken it out of `messages`):
 * `state` ⇒ real merge (version = join; `unchanged` when nothing visible changed); `op` ⇒ dedupe,
 * causal readiness (throw, or return `w` untouched with `park` so the core parks it), `effect()`;
 * `stamp` / `recv` ⇒ the clock slot's receive rule, then the plain payload lands at `into` (or
 * the card flashes). `via` events are pushed for every slot value that changed.
 */
export function applyIncoming(
  w: World,
  msg: Message,
  opts: { into?: Path; park?: boolean; recv?: SlotId },
  ctx: ReduceCtx,
): World {
  requireActor(w, msg.to, ctx, msg)
  const data = msg.data
  if (data?.kind === 'state') return applyState(w, msg, data, opts, ctx)
  if (data?.kind === 'op') return applyOp(w, msg, data, opts, ctx)
  let world = w
  const recv = opts.recv ?? (data?.kind === 'stamp' ? data.slot : undefined)
  if (recv !== undefined)
    world = applyStamp(world, msg, recv, data?.kind === 'stamp' ? data.stamp : undefined, ctx)
  if (data === undefined && opts.recv === undefined) return world
  // A stamped / recv plain message still lands its payload (the core delegates the whole landing).
  if (opts.into !== undefined) {
    assertPlainTarget(world, opts.into, ctx, msg)
    world = setAt(world, opts.into, msg.payload)
    ctx.log.push({ kind: 'via', path: opts.into, message: msg.id })
  } else {
    ctx.log.push({ kind: 'via', path: msg.to, message: msg.id })
  }
  return world
}

// ─── send.stamp ───────────────────────────────────────────────────────────────────────────────

/** The send rule of a clock slot: lamport tick / vector tick / hlc now; the stamp as `Meta`. */
export function stampForSend(
  w: World,
  from: ActorId,
  slot: SlotId,
  ctx: ReduceCtx,
): { world: World; meta: Meta } {
  const actor = requireActor(w, from, ctx, { t: 'send', from, stamp: slot })
  const replica = requireReplica(w, from, slot, ctx, { t: 'send', from, stamp: slot })
  switch (replica.type) {
    case 'lamport-clock': {
      const next = lamportTick(replica.state as number)
      return { world: setReplica(w, from, slot, { ...replica, state: next }), meta: { ts: next } }
    }
    case 'vector-clock': {
      const next = vcTick(replica.state as VectorClock, from)
      return {
        world: setReplica(w, from, slot, { ...replica, state: next }),
        meta: { vc: orderedVc(next, Object.keys(w.actors)) },
      }
    }
    case 'hlc': {
      const next = hlcNow(replica.state as Hlc, wallTime(w, actor))
      return {
        world: setReplica(w, from, slot, { ...replica, state: next }),
        meta: { hlc: { wall: next.wall, counter: next.counter }, ts: encodeHlcStamp(next) },
      }
    }
    default:
      throw fail(
        ctx,
        { t: 'send', from, stamp: slot },
        `send.stamp: "${from}.${slot}" is a ${replica.type}; a stamp needs a lamport-clock, vector-clock or hlc`,
        `${from}.${slot}`,
      )
  }
}
