/**
 * The lesson DSL types — transcribed from `docs/animation-dsl.md` v1.1 (§2–§6, §8.1, §11, §14),
 * which is the authoritative contract between `src/content/` (data), `src/lesson/` (schema, builders,
 * reducer, player) and `src/stage/` (renderer). The comments are part of the contract.
 *
 * Invariants (CLAUDE.md §4, DSL §0): lessons are data; every step is a legible static frame; CRDT
 * state is real (`src/crdt/`), the reducer is only the delivery layer.
 */

// ─── Errors ───────────────────────────────────────────────────────────────────────────────────

/**
 * The one error type of the lesson layer. Thrown by the path lenses, the reducer and the dry-run
 * when a command cannot be applied (bad path, CRDT slot write, unknown id, unready apply …).
 * Caught by `pnpm test`, never by a learner.
 */
export class ReducerError extends Error {
  readonly ctx?: { stepId?: string; command?: unknown; path?: string }
  constructor(message: string, ctx?: { stepId?: string; command?: unknown; path?: string }) {
    super(message)
    this.name = 'ReducerError'
    this.ctx = ctx
  }
}

// ─── Ids and primitives ───────────────────────────────────────────────────────────────────────
export type ActorId = string
export type BoardId = string
export type SlotId = string
export type MessageId = string
export type MarkId = string
export type SceneId = string
export type StepId = string
/** A CRDT node id: an ActorId, or the reserved pseudo-node 'seed' (initial state nobody "wrote"). */
export type NodeId = string
/** `${node}:${seq}` — op ids, OR-Set tags, RGA element ids (see src/crdt/types.ts). */
export type Dot = `${string}:${number}`
export type Path = string // grammar in docs/animation-dsl.md §3 and src/lesson/path.ts
export type Scalar = string | number | boolean | null
export type Tone = 'change' | 'info' | 'ok' | 'warn' | 'danger'
export type VectorClock = Record<NodeId, number>

// ─── World ────────────────────────────────────────────────────────────────────────────────────
export type World = {
  layout: Layout
  clock: Clock
  actors: Record<ActorId, Actor> // insertion-ordered; ≤ 5 on stage
  boards: Record<BoardId, Board> // insertion-ordered
  messages: Message[] // in flight or parked; order = creation order
  marks: Mark[]
  replicas: Record<ActorId, Record<SlotId, Replica>> // opaque CRDT state, see §5.1
  engines: Record<ActorId, EngineState> // regex VM state, see §5.3
  ids: number // reducer counter for generated message ids (m1…) and mark ids (k1…)
}

export type LayoutPreset = 'row' | 'pair' | 'triangle' | 'hub' | 'ring' | 'grid'
/** `hub` names the actor in the centre slot of `hub`/`ring`; default = first server/service, else the first actor. */
export type Layout = { preset: LayoutPreset; hub?: ActorId }

export type Clock = {
  now: number // logical "now"; advanced only by `tick` (and `autoTick`)
  show: boolean // draw the corner HUD
  format: 'counter' | 'ms' | 'time' // 'counter' → t=3, 'ms' → 150 ms, 'time' → hh:mm (now = minutes since `start`)
  start?: string // 'hh:mm', required when format is 'time'
  autoTick?: boolean // advance by 1 before every crdt.update whose stamp comes from the wall clock (§5.1 Time)
}

// ─── Actors and boards ────────────────────────────────────────────────────────────────────────
export type ActorKind = 'person' | 'device' | 'server' | 'service'
export type ActorIcon =
  'person' | 'phone' | 'laptop' | 'tablet' | 'server' | 'cloud' | 'service' | 'database' | 'region'
export type ActorColor = 'a' | 'b' | 'c' | 'd' | 'server' | 'neutral'
export type ActorStatus = 'lock' | 'waiting' | 'busy' | 'error'

export type Actor = {
  id: ActorId
  kind: ActorKind
  label: string // localizable; ≤ 12 characters
  subtitle?: string // localizable; small caption under the label ("shares: text", "tokens 0–33")
  icon?: ActorIcon // default derived from kind
  color: ActorColor // semantic palette slot
  owner?: ActorId // same person, another device → same hue + "Alice's" caption
  online: boolean // offline: dimmed + "no connection" badge; incoming messages park (§4.3)
  status?: ActorStatus // icon + word badge (lock / waiting / busy / error)
  skew?: number // this actor's wall clock reads clock.now + skew; defined ⇒ clock badge drawn
  holds: Record<SlotId, Value> // plain values, or toValue() of a replica (read-only for lessons); insertion-ordered
  outbox: OutboxChip[] // derived by the reducer from replicas: ops created, not yet broadcast
}
export type OutboxChip = { slot: SlotId; id: Dot; label: string }

/** Authoring shape for `spawn` and scene worlds; the reducer fills defaults. */
export type ActorSpec = Omit<Actor, 'color' | 'online' | 'holds' | 'outbox'> & {
  color?: ActorColor // default: the owner's colour; else server/service → 'server'; else the next free of a, b, c, d in insertion order
  online?: boolean // default true
  holds?: Record<SlotId, Value | Scalar> // scalars are wrapped
}

export type Board = { id: BoardId; label?: string; value: Value; tone?: Tone }

// ─── Messages ─────────────────────────────────────────────────────────────────────────────────
export type Message = {
  id: MessageId
  from: ActorId
  to: ActorId // fan-out creates one Message per recipient (ids `${id}@${to}`)
  payload: Value // what the token shows; payload.meta draws the envelope badges (op id, stamp, size…)
  label?: string // localizable short caption ("save", "lock?")
  state: 'flying' | 'parked' // parked = arrived at `to`, not yet applied; drawn in the recipient's inbox tray
  into?: Path // destination hint from send.into (arc endpoint); deliver.into defaults to it — no look-ahead
  size?: number // bytes; set by crdt.send when `mode` is given, never by lessons
  data?: MessageData // opaque to the renderer; consumed by `deliver`
}
export type MessageData =
  | { kind: 'state'; slot: SlotId; state: unknown; version: VectorClock } // a replica snapshot (full or delta)
  | { kind: 'op'; slot: SlotId; op: OpRecord } // one op from crdt.broadcast
  | { kind: 'stamp'; slot: SlotId; stamp: unknown } // a clock stamp attached by send.stamp

// ─── Marks ────────────────────────────────────────────────────────────────────────────────────
export type Verdict = 'equal' | 'different' | 'before' | 'after' | 'concurrent' | 'less' | 'greater'
export type CompareRule = 'clock' | 'stamp' | 'number' | 'value' // which §10 rule produced the verdict
export type Mark =
  | { id: MarkId; kind: 'highlight'; paths: Path[]; tone: Tone; sticky?: boolean; auto?: boolean }
  | { id: MarkId; kind: 'callout'; at: Path; text: string; tone: Tone; sticky?: boolean }
  | { id: MarkId; kind: 'conflict'; a: Path; b: Path; sticky?: boolean }
  | {
      id: MarkId
      kind: 'compare'
      paths: Path[]
      verdict: Verdict
      rule: CompareRule
      sticky?: boolean
    }
  | { id: MarkId; kind: 'check' | 'cross'; path: Path; sticky?: boolean }
  | { id: MarkId; kind: 'unchanged'; path: Path } // reducer-generated: a crdt command changed nothing here
  | { id: MarkId; kind: 'flow'; from: Path; to: Path; both?: boolean } // reducer-generated: crdt.merge / crdt.sync happened between two slots

// ─── Values ───────────────────────────────────────────────────────────────────────────────────
/** A typed tree the renderer knows how to draw. CRDT sidecar lives in `meta`. */
export type Value =
  | { kind: 'scalar'; value: Scalar; meta?: Meta }
  | {
      kind: 'record'
      fields: Array<{ key: string; value: Value }>
      display?: 'card' | 'tree'
      meta?: Meta
    }
  | { kind: 'list'; items: Item[]; display?: 'row' | 'column' | 'text'; meta?: Meta }
  | { kind: 'set'; items: Item[]; meta?: Meta }
  | { kind: 'counter'; rows: CounterRow[]; total: number; meta?: Meta }
  | { kind: 'clock'; entries: Record<NodeId, number>; meta?: Meta }
  | { kind: 'table'; columns: Array<{ key: string; label: string }>; rows: TableRow[]; meta?: Meta }
  | {
      kind: 'bytes'
      bytes: number[]
      display: 'hex' | 'bits' | 'canonical' | 'dec'
      range?: [number, number] // bytes expanded in 'bits' display, half-open [from, to); absent ⇒ all bytes, 4 per row
      annotations: Annotation[]
      meta?: Meta
    }
  | { kind: 'text'; text: string; cursor?: number; annotations: Annotation[]; meta?: Meta }
  | { kind: 'pattern'; tokens: PatternToken[]; cursor?: number; meta?: Meta }
  | { kind: 'meter'; value: number; max?: number; label?: string; tone?: Tone; meta?: Meta }

/** The `Value` variant with discriminant `K` (`ValueOf<'bytes'>`). */
export type ValueOf<K extends Value['kind']> = Extract<Value, { kind: K }>

export type Item = { id: string; value: Value } // list/set item; tombstone, tags, ts… live in value.meta; id never contains ']'
export type CounterRow = { node: NodeId; inc: number; dec?: number } // PN-Counter rows carry `dec`
export type TableRow = { id: string; cells: Record<string, Value> }
export type Annotation = {
  id?: string
  from: number // inclusive; unit 'byte' (bytes), 'bit' (bytes, bit index from the MSB of byte 0), char (text)
  to: number // exclusive
  unit?: 'byte' | 'bit'
  label?: string // localizable
  tone?: Tone
}
export type PatternToken = {
  id: string // stable: p0, p1… in source order
  src: string
  kind: 'literal' | 'any' | 'class' | 'quant' | 'group' | 'anchor' | 'alt'
  label?: string
}

/** Sidecar metadata drawn as small badges next to a value node. Produced by toValue(), or by `patch` on plain values. */
export type Meta = {
  ts?: number // LWW stamp / Lamport time
  node?: NodeId // who wrote it
  hlc?: { wall: number; counter: number } // present when the stamp came from an HLC (renderer prefers it over ts)
  tag?: Dot // one op id / tag (envelopes, RGA elements)
  tags?: Array<{ tag: Dot; alive: boolean }> // OR-Set: every tag seen for the element
  tombstone?: boolean
  addTs?: number // LWW-Element-Set
  removeTs?: number
  vc?: VectorClock // version vector (replica version, MV-Register sibling clock, MV-Register root = join of siblings)
  applied?: Dot[] // op ids applied at this replica (when exposed)
  stats?: { stored: number; visible: number } // RGA: elements incl. tombstones vs visible
  type?: CrdtName // type chip on composed-document parts ("LWW", "OR-Set")
  note?: string // localizable footnote
}

// ─── 4.1 Stage, actors, time ──────────────────────────────────────────────────────────────────
export type StageCommand =
  | { t: 'spawn'; actor: ActorSpec } // add an actor (animates in)
  | { t: 'remove'; actor: ActorId } // animates out; in-flight messages to/from it are dropped (poof, `dropped` changes)
  | { t: 'removeBoard'; board: BoardId }
  | { t: 'layout'; preset: LayoutPreset; hub?: ActorId } // cards glide to new slots
  | { t: 'tick'; by?: number } // clock.now += by (default 1); the only way time moves (besides autoTick)
  | { t: 'skew'; actor: ActorId; by: number } // actor wall clock = clock.now + by (0 allowed: "jumped back")
  | { t: 'offline'; actor: ActorId }
  | { t: 'online'; actor: ActorId }
  | { t: 'status'; actor: ActorId; status: ActorStatus | null }
  | { t: 'note'; id: BoardId; text: string; tone?: Tone; label?: string; textId?: string } // upsert a free-standing text card: a Board whose value is { kind: 'text' }; `textId` pins the overlay key (§12)

// ─── 4.2 Values (plain slots, boards; never CRDT slots) ───────────────────────────────────────
export type ValueCommand =
  | { t: 'set'; path: Path; value: Value | Scalar; quiet?: boolean } // replace; creates a missing slot / record field / list item; keeps meta of a scalar unless a full Value is given
  | { t: 'patch'; path: Path; meta: Partial<Meta>; quiet?: boolean } // sidecar only
  | { t: 'insert'; path: Path; item: Item | TableRow | Scalar; index?: number; quiet?: boolean } // list/set items, table rows; default: append; scalar item ⇒ id = String(value)
  | { t: 'delete'; path: Path; tombstone?: boolean; quiet?: boolean } // item / record field / table row; tombstone keeps it struck-through
  | { t: 'move'; path: Path; to: number; quiet?: boolean } // reorder an item (path = the item)
  | { t: 'sort'; path: Path; by: SortKey[] } // lists and tables only; animates the reorder
  | {
      t: 'annotate'
      path: Path
      from: number
      to: number
      unit?: 'byte' | 'bit'
      label?: string
      tone?: Tone
      id?: string
    } // bytes / text
  | { t: 'unannotate'; path: Path; id?: string } // one annotation, or all
  | {
      t: 'view'
      path: Path
      display: 'hex' | 'bits' | 'canonical' | 'dec'
      range?: [number, number]
    } // bytes display mode; animates between views; `range` absent ⇒ cleared
export type SortKey = 'value' | 'id' | `@${string}` | `.${string}` // '@ts' = meta key, '.price' = record field / table column

// ─── 4.3 Messages ─────────────────────────────────────────────────────────────────────────────
export type Payload = Value | Scalar | { ref: Path } // { ref } snapshots the value at send time (messages are immutable)
export type MessageCommand =
  | {
      t: 'send'
      from: ActorId
      to: ActorId | ActorId[]
      payload: Payload
      id?: MessageId // default m1, m2…; fan-out ⇒ `${id}@${to}` per recipient
      label?: string // localizable
      into?: Path // destination hint (arc endpoint) and the default for deliver.into
      stamp?: SlotId // run the send rule of this clock slot (lamport/vector/hlc) and carry the stamp in payload.meta
      textId?: string // pins the overlay key of `label` (§12)
    }
  | { t: 'deliver'; message: MessageId; into?: Path; park?: boolean; recv?: SlotId } // arrives and takes effect (or parks)
  | { t: 'drop'; message: MessageId } // lost (poof)
  | { t: 'duplicate'; message: MessageId; id: MessageId } // a retry: a copy splits off an in-flight message
  | { t: 'relay'; message: MessageId; to: ActorId | ActorId[]; into?: Path } // deliver at the hub, then forward copies `${base}@${to}`

// ─── 4.4 Marks ────────────────────────────────────────────────────────────────────────────────
export type MarkCommand =
  | { t: 'highlight'; path: Path | Path[]; tone?: Tone; sticky?: boolean; id?: MarkId } // default tone 'change'; one mark, many anchors
  | {
      t: 'callout'
      at: Path
      text: string
      tone?: Tone
      sticky?: boolean
      id?: MarkId
      textId?: string // pins the overlay key of `text` (§12)
    } // bubble near an actor / value / board / msg:id
  | { t: 'conflict'; a: Path; b: Path; sticky?: boolean; id?: MarkId } // ⚡ bolt between two values
  | { t: 'compare'; paths: Path[]; expect?: Verdict; sticky?: boolean; id?: MarkId } // verdict computed by the reducer (§10)
  | { t: 'check'; path: Path; sticky?: boolean; id?: MarkId }
  | { t: 'cross'; path: Path; sticky?: boolean; id?: MarkId }
  | { t: 'clearMarks' } // removes every mark (transient and sticky); boards/notes stay
  | { t: 'unmark'; id: MarkId }

// ─── 4.5 Assertions (invisible) ───────────────────────────────────────────────────────────────
export type AssertCommand = { t: 'expect'; path: Path; equals: unknown } // checked in tests and by the verify walker; never drawn

// ─── 5.1 CRDT replicas ────────────────────────────────────────────────────────────────────────
/** Registered names in src/crdt/index.ts. 'max-register' and 'hlc' are added for v1 (P1, IV.5). */
export type CrdtName =
  | 'max-register'
  | 'lww-register'
  | 'lww-map'
  | 'mv-register'
  | 'g-counter'
  | 'pn-counter'
  | 'op-counter'
  | 'g-set'
  | 'two-phase-set'
  | 'lww-element-set'
  | 'or-set'
  | 'rga'
  | 'lamport-clock'
  | 'vector-clock'
  | 'hlc'

/** A composed document: CRDT parts nested in maps, lists and sets; merged part by part by src/crdt/doc.ts. */
export type CrdtSchema =
  | CrdtName
  | { type: CrdtName; args?: CrdtArgs }
  | { const: Scalar } // an immutable label (e.g. a poll question)
  | { map: Record<string, CrdtSchema> } // fixed fields
  | { list: CrdtSchema } // an RGA whose items follow the schema
  | { set: CrdtSchema } // an OR-Set of sub-documents, keyed by the tag of the add that created them

export type CrdtArgs = {
  seed?: SeedOp[] // initial state, applied at every replica as already-delivered ops (semantics below)
  bias?: 'add' | 'remove' // lww-element-set
  nodes?: NodeId[] // vector-clock: pre-fill zero rows (default: the init actors)
  clock?: { slot: SlotId } // lww-register / lww-map: stamps come from this HLC slot instead of the wall clock
  stamp?: 'lamport' | 'clock' // rga: element ts = max ts seen here + 1 (default) or the wall clock (§5.1 Time)
  display?: 'row' | 'column' | 'text' // rga (default 'row'; 'text' draws one-character items as a line, id beneath each)
  expose?: Array<'vc' | 'applied' | 'stats'> // publish delivery-layer sidecar on the slot's root meta
  wire?: 'state' | 'ops' // how this slot travels (default 'state'); 'ops' draws the outbox chips (pending ops) on the card
}
/** `by` defaults to the pseudo-node 'seed' (no actor seq consumed, not counted in version vectors); `ts` defaults to 0. */
export type SeedOp = { by?: NodeId; op: string; args?: unknown[]; path?: string; ts?: number }

export type Replica = {
  type: CrdtName | 'doc'
  schema?: CrdtSchema // doc: { map: fields }
  args: CrdtArgs
  state: unknown // plain JSON produced only by src/crdt
  seq: number // dense per (actor, slot): the next op id is `${actor}:${seq + 1}`
  version: VectorClock // per node: seq of the latest op applied here (dense within this slot)
  applied: Dot[] // op ids applied here (dedupe); compacted by crdt.gc
  log: OpRecord[] // every op created or applied here, in application order (for delta/ops sync)
  pending: Dot[] // created here, not yet broadcast or sent as a delta (the outbox)
}
export type OpRecord = {
  id: Dot
  op: unknown // the real op from prepare()
  deps: VectorClock // creator's version before this op (causal delivery predicate)
  path?: string // doc part
  label: string // opLabel(): "inc 1", "add milk #alice:3" (§5.2)
  ts: number
}

export type CrdtCommand =
  | { t: 'crdt.init'; actors: ActorId[]; slot: SlotId; type: CrdtName; args?: CrdtArgs }
  | {
      t: 'crdt.doc'
      actors: ActorId[]
      slot: SlotId
      fields: Record<string, CrdtSchema> // the implicit top-level map of a composed document
      args?: CrdtArgs
    }
  | {
      t: 'crdt.update'
      actor: ActorId
      slot: SlotId
      path?: string
      op: string
      args?: unknown[]
      ts?: number
      quiet?: boolean
    }
  | {
      t: 'crdt.send'
      from: ActorId
      to: ActorId | ActorId[]
      slot: SlotId
      id?: MessageId
      label?: string // localizable
      mode?: 'full' | 'delta'
      textId?: string // pins the overlay key of `label` (§12)
    } // state on the wire
  | { t: 'crdt.broadcast'; from: ActorId; slot: SlotId; to?: ActorId[]; id?: MessageId } // ops on the wire: flush the outbox
  | { t: 'crdt.merge'; into: ActorId; from: ActorId; slot: SlotId } // instant one-way merge (flow mark, no token)
  | { t: 'crdt.sync'; a: ActorId; b: ActorId; slot: SlotId; mode?: 'state' | 'ops' } // both ways; 'ops' emits the missing ops as messages
  | { t: 'crdt.gc'; actor: ActorId; slot: SlotId; upTo?: VectorClock; unsafe?: boolean } // drop tombstones / compact applied ids

// ─── 5.2 Lesson-side view contract (`src/lesson/crdt-view/`) ─────────────────────────────────
export interface CrdtView<S, O> {
  toValue(state: S, ctx: ViewCtx): Value // sidecar → Meta; ordering rules in §5.2
  opLabel(op: O): string // outbox chip / token caption, formats in §5.2
}
export type ViewCtx = {
  actors: ActorId[] // world order; orders per-node rows and clock entries
  replica: Replica // for exposed sidecar: vc, applied, stats
  expose: ReadonlyArray<'vc' | 'applied' | 'stats'>
  display?: 'row' | 'column' | 'text'
}

// ─── 5.3 Regex engine (`src/regex/`) ─────────────────────────────────────────────────────────
export type EngineState = unknown // src/regex state: compiled program, input, cursors, choice points, captures, tries
export type RegexCommand =
  | { t: 'regex.init'; actor: ActorId; pattern: string; input: string; flags?: string }
  | {
      t: 'regex.advance'
      actor: ActorId
      until: 'step' | 'token' | 'fail' | 'attempt' | 'backtrack' | 'match' | 'end'
    }

// ─── 6 Step semantics ─────────────────────────────────────────────────────────────────────────
export type Hold = 'short' | 'normal' | 'long'
export type Step = {
  id: StepId // stable forever; translations key on it
  say: string // 1–2 sentences; tiny markup: [text](/module/unit/topic) links, **Term** for a first-use glossary term
  do: Command[]
  hold?: Hold // default 'normal'; 'long' for "Whoops" and summary steps
  autoHighlight?: boolean // default true
}
export type Command =
  | StageCommand
  | ValueCommand
  | MessageCommand
  | MarkCommand
  | AssertCommand
  | CrdtCommand
  | RegexCommand

/** The discriminant of a command (`'set'`, `'crdt.update'` …). */
export type CommandT = Command['t']

// ─── 8.1 Structure ────────────────────────────────────────────────────────────────────────────
export type Topic = {
  id: string // URL segment; must exist in src/content/catalog.ts
  title: string
  goal: string // one sentence: what the learner can do afterwards
  whenToUse: string[] // bullets for the "When to use" panel
  whenNotToUse: string[]
  realWorld: string // the anchor example
  scenes: Scene[]
}
export type Scene = {
  id: SceneId
  title?: string
  inContext?: boolean // the "[in-context]" scene of a topic
  world?: SceneWorld // exactly one of `world` / `startFrom`
  startFrom?: SceneId // inherit an earlier scene's final world (marks cleared; it must have no messages in flight)
  steps: Step[]
  tryIt?: TryIt // §11
}
export type SceneWorld = {
  layout?: LayoutPreset // default 'row'
  hub?: ActorId
  clock?: Partial<Clock> // default { now: 0, show: false, format: 'counter' }
  actors: ActorSpec[]
  boards?: Board[]
}

// ─── 11 Try-it / sandbox hooks ────────────────────────────────────────────────────────────────
export type TryIt = {
  slot: SlotId
  actors?: ActorId[] // default: every actor holding the slot
  ops: Array<{ op: string; label?: string; args?: 'prompt' | unknown[] }> // e.g. { op: 'add', args: 'prompt' }
  network?: Array<'sync' | 'send' | 'offline' | 'drop'> // which delivery controls to show
}

// ─── 14 Testing contract ──────────────────────────────────────────────────────────────────────
export type Change =
  | { kind: 'value'; path: Path; op: 'added' | 'changed' | 'removed' | 'meta'; via?: MessageId } // also <actor>@outbox / @inbox
  | {
      kind: 'actor'
      id: ActorId
      op: 'spawned' | 'removed' | 'online' | 'offline' | 'status' | 'skew'
    }
  | { kind: 'board'; id: BoardId; op: 'added' | 'changed' | 'removed' }
  | {
      kind: 'message'
      op: 'sent' | 'parked' | 'delivered' | 'dropped'
      message: Message // the message as it was when the event fired (it may no longer be in `world`)
      transient?: boolean // created and consumed inside this step
    }
  | { kind: 'sync'; slot: SlotId; from: ActorId; to: ActorId; both: boolean } // crdt.merge / crdt.sync (state mode)
  | { kind: 'mark'; id: MarkId; op: 'added' | 'removed' }
  | { kind: 'layout'; from: Layout; to: Layout }
  | { kind: 'clock'; from: number; to: number }
export type Frame = {
  index: number // global across scenes
  sceneId: SceneId
  sceneIndex: number
  step: Step
  world: World
  prev: World // world0 at the first step of a scene (the scene world, or the startFrom parent's end)
  changes: Change[] // ordered event log (§6 step 5)
}

// ─── Const lists (the schema enumerates from these; schema.test.ts proves they cover the unions)
export const LAYOUT_PRESETS = [
  'row',
  'pair',
  'triangle',
  'hub',
  'ring',
  'grid',
] as const satisfies readonly LayoutPreset[]
export const ACTOR_KINDS = [
  'person',
  'device',
  'server',
  'service',
] as const satisfies readonly ActorKind[]
export const ACTOR_ICONS = [
  'person',
  'phone',
  'laptop',
  'tablet',
  'server',
  'cloud',
  'service',
  'database',
  'region',
] as const satisfies readonly ActorIcon[]
export const ACTOR_COLORS = [
  'a',
  'b',
  'c',
  'd',
  'server',
  'neutral',
] as const satisfies readonly ActorColor[]
export const ACTOR_STATUSES = [
  'lock',
  'waiting',
  'busy',
  'error',
] as const satisfies readonly ActorStatus[]
export const TONES = ['change', 'info', 'ok', 'warn', 'danger'] as const satisfies readonly Tone[]
export const VERDICTS = [
  'equal',
  'different',
  'before',
  'after',
  'concurrent',
  'less',
  'greater',
] as const satisfies readonly Verdict[]
export const COMPARE_RULES = [
  'clock',
  'stamp',
  'number',
  'value',
] as const satisfies readonly CompareRule[]
/** Every CRDT name the DSL knows, in curriculum order (§5.1; a superset of src/crdt/index.ts until 'max-register' and 'hlc' land there). */
export const CRDT_NAMES = [
  'max-register',
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
  'hlc',
] as const satisfies readonly CrdtName[]
export const HOLDS = ['short', 'normal', 'long'] as const satisfies readonly Hold[]

/** Legibility limits (§2, §13). Enforced by the schema where the value is authored; the renderer applies the rest. */
export const LIMITS = {
  maxActors: 5,
  maxRecordFields: 6,
  maxVisibleItems: 8, // list/set items, tombstones excluded
  maxScalarChars: 24, // display: middle-ellipsis beyond this (bytes in canonical display exempt)
  maxTextChars: 96,
  maxLabelChars: 12,
  maxSayChars: 160,
  maxSaySentences: 2,
  bytesPerRowHex: 16,
  bytesPerRowBits: 4,
  maxBadges: 3, // meta tags / applied ids shown before `+n`
} as const
