# Stage + lesson runtime architecture (v1)

Scope: `src/stage/` (world → React + Motion) and `src/lesson/` (types, schema, reducer, timeline,
player). This document is rebased on **`docs/animation-dsl.md` v1.1**, which is authoritative: every
type, command, path form, legibility limit and DOM attribute named here is the spec's; when the two
disagree, the spec wins and this file has a bug. Verified against the installed versions:
**motion 13.1.1** (re-exports framer-motion 13.1.1 / motion-dom 13.1.1 / motion-utils 13.0.0),
**@tanstack/react-router 1.170.x**, React 19, Tailwind v4, Zod 4, shadcn/ui in `src/ui`. No canvas.

## 0. Decisions in one screen

| Concern                                    | Decision                                                                                                                                                                                                                                                                                                                                                                                                  |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unit of rendering                          | A **Frame** `{ index, sceneId, sceneIndex, step, world, prev, changes }` (DSL §14). The stage is a pure function of one frame plus a motion context. `prev` is never null (`world0` at a scene start).                                                                                                                                                                                                    |
| What `changes` is                          | The reducer's ordered **event log** reconciled with `diffWorld(prev, world)` (DSL §6 step 5). Message and `sync` events come from the log (a message that lived and died inside the step is kept with `transient: true`); value / actor / board / layout / clock / mark changes come from the diff.                                                                                                       |
| Forward step (`next`, autoplay)            | Animated. Motion animates the DOM diff; `changes` tells layers what to fly, flash, draw on.                                                                                                                                                                                                                                                                                                               |
| `prev`, `seek`, initial load, scene change | **Instant.** Committed inside `useInstantTransition()` so no in-between animations run. Never animate backwards. A scene change cross-fades the whole stage (200 ms, speed-scaled).                                                                                                                                                                                                                       |
| Actor placement                            | CSS grid per layout preset (`data-layout`), slots assigned in insertion order; `layout.hub` (else first server/service, else first actor) takes the `hub` area. Boards live in a **gutter** (inline-end column ≥ 1024 px, below the grid under 768 px). No pixels in data.                                                                                                                                |
| Overlays                                   | `MessageLayer` (HTML tokens: flying on arcs, parked in inbox trays, transient flights, deck tokens), `MarkLayer` (one absolutely positioned `<svg>`: compare links, conflict bolts, flow arrows, check/cross glyphs), `CalloutLayer` (HTML bubbles, verdict chips, unchanged pills). All read rects from an **anchor registry** keyed by DSL path, measured container-relative.                           |
| Message token                              | HTML `motion.div` on a quadratic arc via CSS `offset-path` + Motion-animated `offsetDistance`. In flight = a stack position (50 %, 42 %, 58 %, …) by creation order on that arc; ≥ 4 tokens on one arc collapse into one **deck token** with a count. Enter `0% → stack`; deliver exit `→ 100%`; park `→ 100%` then glide to `<to>@inbox`; drop exit `→ 70%` + poof. A transient flight runs `0% → 100%`. |
| Values that travel inside one card         | `layoutId` inside a `LayoutGroup` (reorder, sort, a 2P-Set item gaining a tombstone, …). Cross-container travel never uses `layoutId` (§10).                                                                                                                                                                                                                                                              |
| Speed / reduced motion                     | `StageMotionProvider` = `MotionConfig` (`transition`, `reducedMotion`) + `StageMotionContext` (`tr()`, `ms()`, `instant`, `dir`). Primitives never write raw transitions. Under reduced motion transient tokens are not drawn; the via chip carries the information.                                                                                                                                      |
| Determinism for tests                      | `MotionGlobalConfig.skipAnimations = true` in verify/jsdom; `?lab=1&motion=off` installs `window.__lab` and forces instant; `data-*` attributes (DSL §14) expose state.                                                                                                                                                                                                                                   |
| CRDTs                                      | The reducer is the **delivery layer** (`Replica`: `seq`, `version`, `applied`, `log`, `pending`); the data type is `src/crdt/` (`init`, `prepare`/`effect`, `merge`). `holds[slot]` is always `toValue(replica)` from `src/lesson/crdt-view/`; the renderer never reads `world.replicas`.                                                                                                                 |

## 1. Module map

```
src/lesson/
  types.ts              The DSL §2–§6 and §14 types, copied nearly verbatim (World, Actor, Board, Message,
                        Mark, Value, Meta, Path, Command, Step, Scene, Topic, TryIt, Replica, OpRecord,
                        Change, Frame). THE source of truth for every other module.
  schema.ts             Zod mirrors of types.ts (discriminatedUnion on `t` / `kind`; §13 schema rules)
  builders.ts           topic(), scene(), step(), actor/value/command helpers, typed CRDT sugar, macros (§8)
  path.ts               parsePath / formatPath / resolve / getAt / setAt / updateAt (§3 grammar; structural sharing)
  crdt-view/            CrdtView per CrdtName (+ doc): toValue(state, ViewCtx) → Value, opLabel(op) → string (§5.2)
    index.ts fromJson.ts lww-register.ts … rga.ts doc.ts
  reducer/
    index.ts            reduce(world, cmd, ctx) and applyStep(prev, step, ctx) → { world, changes }
    stage.ts values.ts messages.ts marks.ts crdt.ts regex.ts   (one file per §4/§5 command family)
    events.ts           the step-scoped event log (sent / delivered / parked / dropped / sync / via)
    diff.ts             diffWorld(prev, next) + reconcile(log, diff) → Change[]
    timeline.ts         buildTimeline(topic) → Frame[]  (flatten scenes, startFrom, dry-run checks, memo)
    errors.ts           ReducerError (step id + command attached)
  lint.ts               content lints of §13 (narration numbers, Whoops, simplified, delivered-before-end…)
  player/
    machine.ts          pure: (PlayerState, PlayerEvent) → PlayerState
    usePlayer.ts        timers, keyboard, URL sync, onStep / onEvent
    hold.ts             holdMs(frame, speed, reduced)
src/stage/
  Stage.tsx             <Stage frame onEvent />  (root, LayoutGroup, layers)
  motion/
    StageMotionProvider.tsx   MotionConfig + StageMotionContext
    transitions.ts            presets + scaling, tr(), ms()
    useInstantCommit.ts       wraps useInstantTransition (prev/seek)
  geometry/
    AnchorRegistry.tsx        context + useAnchor(path) + useGeometry()
    measure.ts                rectWithin(el, container), arcBetween(a, b), edgePoint(), stackOffset()
  layout/
    StageGrid.tsx  presets.ts  stage.css   (grid-template-areas per preset, gutter, container queries)
  actor/ActorCard.tsx  ActorHeader.tsx  StatusBadge.tsx  OfflineBadge.tsx  ClockBadge.tsx
        InboxTray.tsx  OutboxChips.tsx
  board/BoardCard.tsx  BoardGutter.tsx
  value/ValueView.tsx  Scalar.tsx Record.tsx (card | tree) List.tsx SetView.tsx Counter.tsx Clock.tsx
        Table.tsx Bytes.tsx Text.tsx Pattern.tsx Meter.tsx  MetaBadges.tsx  ViaChip.tsx  truncate.ts
        annotations.ts (lane assignment, nibble snapping)
  message/MessageLayer.tsx  MessageToken.tsx  DeckToken.tsx  TransientFlight.tsx  TokenPayload.tsx
  marks/MarkLayer.tsx (SVG)  CalloutLayer.tsx (HTML)  Highlight.tsx  Callout.tsx  ConflictBolt.tsx
        CompareLinks.tsx  VerdictChip.tsx  FlowArrow.tsx  UnchangedPill.tsx  ActionChip.tsx  CheckCross.tsx
  hud/ClockHud.tsx      corner HUD (counter | ms | time)
  testing/lab.ts        window.__lab installer (dev / VITE_LAB_HOOK builds, and only with ?lab=1)
src/regex/              backtracking VM driven by regex.init / regex.advance (DSL §5.3)
src/uuid/               uuid.v4 / uuid.v7 byte builders used by content at build time (DSL §5.4)
```

Data flow: `content/*.ts` → `buildTimeline(topic)` (memoized per topic) → `frames[]` → player picks
`index` → `<Stage frame={frames[index]} />`. Narration comes from `frame.step.say` through the i18n
overlay keyed by `topic.scene.step`; the stage never reads narration. Renderer chrome strings ("no
change", "init", "no connection", status words, verdict words, `opLabel` pieces, "n ops") go through
`t()` with `stage.*` keys (DSL §12).

## 2. Core types

`src/lesson/types.ts` **is** DSL §2–§6 and §14; nothing here redefines them. The shapes the stage and
player touch most, reproduced from the spec for reference (if these drift from
`docs/animation-dsl.md`, the spec wins):

```ts
export type World = {
  layout: Layout // { preset: LayoutPreset; hub?: ActorId }
  clock: Clock // { now, show, format: 'counter' | 'ms' | 'time', start?, autoTick? }
  actors: Record<ActorId, Actor> // insertion-ordered; ≤ 5 on stage
  boards: Record<BoardId, Board> // insertion-ordered
  messages: Message[] // in flight or parked; order = creation order
  marks: Mark[]
  replicas: Record<ActorId, Record<SlotId, Replica>> // opaque CRDT state (§5.1); renderer never reads it
  engines: Record<ActorId, EngineState> // regex VM state (§5.3)
  ids: number // reducer counter for generated message ids (m1…) and mark ids (k1…)
}

export type Message = {
  id: MessageId
  from: ActorId
  to: ActorId // fan-out creates one Message per recipient (ids `${id}@${to}`)
  payload: Value // what the token shows; payload.meta draws the envelope badges (op id, stamp, size…)
  label?: string
  state: 'flying' | 'parked' // parked = arrived at `to`, not yet applied; drawn in the recipient's inbox tray
  into?: Path // destination hint from send.into (arc endpoint); deliver.into defaults to it — no look-ahead
  size?: number // bytes; set by crdt.send when `mode` is given
  data?: MessageData // opaque to the renderer; consumed by `deliver`
}

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
  | { id: MarkId; kind: 'unchanged'; path: Path } // reducer-generated
  | { id: MarkId; kind: 'flow'; from: Path; to: Path; both?: boolean } // reducer-generated

export type Replica = {
  type: CrdtName | 'doc'
  schema?: CrdtSchema
  args: CrdtArgs
  state: unknown // plain JSON produced only by src/crdt
  seq: number // dense per (actor, slot): the next op id is `${actor}:${seq + 1}`
  version: VectorClock // per node: seq of the latest op applied here
  applied: Dot[] // op ids applied here (dedupe); compacted by crdt.gc
  log: OpRecord[] // every op created or applied here, in application order
  pending: Dot[] // created here, not yet broadcast or sent as a delta (the outbox)
}

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
      message: Message
      transient?: boolean
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
```

Paths follow DSL §3 exactly:

```
Path      := Root Segment* Selector?
Root      := ActorId | 'board.' BoardId | 'msg:' MessageId      ('msg:' takes the rest verbatim)
Segment   := '.' Key | '[' Id ']' | '[' Int '..' Int ']'         (range only on bytes/text, last segment)
Selector  := '@' Name
```

`parsePath(p)` returns `{ root: { kind: 'actor' | 'board' | 'msg'; id }, segs: Seg[], selector?: string }`
with `Seg = { key } | { id } | { range: [from, to] }`; `resolve(world, path)` walks the node kinds of
the §3 table (actor root: slot / `@clock` / `@status` / `@outbox` / `@inbox`; record field; list/set
item by id; counter row by node; table column / row / cell; bytes index or range; text range; pattern
token; `@name` → a `Meta` key, `@cursor`, `@inc`/`@dec` on a counter row). Malformed paths fail the Zod
schema; paths that do not resolve in the world at that step throw `ReducerError` (never a silent no-op).
**Every addressable node renders `data-path` with its canonical path string** — that is also its
anchor-registry key (§4).

## 3. Component tree and layout

```
<StageMotionProvider speed reduced instant dir>          // MotionConfig + StageMotionContext
  <Stage frame onEvent>                                  // position:relative; data-stage data-step data-scene data-layout
    <LayoutGroup id={frame.sceneId}>
      <AnchorRegistryProvider>
        <StageGrid layout={world.layout} actors>         // CSS grid; data-layout; slot per actor (hub → layout.hub)
          {actors.map(a =>
            <ActorCard key={a.id} actor={a}>             // motion.div layout="position"; data-path={a.id}; data-actor…
              <ActorHeader/>                             // icon (kind/icon), label, subtitle, owner caption ("Alice's")
                                                         // + StatusBadge (data-path `${id}@status`), OfflineBadge,
                                                         // ClockBadge when actor.skew is defined (data-path `${id}@clock`)
              {holds.map(([slot, v]) =>
                <ValueView path={`${a.id}.${slot}`} value={v} />)}   // dispatch on v.kind; every node data-path
              <OutboxChips chips={a.outbox} />           // data-outbox; data-path `${id}@outbox`; one chip per pending op
              <InboxTray />                              // data-inbox; data-path `${id}@inbox`; always present (1 token row)
            </ActorCard>)}
        </StageGrid>
        <BoardGutter>                                    // inline-end column ≥ 1024px, below the grid < 768px
          {boards.map(b => <BoardCard key={b.id} board={b} />)}   // data-board; data-path `board.${id}`; ValueView inside
        </BoardGutter>
        <MessageLayer messages changes />                // HTML: MessageToken (flying | parked), DeckToken, TransientFlight
        <MarkLayer marks changes />                      // SVG: CompareLinks, ConflictBolt, FlowArrow, CheckCross
        <CalloutLayer marks changes />                   // HTML: Callout bubbles, VerdictChip, UnchangedPill
        <ClockHud clock />                               // corner HUD when clock.show (counter | ms | time)
      </AnchorRegistryProvider>
    </LayoutGroup>
  </Stage>
</StageMotionProvider>
```

`ValueView` switches on `value.kind` → `Scalar | Record (display card | tree) | List (row | column | text)
| SetView | Counter | Clock | Table | Bytes (hex | bits | canonical | dec) | Text | Pattern | Meter`.
Every value node renders `data-path`, `data-kind`, and for leaves `data-value` (canonical string; the
full value when the display is ellipsized), `data-tombstone` when `meta.tombstone`. Each node calls
`useAnchor(path)`. `MetaBadges` renders `meta` as one quiet muted line (`t2 · bob · alice:1`): `ts` → `t12`
(or `hlc` → `(10:05, 2)` when present), `node` → hue dot + id (`seed` → dim "init"), `tag` → `#alice:3`,
`tags` → ≤ 3 plain tags with alive/dead state (dead: struck through, `+n`), `tombstone` → strikethrough + "deleted", `addTs`/`removeTs`, `vc` compact (`a2 b1`,
full in `title`), `applied` ≤ 3 ids (`+n`), `stats` (`5/7`), `type` chip ("LWW", "OR-Set"), `note`
footnote. Sidecar selectors (`alice.status@ts`, `alice.status@node`, `bob.cart[milk]@tags`,
`alice.cart[milk]@tomb`) are anchors too: each badge renders `data-path` for its key so highlights and
callouts can point at it. `ViaChip` (sender initial
in the sender's hue) sits on a value node whose path has a `via` change this frame; the `ActionChip`
(the operation that changed it — `inc 2`, `add milk #alice:1`, `merge` …, from `Change.action`) is
pinned on the node's top-end corner by the `CalloutLayer` (§5.3).

The sidecar is gated for legibility; a gated badge stays in the DOM, visually hidden (`sr-only`,
`aria-hidden`, `data-hidden=""`), so its anchor and its `data-path` / `data-value` still resolve.
Seed stamps (`node: 'seed'`) hide their `ts` / `hlc` / `node` badges everywhere (`t=0 · init` is
noise). A slot whose nested nodes carry `meta.type` is a composed document (`value/doc.tsx`,
`DocContext`): the card caption names it once (`card · doc`, or the root part's type for a set- /
list-rooted doc), per-part type chips stay hidden, and a node's sidecar shows only where the step
points — the node changed this step (`changedPaths`), landed via a message, carries a mark, or its
parent changed (a freshly added item shows its parts' stamps). A mark or change on a badge's own
path (`alice.card.title@type`, `bob.cart[milk]@tags`) always shows that badge. Atomic slots keep
their sidecar (there, the stamp is the lesson). Counter rows inside a doc draw a step quieter.
`Record` in `display: 'card'` is a `key | value | sidecar` grid (stage.css): rows are subgrids, a
scalar value spans the value + sidecar columns, so keys, values and stamps line up across rows.

`Highlight` reads `marks` via context and decorates the matching nodes (`data-highlight=tone`), so
highlights survive re-layout without measuring. `Board` cards use the same `ValueView` (a `note` is a
`text` board; decision tables are `table`; schema trees are `record display:'tree'`).

### 3.1 Layout presets as CSS grid (`src/stage/layout/stage.css`)

Slots are named `s1…s5` plus `hub`. `slotFor(actor, i, layout)`: in `hub` and `ring`, the hub actor
(`layout.hub`, else the first `server`/`service`, else the first actor) takes `hub`, the others take
`s1…` in insertion order; other presets assign `s{i+1}`. Empty `.` areas leave room for arcs. The
board gutter is a sibling of the grid, not a grid area.

```css
.stage {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto; /* grid | board gutter (empty → collapses) */
  gap: var(--stage-gap);
  container-type: inline-size;
}
.stage-grid {
  display: grid;
  gap: var(--stage-gap);
}
.stage-grid[data-layout='row'] {
  grid-auto-flow: column;
  grid-auto-columns: minmax(0, 1fr);
}
.stage-grid[data-layout='pair'] {
  grid-template-columns: minmax(0, 1fr) minmax(4rem, 12cqw) minmax(0, 1fr);
  grid-template-areas: 's1 . s2';
}
.stage-grid[data-layout='triangle'] {
  grid-template-columns: 1fr minmax(0, 1.1fr) 1fr;
  grid-template-areas: '. s1 .' 's2 . s3';
}
.stage-grid[data-layout='hub'] {
  grid-template-columns: 1fr minmax(0, 1.1fr) 1fr;
  grid-template-areas: 's1 . s2' '. hub .' 's3 . s4';
}
.stage-grid[data-layout='ring'] {
  grid-template-columns: 1fr minmax(0, 1.1fr) 1fr;
  grid-template-areas: '. s1 .' 's4 hub s2' '. s3 .'; /* ≤ 5 actors ⇒ centre + 4 */
}
.stage-grid[data-layout='grid'] {
  grid-template-columns: repeat(auto-fit, minmax(14rem, 1fr));
}
.stage-grid > [data-slot='hub'] {
  grid-area: hub;
}
.stage-grid > [data-slot='s1'] {
  grid-area: s1;
} /* … s2–s5 */
@container (max-width: 56rem) {
  /* narrow: every preset degrades to a 2-column grid; the gutter drops below */
  .stage {
    grid-template-columns: minmax(0, 1fr);
  }
  .stage-grid[data-layout] {
    grid-template-areas: none;
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .stage-grid > [data-slot] {
    grid-area: auto;
  }
}
```

`direction: rtl` mirrors grid areas and the gutter for free; arcs, bolts and tokens are measured, so
they follow. A `layout` command changes `data-layout` (and may change the hub); cards have
`layout="position"` so they glide to their new slots. LTR islands (DSL §9) — `bytes`, `text`,
`pattern`, `list display:'text'`, `Dot` ids, the clock HUD and clock badges — render inside
`<bdi dir="ltr">`.

### 3.2 DOM attributes (the DSL §14 contract, exactly)

| Element                   | Attributes                                                                                                                                          |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| stage root                | `data-stage`, `data-step={step.id}`, `data-scene`, `data-layout` (+ `data-step-index`, `data-instant` for tooling)                                  |
| actor card                | `data-actor`, `data-kind`, `data-online`, `data-slot`, `data-color`, `data-status`; regions `data-inbox`, `data-outbox`; also `data-path={actorId}` |
| value node                | `data-path`, `data-kind`, `data-value` (leaves; canonical string), `data-highlight=tone`, `data-tombstone` (+ `data-hidden` on gated sidecar, §3)   |
| token                     | `data-message={id}`, `data-from`, `data-to`, `data-state=flying\|parked` (+ `data-path=msg:{id}`, `data-transient`, `data-count` on a deck token)   |
| mark                      | `data-mark={id}`, `data-mark-kind`, `data-verdict` (compare)                                                                                        |
| board                     | `data-board={id}`, `data-path=board.{id}`                                                                                                           |
| narration (outside stage) | `data-testid="narration"`, `aria-live="polite"`                                                                                                     |

Attributes in parentheses are extras the tests may use; the unparenthesized set is the contract and
must not change without a spec change.

## 4. Geometry: anchors and measurement

Both overlays need rects of actor cards, value nodes, trays, badges, boards and tokens in
**stage-container coordinates**. Rules:

1. The stage container (`[data-stage]`) is `position: relative; overflow: visible` and is **never
   transformed** (no `layout` prop on it, no CSS transform from the app shell; the sidebar animates
   `width`, not transform).
2. Elements register themselves by their DSL path; the layer measures, not the elements.
3. Measure with `getBoundingClientRect()` minus the container's rect (transforms included, which is
   what we want while cards glide), and re-measure every animation frame while any layout animation
   is in flight. Otherwise measure once per commit + on resize.

The anchor key **is the DSL path** (§3): `alice` (card), `alice.doc.title` (value node),
`alice.status@ts` (a meta badge), `alice@inbox` (tray), `alice@outbox` (chips), `alice@clock`,
`alice@status`, `board.rule`, `board.table[r1].use`, `msg:m1` (a token at rest — flying at its stack
position or parked in a tray). One lookup serves marks, callouts, arcs and via chips; the `path:`/
`actor:` prefixes of v0 are gone.

```tsx
// src/stage/geometry/AnchorRegistry.tsx
import { createContext, useContext, useLayoutEffect, useRef, useSyncExternalStore } from 'react'
import { useAnimationFrame } from 'motion/react'
import type { Path } from '@/lesson/types'

export type Rect = { x: number; y: number; w: number; h: number }
export type AnchorKey = Path // the canonical path string the element renders as data-path

type Registry = {
  els: Map<AnchorKey, Element>
  container: HTMLElement | null
  register(key: AnchorKey, el: Element | null): void
  inFlight: number // layout animations currently running
  setInFlight(delta: number): void
  subscribe(cb: () => void): () => void
  snapshot(): ReadonlyMap<AnchorKey, Rect>
  measure(): void
}

const Ctx = createContext<Registry | null>(null)

export function AnchorRegistryProvider({
  container,
  children,
}: {
  container: React.RefObject<HTMLElement | null>
  children: React.ReactNode
}) {
  const reg = useRef<Registry | null>(null)
  if (!reg.current) reg.current = createRegistry(() => container.current)
  const r = reg.current
  // 1) after every commit (the frame changed, or a child re-rendered)
  useLayoutEffect(() => {
    r.measure()
  })
  // 2) while cards are gliding, track per frame; also 2 settle frames after each commit
  const settle = useRef(0)
  useLayoutEffect(() => {
    settle.current = 2
  })
  useAnimationFrame(() => {
    if (r.inFlight > 0 || settle.current > 0) {
      settle.current = Math.max(0, settle.current - 1)
      r.measure()
    }
  })
  // 3) container / window resize (sidebar toggle animates width → fires continuously)
  useLayoutEffect(() => {
    const el = container.current
    if (!el) return
    const ro = new ResizeObserver(() => r.measure())
    ro.observe(el)
    const onWin = () => r.measure()
    window.addEventListener('resize', onWin)
    document.fonts?.ready.then(() => r.measure())
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', onWin)
    }
  }, [container, r])
  return <Ctx.Provider value={r}>{children}</Ctx.Provider>
}

function createRegistry(getContainer: () => HTMLElement | null): Registry {
  const els = new Map<AnchorKey, Element>()
  const subs = new Set<() => void>()
  let snap: ReadonlyMap<AnchorKey, Rect> = new Map()
  let inFlight = 0
  return {
    els,
    get container() {
      return getContainer()
    },
    register(key, el) {
      if (el) els.set(key, el)
      else els.delete(key)
    },
    get inFlight() {
      return inFlight
    },
    setInFlight(d) {
      inFlight = Math.max(0, inFlight + d)
    },
    subscribe(cb) {
      subs.add(cb)
      return () => subs.delete(cb)
    },
    snapshot: () => snap,
    measure() {
      const c = getContainer()
      if (!c) return
      const cr = c.getBoundingClientRect()
      const next = new Map<AnchorKey, Rect>()
      for (const [k, el] of els) {
        const b = el.getBoundingClientRect()
        next.set(k, { x: b.left - cr.left, y: b.top - cr.top, w: b.width, h: b.height })
      }
      if (!sameRects(snap, next)) {
        snap = next
        subs.forEach((s) => s())
      } // stable snapshot → no re-render storms
    },
  }
}

/** Elements call this; the registry never holds React state for elements. */
export function useAnchor(key: AnchorKey) {
  const r = useContext(Ctx)
  return (el: Element | null) => r?.register(key, el) // pass as ref={…}; React 19 calls with null on unmount
}

/** Layers call this; re-renders only when some rect actually changed. */
export function useGeometry() {
  const r = useContext(Ctx)
  if (!r) throw new Error('useGeometry outside AnchorRegistryProvider')
  return useSyncExternalStore(r.subscribe, r.snapshot, r.snapshot)
}

/** ActorCard wires Motion's layout lifecycle into the registry. */
export function useLayoutInFlight() {
  const r = useContext(Ctx)
  return {
    onLayoutAnimationStart: () => r?.setInFlight(+1),
    onLayoutAnimationComplete: () => r?.setInFlight(-1),
  }
}
```

Why `getBoundingClientRect` and not `offsetLeft` chains: the former follows Motion's projection
transforms, so tokens/arcs track gliding cards. The race "did our layout effect run before or after
Motion applied its first transform" is covered by the two settle frames + in-flight tracking. Scroll
offsets cancel out because both rects are viewport-relative. `sameRects` compares with a 0.5 px
tolerance so sub-pixel jitter does not re-render the layers. A `table` column band (`board.t.price`)
has no box of its own (`<col>` does not lay out), so `Table` registers a zero-width marker in the
header cell and the layer unions it with the last cell of that column.

Arc geometry (shared by arcs, flow arrows and tokens so they stay on one curve):

```ts
// src/stage/geometry/measure.ts
export function edgePoint(r: Rect, toward: Rect) {
  // point on r's border facing `toward`
  const cx = r.x + r.w / 2,
    cy = r.y + r.h / 2,
    tx = toward.x + toward.w / 2,
    ty = toward.y + toward.h / 2
  const dx = tx - cx,
    dy = ty - cy
  const sx = dx === 0 ? Infinity : r.w / 2 / Math.abs(dx),
    sy = dy === 0 ? Infinity : r.h / 2 / Math.abs(dy)
  const s = Math.min(sx, sy)
  return { x: cx + dx * s, y: cy + dy * s }
}
export function arcBetween(a: Rect, b: Rect, bulge = 0.18) {
  const p0 = edgePoint(a, b),
    p1 = edgePoint(b, a)
  const mx = (p0.x + p1.x) / 2,
    my = (p0.y + p1.y) / 2
  const dx = p1.x - p0.x,
    dy = p1.y - p0.y
  const c = { x: mx - dy * bulge, y: my + dx * bulge } // control point offset perpendicular to the chord
  const d = `M ${p0.x} ${p0.y} Q ${c.x} ${c.y} ${p1.x} ${p1.y}`
  const at = (t: number) => ({
    x: (1 - t) ** 2 * p0.x + 2 * (1 - t) * t * c.x + t * t * p1.x,
    y: (1 - t) ** 2 * p0.y + 2 * (1 - t) * t * c.y + t * t * p1.y,
  })
  return { d, p0, p1, c, at }
}
/** Rest position (offsetDistance %) of the i-th token (creation order) on one arc: 50, 42, 58, 34, 66 … */
export function stackOffset(i: number) {
  const k = Math.ceil(i / 2) * 8
  return 50 + (i % 2 === 1 ? -k : k)
}
```

Arc rules (DSL §4.3 "Stacking"): messages between the same pair in **opposite** directions get
opposite bulge signs so the two arcs do not overlap; tokens on the same arc in the same direction take
`stackOffset(i)` by creation order; from 4 tokens on the same arc they collapse into one **deck
token** at 50 % showing a count (`6 ops`, via `t('stage.nOps')`) — the individual `data-message`
elements still exist inside the deck (hidden, for the DOM contract) and `callout('msg:<id>')` anchors
to the deck. The arc endpoint is `message.into` when given (a value node), else the recipient card.

## 5. Animation strategy (Motion 13)

### 5.1 What animates per command / change

| Command / change                                                              | DOM strategy                                           | Motion API                                                                                                                                                                                              |
| ----------------------------------------------------------------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `spawn` / `remove` actor                                                      | card mounts/unmounts                                   | `AnimatePresence` around cards; `initial={{opacity:0, scale:.96}}` / `exit`; siblings glide with `layout="position"`; in-flight tokens to/from it exit as `dropped` (poof)                              |
| `note` / `removeBoard`                                                        | board mounts / changes / unmounts in the gutter        | `AnimatePresence` + `layout="position"`; a replaced note crossfades its text (`AnimatePresence mode="wait"` on the text node keyed by `text`)                                                           |
| `layout` preset / hub                                                         | `data-layout` + `data-slot` change                     | cards `layout="position"` inside `LayoutGroup` (forces siblings to re-measure)                                                                                                                          |
| `set` / `patch` (auto-highlight)                                              | value node text / badge changes                        | `Highlight` ring: `animate={{ opacity:[0,1,.7] }}` once; resting state is the static look; badge `layout` + `AnimatePresence` for appearing badges                                                      |
| `insert` / `delete` / `move` / `sort` (list, set, table)                      | item mount/unmount/reorder                             | items `<motion.li layout layoutId={path}>`; `AnimatePresence mode="popLayout" anchorX={dir==='rtl'?'right':'left'}`; tombstones stay (`data-tombstone`) and only restyle                                |
| `annotate` / `unannotate`                                                     | annotation lane mounts/unmounts under bytes/text       | `AnimatePresence` + `layout` on the lane; lanes are deterministic (sort by `from`, then `id`; first free lane) so two renders stack identically                                                         |
| `view` (bytes)                                                                | display mode changes                                   | each byte cell `layoutId={`${path}[${i}]`}`; `hex`↔`bits` expands the `range`, `canonical` regroups into `8-4-4-4-12`, `dec` relabels; glyphs crossfade (`AnimatePresence mode="popLayout"`)            |
| `send` / `duplicate`                                                          | token mounts                                           | `MessageToken` enters `offsetDistance 0% → stackOffset(i)%`; `duplicate` enters at the original's position                                                                                              |
| `deliver`                                                                     | token unmounts, `into` path changes, via chip          | exit `→ 100%` + fade; destination node flashes in the sender's hue and shows the `ViaChip`; a control message (no `into`) flashes the recipient card                                                    |
| `deliver { park }` / send to an offline actor                                 | token changes `data-state` → `parked`                  | same token: `offsetDistance → 100%` then `x/y` to the `<to>@inbox` rect (two-phase `animate` sequence via keyframes + `times`); static = sitting in the tray                                            |
| `drop`                                                                        | token unmounts                                         | exit `→ 70%`, `scale: 1.4, opacity: 0` (poof); destination does not flash                                                                                                                               |
| `relay`                                                                       | original delivered + copies sent                       | the original's exit + new tokens' enter in one frame (or transient flights, below)                                                                                                                      |
| same-step send + deliver (`transient: true`)                                  | `TransientFlight` mounts for one frame                 | keyed by `${frame.index}:${message.id}`; `offsetDistance 0% → 100%` with `tr('travel')`, then unmount; not drawn under reduced motion / instant — the via chip is the record                            |
| `offline` / `online`                                                          | `data-online`                                          | card `animate={{ opacity: online ? 1 : .55 }}`; "no connection" badge presence                                                                                                                          |
| `status` / `skew`                                                             | badge text / presence                                  | `AnimatePresence` on `StatusBadge`; `ClockBadge` digit flip                                                                                                                                             |
| `tick`                                                                        | clock HUD (+ every clock badge)                        | number flip via `AnimatePresence mode="popLayout"` on the digit; format by `clock.format` (`t3` / `150 ms` / `hh:mm` from `start`)                                                                      |
| `highlight`                                                                   | `data-highlight` on each of `paths`                    | ring pulse (as `set`), persistent when `sticky`                                                                                                                                                         |
| `callout`                                                                     | bubble mounts near anchor (card / value / board / msg) | `AnimatePresence` + `initial={{opacity:0, y:4}}`; on `msg:<id>` it mounts after the token's travel (`ms(TRAVEL_MS)`), instantly under reduced motion                                                    |
| `conflict`                                                                    | SVG bolt between two anchors                           | `<motion.path initial={{pathLength:0}} animate={{pathLength:1}}>` + ⚡ badge at midpoint                                                                                                                |
| `compare`                                                                     | `=`/`≠` links (n paths) or a verdict chip (2 paths)    | links: `motion.path pathLength` draw-on; chip: glyph + word (`≺ before`, `∥ concurrent`, `< less`, `ts 1 < 2`), bidi-mirrored glyphs, `data-verdict`                                                    |
| `check` / `cross`                                                             | glyph at anchor                                        | `motion.path pathLength` draw-on                                                                                                                                                                        |
| `unchanged` (reducer-generated)                                               | "no change" pill at `<actor>.<slot>`                   | `AnimatePresence` + `initial={{opacity:0, scale:.9}}`; transient (one step)                                                                                                                             |
| `Change.action` (any value write: set / insert / crdt op / merge / receive …) | action chip on the changed node's top-end corner       | `ActionChip` in `CalloutLayer` (positioned from the anchor registry): `initial={{opacity:0, y:3, scale:.92}}` with `tr('enter')`; keyed by frame + path so it re-enters each step; transient (one step) |
| `flow` (reducer-generated, `sync` change)                                     | faint arrow between two slots (double-headed)          | `motion.path pathLength` draw-on along `arcBetween(slotA, slotB)`; transient                                                                                                                            |
| `crdt.update` (outbox)                                                        | chip appears in `OutboxChips`                          | `AnimatePresence` + `layout`; `crdt.broadcast` / `crdt.send` empty the chips as tokens take off                                                                                                         |
| `regex.advance`                                                               | pattern/text cursors move, annotations, stack, meter   | cursor caret = a `motion.span layout` child keyed by index; `Meter` width animated with Motion (never CSS transitions)                                                                                  |

`pathLength` is a Motion SVG prop (drives `stroke-dasharray/offset`); `offsetDistance` is an
animatable style (a CSS property on HTML; motion-dom also lists `offsetDistance/offsetPath/
offsetRotate/offsetAnchor` as style properties on SVG). Primitives import from `motion/react`;
`MotionGlobalConfig`, `arc`, `frame` are re-exported from the same entry.

### 5.2 The message token

```tsx
// src/stage/message/MessageToken.tsx
import { useEffect, useMemo } from 'react'
import { motion, AnimatePresence, useIsPresent, usePresenceData, type Variants } from 'motion/react'
import type { Change, Message } from '@/lesson/types'
import { useStageMotion } from '../motion/StageMotionProvider'
import { useStageEvents } from '../Stage'
import { useAnchor, useGeometry } from '../geometry/AnchorRegistry'
import { arcBetween, stackOffset } from '../geometry/measure'
import { TokenPayload } from './TokenPayload'

type Outcome = 'delivered' | 'dropped'
type ExitInfo = Record<string /* MessageId */, Outcome>
const TRAVEL_MS = 600 // must match BASE.travel.duration (single source: transitions.ts)

export function MessageLayer({ messages, changes }: { messages: Message[]; changes: Change[] }) {
  // outcomes of messages that left the world in this frame → consumed by exiting tokens via `custom`
  const exitInfo: ExitInfo = {}
  for (const c of changes) {
    if (c.kind === 'message' && !c.transient && (c.op === 'delivered' || c.op === 'dropped'))
      exitInfo[c.message.id] = c.op
  }
  const { instant } = useStageMotion()
  const stacks = stackIndexes(messages) // per arc (from→to) creation-order index; decks where a stack ≥ 4
  return (
    <div className="pointer-events-none absolute inset-0" aria-hidden>
      <AnimatePresence custom={exitInfo} initial={!instant}>
        {messages.map((m) => (
          <MessageToken key={m.id} message={m} stack={stacks.get(m.id) ?? 0} />
        ))}
      </AnimatePresence>
      {/* same-step send + deliver; nothing under reduced motion */}
      <TransientFlights changes={changes} />
    </div>
  )
}

function MessageToken({ message, stack }: { message: Message; stack: number }) {
  const geo = useGeometry()
  const anchor = useAnchor(`msg:${message.id}`) // marks (callout('msg:m1')) attach to the token at rest
  const { tr, ms, instant } = useStageMotion()
  const emit = useStageEvents()
  const isPresent = useIsPresent() // false once this frame removed the message
  const info = usePresenceData() as ExitInfo | undefined // AnimatePresence `custom`
  const outcome: Outcome = info?.[message.id] ?? 'delivered'
  const rest = `${stackOffset(stack)}%`
  // `exit` cannot be a function; dynamic variants live in `variants` and receive AnimatePresence's `custom`.
  const variants = useMemo<Variants>(
    () => ({
      sent: { offsetDistance: '0%', opacity: 0, scale: 0.9 },
      flying: { offsetDistance: rest, opacity: 1, scale: 1 },
      parked: { offsetDistance: '100%', opacity: 1, scale: 0.9 }, // then InboxTray slot (x/y) — see parkedStyle()
      gone: (ex: ExitInfo) =>
        (ex?.[message.id] ?? 'delivered') === 'dropped'
          ? { offsetDistance: '70%', opacity: 0, scale: 1.5 }
          : { offsetDistance: '100%', opacity: 0, scale: 0.9 },
    }),
    [message.id, rest],
  )
  // Arrival/poof sound: fired when the token *would* land (travel duration, 0 under instant/reduced).
  useEffect(() => {
    if (isPresent) return
    const id = setTimeout(
      () => emit({ t: 'message-gone', message: message.id, outcome }),
      ms(TRAVEL_MS),
    )
    return () => clearTimeout(id)
  }, [isPresent, message.id, outcome, ms, emit])

  const from = geo.get(message.from)
  const to = (message.into && geo.get(message.into)) ?? geo.get(message.to)
  const tray = geo.get(`${message.to}@inbox`)
  if (!from || !to) return null // first paint before measurement; the settle frame fixes it
  const { d } = arcBetween(from, to, bulgeFor(message)) // bulge sign by direction: opposite arcs never overlap (§4)
  const parked = message.state === 'parked'
  return (
    <motion.div
      data-message={message.id}
      data-path={`msg:${message.id}`}
      data-from={message.from}
      data-to={message.to}
      data-state={message.state}
      ref={anchor}
      className="absolute top-0 left-0 will-change-transform" // physical left/top on purpose: overlay coords are measured
      style={{
        offsetPath: `path("${d}")`,
        offsetRotate: '0deg',
        ...(parked ? parkedStyle(tray, stack) : {}),
      }}
      variants={variants}
      initial={instant ? false : 'sent'}
      animate={parked ? 'parked' : 'flying'}
      exit="gone"
      transition={tr('travel')}
    >
      <TokenPayload message={message} />
    </motion.div>
  )
}
```

Notes:

- Static frame correctness: a flying message renders at its stack offset with no animation when
  `instant` (`initial={false}`) or after the enter animation settles; a parked message renders in the
  tray. Resize re-computes `d`; the token stays on the new curve because only `d` changed.
- `exit` accepts only a label or target (`TargetAndTransition | VariantLabels`), so the per-message
  outcome is a dynamic variant (`TargetResolver`) in `variants`, reading `AnimatePresence`'s `custom`
  (`ExitInfo` keyed by message id). One step can deliver one message and drop another.
- The arc endpoint is known while flying because `Message.into` is set by `send.into` at send time
  (no look-ahead, DSL §4.3); exiting children keep their last props.
- Parking is a two-phase move: along the arc to 100 %, then an `x/y` translate to the tray slot
  (`parkedStyle` returns `offsetDistance: '100%'` plus the delta from the arc end to the tray rect,
  which Motion animates with the same `tr('travel')`). A token that arrives at an offline actor is
  created parked: it flies and slots into the tray in one frame. Trays are one token row high by
  default (`min-height`), so parking never resizes the card; beyond 3 parked tokens the tray shows a
  count badge and the extra tokens stack beneath the third.
- The arrival sound is timed by contract, not by callback: `useIsPresent()` flips when the frame
  removed the message, and the token emits `message-gone` after `ms(TRAVEL_MS)` (0 under
  instant/reduced), which equals the exit animation's duration. The page maps `delivered` → bloop,
  `dropped` → soft poof; `parked` makes no sound.
- `TokenPayload` draws `payload` with `MetaBadges` (op id, stamp, `size` when set). For
  `data.kind === 'state'` the token is **compact**: a type chip + a ≤ 24-character value summary
  (`+n`) + stamp/size badges, full payload in `title`/`data-value`. For an op message the payload is
  already `{ scalar: opLabel(op), meta: { tag, ts, node, tags? } }`. Plain payloads use the same
  `ValueView` at chip size, so a delivered value looks identical before and after it lands.
- `TransientFlights` renders, for every `changes` entry `{ kind:'message', transient: true, op:'sent' }`
  whose message also has a `delivered`/`dropped` entry, a `TransientFlight` keyed by
  `${frame.index}:${message.id}` that animates `offsetDistance 0% → 100%` (or `→ 70%` + poof) with
  `tr('travel')` and then unmounts itself; it emits `message-gone` on the same `ms(TRAVEL_MS)` timer so
  the bloop plays. Under reduced motion / instant nothing mounts. The landing flash + `ViaChip` on the
  destination node is driven by the `value` change's `via` (the renderer finds the sender in the
  `Change.message` snapshot), so the **static** frame shows the landed value with the chip.
- `DeckToken` replaces the individual tokens of a stack of ≥ 4: one token at 50 % with the count and
  the shared type chip; the covered tokens render inside it as visually hidden elements so
  `[data-message]` counts still equal `world.messages.length`.

### 5.3 Highlights, conflicts, callouts, compare, flow, unchanged

```tsx
// Three snippets (Highlight.tsx, ConflictBolt.tsx, FlowArrow.tsx) shown side by side.
<>
  {/* Highlight decorates the value node itself; no measuring needed. */}
  <motion.span
    data-highlight={tone}
    className="rounded-[var(--radius)] ring-2 ring-[color:var(--tone)]"
    initial={instant ? false : { opacity: 0 }}
    animate={{ opacity: [0, 1, 0.75] }}
    transition={tr('flash')}
  />

  {/* Conflict bolt is SVG between two measured anchors. */}
  <motion.path
    d={boltPath(a, b)}
    stroke="var(--danger)"
    fill="none"
    strokeWidth={2}
    initial={instant ? false : { pathLength: 0 }}
    animate={{ pathLength: 1 }}
    transition={tr('draw')}
  />

  {/* Flow arrow (crdt.merge / crdt.sync) follows the same arc a token would; double-headed when `both`. */}
  <motion.path
    d={arcBetween(a, b).d}
    stroke="var(--ink-faint)"
    strokeDasharray="4 4"
    markerEnd="url(#arrow)"
    markerStart={both ? 'url(#arrow-rev)' : undefined}
    initial={instant ? false : { pathLength: 0 }}
    animate={{ pathLength: 1 }}
    transition={tr('draw')}
  />
</>
```

- **Compare** with n paths draws `=`/`≠` links between consecutive anchors; with 2 paths it draws a
  `VerdictChip` at the midpoint: glyph + word from `t('stage.verdict.<verdict>')` (`= equal`,
  `≠ different`, `≺ before`, `≻ after`, `∥ concurrent`, `< less`, `> greater`) and, for the `stamp`
  rule, the reason (`ts 1 < 2`, `ts = → node`). Directional glyphs are bidi-mirrored characters, so RTL
  needs no special casing. The chip carries `data-verdict`.
- **Unchanged** pills (`t('stage.noChange')`) sit at the slot anchor's top-end corner; **callouts**
  are positioned by `CalloutLayer` from the anchor rect with a side chosen by available space
  (`start`/`end`/above/below in logical terms).
- **Action chips** (`ActionChip`, drawn by `CalloutLayer`) make every mutation point visible: a value
  change that carries `Change.action` (DSL §14 — `{ key: 'stage.op.*', vars?, by? }`, folded in by the
  reducer) shows `t(key, vars)` — `inc 2`, `set Lunch`, `add milk #alice:1`, `insert "h" after
alice:1`, `append c`, `delete a`, `move b`, `sort`, `merge`, `receive`, `tick` — as a small pill
  (12px medium, hue-soft fill, hue text, 18px tall) pinned at the node's top-end corner: it hangs
  above and outward of the corner, overlapping it by 4px, so it never sits on the value text; it
  flips inward (back over the node's top edge) only when hanging outward would leave the stage or run
  more than a card's padding into another card or a board (`chipSide`); RTL mirrors by itself. The hue
  is the acting actor's (`by`: the local updater, the merge / receive source, the op's creator; the
  accent when nobody acted — a plain `set`), and a tiny lucide icon names the family so colour is
  never the only signal (`plus` inc / add / insert, `minus` dec / remove, `pencil` set, `trash`
  delete, `arrows` move / sort, `merge`, `arrow-down-to-line` receive, `clock` tick, `ban` no-op).
  `StageContext.actions` decides where each chip draws: on its node; on the container when the node
  was removed (a plain `delete` — the node is gone); once on the slot root when one action was folded
  into several nodes of a slot (a `merge` that changed three rows, a `receive` that bumped two clock
  entries, an RGA `type` macro). A check / cross glyph on the same corner pushes the chip clear of it.
  DOM: `data-action` (family), `data-action-key`, `data-action-by`, `data-action-path`, `data-side`.
  Transient by construction (it rides on this step's changes); under `off` it renders at rest.
- Tone colours come from tokens (`--change` maps to `--accent`, others to `--ok/--warn/--danger/--info`);
  the via flash uses the sender's actor hue (`--actor-a` …) **and** the `ViaChip` (sender initial), so
  colour is never the only signal. Icons accompany colour (check, x, bolt, verdict glyph).

### 5.4 `layout` / `layoutId` rules

- Cards: `layout="position"` (size changes snap, position glides) + `layoutDependency={frame.index}` so
  every card re-measures exactly once per step, and `useLayoutInFlight()` handlers.
- Rows/items: `layout` with stable keys (`field.key`, `item.id`, `row.id`, byte index, `token.id`).
  Give radius numerically (`style={{ borderRadius: 8 }}`) on anything that animates size so Motion's
  scale correction applies.
- `layoutId` only for same-card travel (list/set/table reorders, `sort`, bytes regrouping under
  `view`). Use `transition={{ layout: { ...tr('layout'), path: arc({ strength: 0.25 }) } }}` for a
  visible hop (`ValueTransition.path` is supported in 13.x; keep the `arc()` instance module-scoped as
  its docs say — a fresh `arc()` has no continuity memory).
- One `LayoutGroup id={sceneId}` at the stage root; `layoutId`s are the DSL path so they are unique per
  scene.

### 5.5 Bytes, text, pattern, table, meter, record tree

- **Bytes** (`display: hex | bits | canonical | dec`): one cell per byte (`data-path` `x.id[6]`),
  16 per row in `hex`/`dec`; `bits` expands `range` (`[from, to)`) inline as `0111 0100 · …` and, with
  no range, wraps 4 bytes per row; `canonical` groups `8-4-4-4-12` (exempt from the 24-char rule). Bit
  annotations (`unit: 'bit'`) over collapsed bytes snap outward to the nibble, exact bits in `title`.
  Lanes under the bytes are assigned deterministically (sort by `from`, then `id`; first free lane).
- **Text**: ≤ 96 chars wrapped to ≤ 2 lines; a caret at `cursor` (`data-path` `x.text@cursor`);
  annotations (`from`, `to` in chars) as coloured underlines in lanes, labels beneath. `<bdi dir="ltr">`.
- **Pattern**: one chip per `PatternToken` (`data-path` `x.pattern[p2]`, `data-value` = `src`), kind
  styling, a caret at `cursor`.
- **Table**: header row (column labels, localizable), rows by id, cells by key; `data-path` on column
  bands (`board.t.use`), rows (`[r1]`) and cells (`[r1].use`); `sort` animates rows with `layoutId`.
- **Meter**: label + bar; width animated with Motion from `value / max`; `data-value` = value.
- **Record `display: 'tree'`**: indented nodes with connector lines, keyed by field key; same `Record`
  component, different CSS; no re-parenting command exists, so no cross-parent `layoutId`.

### 5.6 Chrome on the card: HUD, badges, tray, chips

- `ClockHud` (top-end corner, `data-clock` / `data-now`) when `clock.show`: a small clock icon, the
  caption "now" and a clear mono readout — `counter` → `t=3`; `ms` → `150 ms`; `time` → `hh:mm` =
  `start` + `now` minutes; the stage reserves its headroom (`--stage-clock-h`, stage.css) and a
  `clock` change flashes behind the readout (`tr('flash')`). `ClockBadge` on an actor whose `skew`
  is defined shows that actor's wall clock (`now + skew`) in the same format, with a `+5`/`−2`
  delta chip (`data-path` `alice@clock`).
- `StatusBadge` = icon + word (`lock` / `waiting` / `busy` / `error`, via `t('stage.status.*')`);
  `OfflineBadge` = "no connection" + dimmed card.
- `OutboxChips` (`data-outbox`, `data-path` `alice@outbox`): one chip per `Actor.outbox` entry, text
  = `opLabel` (`inc 1`, `add milk #alice:3`), hue = actor. `InboxTray` (`data-inbox`, `alice@inbox`):
  an always-present region (zero-height while nothing is parked, one token row while messages are
  parked); parked tokens are overlay-owned and positioned over it (§5.2).

## 6. Speed, reduced motion, instant seeks

Two mechanisms, one provider:

1. `MotionConfig` supplies the default `transition` (scaled by speed; `MotionConfig` spreads into every
   motion component's props, so layout animations pick it up too) and `reducedMotion`.
2. `StageMotionContext` supplies `tr(kind)` / `ms(base)` for primitives that need explicit transitions,
   timers, and the `instant` flag for `initial={false}` decisions.

`reducedMotion` and `skipAnimations` on `MotionConfig` are captured when a motion element **mounts**
(VisualElement constructor), so the provider keys the subtree on those flags — toggling the setting
remounts the stage (cheap: ≤ 5 cards) rather than silently not applying.

```tsx
// src/stage/motion/StageMotionProvider.tsx
import { MotionConfig, useReducedMotion, type Transition } from 'motion/react'
import { createContext, useContext, useMemo } from 'react'

export type TransitionKind = 'travel' | 'settle' | 'layout' | 'flash' | 'draw' | 'enter' | 'exit'
export type StageMotion = {
  speed: number
  reduced: boolean
  instant: boolean
  dir: 'ltr' | 'rtl'
  tr: (k: TransitionKind) => Transition
  ms: (baseMs: number) => number
}
const BASE: Record<TransitionKind, Transition> = {
  travel: { type: 'tween', duration: 0.6, ease: [0.2, 0.8, 0.2, 1] },
  settle: { type: 'spring', visualDuration: 0.32, bounce: 0.15 },
  layout: { type: 'spring', visualDuration: 0.36, bounce: 0.1 },
  flash: { type: 'tween', duration: 0.5, times: [0, 0.3, 1] },
  draw: { type: 'tween', duration: 0.45, ease: 'easeOut' },
  enter: { type: 'tween', duration: 0.25, ease: 'easeOut' },
  exit: { type: 'tween', duration: 0.18, ease: 'easeIn' },
}
const INSTANT: Transition = { type: false } // Motion: `type: false` = instant

export function scaleTransition(t: Transition, speed: number): Transition {
  const s = 1 / speed
  const out: Transition = { ...t }
  if ('duration' in out && typeof out.duration === 'number') out.duration *= s
  if ('visualDuration' in out && typeof out.visualDuration === 'number') out.visualDuration *= s
  if ('delay' in out && typeof out.delay === 'number') out.delay *= s
  return out
}

const Ctx = createContext<StageMotion | null>(null)
export const useStageMotion = () => {
  const v = useContext(Ctx)
  if (!v) throw new Error('StageMotionProvider missing')
  return v
}

export function StageMotionProvider(p: {
  speed: number
  reducedSetting: boolean
  instant: boolean
  dir: 'ltr' | 'rtl'
  children: React.ReactNode
}) {
  const prefers = useReducedMotion() ?? false // OS preference (live)
  const reduced = p.reducedSetting || prefers
  const off = reduced || p.instant
  const value = useMemo<StageMotion>(
    () => ({
      speed: p.speed,
      reduced,
      instant: p.instant,
      dir: p.dir,
      tr: (k) => (off ? INSTANT : scaleTransition(BASE[k], p.speed)),
      ms: (base) => (off ? 0 : base / p.speed),
    }),
    [p.speed, reduced, p.instant, p.dir, off],
  )
  return (
    <Ctx.Provider value={value}>
      {/* key: reducedMotion is read at mount; remount when it flips */}
      <MotionConfig
        key={String(reduced)}
        reducedMotion={reduced ? 'always' : 'user'}
        transition={
          off
            ? INSTANT
            : {
                ...scaleTransition(BASE.settle, p.speed),
                layout: scaleTransition(BASE.layout, p.speed),
              }
        }
      >
        {p.children}
      </MotionConfig>
    </Ctx.Provider>
  )
}
```

Rules for primitives: never write a literal `transition`; call `tr()`. Never use CSS transitions or
animations inside the stage (they would ignore speed and instant). Timers outside Motion use `ms()`.
Speed `s ∈ {0.5, 0.75, 1, 1.5, 2, 3}` scales every duration and every hold by `1/s` (DSL §7).

### 6.1 Instant seeks (`prev`, `seek`, URL load, scene change)

Goal: rendering frame _k_ after frame _n_ must not play _any_ intermediate animation: no token
flights, no layout glides, no exits. Approach: commit the state change inside Motion's
`useInstantTransition()`. It sets `MotionGlobalConfig.instantAnimations = true` (read by every
animation start, including layout animations), blocks the projection update for that commit, forces a
render, runs our callback, and unlocks two frames later. It is a public export of `motion/react`
(`useInstantTransition(): (callback: () => void) => void`), thinly documented; we wrap it once so it
can be swapped for the fallback below.

```ts
// src/stage/motion/useInstantCommit.ts
import { useInstantTransition, MotionGlobalConfig, frame } from 'motion/react'
import { flushSync } from 'react-dom'

export function useInstantCommit() {
  const instant = useInstantTransition()
  return (commit: () => void) => instant(commit)
}

// Fallback (same effect, no hook): use if useInstantTransition misbehaves with React 19 transitions.
export function commitInstantly(commit: () => void) {
  MotionGlobalConfig.instantAnimations = true
  flushSync(commit) // synchronous commit; Motion schedules animations in frame.update
  frame.postRender(() =>
    frame.postRender(() => {
      MotionGlobalConfig.instantAnimations = false
    }),
  )
}
```

The player marks each move with `kind: 'next' | 'prev' | 'seek'`; the topic page dispatches
`prev`/`seek`/`load` through `useInstantCommit()` and `next` normally. `AnimatePresence
initial={false}` is set whenever `instant` is true, so tokens (flying or parked), callouts, pills and
arrows present in the target frame render at rest; `TransientFlights` renders nothing.

Verify/jsdom mode sets `MotionGlobalConfig.skipAnimations = true` at boot (global, affects every
animation including layout) **and** passes `instant` to the provider (so `reducedMotion="always"`
also snaps layout). Belt and braces: the first covers animations started anywhere, the second covers
`initial` rendering and timers.

## 7. The reducer

`reduce(world, cmd, ctx): World` is pure and total (throws `ReducerError` with the step id and command
on misuse — tests catch authoring mistakes, learners never see one). `applyStep(prev, step, ctx)`
adds the step-level behaviour of DSL §6. `buildTimeline(topic): Frame[]` folds scenes.

```ts
// src/lesson/reducer/index.ts
export function applyStep(prev: World, step: Step, ctx: StepCtx): StepResult {
  const log = createEventLog() // sent / parked / delivered / dropped / sync / via, in order (events.ts)
  let w = clearTransientMarks(prev) // 1. everything not sticky, incl. unchanged / flow / auto highlights
  for (const cmd of step.do) w = reduce(w, cmd, { ...ctx, log }) // 2. in order
  w = resolveMarks(w, step, ctx) // 3. anchors checked, compare verdicts computed on the END-OF-STEP world
  w = addAutoHighlights(w, diffValues(prev, w), step, log) // 4. 'change' tone unless marked / quiet / autoHighlight:false
  const changes = reconcile(log.events, diffWorld(clearTransientMarks(prev), w)) // 5. log + diff
  return { world: w, changes }
}

export function reduce(w: World, cmd: Command, ctx: ReduceCtx): World {
  switch (cmd.t) {
    case 'spawn':
    case 'remove':
    case 'removeBoard':
    case 'layout':
    case 'tick':
    case 'skew':
    case 'offline':
    case 'online':
    case 'status':
    case 'note':
      return stage(w, cmd, ctx)
    case 'set':
    case 'patch':
    case 'insert':
    case 'delete':
    case 'move':
    case 'sort':
    case 'annotate':
    case 'unannotate':
    case 'view':
      return values(w, cmd, ctx)
    case 'send':
    case 'deliver':
    case 'drop':
    case 'duplicate':
    case 'relay':
      return messages(w, cmd, ctx)
    case 'highlight':
    case 'callout':
    case 'conflict':
    case 'compare':
    case 'check':
    case 'cross':
    case 'clearMarks':
    case 'unmark':
      return marks(w, cmd, ctx)
    case 'expect':
      return ctx.assert(w, cmd) // checked in tests / the verify walker; never drawn; the world is unchanged
    case 'crdt.init':
    case 'crdt.doc':
    case 'crdt.update':
    case 'crdt.send':
    case 'crdt.broadcast':
    case 'crdt.merge':
    case 'crdt.sync':
    case 'crdt.gc':
      return crdt(w, cmd, ctx)
    case 'regex.init':
    case 'regex.advance':
      return regex(w, cmd, ctx)
  }
}
```

That is the full v1.1 command set: 43 (10 stage, 9 value, 5 message, 8 mark, 1 assert, 8 CRDT,
2 regex). The `switch` is exhaustive over `Command['t']`, so adding a command to `types.ts` without a
reducer case is a type error.

### 7.1 Paths

```ts
// src/lesson/path.ts
export type Seg = { key: string } | { id: string } | { range: [number, number] }
export type Root =
  { kind: 'actor'; id: ActorId } | { kind: 'board'; id: BoardId } | { kind: 'msg'; id: MessageId }
export type ParsedPath = { root: Root; segs: Seg[]; selector?: string }
const ROOT = /^(?:(board)\.([\w-]+)|(msg):(.+)|([a-z][\w-]*))/
const SEG = /\.([\w-]+)|\[(\d+)\.\.(\d+)\]|\[([^\]]+)\]/y
const SELECTOR = /@([A-Za-z]+)$/

export function parsePath(p: Path): ParsedPath {
  const m = ROOT.exec(p)
  if (!m) throw new ReducerError(`bad path "${p}"`)
  if (m[3]) return { root: { kind: 'msg', id: m[4] }, segs: [] } // 'msg:' takes the rest verbatim
  const root: Root = m[1] ? { kind: 'board', id: m[2] } : { kind: 'actor', id: m[5] }
  let rest = p.slice(m[0].length)
  let selector: string | undefined
  const sel = SELECTOR.exec(rest)
  if (sel) {
    selector = sel[1] === 'tomb' ? 'tombstone' : sel[1]
    rest = rest.slice(0, sel.index)
  }
  const segs: Seg[] = []
  SEG.lastIndex = 0
  let s: RegExpExecArray | null
  let at = 0
  while (at < rest.length && (s = SEG.exec(rest))) {
    if (s[1] !== undefined) segs.push({ key: s[1] })
    else if (s[2] !== undefined) segs.push({ range: [Number(s[2]), Number(s[3])] })
    else segs.push({ id: s[4] })
    at = SEG.lastIndex
  }
  if (at !== rest.length) throw new ReducerError(`bad path "${p}"`)
  return { root, segs, selector }
}

// Lenses over the world. `resolve` follows the §3 table by node kind: actor root → slot or @clock/@status/
// @outbox/@inbox; board root → its value; record.key; list/set[id]; counter[node] (@inc/@dec on the row);
// clock.node; table.col / [row] / [row].col; bytes[i] / [a..b]; text[a..b] / @cursor; pattern[pN] / @cursor;
// meter; @name → a Meta key on the node reached. Ranges are valid only as the last segment on bytes/text.
export function resolve(w: World, p: Path): Resolved // throws ReducerError when it does not resolve
export function getAt(w: World, p: Path): Value | undefined
export function setAt(w: World, p: Path, v: Value): World // structural sharing; creates a missing slot / field / item (§4.2)
export function updateAt(w: World, p: Path, f: (v: Value) => Value): World
```

`holds` is keyed by slot (`alice.doc`), so the first segment after an actor root is always a slot.
`set` with a `Scalar` wraps it as `{ kind: 'scalar', value }`, preserving existing `meta` unless the
command provides a full `Value`; `set` on `x.id[6]` replaces one byte, on `x.id[0..6]` a byte range.
`set`/`patch`/`insert`/… on a CRDT or engine slot throw (`slot "doc" is CRDT-managed; use crdt.update`).

### 7.2 CRDT adapter — the delivery layer

`src/crdt/` exposes one module per type implementing `CrdtType<S, U, O, V, A>`: `init(node, args)`,
`update(state, u, ctx)`, `prepare(state, u, ctx) → op`, `effect(state, op)`, `merge(a, b)`,
`value(state)`, with `Ctx = { node, ts, nextSeq() }` (`src/crdt/types.ts`), plus `compareStamp` for
tie-breaks and `gc?(state, upTo)` where a type supports it. `crdtRegistry` maps `CrdtName` → erased
type; `max-register` and `hlc` join the registry with the reducer work (DSL §17). States are plain
immutable data (no classes, no randomness, no `Date.now`), so `world.replicas` is JSON and
snapshot-testable.

The lesson side adds what the stage needs and nothing else:

```ts
// src/lesson/crdt-view/index.ts — per-type projection of replica state into the DSL `Value` tree (DSL §5.2)
export interface CrdtView<S, O> {
  toValue(state: S, ctx: ViewCtx): Value // sidecar → Meta; ordering rules are part of the contract
  opLabel(op: O): string // outbox chip / op-token caption: 'inc 1', 'add milk #alice:3', 'insert "h" after alice:1' …
}
export type ViewCtx = {
  actors: ActorId[] // world order; orders per-node counter rows and clock entries (Motion never reshuffles on merge)
  replica: Replica // for exposed sidecar: vc, applied, stats
  expose: ReadonlyArray<'vc' | 'applied' | 'stats'>
  display?: 'row' | 'column' | 'text'
}
export const views: { [K in CrdtName | 'doc']: CrdtView<unknown, unknown> }
export function fromJson(v: unknown): Value // register payloads: scalar → scalar, array → list (ids 0…), object → record
```

Reducer side (`src/lesson/reducer/crdt.ts`), all deterministic (pseudo-code; the normative text is
DSL §5.1):

```txt
ctxFor(replica, actor, ts)       Ctx whose nextSeq() returns replica.seq + 1 on its first call (and counts further calls);
                                 ts = cmd.ts ?? HLC slot (args.clock) ?? lamport (rga default: max element ts here + 1)
                                 ?? actor wall time (clock.now + skew); autoTick advances clock.now first when the stamp is wall-clock
crdt.init / crdt.doc             per actor (adds replicas for actors that lack one, never resets): state = T.init(actor, args);
                                 apply args.seed as already-delivered ops (by 'seed' → seed:n, invisible to version; by actor → that seq);
                                 holds[slot] = toValue()
crdt.update                      op = T.prepare(state, u, ctx); state' = T.effect(state, op);
                                 id = `${actor}:${seq+1}`; replica.{seq, version[actor], applied, log, pending} updated;
                                 holds refreshed; actor.outbox = pending.map(chip);  toValue unchanged ⇒ `unchanged` mark
                                 ('type' / 'deleteRange' on rga expand to one real op each, here)
crdt.send                        Message { data: { kind:'state', slot, state: full | delta(pending → init()), version }, size when mode given,
                                 payload: compact summary }, one per recipient (`${id}@${to}`); pending = []; offline recipient ⇒ parked
crdt.broadcast                   one { kind:'op' } Message per pending op per recipient (`${opId}@${to}`), payload
                                 { scalar: opLabel(op), meta: { tag, ts, node, tags? } }; pending = []; offline ⇒ parked
deliver (in messages.ts)         data none  → payload written to `into` (or card flash via chip);   log: delivered + via
                                 kind:'state' → state' = T.merge(state, carried); version = join; unchanged ⇒ `unchanged` mark
                                 kind:'op'   → id ∈ applied ⇒ `unchanged`; deps ≰ version or predecessor missing ⇒ ReducerError unless park;
                                               else T.effect, applied.push, version bump, log.push
                                 kind:'stamp' / recv → the clock slot's receive rule
crdt.merge / crdt.sync           both online else ReducerError; T.merge one way / both ways; version = join;
                                 transient `flow` mark (both for sync) + log.sync; unchanged side ⇒ `unchanged` mark;
                                 sync mode:'ops' → emits `${opId}@${to}` messages for ops the other side lacks (by node, then seq)
crdt.gc                          upTo provable against every replica's version (or unsafe:true) → T.gc(state, upTo); applied compacted
```

Ids are Dots `${actor}:${seq}` with a dense per-(actor, slot) sequence; every `crdt.update` mints
exactly one and shares it with the type's own dot (OR-Set tag, RGA element id, doc sub-document id).
Two runs of a topic produce identical ids, tags and messages. `holds[slot]` is recomputed from the
replica after any CRDT command or delivery; the renderer never reads `replicas`.

### 7.3 Events, diff and auto-highlight

- `events.ts` is the step-scoped **event log**: `messages.ts` and `crdt.ts` append `sent`, `parked`,
  `delivered`, `dropped` (each with the `Message` snapshot as it was when the event fired) and `sync`;
  `deliver` also records `via` per written path. `remove actor` appends `dropped` for every in-flight
  message to/from it.
- `diffWorld(prev, next)` walks `holds` per actor and `boards`, keyed by `field.key` / `item.id` /
  counter node / clock node / table row & column / byte index; leaves compare `(kind, value, meta)`.
  It emits `value` changes with the deepest changed path (a field whose scalar changed → that field; a
  new list item → the item path; meta-only → `op: 'meta'`); outbox / inbox changes are `value`
  changes on `<actor>@outbox` / `<actor>@inbox`. Actors (incl. `status`/`skew`), boards and marks
  diff by id; `layout` and `clock` by value. Marks are diffed against `prev` **with its transient
  marks already cleared**, so only real additions and removals appear.
- `reconcile(log, diff)`: message and `sync` changes come from the log (a message that lived and died
  inside the step keeps both events with `transient: true`); everything else from the diff; `via` is
  copied onto the matching `value` changes; two writes to one path collapse into one `changed`.
  `action` events (`{ kind: 'action', path, label }`, pushed by `set` / `insert` / `delete` / `move`
  / `sort`, by `crdt.update` on the node the op touched (`actions.ts` diffs the slot's `holds` around
  the op: `alice.views[alice]`, `alice.cart[milk]`, `alice.note[alice:3]`; an RGA macro pushes one
  summary label on the slot), by `crdt.merge` / `crdt.sync` / a delivered state (`merge`, on every
  slot that changed, `by` the source), by a delivered op (the op's own label, `by` its creator), by
  a clock receive (`receive`) and a `send.stamp` tick (`tick`), and by `deliver … into` (`setPlain`))
  fold into the `value` change at their path, else the nearest ancestor change (a `move` rewrites the
  container), else every change under the path (a whole-slot merge); the last action on a path wins.
- `addAutoHighlights` adds `{ kind: 'highlight', tone: 'change', auto: true, paths: [path] }` for each
  changed value path unless the step already marks that path (highlight / check / cross / conflict /
  compare), the command carried `quiet: true`, or the step declares `autoHighlight: false`. Values that
  landed via a message flash in the sender's hue with the via chip (renderer) — still one auto mark.
- Transient marks get fresh ids each step (re-issuing a highlight re-pulses it); sticky marks keep
  their id and rest until `clearMarks` / `unmark`; a sticky mark whose anchor vanished is removed by
  `resolveMarks` with a `mark removed` change.

`changes` is the contract between reducer and renderer/tests: the renderer reads `message` changes
for exit outcomes and transient flights, `value.via` for landing flashes, `sync` for flow arrows'
timing, `actor` changes for spawn emphasis; tests assert on `changes` without rendering; the player
uses them for sound and hold budgeting.

### 7.4 Timeline

```ts
export function buildTimeline(topic: Topic): Frame[] {
  const frames: Frame[] = []
  const ends = new Map<SceneId, World>() // final world per scene, for startFrom
  for (const [sceneIndex, scene] of topic.scenes.entries()) {
    const world0 = scene.startFrom
      ? inherit(ends.get(scene.startFrom)) // parent's end: marks cleared; throws if it has messages in flight
      : initWorld(scene.world) // ActorSpec defaults, boards, clock defaults, layout
    let world = world0
    for (const step of scene.steps) {
      const { world: next, changes } = applyStep(world, step, ctx(topic, scene, step))
      frames.push({
        index: frames.length,
        sceneId: scene.id,
        sceneIndex,
        step,
        world: next,
        prev: world, // never null: world0 at the first step
        changes,
      })
      world = next
    }
    ends.set(scene.id, world)
  }
  return frames
}
```

Memoized per topic module (`WeakMap<Topic, Frame[]>`); cheap enough to rebuild in tests. There is
**no look-ahead**: `state[n] = reduce(world0, steps[0..n])`, so the sandbox (same reducer, user
commands) and the lesson draw the same arcs. `buildTimeline` is also the dry-run of DSL §13: it
throws on non-resolving paths, unknown message ids, bad op arity, unready applies, unprovable `gc`,
disagreeing `send.into`/`deliver.into`, failed `expect`/`compare.expect`, value commands on CRDT or
engine slots, offline instant merges, and a `startFrom` parent with messages in flight.

## 8. Player

```ts
// src/lesson/player/machine.ts
export type Speed = 0.5 | 0.75 | 1 | 1.5 | 2 | 3
export type MoveKind = 'next' | 'prev' | 'seek'
export type PlayerState = {
  index: number
  total: number
  status: 'paused' | 'playing' | 'ended'
  speed: Speed
  mode: 'lesson' | 'sandbox' // sandbox: Try-it drives the same reducer from the scene's final world (DSL §11)
  move: { kind: MoveKind; seq: number } // how we got to `index`; seq bumps per move (effects key on it)
}
export type PlayerEvent =
  | { t: 'next'; source: 'user' | 'auto' }
  | { t: 'prev' }
  | { t: 'seek'; index: number }
  | { t: 'play' }
  | { t: 'pause' }
  | { t: 'toggle' }
  | { t: 'setSpeed'; speed: Speed }
  | { t: 'load'; total: number; index: number }

export function transition(s: PlayerState, e: PlayerEvent): PlayerState {
  const last = s.total - 1
  const go = (index: number, kind: MoveKind) => ({
    ...s,
    index,
    move: { kind, seq: s.move.seq + 1 },
  })
  switch (e.t) {
    case 'load':
      return {
        ...s,
        total: e.total,
        index: clamp(e.index, 0, e.total - 1),
        status: 'paused',
        move: { kind: 'seek', seq: s.move.seq + 1 },
      }
    case 'next':
      if (s.index >= last) return s.status === 'playing' ? { ...s, status: 'ended' } : s
      return go(s.index + 1, 'next')
    case 'prev':
      return s.index === 0
        ? s
        : { ...go(s.index - 1, 'prev'), status: s.status === 'ended' ? 'paused' : s.status }
    case 'seek':
      return e.index === s.index ? s : { ...go(clamp(e.index, 0, last), 'seek'), status: 'paused' }
    case 'play':
      return s.index >= last ? { ...go(0, 'seek'), status: 'playing' } : { ...s, status: 'playing' }
    case 'pause':
      return { ...s, status: 'paused' }
    case 'toggle':
      return transition(s, { t: s.status === 'playing' ? 'pause' : 'play' })
    case 'setSpeed':
      return { ...s, speed: e.speed }
  }
}
```

`usePlayer(frames, { onStep, onEvent })`:

- **Autoplay timer** (`hold.ts`, DSL §7): `useEffect([status, index, speed, move.seq])` → if playing,
  `setTimeout(next/auto, holdMs(frame, speed, reduced))` with
  `holdMs = (animBudget(frame.changes) + HOLD[step.hold ?? 'normal']) / speed`,
  `HOLD = { short: 1200, normal: 2200, long: 3600 }`, `animBudget` = 600 ms if any `message` or `sync`
  change, 350 ms if any value / actor / board / layout change, else 0; under reduced motion
  `animBudget = 0`, holds unchanged. Timer cleared on any state change.
- **Dispatch routing**: `next` → plain `dispatch`; `prev`/`seek`/`load` → `useInstantCommit()(…dispatch)`.
  The stage receives `instant = move.kind !== 'next' || motionOff`.
- **Keyboard** (topic page scope; ignored when focus is in inputs/`contenteditable` or a Radix dialog is
  open): `ArrowRight/ArrowLeft` = next/prev in LTR, swapped in RTL (matches the mirrored transport
  buttons), `Space` = toggle, `Home/End` = first/last, `.`/`,` = speed up/down, `Escape` = pause.
- **URL sync**: the topic route declares `validateSearch` with Zod
  (`{ step: z.coerce.number().int().min(1).optional(), lab: z.literal('1').optional(), motion: z.literal('off').optional() }`).
  On mount: `load({ index: (search.step ?? 1) - 1 })`. On index change:
  `navigate({ search: (s) => ({ ...s, step: index + 1 }), replace: true })` (replace, so Back leaves the
  topic instead of un-stepping). Back/forward that changes `step` externally dispatches `seek`. URL
  `step` is 1-based; code is 0-based. `?lab=1` installs `window.__lab` (dev / `VITE_LAB_HOOK` builds);
  `?motion=off` forces `instant` for the session (global `skipAnimations` + provider flag).
- **Sound** (`src/sound/`, DSL §7): `onStep(frame, move)` after commit → `sound.tick()` (not on `load`);
  stage `onEvent` (`StageEvent = { t: 'message-gone'; message: MessageId; outcome: 'delivered' | 'dropped' }`,
  provided to primitives via `useStageEvents()`, fired by real and transient flights alike) →
  `sound.bloop()` on `delivered`, soft poof on `dropped`, nothing on `parked`; `status → 'ended'` →
  `sound.chord()`.
- **Analytics** (`track()` from `src/analytics/`): `step_view` `{ topic, step: step.id, source }` per
  step, `topic_complete` on `ended`, `speed_change` on `setSpeed` (which also writes the settings
  store). The progress store marks the step seen.
- **Scene change**: when `frames[index].sceneId` differs from the previous, the `<Stage key={sceneId}>`
  remounts (always an instant commit) with a 200 ms cross-fade of the whole stage (that one transition
  is allowed at the shell level and respects `ms()`).
- **Sandbox**: `mode: 'sandbox'` appends user-generated commands (from the `TryIt` buttons) to a
  scratch step list starting at the scene's final world and runs `applyStep` live; the stage is
  unchanged.

Determinism: `frames` is immutable; `index` → frame; `move.kind` → animated or not. Two users who
reach step 7 by any path see the same static frame; only the transition into it differs.

## 9. Testing (the DSL §14 contract)

### 9.1 Reducer / timeline (Vitest, node)

- Golden tests per command on a fixture world; error tests for bad paths, CRDT/engine-slot writes,
  unknown message ids, unready applies, offline instant merges, unprovable `gc`.
- `buildTimeline(topic)` for every content topic: no throws; `changes` non-empty for every step except
  narration-only steps (deliberately `do: []`); every `send`/`crdt.send`/`crdt.broadcast` message is
  delivered or dropped before scene end; every `expect` and `compare.expect` holds.
- Property tests (fast-check): for every state type `reduce(crdt.merge)` equals the module's `merge`
  directly, and merge-order permutations yield equal `holds`; applying a timeline twice yields
  deep-equal frames (determinism of ids, tags, marks).
- Snapshot `frames.map(f => ({ id: f.step.id, changes: f.changes }))` per topic (small, reviewable
  diffs; transient message events and `sync` events included).
- `lint.ts` runs the §13 content lints over every topic (narration numbers against the frame's
  `data-value` text, "Whoops", `(simplified)`, glossary, warnings) — warnings become errors once a
  topic is marked final.

### 9.2 Stage in jsdom (Vitest + Testing Library)

`src/test/setup.ts` adds `ResizeObserver` and `matchMedia` stubs and sets
`MotionGlobalConfig.skipAnimations = true`. Render
`<StageMotionProvider speed={1} reducedSetting instant dir="ltr"><Stage frame /></StageMotionProvider>`
and assert the DOM contract of §3.2: `[data-path="alice.doc.title"]` has `data-value="Draft"`,
`[data-highlight]` on changed paths, `[data-message]` count equals `world.messages.length` with the
right `data-state`, `[data-inbox]`/`[data-outbox]` present on every card, `[data-board]` per board,
`[data-mark-kind="compare"][data-verdict]`, actor cards carry the right `data-slot` for the preset.
`getBoundingClientRect` is zero in jsdom, so geometry-dependent assertions (arc `d`, stack offsets)
use an injected fake registry snapshot. Every primitive gets one "renders every kind" test and one
"renders meta" test (badges, tombstones, `+n` overflow, LTR islands); one RTL and one dark snapshot
per unit.

### 9.3 Playwright (`e2e/`)

- `e2e/topics.spec.ts` (Chromium/Firefox/WebKit): for each topic, load
  `/en/<module>/<unit>/<topic>?step=1&lab=1&motion=off`, walk every frame with `window.__lab`, assert
  narration, changed paths and `expect`s. Node-side code imports the same content + `buildTimeline` to
  cross-check `total` and the canonical `data-value` strings, so the browser and the reducer must
  agree.
- `e2e/verify.spec.ts` (project `verify`, Chromium only, 1280×800, DPR 1,
  `emulateMedia({ reducedMotion: 'reduce' })`): same walk, plus
  `page.locator('[data-stage]').screenshot({ animations: 'disabled' })` per step to
  `verification/<module>/<unit>/<topic>/NN-<stepId>.png`, a `contact.png` (an HTML grid of the PNGs
  rendered and screenshotted by Playwright itself — no image deps) and an `index.html`. Dark theme: one
  contact sheet per unit rendered with `.dark`; RTL: `/ar/...` for one topic per unit.

```ts
// src/stage/testing/lab.ts — installed only when import.meta.env.DEV || import.meta.env.VITE_LAB_HOOK === '1' (and ?lab=1)
declare global {
  interface Window {
    __lab?: Lab
  }
}
export type Lab = {
  ready: true
  total: number
  current(): { index: number; stepId: string; sceneId: string; say: string; changes: Change[] }
  goto(index: number): Promise<void> // instant seek, resolves after settle()
  next(): Promise<void>
  prev(): Promise<void>
  settle(): Promise<void> // fonts.ready → 2 rAF → all document.getAnimations() finished
}
```

## 10. Risks with Motion layout animations, and mitigations

| Risk                                                   | Why it happens                                                                               | Mitigation                                                                                                                                                                                                                      |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Siblings snap instead of glide when one card grows     | Motion only measures components that re-render                                               | `LayoutGroup` at stage root; `layoutDependency={frame.index}` on cards/rows                                                                                                                                                     |
| Child content stretches while a parent resizes         | projection scales the box; non-motion children are not corrected                             | cards `layout="position"`; size-animated items are motion elements with numeric `borderRadius`; text-heavy nodes never animate size                                                                                             |
| Cards resize when a token parks or an outbox fills     | tray/chips change the card's height                                                          | the tray reserves one token row always; chips wrap inside a fixed-height strip with `+n`; beyond that the card grows once and siblings glide (`layout="position"`)                                                              |
| Overlay arcs point at the wrong spot mid-glide         | overlay measured once after commit                                                           | in-flight tracking + 2 settle frames (§4)                                                                                                                                                                                       |
| `layoutId` across containers distorts/crossfades oddly | shared-element transition between an overlay and a card that is itself under a layout parent | don't; tokens fly on their own path (§5.2), parked tokens stay overlay-owned over the tray. `layoutId` only within one card                                                                                                     |
| Exiting list items hold space                          | `AnimatePresence` keeps them in flow                                                         | `mode="popLayout"` + `anchorX` by `dir`; pass `root` if inside a portal                                                                                                                                                         |
| Scrollable value views mis-measure                     | projection assumes no scroll inside                                                          | stage has no scrollers; if a long list must clip, mark the container `layoutScroll` and cap items (legibility rule)                                                                                                             |
| Stage inside a transformed ancestor                    | projection measures against transformed parents                                              | the stage container is never transformed; app shell animates `width/opacity` only. If ever needed, `layoutRoot` on the stage container makes children resolve against it (it also makes that node's own layout changes instant) |
| Seek plays a cascade of interrupted animations         | each commit schedules animations                                                             | `useInstantTransition` wrapper (§6.1); transient flights key on `frame.index` and never mount under `instant`                                                                                                                   |
| `reducedMotion`/`skipAnimations` toggles do nothing    | read at mount                                                                                | `key` the `MotionConfig` subtree on those flags                                                                                                                                                                                 |
| Many tokens on one arc overlap into mush               | `type`/`broadcast` mint N ops per step                                                       | stack offsets by creation order; deck token at ≥ 4 (§4)                                                                                                                                                                         |
| Fonts load after first measure                         | self-hosted variable fonts swap in                                                           | re-measure on `document.fonts.ready`; verify waits for it                                                                                                                                                                       |
| Tailwind `transition-*` utilities leak into the stage  | ignore speed/instant                                                                         | lint rule / review: no `transition-` or `animate-` classes under `src/stage/`                                                                                                                                                   |

## 11. RTL, dark mode, legibility

- RTL: logical properties everywhere (`ps-`, `ms-`, `text-start`); the grid and the board gutter
  mirror with `dir`; arrows, bolts, flow arrows and tokens are drawn from measured points (no mirroring
  needed); the overlay layers are the one sanctioned use of physical `left/top` (coordinates are
  measured); icons that imply direction get `rtl:-scale-x-100`; verdict glyphs are bidi-mirrored
  characters. LTR islands (DSL §9): `bytes` (all displays), `text`, `pattern`, `list display:'text'`,
  `Dot` ids, the clock HUD and clock badges render inside `<bdi dir="ltr">`. Keyboard ←/→ follow the
  mirrored transport bar. Verify runs `/ar/...` on one topic per unit.
- Dark mode: every colour in the stage is a token (`bg-card`, `text-ink`, `stroke: var(--actor-a)`);
  highlights use `*-soft` fills + `*` rings so contrast holds in both themes; screenshots exist for
  both.
- Legibility (DSL §2, enforced by schema where it can be): ≤ 5 actors, ≤ 6 record fields per card,
  ≤ 8 visible list/set items (tombstones excluded; overflow → `+n` chip), scalar display ≤ 24 chars
  (middle ellipsis; full value in `title` and `data-value`; `bytes` canonical exempt), `text` ≤ 96
  chars wrapped to ≤ 2 lines, bytes 16 per row in `hex`/`dec` and 4 per row in `bits`, `Meta` badges
  ≤ 3 tags / ≤ 3 applied ids (`+n`), `vc` compact (`a2 b1`, full in `title`), label ≤ 12 chars, state
  tokens ≤ 24-char summary. Value font: JetBrains Mono 15 px (14 px inside records and tables); captions
  and badges 11 px; no body text inside the
  stage (narration lives under it). Stage min height `--stage-min-h`; cards `min-width: 12rem`.

## 12. Implementation order

Each step lands green (`pnpm check`) with its own tests; later steps never require rewriting earlier
files. File lists match the module map (§1).

1. **`src/lesson` types, schema, paths** (in progress) — `types.ts` (DSL §2–§6, §14 verbatim),
   `schema.ts` (Zod, §13 schema rules), `path.ts` (`parsePath`/`resolve`/`getAt`/`setAt`/`updateAt`),
   `reducer/errors.ts`, `builders.ts` (structure, actors, values, command helpers, typed CRDT sugar,
   seed helpers, macros). Tests: schema accepts the §15 worked examples; path grammar goldens.
2. **Reducer families, crdt-view, timeline** — `reducer/index.ts`, `stage.ts`, `values.ts`,
   `messages.ts`, `marks.ts`, `crdt.ts`, `regex.ts`, `events.ts`, `diff.ts`, `timeline.ts`;
   `crdt-view/*` (`toValue`, `opLabel`, `fromJson`, `doc.ts`); `lint.ts`; `src/crdt/index.ts` gains
   `max-register` and `hlc`; `src/regex/` VM; `src/uuid/` builders. Tests: §9.1 in full, the §15
   examples as fixtures (frames snapshot).
3. **Player + transport UI** — `player/machine.ts`, `hold.ts`, `usePlayer.ts`; `src/app/` transport
   bar, narration region (`aria-live`), keyboard, `validateSearch` (`step`, `lab`, `motion`), settings
   (speed) and sound/analytics hooks. Tests: machine goldens; hold budget; URL sync in Playwright
   (`shell.spec.ts`).
4. **Stage core: motion, geometry, layout, actors, values** — `Stage.tsx`,
   `motion/StageMotionProvider.tsx`, `transitions.ts`, `useInstantCommit.ts`;
   `geometry/AnchorRegistry.tsx`, `measure.ts`; `layout/StageGrid.tsx`, `presets.ts`, `stage.css`;
   `actor/ActorCard.tsx`, `ActorHeader.tsx`, `StatusBadge.tsx`, `OfflineBadge.tsx`, `ClockBadge.tsx`,
   `InboxTray.tsx`, `OutboxChips.tsx`; `value/*` (all twelve kinds, `MetaBadges`, `ViaChip`,
   `truncate`, `annotations`); `hud/ClockHud.tsx`. Tests: §9.2 DOM contract per primitive, RTL/dark
   snapshots.
5. **Message, mark and board layers** — `message/MessageLayer.tsx`, `MessageToken.tsx`,
   `DeckToken.tsx`, `TransientFlight.tsx`, `TokenPayload.tsx`; `marks/MarkLayer.tsx`,
   `CalloutLayer.tsx`, `Highlight.tsx`, `Callout.tsx`, `ConflictBolt.tsx`, `CompareLinks.tsx`,
   `VerdictChip.tsx`, `FlowArrow.tsx`, `UnchangedPill.tsx`, `CheckCross.tsx`; `board/BoardCard.tsx`,
   `BoardGutter.tsx`. Tests: token `data-state`, exit outcomes, transient flights absent under
   instant, deck at ≥ 4, marks per kind, verdict chips.
6. **Topic page integration, `__lab`, e2e** — topic route wiring (`buildTimeline` → `usePlayer` →
   `<Stage>`), scene cross-fade, Try-it sandbox mode, `testing/lab.ts`, `e2e/topics.spec.ts`,
   `e2e/verify.spec.ts` + storyboard writer, `verification/` output. Tests: every topic walked in three
   browsers; first storyboards committed.

## 13. Divergences from the spec

None. Everything v0 proposed under "Recommended DSL changes" either landed in v1/v1.1 (message and
mark ids, `send.into` as the hint, `quiet`/`autoHighlight`, the tone set, the path grammar, `compare`,
typed `CrdtArgs`, CRDT-slot write errors, transient-mark id rules) or was rejected there (`focus`,
`crdt.compare`, `crdt.apply`, look-ahead `into`), and this document follows the spec in each case.
Things this document adds that the spec leaves to the implementation, none of which change a frame's
content: the anchor-registry key is the DSL path itself; stack offsets are `50, 42, 58, 34, 66 …`
percent; the deck token keeps the covered `[data-message]` elements in the DOM; parking is a
two-phase move (arc end → tray slot); `data-step-index`, `data-instant`, `data-transient`,
`data-count` and `data-path` on cards/tokens/boards are extra attributes beyond the §14 contract.

## 14. Open items

- `max-register` and `hlc` registry entries in `src/crdt/index.ts` (tracked with step 2; DSL §17).
- Whether `verify` should render one RTL storyboard per unit instead of one topic per unit (DSL §17).
- The fallback `commitInstantly` (§6.1) stays until `useInstantTransition` is confirmed against React 19
  transitions in the e2e walk; remove whichever is unused after step 6.
