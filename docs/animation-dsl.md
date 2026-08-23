# Animation DSL — v1.1 (authoritative)

This document defines how lessons describe what happens on the stage. It supersedes v1 and is
the contract between `src/content/` (data), `src/lesson/` (types, schema, builders, reducer,
player) and `src/stage/` (renderer). Every type in §2–§6 and §14 is valid TypeScript and is copied
into `src/lesson/types.ts` nearly verbatim; `src/lesson/schema.ts` mirrors it in Zod.

Three invariants, restated from `CLAUDE.md`:

1. **Lessons are data.** A step is `{ id, say, do }`: a stable id, one or two short sentences,
   an ordered list of typed commands. No durations, pixels, easing, or functions. The reducer turns
   commands into immutable world states; the stage renders a world state; Motion animates the
   difference between two consecutive states.
2. **Every step is a legible static frame.** Anything that must be visible (a message in flight, a
   parked op, a rule card, a no-op, a merge that just happened) is world state, not a side effect
   of an animation.
3. **CRDT state is real.** Where a slot is a CRDT, its state is produced only by `src/crdt/`
   (`init`, `update`/`prepare`/`effect`, `merge`). The reducer is the delivery layer (ids, dedupe,
   causal buffering, version vectors); the CRDT is the data type. Lessons never hand-write a merge
   result; value commands on a CRDT slot are errors.

Companion: `docs/stage-architecture.md` (how the renderer and player implement this; its v0 text
is being rebased on this document, see §17).

---

## 1. Vocabulary

| Term    | Meaning                                                                                                                            |
| ------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Module  | A course (`crdts`, `uuids`, `regex`, `columnar-stores`). Catalog metadata lives in `src/content/catalog.ts`.                       |
| Unit    | A chapter of a module (`the-problem`, `state-based`, …).                                                                           |
| Topic   | One lesson page; the unit of URL, progress and verification: `/:locale/:module/:unit/:topic`.                                      |
| Scene   | A self-contained animation inside a topic: its own **World** and ordered **Steps**. A scene may inherit another scene's end.       |
| Step    | `{ id, say, do }`. `say` is narration (1–2 sentences). `do` is a list of **commands**. `state[n] = reduce(world0, steps[0..n])`.   |
| Command | Typed data applied by the reducer. Primitive (actors, values, messages, marks) or domain (`crdt.*`, `regex.*`).                    |
| World   | The immutable stage state at one step: layout, clock, actors, boards, messages, marks, replicas.                                   |
| Actor   | A card on the stage that can hold values and send/receive messages (person, device, server, service).                              |
| Board   | A free-standing card (a rule note, a decision table, a schema tree) not owned by an actor.                                         |
| Slot    | A named value an actor holds (`alice.doc`); a slot is either a plain `Value` or a CRDT replica.                                    |
| Path    | A string that addresses a node in the world (`alice.doc.title`, `bob.cart[milk]@tags`, `board.rule`, `msg:m1`). §3.                |
| Message | A token in flight (or parked) between two actors, carrying a payload and optional opaque data.                                     |
| Mark    | An overlay: highlight, callout, conflict, compare, check/cross, unchanged, flow. Transient (one step) or sticky.                   |
| Replica | One actor's copy of a CRDT slot: real `src/crdt/` state plus delivery-layer bookkeeping (seq, version, applied, log, outbox).      |
| Frame   | `{ index, sceneId, step, world, prev, changes }` — what the stage renders; `changes` is the typed event log the renderer animates. |

Ids are short, lower-case, stable: actor ids (`alice`, `server`, `edge-us`; `board` and `msg` are
reserved), slot ids (`doc`, `likes`), step ids (`s01` … never renumbered), scene ids
(`update-and-merge`), message ids (`m1`, `alice:3@bob`), op ids (`alice:3`).

---

## 2. World model

```ts
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
export type Path = string // grammar in §3
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
  format: 'counter' | 'ms' | 'time' // 'counter' → t3, 'ms' → 150 ms, 'time' → hh:mm (now = minutes since `start`)
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
```

Rules:

- `actors` and `boards` keep insertion order; that order drives layout slots and the order of
  per-node rows / clock entries everywhere (§5.2). `holds` keeps insertion order too (it drives the
  layout inside a card and Motion keys); `set` on a new slot appends.
- `holds[slot]` of a CRDT slot is always `toValue(replica)`; the renderer never reads `replicas`.
- A `Value` is immutable data; every change produces a new tree (structural sharing in the reducer).
- Legibility limits, enforced by schema: ≤ 5 actors, ≤ 6 record fields per card, ≤ 8 visible
  list/set items (tombstones excluded; overflow draws `+n`), scalar display ≤ 24 characters
  (middle-ellipsis; full value in `title`/`data-value`; `bytes` in `canonical` display are exempt),
  `text` ≤ 96 characters (wrapped to ≤ 2 lines), bytes 16 per row in `hex`/`dec` and 4 per row in
  `bits`, `Meta` badges ≤ 3 tags / ≤ 3 applied ids (`+n`), `vc` compact (`a2 b1`, full in `title`).

---

## 3. Paths

A `Path` addresses one node on the stage. It is the only way commands and marks point at things.

```
Path      := Root Segment* Selector?
Root      := ActorId | 'board.' BoardId | 'msg:' MessageId      ('msg:' takes the rest verbatim, no segments, no selector)
Segment   := '.' Key | '[' Id ']' | '[' Int '..' Int ']'         (Id = any chars except ']'; range only on bytes/text, last segment)
Selector  := '@' Name                                             (Name = [A-Za-z]+)
```

Resolution by the kind of the node reached so far:

| Node kind    | `.key`                         | `[id]`                                    | `[a..b]`        | `@name`                                                     |
| ------------ | ------------------------------ | ----------------------------------------- | --------------- | ----------------------------------------------------------- |
| actor (root) | slot                           | —                                         | —               | `@clock` (wall-clock badge), `@status`, `@outbox`, `@inbox` |
| board (root) | the board's value (then below) | —                                         | —               | —                                                           |
| scalar       | —                              | —                                         | —               | any `Meta` key (`@ts`, `@node`, `@tomb`, `@hlc`…)           |
| record       | field                          | —                                         | —               | `Meta` key of the record                                    |
| list / set   | —                              | item by id (missing id on `set` = create) | —               | `Meta` key (`@tags`, `@tomb`, `@vc`, `@stats`…)             |
| counter      | —                              | row by node                               | —               | on a row: `@inc` / `@dec`; on the counter: `@vc`…           |
| clock        | entry by node                  | —                                         | —               | `Meta` key                                                  |
| table        | column by key (vertical band)  | row by id; `[id].key` = cell              | —               | `Meta` key                                                  |
| bytes        | —                              | one byte by index                         | byte range      | `Meta` key                                                  |
| text         | —                              | —                                         | character range | `Meta` key, `@cursor`                                       |
| pattern      | —                              | token by id (`p0`…)                       | —               | `Meta` key, `@cursor`                                       |
| meter        | —                              | —                                         | —               | `Meta` key                                                  |

`@tomb` is short for `@tombstone`. A root-only path (`alice`) addresses the whole card; `msg:m1`
addresses a token in flight or parked (marks only; a token's payload is not addressable — compare
against the sender's copy, which equals the snapshot at send time). `board` and `msg` are reserved
and cannot be actor ids. Malformed paths fail the Zod schema; paths that do not resolve in the world
at that step throw `ReducerError` in tests (never a silent no-op).

Examples: `alice.doc.title`, `server.list[item-3]`, `bob.views[bob]@inc`, `alice.likes[alice]@dec`,
`bob.fav[jazz]@removeTs`, `alice.cart[milk]@tags`, `alice.list.items[alice:1].qty`,
`server.cart[s1]@vc`, `alice@clock`, `bob@inbox`, `board.table[r1].use`, `board.events.price`,
`laptop.id[6]`, `matcher.text[4..7]`, `matcher.text@cursor`, `matcher.pattern[p2]`, `msg:alice:3@bob`.

---

## 4. Commands (primitive, concept-agnostic)

Every command is a plain object with a discriminant `t`; every `t` value is unique (Zod
`discriminatedUnion`). Mutating value commands accept `quiet?: boolean` to suppress the
auto-highlight of the change (§6).

### 4.1 Stage, actors, time

```ts
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
  | { t: 'note'; id: BoardId; text: string; tone?: Tone; label?: string } // upsert a free-standing text card: a Board whose value is { kind: 'text' }
```

`note` with an existing id replaces that card in place (used to step through "law 1 / law 2 / law 3").
Boards declared in the scene world or created by `note` are removed only by `removeBoard` —
`clearMarks` never touches them.

### 4.2 Values (plain slots, boards; never CRDT slots)

```ts
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
```

`set` on a path inside a CRDT slot throws `ReducerError: slot "doc" is CRDT-managed; use crdt.update`.
`set` on `<actor>.<slot>` with no such slot creates it (appended to `holds`). `set` on `x.id[6]`
(bytes) replaces one byte; on `x.id[0..6]` it replaces a byte range (value: `number[]`). `delete` on
a record field removes the key. `sort` by `'value'` orders strings by code unit, numbers
numerically, `bytes` bytewise. Bit-unit annotations drawn over bytes that are not expanded
(`hex`/`canonical`/`dec`) snap outward to the nibble; the exact bits stay in `title`. Overlapping
annotations take lanes deterministically (sort by `from`, then `id`; first free lane).

### 4.3 Messages

```ts
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
    }
  | { t: 'deliver'; message: MessageId; into?: Path; park?: boolean; recv?: SlotId } // arrives and takes effect (or parks)
  | { t: 'drop'; message: MessageId } // lost (poof)
  | { t: 'duplicate'; message: MessageId; id: MessageId } // a retry: a copy splits off an in-flight message
  | { t: 'relay'; message: MessageId; to: ActorId | ActorId[]; into?: Path } // deliver at the hub, then forward copies `${base}@${to}`
```

Semantics:

- A message exists between `send` and `deliver`/`drop`. In every static frame a flying message
  sits on its arc; a parked message sits in the recipient's **inbox tray**. Every card reserves a
  tray region (one token row; a count badge beyond 3); parked tokens are overlay-owned and anchored
  at `<actor>@inbox`, so a token that parks glides from the arc into the tray.
- **Same-step send and deliver.** A message created and consumed in one step is drawn anyway: the
  reducer records `sent` and `delivered`/`dropped` events with `transient: true` (§14), the renderer
  flies a transient token along the whole arc, and the landing flashes with a **via chip** (sender
  initial in the sender's hue). The static frame shows the landed value with the chip. `relay`
  works the same way: the original lands, the copies take off.
- **Stacking.** Tokens on the same arc in the same direction take distinct positions along the arc
  in creation order; from 4 tokens on, they collapse into one deck token with a count (`6 ops`).
- **Parking.** `deliver { park: true }` lands the message without effect. Messages addressed to an
  **offline** actor are created parked ("waiting at the door": `sent` + `parked` in one step; the
  token flies and slots into the tray); `online` does not apply them. A later `deliver` of a parked
  message applies it. `drop` works on either state.
- **`into`.** `send.into` is the only destination hint (no look-ahead: `state[n]` never depends on
  later steps); `deliver.into` defaults to it; when both are given they must agree (dry-run check).
- **`deliver` is the one receiver.** What happens depends on `message.data`:
  - none (plain payload): the payload is written to `into` (a missing slot, record field or `[id]`
    item is created); without `into` the token is consumed and the recipient card flashes with the
    via chip (control messages leave that trace in the frame).
  - `{ kind: 'state' }` (from `crdt.send`): the recipient's replica is **merged** with the carried
    snapshot via the real `merge()`; `into` is not allowed.
  - `{ kind: 'op' }` (from `crdt.broadcast`): the op is **applied** via the real `effect()` after
    the reducer's dedupe and causal checks (§5.1); not ready ⇒ throws unless `park: true`.
  - `{ kind: 'stamp' }` or `recv` given: the recipient's clock slot runs its receive rule.
- `relay` = `deliver` at the current recipient, then new messages with the same payload/data to each
  `to`, ids `${base}@${to}` where `base` is the original id without its `@recipient` suffix.
- Message ids referenced by `deliver`/`drop`/`duplicate`/`relay` must exist at that step (test-time
  check). Re-using the id of a delivered message later in the scene is allowed; a generated id that
  collides with a live message throws (give `id` explicitly).
- Marks anchored at `msg:<id>` attach once the token is at rest (after its flight; instantly under
  reduced motion).

### 4.4 Marks

```ts
export type MarkCommand =
  | { t: 'highlight'; path: Path | Path[]; tone?: Tone; sticky?: boolean; id?: MarkId } // default tone 'change'; one mark, many anchors
  | { t: 'callout'; at: Path; text: string; tone?: Tone; sticky?: boolean; id?: MarkId } // bubble near an actor / value / board / msg:id
  | { t: 'conflict'; a: Path; b: Path; sticky?: boolean; id?: MarkId } // ⚡ bolt between two values
  | { t: 'compare'; paths: Path[]; expect?: Verdict; sticky?: boolean; id?: MarkId } // verdict computed by the reducer (§10)
  | { t: 'check'; path: Path; sticky?: boolean; id?: MarkId }
  | { t: 'cross'; path: Path; sticky?: boolean; id?: MarkId }
  | { t: 'clearMarks' } // removes every mark (transient and sticky); boards/notes stay
  | { t: 'unmark'; id: MarkId }
```

Marks are recorded in command order, but their anchors are resolved and their verdicts computed
against the **end-of-step** world — the frame the learner sees. A mark added in this step whose
anchor does not resolve at the end of the step throws `ReducerError`; a sticky mark from an earlier
step whose anchor has vanished is removed by the reducer (a `mark removed` change). Consequence: a
`compare` and the merge it motivates belong in different steps (the verdict would be computed on
the merged state).

### 4.5 Assertions (invisible)

```ts
export type AssertCommand = { t: 'expect'; path: Path; equals: unknown } // checked in tests and by the verify walker; never drawn
```

`equals` is compared with the **plain value** of the node: scalar → its value; record → object;
list → array of plain values (tombstones excluded; a `display: 'text'` list also accepts the joined
string, `'what'`); set → sorted array; counter → total; clock → entries; bytes → lower-case hex
string; table → array of row objects; text → the string; pattern → its source; meter → its value;
`@meta` selectors → the meta value; `@cursor` → the index. This pins narration numbers ("1 + 1 = 2",
"−60", "tag alice:2") to what the real code computes.

---

## 5. Commands (domain: computed by real code)

### 5.1 CRDT replicas

```ts
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
  wire?: 'state' | 'ops' // how the slot travels (default 'state'); 'ops' draws the outbox chips (pending ops) on the card
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
```

Commands:

```ts
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
    } // state on the wire
  | { t: 'crdt.broadcast'; from: ActorId; slot: SlotId; to?: ActorId[]; id?: MessageId } // ops on the wire: flush the outbox
  | { t: 'crdt.merge'; into: ActorId; from: ActorId; slot: SlotId } // instant one-way merge (flow mark, no token)
  | { t: 'crdt.sync'; a: ActorId; b: ActorId; slot: SlotId; mode?: 'state' | 'ops' } // both ways; 'ops' emits the missing ops as messages
  | { t: 'crdt.gc'; actor: ActorId; slot: SlotId; upTo?: VectorClock; unsafe?: boolean } // drop tombstones / compact applied ids
```

Per-type op vocabulary (`crdt.update.op` and `args`; all executed by `src/crdt/`):

| type              | ops                                                                                                                                                                                                                                                                                                                                                                                         | toValue()                                                                                                                                                    |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `max-register`    | `set(n)`                                                                                                                                                                                                                                                                                                                                                                                    | scalar                                                                                                                                                       |
| `lww-register`    | `set(v)`                                                                                                                                                                                                                                                                                                                                                                                    | `fromJson(v)` with `meta { ts, node, hlc? }`                                                                                                                 |
| `lww-map`         | `set(key, v)` · `remove(key)`                                                                                                                                                                                                                                                                                                                                                               | record; each field `meta { ts, node, tombstone? }`                                                                                                           |
| `mv-register`     | `set(v)`                                                                                                                                                                                                                                                                                                                                                                                    | one version: `fromJson(v)` with `meta.vc`; several: `set` of siblings, ids `s1…` in canonical order, `meta.vc` per item; root `meta.vc` = join (the context) |
| `g-counter`       | `inc(n = 1)`                                                                                                                                                                                                                                                                                                                                                                                | counter `{ rows[node].inc, total }`                                                                                                                          |
| `pn-counter`      | `inc(n = 1)` · `dec(n = 1)`                                                                                                                                                                                                                                                                                                                                                                 | counter `{ rows[node].inc/dec, total }`                                                                                                                      |
| `op-counter`      | `inc(n = 1)` · `dec(n = 1)`                                                                                                                                                                                                                                                                                                                                                                 | scalar total; `expose:['applied']` adds `meta.applied`                                                                                                       |
| `g-set`           | `add(e)`                                                                                                                                                                                                                                                                                                                                                                                    | set; item id = `keyOf(e)`                                                                                                                                    |
| `two-phase-set`   | `add(e)` · `remove(e)`                                                                                                                                                                                                                                                                                                                                                                      | set; removed items stay with `meta.tombstone`                                                                                                                |
| `lww-element-set` | `add(e)` · `remove(e)`                                                                                                                                                                                                                                                                                                                                                                      | set; `meta { addTs, removeTs, tombstone }`                                                                                                                   |
| `or-set`          | `add(e)` · `remove(e)`                                                                                                                                                                                                                                                                                                                                                                      | set; one row per element ever seen here; `meta.tags` (every tag with `alive`), `meta.tombstone` when no tag is alive                                         |
| `rga`             | `insertAfter(anchor, v)` · `insertAt(i, v)` · `delete(id)` · `deleteAt(i)` · `type(anchor, string)` · `deleteRange(fromId, toId)`                                                                                                                                                                                                                                                           | list (`display` from args); item id = element id, `data-value` = id, `meta { ts, node, tombstone }`; `expose:['stats','vc']`                                 |
| `lamport-clock`   | `tick()`                                                                                                                                                                                                                                                                                                                                                                                    | scalar                                                                                                                                                       |
| `vector-clock`    | `tick()`                                                                                                                                                                                                                                                                                                                                                                                    | clock                                                                                                                                                        |
| `hlc`             | `tick()`                                                                                                                                                                                                                                                                                                                                                                                    | record `{ wall, counter }` (rendered "(10:05, 2)")                                                                                                           |
| `doc`             | routed by `path` to the part. `{ set }`: `add(init?)` creates a sub-document whose id is this op's id; every register leaf named in `init` (`Record<field, Scalar>`) gets `set(v)` with the adder's stamp, counters start at 0, nested sets/lists empty; `remove(id)` by sub-document id. `{ list }`: `insertAfter(anchor, init?)` · `insertAt(i, init?)` · `delete(id)`. Leaf ops as above | record/list/set composed from the parts; each part carries its own meta plus `meta.type`                                                                     |

`anchor` for RGA is an element id or `'HEAD'`. `type` and `deleteRange` are lesson-side macros that
expand to one real op per character/element inside the reducer (each gets its own id and message).
`fromJson(v)` (§5.2) turns a register payload into a `Value`: scalar → scalar, array → list with
index ids `0…`, object → record. Receive rules of clocks run through `deliver` (`recv` / `stamp`),
not through `update`.

Semantics (the delivery layer):

- **`crdt.init` / `crdt.doc`** create a replica per listed actor (`state = T.init(actor, args)`),
  apply the seed ops at every replica, and set `holds[slot] = toValue()`. Init on a slot that
  already exists for other actors **adds replicas** (an actor spawned mid-scene); it never resets
  existing ones.
- **Time.** `Ctx.ts` for a `crdt.update` is, in order: `ts` on the command; else the slot's HLC
  (`args.clock`: tick the HLC with wall = actor wall time, stamp = `hlc.wall * 65536 + hlc.counter`,
  valid because 'time' clocks count minutes from `start`); else, for `rga` with `stamp: 'lamport'`
  (the default), `max(ts of every element at this replica, 0) + 1` — a fresh insert outranks every
  concurrent insert it has seen, and two replicas that saw the same elements tie, which is the
  tie-break lesson; else the actor's wall time `clock.now + (actor.skew ?? 0)`. `clock.autoTick`
  advances `now` by 1 before each update whose stamp comes from the wall clock (`lww-register`,
  `lww-map`, `lww-element-set`, `rga` with `stamp: 'clock'`) and never before counters, sets, clocks
  or a Lamport-stamped RGA. Seeds default to `ts: 0` ("the beginning of time"). `tick` is the only
  other way time moves. Ties break inside `src/crdt` (`compareStamp`: higher ts, then higher node
  id) — a teaching moment, never a bug.
- **Ids.** Every `crdt.update` mints exactly one op id `${actor}:${replica.seq + 1}`; `Ctx.nextSeq()`
  returns that same number on its first call (so an OR-Set add's tag, an RGA element id, a doc
  sub-document id and the op id coincide). Should a type call `nextSeq()` more than once in one
  `prepare`, `replica.seq` advances by the count, the op id is the first number, and `version`
  counts seqs. Seeds with `by: <actor>` consume that actor's seq (`alice:1…`); `by: 'seed'`
  (default) mints `seed:1…` and is invisible to version vectors. Two runs of a topic yield
  identical ids.
- **Update** = `op = prepare(state, u, ctx)`; `state' = effect(state, op)`; `log.push`, `pending.push`,
  `version[actor] = seq`, `applied.push(id)`; `holds` refreshed; the actor's `outbox` chips mirror
  `pending` when the slot is declared `wire: 'ops'` (state-driven slots keep `pending` as bookkeeping only). If `toValue()` is unchanged, an `unchanged` mark is added (e.g. a 2P-Set re-add).
- **`crdt.send`** snapshots the sender's state **at this step** into a `{ kind:'state' }` message:
  `mode:'full'` (default) carries the whole state; `mode:'delta'` carries `pending` ops applied to
  `init()` (a small state the same `merge()` accepts; narration says "(simplified)"). Either clears
  `pending`, so a slot is driven either state-style (`send`/`merge`/`sync`) or op-style
  (`broadcast`/`apply`/`sync mode:'ops'`), never both (lint). When `mode` is given explicitly,
  `Message.size` = UTF-8 length of the canonical JSON and the token shows it. The token is drawn
  compact: type chip + a ≤ 24-character value summary (`+n`) + stamp/size badges; the full payload
  sits in `title`/`data-value`. Recipient merges on `deliver`; merging a snapshot that changes
  nothing adds an `unchanged` mark (idempotence, visibly).
- **`crdt.merge` / `crdt.sync`** are the instant forms for scenes where the wire is not the point:
  real `merge()` one way / both ways; `version` = join. Each adds a reducer-generated transient
  `flow` mark between `<from>.<slot>` and `<to>.<slot>` (double-headed for `sync`) and a
  `{ kind:'sync' }` change, so the frame shows that a merge happened; a side that did not change
  gets an `unchanged` mark. Both participants must be online (`ReducerError` otherwise: an instant
  merge implies a connection — use `crdt.send`, which parks). `sync` with `mode:'ops'` instead
  emits `${opId}@${to}` messages for every op in `a.log` that `b.version` lacks and vice versa (by
  node, then seq) — a Yjs-style state-vector exchange — to be applied with `deliver`. Merging a slot
  whose `args.clock` names an HLC runs that HLC's receive rule with the greatest stamp carried.
- **`crdt.broadcast`** turns each `pending` op into one `{ kind:'op' }` message per recipient
  (`to` default: every other actor holding the slot, online or not; offline ⇒ parked). Ids are
  `${opId}@${to}`; `id` overrides the base and is only legal when exactly one op is pending. The
  token's payload is `{ kind:'scalar', value: opLabel(op), meta: { tag: opId, ts, node, tags? } }`
  (`tags` = the tags an OR-Set remove kills). `deliver` of an op message: duplicate
  (`id ∈ applied`) ⇒ no effect + `unchanged` mark; causally not ready (`deps ≰ recipient.version` or
  the creator's previous op in this slot not applied) ⇒ `ReducerError` unless `park:true`; otherwise
  `effect()`, `applied.push`, `version` bump, `log.push`. `deliver` accepts the bare op id (`alice:3`)
  when exactly one live message carries it. Op-based and state-based are the same implementations:
  `or-set` is the "op-based OR-Set" when driven with broadcast/deliver and the state-based one when
  driven with send/merge.
- **`crdt.gc`** drops tombstones (RGA, sets) whose delete op is ≤ `upTo` per node and compacts
  `applied` into `version` (op-counter). With `upTo` the reducer proves `upTo ≤ version` of **every**
  replica of the slot (stability), else throws; `unsafe:true` skips the proof and defaults `upTo` to the
  actor's own version (the "resurrection" lesson). The CRDT side is `T.gc?(state, upTo)`; a type
  without it throws.
- **Errors.** Value commands on CRDT slots, unknown ops, bad arity, unknown message ids, non-resolving
  paths, unready applies, offline instant merges and unprovable gc all throw `ReducerError` with the
  step id and command — caught by `pnpm test`, never by a learner.

### 5.2 Lesson-side view contract (`src/lesson/crdt-view/`)

For every `CrdtName` (and `doc`) there is a `CrdtView`:

```ts
export interface CrdtView<S, O> {
  toValue(state: S, ctx: ViewCtx): Value // sidecar → Meta; ordering rules below
  opLabel(op: O): string // outbox chip / token caption, see formats below
}
export type ViewCtx = {
  actors: ActorId[] // world order; orders per-node rows and clock entries
  replica: Replica // for exposed sidecar: vc, applied, stats
  expose: ReadonlyArray<'vc' | 'applied' | 'stats'>
  display?: 'row' | 'column' | 'text'
}
```

Ordering is part of the contract so Motion never reshuffles rows on a merge: counter rows and clock
entries in `actors` order (then unknown nodes by id); set items by canonical key; list items in
sequence order; map fields by key. Pseudo-node `seed` renders as a dim "init" chip where a node is a
row (counter rows, clock entries); as a value's writer it is hidden with its stamp (`t=0 · init` is
noise — the badge stays in the DOM as an anchor). Inside a composed document the renderer shows a
part's sidecar only where the step points (changed / via / marked, or a mark on the badge path);
the slot caption names the doc's type once. `fromJson(v)` is defined here (§5.1).

`opLabel` formats (every piece is a `t()` key, values interpolated): `inc 1` · `dec 2` · `set Lunch`
· `set title = Q3` · `remove title` · `add milk #alice:1` · `remove milk {alice:1}` ·
`insert "h" after alice:1` · `delete alice:1` · `tick` · doc parts: `add {name: milk} #alice:1` ·
`remove alice:1` · `items[alice:1].qty: inc 1`.

### 5.3 Regex engine (`src/regex/`)

A small backtracking VM drives the regex topics; lessons never hand-set cursors.

```ts
export type EngineState = unknown // src/regex state: compiled program, input, cursors, choice points, captures, tries
export type RegexCommand =
  | { t: 'regex.init'; actor: ActorId; pattern: string; input: string; flags?: string }
  | {
      t: 'regex.advance'
      actor: ActorId
      until: 'step' | 'token' | 'fail' | 'attempt' | 'backtrack' | 'match' | 'end'
    }
```

`regex.init` creates five plain-looking slots on the actor, all written by the engine after every
command (re-`init` on the same actor resets all five): `pattern` (kind `pattern`, tokens `p0…` in
source order, with `cursor`), `text` (kind `text`, with `cursor` and attempt annotations: failed
starts `danger`, consumed spans `ok`, a greedy span `change`), `stack` (list of choice points, ids
`c1…`), `captures` (record), `tries` (meter; `value` = character tests so far). `regex.advance`
runs the VM to the next event: one character test (`step`), the pattern cursor leaving the current
token (`token`: a whole greedy run in one command), the next failed test (`fail`), the next start
position (`attempt`), the next give-back (`backtrack`), the next match, or the end. Value commands
on engine slots throw, like CRDT slots. `pattern` and `input` are data, never localized.

### 5.4 Bytes and UUIDs

UUID bytes are data computed at build time by `src/uuid/` builders and snapshot-tested:
`uuid.v4(rand)` takes 32 hex characters and forces the version/variant bits; `uuid.v7({ ms, rand })`
takes the Unix milliseconds (bytes 0–5) and 20 hex characters for bytes 6–15, then forces the
version/variant bits. Both return `bytes` pre-annotated with ids `time` (v7 only), `ver`, `var`,
`rand`; `unannotate(path)` clears them when the lesson tells its own story. The lesson then uses
`set` (one byte or a range), `annotate`, `unannotate` and `view` (§4.2). No reducer command is needed.

---

## 6. Step semantics

```ts
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
```

`applyStep(prev, step)`:

1. Transient marks (everything not `sticky`, incl. `unchanged`, `flow` and auto highlights) are
   cleared.
2. Commands run in order; each is pure `reduce(world, cmd)` and appends the events it causes
   (`sent`, `delivered`, `parked`, `dropped`, `sync`, value writes with their `via`, and the
   `action` — the operation that caused a write, as a `stage.op.*` label) to the step's
   **event log**.
3. Marks added in this step are resolved against the end-of-step world (§4.4): anchors checked,
   `compare` verdicts computed; sticky marks with vanished anchors are removed.
4. Auto-highlight: every changed value path gets a transient `highlight` (tone `change`,
   `auto: true`) unless the step already marks that path, the command was `quiet`, or
   `autoHighlight: false`. Values that landed via a message flash in the sender's hue with the via
   chip.
5. `changes` (§14) = the event log reconciled with `diffWorld(prev, next)`: value, actor, board,
   layout, clock and mark changes come from the diff (two writes to one path collapse into one
   `changed`; marks are diffed against `prev` with its transient marks already cleared, so only
   real additions and removals appear); message and sync events come from the log, and a message
   that lived and died inside the step is kept with `transient: true`. Each `action` event folds into
   the value change at its path (else the nearest ancestor change, else every change under it) as
   `Change.action`; the last action on a path wins.
6. Transient marks get fresh ids each step (re-issuing a highlight re-pulses it); sticky marks keep
   their id and rest until `clearMarks`/`unmark`.

What is visible in the static frame after a step: all actors/boards/values, every message (flying
on its arc, parked in the inbox tray), every mark (including `flow` arrows and `unchanged` pills),
via chips on values that just landed, action chips on values that just changed (`inc 2`, `add milk
#alice:1`, `merge` …), the outbox chips, the clock HUD / actor clock badges, status badges. Nothing
depends on an animation having played.

---

## 7. Step timing & player

- Hold: `holdMs = (animBudget(changes) + HOLD[step.hold ?? 'normal']) / speed`, with
  `HOLD = { short: 1200, normal: 2200, long: 3600 }` and `animBudget` = 600 ms if any message or
  sync change, 350 ms if any value/actor/layout change, else 0. Under reduced motion `animBudget`
  = 0, holds unchanged.
- Speed multiplier `s ∈ {0.5, 0.75, 1, 1.5, 2, 3}`: every transition duration × 1/s, holds × 1/s.
- Reduced motion (setting or OS): transitions instant; holds unchanged; message tokens render at rest;
  transient tokens (same-step send + deliver) are not drawn — the via chip carries the information.
- Forward steps animate; `prev`, `seek`, load and scene change are instant commits (never animate
  backwards). A scene change cross-fades the whole stage (200 ms, speed-scaled).
- Keyboard: ← → step (mirrored in RTL), space play/pause, Home/End, `.`/`,` speed, Esc pause.
- URL: `?step=n` (1-based), replace-navigation; reload restores the frame.
- Sound: tick per step, bloop on `delivered` (transient flights included), soft poof on `dropped`,
  nothing on `parked`, chord on topic complete (all via `src/sound/`).
- Analytics: `step_view`, `topic_complete`, `speed_change` via `track()`.

---

## 8. Authoring API (builders, `src/lesson/builders.ts`)

Builders are pure constructors: they return the plain data above (or arrays of commands) and never
close over state; no builder result carries a method. The Zod schema validates their output exactly
as it validates hand-written literals. `step()` flattens nested arrays, so macros drop in anywhere
a command goes.

### 8.1 Structure

```ts
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
```

```ts
topic({ id: 'lww-register', title: 'LWW Register', goal, whenToUse: [...], whenNotToUse: [...], realWorld, scenes: [...] })
scene('update-and-merge', { layout: 'pair', clock: { show: true }, actors: [alice({ icon: 'phone' }), bob({ icon: 'laptop' })] }, [
  step('s01', 'An LWW register holds a value and a timestamp.', ...cmds),
  step.long('s09', 'LWW always loses one side of a race.'),
])
scene('tie-break', null, [...], { startFrom: 'update-and-merge' })   // scene(id, world | null, steps, opts?: { title, inContext, startFrom, tryIt })
```

Step ids are explicit strings (`'s01'`), never generated. `step(id, say, ...cmds)` is `hold:
'normal'`; `step.long(...)` / `step.short(...)` set `hold`.

### 8.2 Actors and values

```ts
alice(opts?)  bob(opts?)  carol(opts?)            // person, colours a/b/c; opts: { label, subtitle, icon, holds, online }
server(label = 'Server', opts?)                    // kind server, colour server
service(id, label, color, opts?)                   // kind service ('edge-us', 'US edge', 'a')
device(id, label, opts?)                           // kind device; opts.owner links the hue ('laptop', 'Laptop', { owner: 'alice' }) → "Alice's" caption
board(id, value, { label, tone })                  // free-standing card declared in the world

rec({ title: 'Q3 plan', owner: 'Bob' })            // record of scalars (nestable); rec.tree({...}) sets display 'tree'
list(['bread', 'milk'])                            // list; scalar items ⇒ ids = String(value); Value items ⇒ ids 'i0'…, or list(items, { ids })
sset(['a', 'b'])                                   // set
cnt({ alice: 2, bob: 1 })                          // counter rows (plain, non-CRDT illustration)
clockOf({ alice: 2, bob: 1 })                      // clock value
text('the cat sat')                                // text value
table(['how', 'use'], [row('r1', { how: 'replaces', use: 'LWW register' })])
meter(6, 24, 'values read')
bytes(hex, { display: 'hex' })                     // bytes from a hex string
uuid.v4(rand)  uuid.v7({ ms, rand })               // bytes + time/version/variant/random annotations, computed by src/uuid/ (§5.4)
```

### 8.3 Commands (same names as `t`)

```ts
set('alice.doc.title', 'Q3 plan v2')              patch('bob.likes', { tag: 'alice:1' })
insert('alice.list', 'milk', { index: 1 })        del('alice.list[milk]')   move('bob.inbox[alice:2]', 1)
sort('server.chat', ['@ts', '@node'])             annotate('laptop.id', 48, 52, 'version = 4', { unit: 'bit', tone: 'change' })
unannotate('laptop.id')                           view('laptop.id', 'canonical')
send('alice', 'server', ref('alice.doc'), { id: 'm3', label: 'save', into: 'server.doc' })
send('server', 'bob', 'wait', { id: 'm4' })       // scalar payload = control message
deliver('m3')  deliver('m3', { into: 'server.doc' })   deliver('op4', { park: true })
drop('m1')  duplicate('op1', 'op1-retry')         relay('m-l@icloud', ['phone'])
offline('alice')  online('alice')  status('alice', 'lock')  skew('alice', 5)  tick()  tick(150)
layout('triangle')  layout('ring', { hub: 'client' })
note('rule', 'merge(a, b) = max(a, b)')           spawn(carol())  remove('carol')  removeBoard('rule')
highlight('bob.status@ts')  highlight(['a', 'b'], { tone: 'warn', sticky: true })
callout('server.doc.title', 'last write silently won', { tone: 'warn', sticky: true, id: 'c1' })
conflict('alice.doc.title', 'bob.doc.title')
compare(['alice.A', 'bob.B'], { expect: 'concurrent' })   same('alice.tags', 'bob.tags', 'carol.tags')  // same = compare expect 'equal'
check(path)  cross(path)  clearMarks()  unmark('c1')
expect('alice.likes', 2)                          // DSL assertion; test files that also use Vitest import it as `import { expect as expectEq }`
```

Tone aliases used in content: `bad(path, text?)` = highlight danger (+ callout), `good(path)` =
highlight ok, `tomb(path)` = highlight `path@tomb` warn.

### 8.4 CRDT commands

```ts
crdt.init(['alice', 'bob'], 'status', 'lww-register', { seed: [seed('set', 'Offline')] })
crdt.doc(['alice', 'bob'], 'list', { title: S.lww(), items: S.set(S.map({ name: S.lww(), qty: S.pn() })) }, { seed: [...] })
crdt.update('alice', 'status', 'set', 'In a meeting')          // args spread
crdt.updateAt('alice', 'list', 'items[alice:1].qty', 'inc', 2) // doc part
crdt.send('alice', 'bob', 'status', { id: 'm1', mode: 'delta', label: 'state' })
crdt.broadcast('alice', 'likes', { to: ['server'] })
crdt.merge('bob', 'alice', 'status')   crdt.sync('alice', 'bob', 'status')   crdt.sync('alice', 'server', 'note', { mode: 'ops' })
crdt.gc('alice', 'text', { upTo: { alice: 4, bob: 0, carol: 0 } })
apply('alice:1@bob')   merge('m1')                 // both = deliver(message); readable aliases for op/state messages
seed('set', 'Offline')  seed.by('alice', 'add', 'milk')  seed.at('title', 'set', 'Groceries')  seed.text('alice', 'cat')
// SeedOp helpers; seed.text ⇒ rga type macro anchored at HEAD; by + path ⇒ the literal { by, path, op, args }
```

Typed sugar keeps op names typed per CRDT (a compile error, not a runtime surprise; `doc().at()` is
loosely typed and checked by the dry-run):

```ts
lww('status').set('alice', 'In a meeting')        lwwMap('task').set('bob', 'status', 'Doing')   lwwMap('task').remove('bob', 'due')
maxReg('best').set('alice', 3)                    mvReg('cart').set('alice', 'milk, eggs')
gcounter('views').inc('alice', 2)                 pncounter('likes').dec('alice')   opcounter('likes').inc('alice')
gset('seen').add('alice', 'm1')                   twoPSet('guests').remove('bob', 'dan')
lwwSet('fav').add('alice', 'jazz')                orSet('cart').remove('bob', 'milk')
rga('text').insertAfter('bob', 'alice:1', 'h')    rga('text').type('alice', 'alice:5', ' world')   rga('text').delete('alice', 'alice:1')
vclock('vc').tick('alice')                        lamport('clock').tick('carol')   hlc('hlc').tick('bob')
doc('list').at('items[alice:1].qty').inc('bob', 1)  doc('list').at('items').add('alice', { name: 'milk' })  doc('list').at('items').remove('bob', 'bob:1')
S.lww()  S.lwwMap()  S.pn()  S.g()  S.orSet()  S.rga({ display: 'text' })  S.mvr()  S.const('Lunch?')  S.map({...})  S.list(S.map({...}))  S.set(S.map({...}))
```

### 8.5 Macros (expand at build time; the reducer never sees them)

```ts
syncAll('card', ['alice', 'server'], ['bob', 'server'], ['alice', 'server']) // ordered pair syncs
broadcastState('carol', ['alice', 'bob'], 'views', 'm3') // crdt.send to many + deliver each (transient flights)
allSame('views', ['alice', 'bob', 'carol']) // compare expect 'equal' over <actor>.<slot>
applyAll(['alice:6', 'alice:7', 'alice:8']) // N delivers in one step
sendAndDeliver('alice', 'server', ref('alice.doc'), { id: 'm3', into: 'server.doc' })
```

Macros must expand to the command list a human would write, so goldens and the verify walker see
plain commands.

### 8.6 Narration and paths

- `say` is a single string; the lint (§13) counts sentences and characters. `[text](/crdts/...)`
  renders an in-app link; `**LWW**` marks a first-use term whose definition comes from the glossary.
- `p` is an identity helper that the test suite resolves against the dry-run world:
  `p('alice.list.items[alice:1].qty')`. Typo'd paths fail `pnpm test`, not the learner.

---

## 9. Layout presets

Presets are CSS-grid hints, never pixels. Cards are assigned to slots in insertion order; the hub
slot goes to `layout.hub`, else the first `server`/`service`, else the first actor. Boards live in
a gutter (inline-end column ≥ 1024 px, below the grid under 768 px). Every preset mirrors in RTL via
`direction`; arcs, bolts and tokens are measured, so they follow. `layout` glides cards to their
new slots. Data that reads left-to-right by nature is an LTR island in RTL pages (`<bdi
dir="ltr">`): `bytes` (all displays), `text`, `pattern`, `list display:'text'`, `Dot` ids, clock
HUD/badges.

| preset     | shape                           | typical use                                 |
| ---------- | ------------------------------- | ------------------------------------------- |
| `row`      | n cards in a row                | one or two actors, prototypes, boards-heavy |
| `pair`     | two cards with space between    | two replicas, message arcs                  |
| `triangle` | one on top, two below           | three replicas, gossip                      |
| `hub`      | centre card + up to four around | relay / server topologies                   |
| `ring`     | up to five around a centre      | regions, multi-region databases             |
| `grid`     | auto-fit grid                   | galleries (I.6), many boards                |

---

## 10. Marks

| kind            | anchor                     | drawn as                                                                   | lifetime                     |
| --------------- | -------------------------- | -------------------------------------------------------------------------- | ---------------------------- |
| `highlight`     | paths (or whole card)      | ring pulse in the tone colour; `sticky` keeps the ring                     | transient unless sticky      |
| `callout`       | path / card / msg:id       | bubble with text (localizable)                                             | transient unless sticky      |
| `conflict`      | two paths                  | ⚡ bolt between the anchors                                                | transient unless sticky      |
| `compare`       | 2..n paths                 | `=` / `≠` links (n paths); verdict chip (2 paths): glyph + word, see below | transient unless sticky      |
| `check`/`cross` | path                       | ✓ / ✗ glyph drawn on                                                       | transient unless sticky      |
| `unchanged`     | `<actor>.<slot>`           | "no change" pill                                                           | transient; reducer-generated |
| `flow`          | two `<actor>.<slot>` paths | faint arrow between the slots (double-headed for `sync`)                   | transient; reducer-generated |

Tones: `change` (accent; the default for "this moved"), `info`, `ok`, `warn`, `danger`. Colour is never
the only signal: every tone pairs with an icon or glyph. `compare` verdicts are computed by the
reducer on the end-of-step world, with the first matching rule (`Mark.compare.rule`):

1. `clock` — two `clock` values or two `@vc` selectors → `vcCompare`: before / after / concurrent / equal.
2. `stamp` — two nodes that both carry `meta.ts` and `meta.node` → `compareStamp`: less / greater,
   `equal` only for an identical stamp; the chip shows the reason (`ts 1 < 2`, or `ts = → node`).
3. `number` — two numeric scalars → less / greater / equal.
4. `value` — deep equality of plain values → equal / different.

Verdict chips pair a glyph with a word (`≺ before`, `∥ concurrent`, `< less`); directional glyphs are
bidi-mirrored characters, so RTL needs no special casing. When `expect` is given and disagrees,
`pnpm test` fails (the frame still draws the computed verdict).

---

## 11. Try-it / sandbox hooks

A scene may declare what the sandbox exposes. The sandbox drives the **same reducer** with
user-generated commands starting from the scene's final world; the player runs in `mode: 'sandbox'`
and the stage is unchanged.

```ts
export type TryIt = {
  slot: SlotId
  actors?: ActorId[] // default: every actor holding the slot
  ops: Array<{ op: string; label?: string; args?: 'prompt' | unknown[] }> // e.g. { op: 'add', args: 'prompt' }
  network?: Array<'sync' | 'send' | 'offline' | 'drop'> // which delivery controls to show
}
```

The UI maps each `ops` entry to a button per actor (`args: 'prompt'` asks for a value), `network`
to sync/send/offline/drop buttons; every click becomes a `crdt.update` / `crdt.send` / `deliver` /
`offline` command through the reducer, so the sandbox can never show a state the real code did not
compute. Unit II topics expose exactly the ops their scenes use.

A `TryIt` declaration is optional. Without one, the sandbox derives its controls from the world
(`src/lesson/sandbox/derive.ts`): per replica type — registers `set`, `lww-map` set/remove field,
counters `inc`/`dec`, sets `add`/`remove` (pick an item), `rga` type/delete last, clocks `tick`,
composed documents `set` of their top-level LWW fields — plus `sync(a, b)` per pair of a state-wired
slot, `broadcast` + "deliver all" for an `ops`-wired slot, an offline/online toggle per actor and
`tick` when the clock shows or a type stamps with it. A write whose stamp comes from the wall clock
is preceded by a `tick` unless the scene `autoTick`s (otherwise a sandbox write at the current time
would lose the tie-break and visibly change nothing). The panel (`src/app/components/try-it/`)
starts from the lesson's **current** frame and runs each press as one synthetic step (`x1`, `x2` …)
through `applyStep`; reducer errors are shown inline, never thrown.

**Layout and guidance (v2).** The sheet has three parts: LEFT the live stage (the data) with the
narration of the last action directly under it, RIGHT a narrow actions column, and a **Code** panel
under the narration on demand (a toggle next to it; off by default). Actions read as actions: real
outlined buttons with an icon and a verb-first label (`tryIt.act.*`: "Set status…", "Add to cart…",
"Add 1 to views", "Go offline", "Sync Alice ↔ Bob", "Broadcast cart", "Deliver all"), grouped under
"Alice can…" / "Network"; slot names and types are small captions above each group, never labels.
Stage ≥ ~60% of the width on desktop; below `lg` the parts stack (stage, then actions).

- **Try this** (`src/lesson/sandbox/suggest.ts`, `suggestExperiments(world, tryIt?)`): two or three
  experiments derived from the start world — one per slot by type (registers / lww-map / doc: a
  race; counters: +1 on both, sync, sync again; or-set / lww-element-set: add vs. remove of the same
  item; 2P-set: remove then re-add; g-set: add on both; rga: type on both; clocks: two ticks then
  sync; an ops-wired slot: broadcast then deliver all) plus one partition experiment (go offline,
  change both sides, come back, sync — or, for ops wire, broadcast while offline). Each suggestion
  is a checklist item whose `done(history)` scans the sandbox history (the commands of each step and
  the delivered messages of its change log) for the shape of the experiment, e.g. "writes by two
  actors on the slot, then an exchange of that slot". Copy lives at `tryIt.suggest.*`.
- **Code** (`src/lesson/sandbox/code.ts` + `src/app/components/try-it/crdt-source.ts`): the real
  `src/crdt/*.ts` files are imported as text with Vite `?raw`; `whatRan(frame)` maps the step's
  commands to the functions the reducer called (`crdt.update` → `prepare` + `effect`; `crdt.sync` /
  `crdt.merge` / a delivered state → `merge`; a delivered op → `effect`); `extractFunction(source,
name)` is a tolerant line scanner (free `function name(`, object method `name(...) {`, arrow
  `name: (...) =>`, or a `name: otherFn,` reference followed once; the doc comment above is kept;
  braces are balanced to the end) that falls back to the whole file. The panel prints "This ran:
  `orSet.prepare` → `orSet.effect` · Alice built op alice:3" and the function with its file lines,
  the function body highlighted. Delivery-layer actions (offline, tick, broadcast …) run nothing in
  the CRDT: the panel says so and keeps the last function that did; before anything ran it shows the
  wire's function (`merge` for state, `effect` for ops) as a reference.
- **Entry points**: `<TryIt … renderTrigger={(open) => …}>` lets the page place its own trigger(s);
  `<TryItTrigger onClick={open} />` is the compact flask button (also the default). The sheet is
  always rendered by `<TryIt>`.

---

## 12. i18n hooks

- Narration and every user-visible string inside commands are **localizable fields**:
  `Step.say`, `callout.text`, `note.text`/`label`, `send.label`, `crdt.send.label`,
  `Actor.label`/`subtitle`, `Board.label`, table column labels, `Annotation.label`, `Meta.note`,
  and `TryIt.ops[].label`. Zod marks them, so the extractor (`pnpm i18n:extract`) needs no hand list.
- **Overlays never touch the world.** The world is computed from the authored data in every
  locale; ids, paths, `expect`s and `data-value` keep the authored values. Data values (`'milk'`,
  `'Q3 plan'`) are not localizable fields; a locale that needs a different display label provides a
  render-time map `<topicId>.values.<value>` that relabels scalars at draw time only.
  `regex.init.pattern/input`, `bytes` and anything a range or `expect` points at are data.
- Overlay files (`src/locales/<lang>/<module>.json`) key on stable ids:
  `<topicId>.<sceneId>.<stepId>.say`, `<topicId>.<sceneId>.<stepId>.<t>[<n>].<field>` where `<t>`
  is the command's discriminant and `<n>` its index among the step's commands **of that `t`**
  (inserting an `expect` or a `highlight` never shifts a `callout` key),
  `<topicId>.<sceneId>.world.actors.<actorId>.label`, `<topicId>.whenToUse[<n>]`, etc. A command may
  carry `textId` (allowed on any command with a localizable field) to pin its key.
- Renderer chrome is UI text and goes through `t()` with `stage.*` keys: `opLabel` pieces, "no
  change", "init", status words, "no connection", verdict words, "n ops".
- Step ids never change once published; new steps are appended with the next id.

---

## 13. Validation rules (`pnpm test` fails on any of these)

Schema (Zod, `src/lesson/schema.ts`):

- Every type in this document, discriminated on `t`/`kind` (each `t` unique); unknown keys rejected.
- `Path` grammar (§3); `Dot` shape; ≤ 5 actors per world; ≤ 6 record fields / ≤ 8 visible items;
  label ≤ 12 chars; `say` ≤ 2 sentences and ≤ 160 characters; straight quotes only; `board`/`msg`
  not used as actor ids; scalar `insert` items whose `String(value)` contains `]` rejected; a scene
  has exactly one of `world` / `startFrom`.
- Step ids `s\d\d` unique per scene, zero-padded; scene ids unique per topic; a committed snapshot
  of `<topic>.<scene>.<step>` ids is append-only.

Dry-run (reducer, per topic): `buildTimeline(topic)` must not throw. It checks, at the step where
each command runs: paths resolve (marks: at the end of the step); message ids exist; `crdt.update`
ops/arity match the type; causal readiness on op delivery; `crdt.gc.upTo` provable; `startFrom`
parent has no messages in flight; `send.into`/`deliver.into` agree; `expect` and `compare.expect`
hold; value commands never touch CRDT/engine slots; instant merges have both sides online.

Lints (content style):

- Narration states computed values: every id-, clock- or value-shaped token in `say` (`alice:1`,
  `t=3`, `{alice 2}`, a quoted or code-span value) must appear in the frame's `data-value` text
  (annotation labels, meter text and the HUD count). Plain numbers in prose ("16 bytes") are not
  linted. Code spans and such tokens are removed before sentences are counted, so `a.*b`, `0.5` and
  `alice:1` do not split a sentence. Warning → error once the topic is marked final.
- "Whoops" convention: a step whose `say` starts with "Whoops" carries a `conflict`/`cross`/danger
  mark and is not the last step of its scene ("The fix:" follows).
- `(simplified)` must appear in `say` when a step uses plain values for something a real system
  computes, or `crdt.gc { unsafe }`.
- Glossary: `**Term**` must have a glossary entry; banned-jargon list with the glossary as allow-list.
- Every `send`/`crdt.send`/`crdt.broadcast` message is delivered or dropped before the scene ends.
- Every scene has a `changes`-producing step except deliberately narration-only steps (`do: []`).
- A `compare` whose paths a later command in the same step writes (warning: the verdict is computed
  on the end state); `tick`/`skew` in a scene whose clock is hidden (warning); one slot driven with
  both `crdt.send` and `crdt.broadcast` (warning).

---

## 14. Testing contract

```ts
export type Change =
  | {
      kind: 'value'
      path: Path
      op: 'added' | 'changed' | 'removed' | 'meta'
      via?: MessageId
      action?: ActionLabel // the operation that caused it (drawn as an action chip)
    } // also <actor>@outbox / @inbox
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
/** A translatable operation label: `key` is a `stage.op.*` catalog key, `vars` fills its placeholders,
 *  `by` the acting actor (the local updater, the merge / receive source, an op's creator; absent for
 *  a plain `set`). Keys: inc · dec · set · setField · removeField · add · addTag · remove · removeTags ·
 *  insert · delete · tick · noop · docAdd · docAddEmpty · docRemove · docInsert · docInsertEmpty (the
 *  CRDT op labels of §5.2) plus setPlain · insertPlain · append · deletePlain · deleteRange · move ·
 *  sort · merge · receive. */
export type ActionLabel = { key: string; vars?: Record<string, string | number>; by?: ActorId }
export type Frame = {
  index: number // global across scenes
  sceneId: SceneId
  sceneIndex: number
  step: Step
  world: World
  prev: World // world0 at the first step of a scene (the scene world, or the startFrom parent's end)
  changes: Change[] // ordered event log (§6 step 5)
}
```

- **`Change.action`:** every value write names its operation: `set` / `insert` (`append` at the end,
  `add` into a set) / `delete` / `move` / `sort` → `stage.op.setPlain` … ; `crdt.update` → the op's
  §5.2 label (`inc 1`, `add milk #alice:1`, `insert "h" after alice:1`) on the node the op touched,
  `by` the actor; `crdt.merge` / `crdt.sync` / a delivered state → `merge` on each slot that changed,
  `by` the source; a delivered op → its label `by` its creator; a clock receive → `receive`; a
  `send.stamp` → `tick` on the sender's clock; `deliver … into` → `setPlain` `by` the sender. `patch`,
  `annotate`, `view` carry none.
- **Reducer (Vitest, node):** golden tests per command; error tests (bad paths, CRDT slot writes,
  unknown ids, unready applies); `buildTimeline` for every content topic; property tests: for every
  state type `reduce(crdt.merge)` equals the module's `merge` and merge-order permutations give equal
  `holds`; applying a timeline twice gives deep-equal frames; snapshots of
  `frames.map(f => ({ id: f.step.id, changes: f.changes }))` per topic.
- **Stage (jsdom):** DOM contract — `[data-stage][data-step][data-scene][data-layout]`; actor cards
  `data-actor/data-kind/data-online/data-slot/data-color/data-status`, with `data-inbox` and
  `data-outbox` regions; value nodes `data-path/data-kind/data-value/data-highlight/data-tombstone`;
  tokens `data-message/data-from/data-to/data-state`; marks `data-mark/data-mark-kind/data-verdict`;
  boards `data-board`; narration `data-testid="narration"` with `aria-live="polite"`. One "renders
  every kind" and one "renders meta" test per primitive; RTL and dark snapshots for one topic per unit.
- **Playwright:** `e2e/topics.spec.ts` walks every frame of every topic in Chromium/Firefox/WebKit
  through `window.__lab` (`goto/next/prev/settle/current`) with `?lab=1&motion=off`, asserting
  narration, changed paths and `expect`s; `pnpm verify` screenshots each step to
  `verification/<module>/<unit>/<topic>/NN-<stepId>.png` plus a contact sheet and index (committed).
- **Determinism:** frames are a pure function of the topic module; two users reaching step 7 by any
  path see the same static frame.

---

## 15. Worked examples (final authoring API)

### 15.1 LWW register — `update-and-merge` (II.2)

```ts
import {
  topic,
  scene,
  step,
  alice,
  bob,
  note,
  highlight,
  conflict,
  clearMarks,
  check,
  same,
  tick,
  crdt,
  lww,
  seed,
  merge,
  expect,
} from '@/lesson/builders'

export const lwwRegister = topic({
  id: 'lww-register',
  title: 'LWW Register',
  goal: 'Pick an LWW register for a single field and explain which write wins and why.',
  whenToUse: [
    'Single-value fields where "the newest edit wins" is what users expect (title, status, colour).',
    'The field is set as a whole, not edited inside.',
    'You can give every write a timestamp that is good enough (logical or hybrid; Unit IV).',
  ],
  whenNotToUse: [
    'Two edits should both survive (use a set, a counter, or a sequence).',
    'Device clocks cannot be trusted and losing an edit is costly (Unit IV.1).',
    'The value is long text edited by several people at once (Unit III.5).',
  ],
  realWorld: 'A status line set from phone and laptop; a cell in Cassandra or DynamoDB.',
  scenes: [
    scene(
      'update-and-merge',
      {
        layout: 'pair',
        clock: { show: true },
        actors: [alice({ icon: 'phone' }), bob({ icon: 'laptop' })],
      },
      [
        step(
          's01',
          'An **LWW register** holds a value and a timestamp. The sidecar also remembers who wrote it.',
          crdt.init(['alice', 'bob'], 'status', 'lww-register', { seed: [seed('set', 'Offline')] }),
          highlight(['alice.status@ts', 'alice.status@node']),
        ),
        step(
          's02',
          'The rule: on merge, the newer timestamp wins.',
          note('rule', 'merge: newer ts wins · tie → higher node id'),
        ),
        step(
          's03',
          'Time moves to 1. Alice sets her status; her copy records the value, t=1, node alice.',
          tick(),
          lww('status').set('alice', 'In a meeting'),
          expect('alice.status@ts', 1),
          expect('alice.status@node', 'alice'),
        ),
        step(
          's04',
          'Time 2. Bob sets a different status on the laptop.',
          tick(),
          lww('status').set('bob', 'Lunch'),
          conflict('alice.status', 'bob.status'),
        ),
        step(
          's05',
          'Alice sends her state to Bob.',
          clearMarks(),
          crdt.send('alice', 'bob', 'status', { id: 'm1' }),
        ),
        step(
          's06',
          'Bob compares timestamps: 2 is newer than 1. He keeps Lunch.',
          merge('m1'), // = deliver('m1'); the reducer adds the "no change" pill
          highlight('bob.status@ts'),
          check('bob.status'),
          expect('bob.status', 'Lunch'),
        ),
        step(
          's07',
          'Bob sends his state to Alice. She compares: 2 beats 1, so she takes Lunch.',
          crdt.send('bob', 'alice', 'status', { id: 'm2' }),
          merge('m2'), // same step: a transient flight along the whole arc, then the via chip on Alice's value
          expect('alice.status', 'Lunch'),
        ),
        step(
          's08',
          'Both copies agree, and both carry the same sidecar: t=2, bob.',
          same('alice.status', 'bob.status'), // stamp rule: identical (ts, node) ⇒ equal
          expect('alice.status@node', 'bob'),
        ),
        step.long(
          's09',
          "Alice's status was lost. LWW always loses one side of a race; that is the deal you accept when you pick it.",
        ),
      ],
    ),
  ],
})
```

What the frames show: s01 two cards with `Offline · t=0 · init`; s03 Alice `In a meeting · t=1 · alice`
flashing; s04 a ⚡ bolt between the two values; s05 a compact token on the arc carrying
`LWW · In a meeting · t=1·alice`; s06 the token lands, Bob's card shows a "no change" pill and a ✓;
s07 Alice's value `Lunch` with a via chip (`B`) — the flight itself was transient; s08 `=` links
between the two values.

### 15.2 OR-Set — `tags` (II.9, re-add after a concurrent remove)

```ts
scene('tags', { layout: 'pair', actors: [alice(), bob()] }, [
  step(
    's01',
    'An **OR-Set** remembers, for each element, the tags of the adds that put it there.',
    crdt.init(['alice', 'bob'], 'cart', 'or-set'),
    note('rule', 'add → new tag · remove → drop the tags you have seen · in set = has a live tag'),
  ),
  step(
    's02',
    'Alice adds milk. The add gets the tag alice:1.',
    orSet('cart').add('alice', 'milk'),
    highlight('alice.cart[milk]@tags'),
    expect('alice.cart[milk]@tags', [{ tag: 'alice:1', alive: true }]),
  ),
  step(
    's03',
    'They sync. Bob has milk with tag alice:1.',
    crdt.sync('alice', 'bob', 'cart'), // flow arrow between the two carts; "no change" pill on Alice's side
    same('alice.cart', 'bob.cart'),
  ),
  step(
    's04',
    'Bob removes milk. He has seen alice:1, so he drops alice:1, and milk has no live tag left.',
    clearMarks(),
    orSet('cart').remove('bob', 'milk'),
    tomb('bob.cart[milk]'),
    expect('bob.cart', []),
  ),
  step(
    's05',
    'At the same time, Alice adds milk again. New add, new tag: alice:2.',
    orSet('cart').add('alice', 'milk'),
    highlight('alice.cart[milk]@tags'),
    expect('alice.cart[milk]@tags', [
      { tag: 'alice:1', alive: true },
      { tag: 'alice:2', alive: true },
    ]),
  ),
  step(
    's06',
    "They sync. Bob's remove only covered alice:1, so alice:2 survives and milk is in.",
    clearMarks(),
    crdt.sync('alice', 'bob', 'cart'),
    same('alice.cart', 'bob.cart'),
    highlight('bob.cart[milk]@tags'),
    expect('bob.cart', ['milk']),
    expect('bob.cart[milk]@tags', [
      { tag: 'alice:1', alive: false },
      { tag: 'alice:2', alive: true },
    ]),
  ),
  step.long(
    's07',
    'This is observed remove: you can only remove what you observed. A concurrent add always wins, and no clock was needed.',
  ),
])
```

Every tag shown is minted by `src/crdt/or-set.ts` through the reducer's `Ctx` (`alice:1`, `alice:2`);
the `expect`s pin the narration to the real state. s03 shows a double-headed flow arrow between the
carts; s04 shows milk struck through on Bob's card with tag `alice:1` dimmed; s06 shows both tags on
both cards, `alice:1` dead and `alice:2` alive.

### 15.3 UUID v7 — `time-first` (prototype module `uuids`)

```ts
scene(
  'time-first',
  {
    layout: 'row',
    actors: [
      device('laptop', 'Laptop', {
        holds: { now: rec({ iso: '2026-08-22T10:00:00.000Z', ms: 1787392800000 }) },
      }),
    ],
  },
  [
    step(
      's01',
      'Take the current time as milliseconds since 1970: 1787392800000 (2026-08-22 10:00 UTC).',
      highlight('laptop.now.ms'),
    ),
    step(
      's02',
      'Start with 16 random bytes, like a v4 id.',
      set('laptop.id', bytes('9c017e5502a1e4712d66c0158af34102')), // creates the slot
      annotate('laptop.id', 0, 16, 'random', { tone: 'info', id: 'rand' }),
    ),
    step(
      's03',
      'Write the time as 6 bytes: 01 a0 28 e9 b5 00. They replace the first 6 bytes.',
      unannotate('laptop.id', 'rand'),
      set('laptop.id[0..6]', [0x01, 0xa0, 0x28, 0xe9, 0xb5, 0x00]),
      annotate('laptop.id', 0, 6, 'unix ms (48 bits)', { tone: 'change' }),
      expect('laptop.id[0..6]', '01a028e9b500'),
    ),
    step(
      's04',
      'Byte 6: its top 4 bits become 0111, version 7. Byte 8: its top 2 bits become 10, the variant.',
      view('laptop.id', 'bits', [6, 9]), // bytes 6, 7, 8 expanded ([from, to))
      set('laptop.id[6]', 0x74),
      set('laptop.id[8]', 0xad),
      annotate('laptop.id', 48, 52, 'version = 7', { unit: 'bit' }),
      annotate('laptop.id', 64, 66, 'variant = 10', { unit: 'bit' }),
    ),
    step(
      's05',
      'Everything else stays random: 74 bits.',
      view('laptop.id', 'hex'), // range cleared; bit annotations snap to nibbles in hex
      annotate('laptop.id', 52, 64, 'random', { unit: 'bit', tone: 'info' }),
      annotate('laptop.id', 66, 128, 'random', { unit: 'bit', tone: 'info' }),
    ),
    step(
      's06',
      'Canonical text: 01a028e9-b500-7471-ad66-c0158af34102. The 7 shows the version.',
      view('laptop.id', 'canonical'),
      highlight('laptop.id[6]'),
      expect('laptop.id', '01a028e9b5007471ad66c0158af34102'),
    ),
    step(
      's07',
      'One millisecond later, a new id starts with …b501. The time part is bigger, so the text sorts after.',
      set('laptop.id2', uuid.v7({ ms: 1787392800001, rand: '1122b34455667788990a' })),
      highlight(['laptop.id[5]', 'laptop.id2[5]']),
      expect('laptop.id2', '01a028e9b5017122b34455667788990a'),
    ),
    step.long(
      's08',
      'Anyone who sees a v7 id learns when it was made, to the millisecond. Decide if that is OK before you choose it.',
      callout('laptop.id', 'leaks creation time', { tone: 'warn', sticky: true }),
    ),
  ],
)
```

The bits view (s04) expands bytes 6–8 inline as `0111 0100 · 0111 0001 · 1010 1101` with the
version and variant annotations drawn over the bit groups; `view` back to `hex` (s05) collapses the
range and draws the bit annotations at nibble resolution (the variant and the second random band
share nibble 16 and take separate lanes); `canonical` animates the same 16 bytes into `8-4-4-4-12`
text; `uuid.v7()` computes `id2` in `src/uuid/` at build time (snapshot-tested, with its own
`time`/`ver`/`var`/`rand` annotations), so the lesson never hand-types a wrong byte.

---

## 16. Changes

### 16.1 v0 → v1

Each line: the decision, and why. Gap ids refer to the curriculum stress tests
(`docs/curriculum/unit-1-2.md` G·, `unit-3-4.md` C·, `unit-5-prototypes.md` G·).

**World model**

1. `World` gains `boards`, `replicas`, `engines`, `seq`; `layout` becomes `{ preset, hub? }`;
   `clock` becomes `{ now, show, format, start?, autoTick? }` (U12 G14, U34 C5, U5 G12/G17). The
   renderer needs the hub and the clock format; these are scene facts, not animation.
2. `Actor` gains `subtitle`, `icon`, `owner`, `status`, `skew`, `outbox`; `ActorSpec` is the
   authoring shape with defaults (U12 G7/G13, U34 C5/C15, U5 G16/G18). `tag` chips (U5 G16) fold
   into `subtitle`; "device" stays a kind, `icon` picks the glyph.
3. `Board` (free-standing card) is a first-class world entry addressed as `board.<id>`; `note` is
   sugar that upserts a board (U12 G6, U5 G4). One rendering rule serves rule cards, decision
   tables, schema trees and checklists; `clearMarks` never wipes them.
4. `Message` gains `state` (flying/parked), `into`, `size`, `data`; fan-out ids are `${id}@${to}`
   (U12 G4/G11/G12, U34 C2/C3/C6, U5 G6/G22). The envelope stamp is `payload.meta` — no new field.
5. `Mark` has ids, a `compare` kind with a computed verdict, and a reducer-generated `unchanged`
   kind; `same` is an alias for `compare expect:'equal'` (U12 G5/G10/G16, U34 C4, U5 G7).
6. `Value`: `counter` becomes `{ rows, total }` (PN rows carry `dec`; U12 `@neg` folds into
   `[node]@dec`); `list` gains `display`; `record` gains `display:'tree'` (replaces `tree`); `table`,
   `pattern`, `meter` added; `bytes` gains `display`, `range` and bit-level annotations; `text` uses
   the same `Annotation` shape (U34 C7/C8, U5 G2/G3/G10/G15/G19). MV-Register siblings are a `set`
   with `meta.vc` per item — no `siblings` kind.
7. `Meta` gains `hlc`, `tags` (with alive flags), `addTs`/`removeTs`, `vc`, `applied`, `stats`,
   `type` (U12 G9, U34 C7/C8, U5 G1/G11). No free-form `extra` bag: every key has a renderer.

**Paths**

8. Formal grammar with `board.`/`msg:` roots, `[id]`, `[a..b]` ranges and one sidecar selector
   `@name` (U12 G8/G17, U34 C9/C17). `.meta.key` (U34) and `.cols[key]`/`.text[n]` (U5) fold into
   `@key` and table `.column`/byte `[i]` addressing so the renderer has one lookup.

**Primitive commands**

9. Added: `skew`, `status`, `note`, `remove { board }`, `sort`, `annotate`/`unannotate`, `view`,
   `duplicate`, `relay`, `compare`, `unmark`, `expect`; `delete` takes a full item path (no `id`
   field); `insert` accepts a scalar item and defaults to append; `deliver` gains `park`/`recv`,
   `send` gains `into`/`stamp`; `quiet` on mutating commands and `autoHighlight` on steps
   (stage-architecture §12). `[+]` append and `deliver … outcome:'reject'` were rejected: a missing
   `[id]` creates an item, and a reject is a `cross` plus a reply message.
10. `deliver` is the single receiver: plain payloads land, state snapshots merge, ops apply, clock
    stamps run the receive rule. `crdt.apply` and `crdt.merge { message }` are removed; `apply()` /
    `merge()` builders are readable aliases. One mental model: messages arrive.

**CRDT commands**

11. `crdt.init` accepts a typed `CrdtArgs` (`seed`, `bias`, `nodes`, `clock`, `display`, `expose`) and
    `type:'doc'` with a `CrdtSchema` (`map`/`list`/`set`/`const`/leaf) that `src/crdt/doc.ts` merges
    part by part; `crdt.update` gains `path` (U12 G3, U34 C1, U5 G1). `dict` (dynamic keys) is left
    out until a topic needs it.
12. Time: `ts` = command override › HLC slot (`args.clock`) › actor wall time (`clock.now + skew`),
    with `clock.autoTick` as an opt-in (U12 G1, U34 C5/C20, U5 G12). Ties break in `src/crdt`.
13. Ids: op ids are Dots `${actor}:${seq}` with a dense per-(actor, slot) sequence; every update
    mints exactly one and shares it with the type's own dot (tags, element ids); seeds by a real actor
    consume that actor's seq, the default pseudo-node `seed` does not (U12 G2, U34 C2/C10, U5 G5). The
    `a1`/`b2` short form was rejected: `alice:1` is already what Units III–V narrate and what the
    implementation mints.
14. Wire: `crdt.send` (state or delta snapshot, size computed) and `crdt.broadcast` (ops from the
    outbox, ids `${opId}@${to}`, auto-park at offline actors) create messages; `crdt.merge`/`crdt.sync`
    stay as instant forms; `crdt.sync mode:'ops'` is the state-vector exchange (U12 G4/G11, U34
    C2/C3/C14, U5 G6). `batch` broadcasts were rejected (one op per token keeps frames legible).
15. The reducer is the delivery layer: `Replica` keeps `seq`, `version`, `applied`, `log`, `pending`;
    dedupe, causal readiness (`deps`), `unchanged` marks and `crdt.gc` stability proofs live there
    (U34 C2e/C12/C15, U5 G11/G14). `compact` is `crdt.gc { unsafe:true }`; `expose` publishes
    `vc`/`applied`/`stats` on the slot's meta instead of wrapping the value in a record.
16. New CRDT types: `max-register` (II.1, P1) and a registered `hlc` type; `ew-flag` rejected (use a
    register and say "(simplified)"). RGA gains `type`/`deleteRange` macros and `gc`; `or-set` doubles
    as the op-based OR-Set (U34 C11, U5 G14).

**Domain engines**

17. `regex.init`/`regex.advance` drive a real backtracking VM (U5 G10); UUID bytes come from
    `src/uuid/` builders at build time (U5 G3). No `focus`/zoom command: bits `view` and layout
    presets cover every zoom request (U34 C21, U5 G17).

**Authoring, i18n, testing**

18. Builders (§8) with typed per-CRDT sugar, schema builders, seed helpers and macros; `scene.startFrom`
    replaces long re-creation blocks (U12 G20); `TryIt` is declared per scene (U12 G19, U5 G20).
19. Overlay keys for text inside commands: `<topic>.<scene>.<step>.do[<i>].<field>` with optional
    `textId` (U34 C18, U5 G13); `say` supports links and `**Term**` (U34 C19, U12 term()).
20. Validation and lints (§13) and the `Change`/`Frame` testing contract (§14) are part of the spec,
    so "narration says X, stage shows Y" is a failing test, not a review comment (U5 G8, U34 D.2).

**v0 open questions, answered:** (1) `Value` now covers LWW maps, OR-Set tags, RGA with tombstones,
vector-clock comparison, UUID bit annotation, regex matching, sorting, trees (record display) and
columnar tables; (2) no focus/zoom command; (3) composed documents are `crdt.init type:'doc'`
(renamed `crdt.doc` in v1.1, §16.2) with a schema and path-addressed updates; (4) `TryIt` per
scene, driven through the reducer; (5) the minimum command set is §4–§5 — 41 commands; everything
else is a builder or a macro.

### 16.2 v1 → v1.1

Resolved from the two v1 critiques (`docs/review/critique-author.md` A·, `critique-renderer.md`
R·). Each line: the decision, and why; the one-line log is `docs/review/decisions-log.md`.

**Events, not only diffs**

21. `changes` is the reducer's ordered **event log** reconciled with the world diff (§6, §14). A
    message sent and delivered in one step — the dominant pattern in the scripts (`crdt.send` +
    `merge`, `sendAndDeliver`, `broadcastState`, `relay`) — is kept as `sent` + `delivered` with
    `transient: true`; the renderer flies a transient token along the whole arc and the landing
    shows a via chip (A-H1, R-H1). Forbidding the pattern was rejected: the scripts read as one beat.
    `Change.message` carries the `Message` snapshot (it may be gone from the world);
    `Change.kind:'sync'` added; `Frame.prev` is never null (`world0` at a scene start; R-L2); mark
    changes are diffed after auto-highlighting against `prev` with transients cleared (R-L1).
22. `crdt.merge`/`crdt.sync` leave a trace: a reducer-generated transient `flow` mark between the two
    slots (double-headed for sync) plus the `sync` change; the side that did not change gets
    `unchanged` (R-H2). Both sides must be online, else `ReducerError` (A-M13).

**Marks**

23. Mark anchors are resolved and `compare` verdicts computed on the **end-of-step** world; an
    unresolvable new anchor throws, a vanished sticky anchor removes the mark (A-H2). A compare and
    the merge it motivates go in separate steps (lint warning).
24. `compare` rules in order: clock (`clock` values or `@vc` metas), **stamp** (`compareStamp` over
    `meta.ts`+`meta.node`: the tie-break verdict the RGA/LWW lessons must prove, with the reason in
    the chip), number, value; `Mark.compare.rule` records which fired (A-H3, A-M3, A-L9).
    `Mark.highlight` takes `paths: Path[]` (R-L3). Verdict chips are glyph + word with bidi-mirrored
    glyphs (R-L8). A token's payload is not addressable; compare against the sender's copy (A-M3).

**Messages**

25. Parked messages live in a reserved **inbox tray** on every card, anchored at `<actor>@inbox`
    (new actor selector) and overlay-owned (R-M3). `send.into` is the only destination hint and the
    default for `deliver.into`; no look-ahead from later steps (R-M4). Tokens on one arc stack in
    creation order and collapse into a deck token at ≥ 4 (A-M4, R-M5). State tokens are compact
    (type chip + ≤ 24-char summary + badges) and `crdt.send` takes a `label` (R-M5, A-L8). Op
    tokens carry `{ scalar: opLabel, meta: { tag, ts, node, tags? } }` with fixed label formats
    (A-M5). A control message without `into` flashes the recipient card with the via chip (R-L10).
    `remove actor` emits `dropped`; a message created parked emits `sent` + `parked` (R-L4).
    Generated message ids that collide with a live message throw (A-L5).

**CRDTs**

26. Composed documents: `crdt.doc(actors, slot, fields, args?)` with its own `t:'crdt.doc'` (Zod
    `discriminatedUnion` needs unique `t`; `remove { board }` became `removeBoard` for the same
    reason) and `fields` as the implicit top-level map; `{ set }` parts get `add(init?)` /
    `remove(id)` and `{ list }` parts `insertAfter`/`insertAt`/`delete` with defined leaf seeding
    (A-B1, A-B2, R-M2). `seed.at(path, …)` added (A-L1); `SeedOp.ts` defaults to 0.
27. Time: `rga` stamps are Lamport by default (`args.stamp: 'lamport' | 'clock'` = max ts seen + 1),
    so concurrent inserts at one anchor tie without `tick()` gymnastics and the tie-break lesson is
    writable; `clock.autoTick` is scoped to wall-clock-stamped updates only (A-H4). `lamport-clock`
    / `vector-clock` `tick()` take no count, matching `src/crdt` (R-L14). `nextSeq()` called more
    than once in one `prepare` advances `seq` by the count (R-L14). A slot is state-driven or
    op-driven, not both (A-L13).
28. MV-Register siblings get ids `s1…` in canonical order, the root carries `meta.vc` = join (the
    Dynamo context), and non-scalar register payloads go through `fromJson` (A-M2). RGA
    `display:'text'` draws the id beneath each character (`data-value` = id; A-M9).

**Values and paths**

29. `note` is a `text` board (the 24-char scalar rule would truncate every rule card; R-M1); scalar
    display limit raised to 24, `bytes` canonical exempt (A-M12, R-L7); `text` ≤ 96 chars; badge
    overflow `+n` (R-L9). `bytes.range` is `[from, to)`; `view` without `range` clears it; bit
    annotations over collapsed bytes snap to nibbles; `bits` without range wraps 4 bytes per row;
    annotation lanes are deterministic (A-M10, R-M6, R-L16). `set` creates slots (R-L6, A-L6);
    `list()` accepts Values with `i0…` ids; `sort 'value'` on bytes is bytewise (A-L7). `uuid.v4`/
    `uuid.v7` inputs and pre-annotation ids documented (A-M11). `World.seq` renamed `ids`; `board`/
    `msg` reserved; item ids never contain `]` (R-L15). `ActorSpec.color` optional with derivation
    rules; `device(id, label, opts)` (R-L5). `@cursor` on `text`/`pattern`, `pattern[p0]`, stack
    ids `c1…`; `expect` plain values for text/pattern/meter/`display:'text'` lists (A-M8, A-L11).
30. Regex: `until` gains `token` (a greedy run in one command) and `fail`; `tries` = character tests;
    re-`init` resets the five slots (A-M8).

**Authoring, i18n, lints**

31. No builder result carries a method: `step.long(...)`/`step.short(...)` replace `.hold()`,
    `scene(id, world | null, steps, opts)` replaces `.startFrom()` (A-L2); `merge('m1')` drops the
    redundant actor (A-L3); `compare(paths, opts)` has room for `expect` (A-M14); `tomb(path)` alias
    (A-V4); `expect` keeps its name, test files alias it (A-L4). `scene.world` is optional with
    `startFrom` (R-L15).
32. i18n: overlays never touch the world; a render-time `values` map relabels scalars; ids/paths/
    `data-value` keep authored values (A-M1). Overlay keys index commands per `t`, so an inserted
    `expect` never shifts a `callout` key (A-M6). Chrome strings go through `t()` (R-L12); pattern/
    input/bytes are data (R-L13). RTL LTR-island rule in §9 (A-L10).
33. Lints: the "Whoops" lint keys on the narration prefix, not on `hold:'long'` (every summary step
    failed it; A-H5, R-M7); the number lint covers id/clock/value-shaped tokens only and tokenises
    code spans before counting sentences (A-M7); warnings for compare-then-write, hidden-clock
    `tick`, and mixed state/op sync.
34. Command count: 43 (10 stage, 9 value, 5 message, 8 mark, 1 assert, 8 CRDT, 2 regex).

**Rejected in v1.1:** `push`/`pull` aliases for `crdt.send`+`merge` (A-V3: two names for one thing);
`{ msg, meta }` compare targets (A-M3: the sender's copy is the same data); a ≤ 3-ops-per-broadcast
lint (R-M5: the deck token handles `type`); `by: 'value' | 'state'` on `same` (A-L9: the stamp rule
covers it); a `values` overlay that rewrites the world (A-M1).

---

## 17. Open items (not blocking v1.1)

- `docs/stage-architecture.md` is v0 and contradicts this document on ~15 points (World/Message/
  Mark/Change shapes, `opToValue` vs `opLabel`, path grammar, anchor keys, `data-state`, inbox/
  outbox/board components). It is rebased in the same PR that lands `src/lesson/types.ts` (R-M8).
- `dict` schema node (dynamic-key maps) if a topic needs a Riak-style map of arbitrary keys.
- A `max-register` and `hlc` entry in `src/crdt/index.ts` (small, tracked with the reducer work).
- Whether `verify` should also render one RTL storyboard per unit (currently one topic per unit).
- A locale actually needing the `values` relabel map (§12) — none planned for the first five.
