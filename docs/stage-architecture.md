# Stage + lesson runtime architecture (v0)

Scope: `src/stage/` (world → React + Motion) and `src/lesson/` (reducer, timeline, player).
Companion to `docs/animation-dsl.md`. Verified against the installed versions:
**motion 13.1.1** (re-exports framer-motion 13.1.1 / motion-dom 13.1.1), **@tanstack/react-router 1.170.31**,
React 19, Tailwind v4, shadcn/ui in `src/ui`. No canvas.

## 0. Decisions in one screen

| Concern                                    | Decision                                                                                                                                                                                                                         |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unit of rendering                          | A **Frame** `{ world, prev, changes, step }`. The stage is a pure function of one frame plus a motion context.                                                                                                                   |
| Forward step (`next`, autoplay)            | Animated. Motion animates the DOM diff; `changes` tells primitives what to flash / where tokens go.                                                                                                                              |
| `prev`, `seek`, initial load, scene change | **Instant.** Committed inside `useInstantTransition()` so no in-between animations run. Never animate backwards.                                                                                                                 |
| Actor placement                            | CSS grid per layout preset (`data-layout`), slots assigned in insertion order. No pixels in data.                                                                                                                                |
| Overlays                                   | `MarkLayer` (one absolutely positioned `<svg>`: arcs, conflict bolts, check/cross glyphs), `MessageLayer` (HTML tokens), `CalloutLayer` (HTML bubbles). All read rects from an **anchor registry**, measured container-relative. |
| Message token                              | HTML `motion.div` that follows a quadratic arc via CSS `offset-path` + Motion-animated `offsetDistance`. In flight = `50%`. Enter `0% → 50%`; deliver exit `50% → 100%`; drop exit `50% → 70%` + poof.                           |
| Values that travel inside one card         | `layoutId` inside a `LayoutGroup` (reorder, add-set → removed-set, etc.). Cross-container travel does **not** use `layoutId` (see §10).                                                                                          |
| Speed / reduced motion                     | `StageMotionProvider` = `MotionConfig` (`transition`, `reducedMotion`) + `StageMotionContext` (`tr()`, `ms()`, `instant`, `dir`). Primitives never write raw transitions.                                                        |
| Determinism for tests                      | `MotionGlobalConfig.skipAnimations = true` in verify/jsdom; `window.__lab` steps the player; `data-*` attributes expose state.                                                                                                   |
| CRDTs                                      | Reducer calls pure functions in `src/crdt/` on opaque replica state stored in `world.replicas`; `holds[slot]` is always `toValue(replica)`.                                                                                      |

## 1. Module map

```
src/lesson/
  types.ts              World, Value, Message, Mark, Command, Step, Scene, Topic, Path, Frame, Change
  schema.ts             Zod mirrors of types.ts (z.infer re-exported for content)
  builders.ts           step(), scene(), topic(), and command helpers: set(), send(), deliver(), …
  path.ts               parsePath / formatPath / getAt / setAt / updateAt (immutable, structural sharing)
  reducer/
    index.ts            reduce(world, cmd) and applyStep(world, step) → StepResult
    actors.ts values.ts messages.ts marks.ts crdt.ts   (one file per command family)
    diff.ts             diffWorld(prev, next) → Change[]
    timeline.ts         buildTimeline(topic) → Frame[]  (flatten scenes, resolve message targets, memo)
  player/
    machine.ts          pure: (PlayerState, PlayerEvent) → PlayerState
    usePlayer.ts        timers, keyboard, URL sync, onStep events
    hold.ts             holdMs(frame, speed)
src/stage/
  Stage.tsx             <Stage frame onEvent />  (root, LayoutGroup, layers)
  motion/
    StageMotionProvider.tsx   MotionConfig + StageMotionContext
    transitions.ts            presets + scaling, tr(), ms()
    useInstantCommit.ts       wraps useInstantTransition (prev/seek)
  geometry/
    AnchorRegistry.tsx        context + useAnchor(key) + useGeometry()
    measure.ts                rectWithin(el, container), arcBetween(a, b), edgePoint()
  layout/
    StageGrid.tsx  presets.ts  stage.css   (grid-template-areas per preset, container queries)
  actor/ActorCard.tsx  ActorHeader.tsx  OfflineBadge.tsx
  value/ValueView.tsx  Scalar.tsx Record.tsx List.tsx SetView.tsx Counter.tsx Tree.tsx Bytes.tsx Text.tsx Clock.tsx
        MetaBadges.tsx  truncate.ts
  message/MessageLayer.tsx  MessageToken.tsx
  marks/MarkLayer.tsx (SVG)  CalloutLayer.tsx (HTML)  Highlight.tsx  Callout.tsx  ConflictBolt.tsx  CheckCross.tsx
  hud/ClockHud.tsx
  testing/lab.ts        window.__lab installer (dev / VITE_LAB_HOOK builds only)
```

Data flow: `content/*.ts` → `buildTimeline(topic)` (memoized per topic) → `frames[]` → player picks `index` →
`<Stage frame={frames[index]} />`. Narration comes from `frame.step.say` through the i18n overlay keyed by
`step.id`; the stage never reads text.

## 2. Core types (additions to the v0 DSL)

```ts
// src/lesson/types.ts (excerpt — the v0 DSL types stay as written; these are the additions)
export type MessageId = string
export type MarkId = string

export type Message = {
  id: MessageId
  from: ActorId
  to: ActorId // send.to: ActorId[] fans out to one Message per recipient (ids m1, m2, …)
  payload: Value
  label?: string
  into?: Path // where the payload lands (resolved by send.into or look-ahead from deliver.into)
  data?: unknown // opaque, e.g. the op(s) for crdt.apply; never rendered
}

export type Mark =
  | { id: MarkId; kind: 'highlight'; path: Path; tone: Tone; sticky?: boolean; auto?: boolean }
  | { id: MarkId; kind: 'callout'; at: Path | ActorId; text: string; tone: Tone; sticky?: boolean }
  | { id: MarkId; kind: 'conflict'; a: Path; b: Path; sticky?: boolean }
  | { id: MarkId; kind: 'check' | 'cross'; path: Path; sticky?: boolean }

export type Tone = 'change' | 'info' | 'ok' | 'warn' | 'danger'

export type World = {
  layout: LayoutPreset
  actors: Record<ActorId, Actor> // insertion-ordered (object key order), ≤ 5
  messages: Message[]
  marks: Mark[]
  clock: number
  replicas: Record<ActorId, Record<string, Replica>> // opaque CRDT state; holds[slot] = toValue(replica)
  seq: number // deterministic id counter (m1, m2…, k1, k2…)
}

export type Replica = { type: CrdtTypeName; state: unknown; seq: number; pending?: unknown[] } // plain JSON, produced only by src/crdt

export type Change =
  | { kind: 'value'; path: Path; op: 'added' | 'changed' | 'removed' | 'meta'; via?: MessageId }
  | { kind: 'actor'; id: ActorId; op: 'spawned' | 'removed' | 'online' | 'offline' }
  | { kind: 'message'; id: MessageId; op: 'sent' | 'delivered' | 'dropped'; into?: Path }
  | { kind: 'mark'; id: MarkId; op: 'added' | 'removed' }
  | { kind: 'layout'; from: LayoutPreset; to: LayoutPreset }
  | { kind: 'clock'; from: number; to: number }

export type Frame = {
  index: number // global across scenes
  sceneId: string
  sceneIndex: number
  step: Step
  world: World
  prev: World | null // null at scene start
  changes: Change[]
}
```

`Path` grammar (formalized): `actor ( '.' key | '[' id ']' )*`. Examples: `alice.doc.title`,
`server.list[item-3]`, `bob.likes.perNode.alice`, `alice.clock.entries.bob`, `alice.id.bytes[6..7]`,
`alice.text[3..8]` (ranges only for `bytes`/`text`, used by highlight/callout). `parsePath` returns
`{ actor, segments: Array<{ key } | { id } | { range: [from, to] }> }`; malformed paths fail the Zod
schema at test time, and throw in the reducer (never silently no-op).

## 3. Component tree and layout

```
<StageMotionProvider speed reduced instant dir>          // MotionConfig + StageMotionContext
  <Stage frame onEvent>                                  // position:relative container; data-stage, data-step, data-scene
    <LayoutGroup id={frame.sceneId}>
      <AnchorRegistryProvider>
        <StageGrid layout={world.layout} count={n}>       // CSS grid; data-layout
          {actors.map(a => (
            <ActorCard key={a.id} actor={a} slot={…} changes>   // motion.div layout="position", useAnchor(`actor:${id}`)
              <ActorHeader/>                                      // avatar by kind, label, OfflineBadge
              {Object.entries(a.holds).map(([slot, v]) =>
                <ValueView key={slot} path={`${a.id}.${slot}`} value={v} />)}   // dispatch on v.kind
            </ActorCard>))}
        </StageGrid>
        <MessageLayer messages changes />                 // HTML layer: MessageToken per message (AnimatePresence)
        <MarkLayer marks changes />                       // SVG layer: arcs, conflict bolts, check/cross glyphs
        <CalloutLayer marks />                            // HTML layer: callout bubbles (need text wrapping)
        <ClockHud clock />                                // corner badge when scene uses the clock
      </AnchorRegistryProvider>
    </LayoutGroup>
  </Stage>
</StageMotionProvider>
```

`ValueView` switches on `value.kind` → `Scalar | Record | List | SetView | Counter | Tree | Bytes | Text | Clock`.
Every value node renders `data-path`, `data-kind`, and for leaves `data-value` (canonical string). Each
node calls `useAnchor(`path:${path}`)`, and `MetaBadges` renders `meta` (`ts` → `t=12`, `node` → actor dot,
`tag` → pill, `tombstone` → strikethrough + "deleted" label + icon, `note` → footnote). Marks attach to
value nodes by path: `Highlight` reads `marks` via context and decorates the matching node (`data-highlight=tone`),
so highlights survive re-layout without measuring.

### 3.1 Layout presets as CSS grid (`src/stage/layout/stage.css`)

Slots are named `s1…s5` plus `hub`. `slotFor(actor, i, preset)`: in `hub`, the first actor of kind
`server|service` takes `hub`, others take `s1…` in insertion order; other presets assign `s{i+1}`.
Empty `.` areas leave room for arcs.

```css
.stage-grid {
  display: grid;
  gap: var(--stage-gap);
  container-type: inline-size;
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
  grid-template-areas: '. s1 .' 's5 . s2' '. s4 s3';
}
.stage-grid[data-layout='grid'] {
  grid-template-columns: repeat(auto-fit, minmax(14rem, 1fr));
}
.stage-grid > [data-slot='hub'] {
  grid-area: hub;
}
.stage-grid > [data-slot='s1'] {
  grid-area: s1;
} /* … */
@container (max-width: 56rem) {
  /* narrow: every preset degrades to a 2-column grid */
  .stage-grid[data-layout] {
    grid-template-areas: none;
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .stage-grid > [data-slot] {
    grid-area: auto;
  }
}
```

`direction: rtl` mirrors grid areas for free; arcs are measured, so they follow. A `layout` command
changes `data-layout`; cards have `layout="position"` so they glide to their new slots.

### 3.2 DOM attributes (contract for tests)

| Element                   | Attributes                                                                               |
| ------------------------- | ---------------------------------------------------------------------------------------- |
| stage root                | `data-stage`, `data-step={step.id}`, `data-step-index`, `data-scene`, `data-layout`      |
| actor card                | `data-actor`, `data-kind`, `data-online`, `data-slot`, `data-color`                      |
| value node                | `data-path`, `data-kind`, `data-value` (leaves), `data-highlight=tone`, `data-tombstone` |
| token                     | `data-message={id}`, `data-from`, `data-to`, `data-phase=flying`                         |
| mark                      | `data-mark={id}`, `data-mark-kind`                                                       |
| narration (outside stage) | `data-testid="narration"`, `aria-live="polite"`                                          |

## 4. Geometry: anchors and measurement

Both overlays need rects of actor cards and value nodes in **stage-container coordinates**. Rules:

1. The stage container (`[data-stage]`) is `position: relative; overflow: visible` and is **never transformed**
   (no `layout` prop on it, no CSS transform from the app shell; the sidebar animates `width`, not transform).
2. Elements register themselves by key; the layer measures, not the elements.
3. Measure with `getBoundingClientRect()` minus the container's rect (transforms included, which is what
   we want while cards glide), and re-measure every animation frame while any layout animation is in
   flight. Otherwise measure once per commit + on resize.

```tsx
// src/stage/geometry/AnchorRegistry.tsx
import { createContext, useContext, useLayoutEffect, useRef, useSyncExternalStore } from 'react'
import { useAnimationFrame } from 'motion/react'

export type Rect = { x: number; y: number; w: number; h: number }
export type AnchorKey = `actor:${string}` | `path:${string}`

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

Why `getBoundingClientRect` and not `offsetLeft` chains: the former follows Motion's projection transforms,
so tokens/arcs track gliding cards. The race "did our layout effect run before or after Motion applied its
first transform" is covered by the two settle frames + in-flight tracking. Scroll offsets cancel out
because both rects are viewport-relative. `sameRects` compares with a 0.5px tolerance so sub-pixel jitter
does not re-render the layers.

Arc geometry (shared by arcs and tokens so they stay on the same curve):

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
```

Messages between two actors in the same step (e.g. `crdt.sync`) get opposite bulge signs so the two arcs
do not overlap; same-pair, same-direction messages get increasing bulge.

## 5. Animation strategy (Motion 13)

### 5.1 What animates per command

| Command / change                               | DOM strategy                        | Motion API                                                                                                                     |
| ---------------------------------------------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `spawn` / `remove` actor                       | card mounts/unmounts                | `AnimatePresence` around cards; card `initial={{opacity:0, scale:.96}} animate exit` ; siblings glide with `layout="position"` |
| `layout` preset                                | `data-layout` changes               | cards `layout="position"` inside `LayoutGroup` (forces siblings to re-measure)                                                 |
| `set` (auto-highlight)                         | value node text changes             | `Highlight` ring: `animate={{ opacity:[0,1,.7] }}` once; resting state is the static look                                      |
| `insert` / `delete` / `move` (list, set, tree) | item mount/unmount/reorder          | items `<motion.li layout layoutId={`${path}`}>`; `AnimatePresence mode="popLayout" anchorX={dir==='rtl'?'right':'left'}`       |
| `patch` meta                                   | badge text/visibility               | badge `layout` + `AnimatePresence` for appearing badges                                                                        |
| `send`                                         | token mounts                        | `MessageToken` enters `offsetDistance 0% → 50%`                                                                                |
| `deliver`                                      | token unmounts, `into` path changes | exit `50% → 100%` + fade; destination flashes with `via` colour                                                                |
| `drop`                                         | token unmounts                      | exit `50% → 70%`, `scale: 1.4, opacity: 0` (poof); destination does not flash                                                  |
| `offline` / `online`                           | `data-online`                       | card `animate={{ opacity: online ? 1 : .55, filter }}`; badge presence                                                         |
| `highlight`                                    | `data-highlight`                    | ring pulse (as `set`), persistent when `sticky`                                                                                |
| `callout`                                      | bubble mounts near anchor           | `AnimatePresence` + `initial={{opacity:0, y:4}}`; static = visible                                                             |
| `conflict`                                     | SVG bolt between two anchors        | `<motion.path initial={{pathLength:0}} animate={{pathLength:1}}>` + ⚡ badge at midpoint                                       |
| `check` / `cross`                              | glyph at anchor                     | `motion.path pathLength` draw-on                                                                                               |
| `tick`                                         | clock HUD                           | number flip via `AnimatePresence mode="popLayout"` on the digit                                                                |

`pathLength` is a Motion SVG prop (drives `stroke-dasharray/offset`), `offsetDistance` is an animatable
style (Motion lists `offsetDistance/offsetPath/offsetRotate/offsetAnchor` as CSS-style properties even on SVG).
Primitives import from `motion/react`; `MotionGlobalConfig`, `arc`, `frame` are re-exported from the same entry.

### 5.2 The message token

```tsx
// src/stage/message/MessageToken.tsx
import { useEffect, useMemo } from 'react'
import { motion, AnimatePresence, useIsPresent, usePresenceData, type Variants } from 'motion/react'
import { useStageMotion } from '../motion/StageMotionProvider'
import { useStageEvents } from '../Stage'
import { useGeometry } from '../geometry/AnchorRegistry'
import { arcBetween } from '../geometry/measure'

type Outcome = 'delivered' | 'dropped'
type ExitInfo = Record<string /* MessageId */, Outcome>
const TRAVEL_MS = 600 // must match BASE.travel.duration (single source: transitions.ts)

const AT_REST = {
  sent: { offsetDistance: '0%', opacity: 0, scale: 0.9 },
  flying: { offsetDistance: '50%', opacity: 1, scale: 1 },
  delivered: { offsetDistance: '100%', opacity: 0, scale: 0.9 },
  dropped: { offsetDistance: '70%', opacity: 0, scale: 1.5 },
} as const

export function MessageLayer({ messages, changes }: { messages: Message[]; changes: Change[] }) {
  // outcomes of messages that left the world in this frame → consumed by exiting tokens via `custom`
  const exitInfo: ExitInfo = {}
  for (const c of changes) if (c.kind === 'message' && c.op !== 'sent') exitInfo[c.id] = c.op
  const { instant } = useStageMotion()
  return (
    <div className="pointer-events-none absolute inset-0" aria-hidden>
      <AnimatePresence custom={exitInfo} initial={!instant}>
        {messages.map((m) => (
          <MessageToken key={m.id} message={m} />
        ))}
      </AnimatePresence>
    </div>
  )
}

function MessageToken({ message }: { message: Message }) {
  const geo = useGeometry()
  const { tr, ms, instant } = useStageMotion()
  const emit = useStageEvents()
  const isPresent = useIsPresent() // false once this frame removed the message
  const outcome = (usePresenceData() as ExitInfo | undefined)?.[message.id] ?? 'delivered' // AnimatePresence `custom`
  // `exit` cannot be a function; dynamic variants live in `variants` and receive AnimatePresence's `custom`.
  const variants = useMemo<Variants>(
    () => ({
      sent: AT_REST.sent,
      flying: AT_REST.flying,
      gone: (info: ExitInfo) => AT_REST[info[message.id] ?? 'delivered'],
    }),
    [message.id],
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

  const from = geo.get(`actor:${message.from}`)
  const to =
    geo.get(message.into ? `path:${message.into}` : `actor:${message.to}`) ??
    geo.get(`actor:${message.to}`)
  if (!from || !to) return null // first paint before measurement; the settle frame fixes it
  const { d } = arcBetween(from, to)
  return (
    <motion.div
      data-message={message.id}
      data-from={message.from}
      data-to={message.to}
      data-phase="flying"
      className="absolute top-0 left-0 will-change-transform" // physical left/top on purpose: overlay coords are measured
      style={{ offsetPath: `path("${d}")`, offsetRotate: '0deg' }} // CSS motion path; offset-anchor auto centres the token on the curve
      variants={variants}
      initial={instant ? false : 'sent'}
      animate="flying"
      exit="gone"
      transition={tr('travel')}
    >
      <ValueChip value={message.payload} label={message.label} actor={message.from} />
    </motion.div>
  )
}
```

Notes:

- Static frame correctness: a flying message renders at `offsetDistance: 50%` with no animation when
  `instant` (initial=false) or after the enter animation settles. Resize re-computes `d`; the token
  stays at the midpoint of the new curve because only `d` changed.
- `exit` accepts only a label or target (`TargetAndTransition | VariantLabels`), so the per-message
  outcome is a dynamic variant (`TargetResolver`) in `variants`, reading `AnimatePresence`'s `custom`
  (`ExitInfo` keyed by message id). One step can deliver one message and drop another.
- The arc endpoint must be known while flying, because exiting children keep their last props. That is why
  `Message.into` is resolved at send time (`send.into` or timeline look-ahead, §7.4).
- The arrival sound is timed by contract, not by callback: `useIsPresent()` flips when the frame removed
  the message, and the token emits `message-gone` after `ms(TRAVEL_MS)` (0 under instant/reduced), which
  equals the exit animation's duration. The page maps `delivered` → bloop, `dropped` → soft poof.
- `ValueChip` is the same component `Record` uses for field values at the same size, so a delivered value
  looks identical before and after it lands.

### 5.3 Highlights, conflicts, callouts

```tsx
// Highlight decorates the value node itself; no measuring needed.
<motion.span data-highlight={tone} className="ring-2 ring-[color:var(--tone)] rounded-[var(--radius)]"
  initial={instant ? false : { opacity: 0 }} animate={{ opacity: [0, 1, 0.75] }} transition={tr('flash')} />

// Conflict bolt is SVG between two measured anchors.
<motion.path d={boltPath(a, b)} stroke="var(--danger)" fill="none" strokeWidth={2}
  initial={instant ? false : { pathLength: 0 }} animate={{ pathLength: 1 }} transition={tr('draw')} />
```

Tone colours come from tokens (`--change` maps to `--accent`, others to `--ok/--warn/--danger/--info`);
the `via` actor colour is used for "landed from Alice" flashes. Icons accompany colour (check, x, bolt).

### 5.4 `layout` / `layoutId` rules

- Cards: `layout="position"` (size changes snap, position glides) + `layoutDependency={frame.index}` so every
  card re-measures exactly once per step, and `useLayoutInFlight()` handlers.
- Rows/items: `layout` with stable keys (`field.key`, `item.id`). Give radius numerically
  (`style={{ borderRadius: 8 }}`) on anything that animates size so Motion's scale correction applies.
- `layoutId` only for same-card travel (2P-Set add→removed column, RGA item reorders, tree node re-parenting).
  Use `transition={{ layout: { ...tr('layout'), path: arc({ strength: 0.25 }) } }}` for a visible hop
  (`transition.layout.path` is supported in 13.x; keep the `arc()` instance module-scoped per docs).
- One `LayoutGroup id={sceneId}` at the stage root; `layoutId`s are `${path}` so they are unique per scene.

## 6. Speed, reduced motion, instant seeks

Two mechanisms, one provider:

1. `MotionConfig` supplies the default `transition` (scaled by speed; `MotionConfig` spreads into every
   motion component's props, so layout animations pick it up too) and `reducedMotion`.
2. `StageMotionContext` supplies `tr(kind)` / `ms(base)` for primitives that need explicit transitions,
   timers, and the `instant` flag for `initial={false}` decisions.

`reducedMotion` and `skipAnimations` on `MotionConfig` are captured when a motion element **mounts**
(VisualElement constructor), so the provider keys the subtree on those flags — toggling the setting
remounts the stage (cheap: ≤5 cards) rather than silently not applying.

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

Rules for primitives: never write a literal `transition`; call `tr()`. Never use CSS transitions/animations
inside the stage (they would ignore speed and instant). Timers outside Motion use `ms()`.

### 6.1 Instant seeks (`prev`, `seek`, URL load, scene change)

Goal: rendering frame _k_ after frame _n_ must not play _any_ intermediate animation: no token flights,
no layout glides, no exits. Approach: commit the state change inside Motion's `useInstantTransition()`.
It sets `MotionGlobalConfig.instantAnimations = true` (read by every animation start, including layout
animations which go through `animateSingleValue`), blocks the projection update for that commit, forces a
render, runs our callback, and unlocks two frames later. It is a public export of `motion/react`, thinly
documented; we wrap it once so it can be swapped for the fallback below.

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

The player marks each move with `kind: 'next' | 'prev' | 'seek'`; the topic page dispatches `prev`/`seek`
through `useInstantCommit()` and `next` normally. `AnimatePresence initial={false}` is set whenever
`instant` is true, so tokens/callouts present in the target frame render at rest.

Verify/jsdom mode sets `MotionGlobalConfig.skipAnimations = true` at boot (global, affects every
animation including layout) **and** passes `instant` to the provider (so `reducedMotion="always"` also
snaps layout). Belt and braces: the first covers animations started anywhere, the second covers
`initial` rendering and timers.

## 7. The reducer

`reduce(world, cmd): World` is pure and total (throws `ReducerError` with the path/command on misuse —
tests catch authoring mistakes). `applyStep(world, step): { world, changes }` adds the step-level
behaviour. `buildTimeline(topic): Frame[]` folds scenes.

```ts
// src/lesson/reducer/index.ts
export function applyStep(prev: World, step: Step, ctx: StepCtx): StepResult {
  let w = clearTransientMarks(prev) // non-sticky marks live exactly one step
  for (const cmd of step.do) w = reduce(w, cmd, ctx)
  const changes = diffWorld(prev, w) // values, actors, messages, marks, layout, clock
  w = addAutoHighlights(w, changes, step) // 'change' tone unless explicit highlight or quiet
  return { world: w, changes }
}

export function reduce(w: World, cmd: Command, ctx: StepCtx): World {
  switch (cmd.t) {
    case 'spawn':
    case 'remove':
    case 'offline':
    case 'online':
      return actors(w, cmd)
    case 'set':
    case 'patch':
    case 'insert':
    case 'delete':
    case 'move':
      return values(w, cmd)
    case 'send':
    case 'deliver':
    case 'drop':
      return messages(w, cmd)
    case 'highlight':
    case 'callout':
    case 'conflict':
    case 'check':
    case 'cross':
    case 'clearMarks':
      return marks(w, cmd)
    case 'tick':
      return { ...w, clock: w.clock + (cmd.by ?? 1) }
    case 'layout':
      return { ...w, layout: cmd.preset }
    default:
      return crdt(w, cmd, ctx) // 'crdt.*'
  }
}
```

### 7.1 Paths

```ts
// src/lesson/path.ts
export type Seg = { key: string } | { id: string } | { range: [number, number] }
export type ParsedPath = { actor: ActorId; segs: Seg[] }
const RE = /^([a-z][\w-]*)((?:\.[\w-]+|\[[^\]]+\])*)$/

export function parsePath(p: Path): ParsedPath {
  const m = RE.exec(p)
  if (!m) throw new ReducerError(`bad path "${p}"`)
  const segs: Seg[] = []
  for (const tok of m[2].match(/\.[\w-]+|\[[^\]]+\]/g) ?? []) {
    if (tok.startsWith('.')) segs.push({ key: tok.slice(1) })
    else {
      const inner = tok.slice(1, -1),
        r = /^(\d+)\.\.(\d+)$/.exec(inner)
      segs.push(r ? { range: [Number(r[1]), Number(r[2])] } : { id: inner })
    }
  }
  return { actor: m[1], segs }
}

// Lenses over Value trees. `record.key`, `list[id]`, `set[id]`, `counter.perNode.alice`,
// `clock.entries.alice`, `tree[id]` (depth-first id lookup). Ranges are only valid as the last segment
// and only on bytes/text (they address a span, used by marks).
export function getAt(w: World, p: Path): Value | undefined
export function setAt(w: World, p: Path, v: Value): World // structural sharing; throws on missing parent
export function updateAt(w: World, p: Path, f: (v: Value) => Value): World
```

`holds` is keyed by slot (`alice.doc`), so the first segment after the actor is always a slot.
`set` with a `Scalar` (string/number/boolean/null) wraps it as `{ kind: 'scalar', value }`, preserving
existing `meta` unless the command provides a full `Value`.

### 7.2 CRDT adapter

`src/crdt/` (already in progress) exposes one module per type implementing `CrdtType<S, U, O, V, A>`:
`init(node, args)`, `update(state, u, ctx)`, `prepare(state, u, ctx) → op`, `effect(state, op)`,
`merge(a, b)`, `value(state)`, with `Ctx = { node, ts, nextSeq() }`. States are plain immutable data
(no classes, no randomness, no `Date.now`), so `world.replicas` is JSON and snapshot-testable.

The lesson side adds what the stage needs and nothing else:

```ts
// src/lesson/crdt-view/index.ts — per-type projection of replica state into the DSL `Value` tree
export interface CrdtView<S, O> {
  toValue(state: S, opts?: { showMeta?: boolean }): Value // sidecar → Meta / tags / perNode / tombstones
  opToValue(op: O): Value // what a broadcast token shows (e.g. `inc 1`, `add "milk" #a:3`)
}
export const views: { [K in CrdtTypeName]: CrdtView<StateOf<K>, OpOf<K>> }
export const types: { [K in CrdtTypeName]: CrdtType<…> } // re-export of src/crdt modules by name
```

Reducer side (`src/lesson/reducer/crdt.ts`), all deterministic:

```ts
// Ctx for one command: seq comes from the replica, advances locally, and is written back.
function ctxFor(w: World, actor: ActorId, slot: string, ts?: number) {
  let seq = w.replicas[actor]?.[slot]?.seq ?? 0
  const ctx: Ctx = { node: actor, ts: ts ?? w.clock, nextSeq: () => ++seq }
  return { ctx, seqAfter: () => seq }
}

case 'crdt.init':      for each actor: replicas[actor][slot] = { type, state: T.init(actor, args), seq: 0 }; holds[slot] = V.toValue(state)
case 'crdt.update':    op = T.prepare(state, u, ctx); state' = T.effect(state, op)          // == T.update for state-based use
                       replica = { state: state', seq: seqAfter(), pending: [...pending, op] }; holds[slot] = V.toValue(state')
case 'crdt.merge':     replicas[into][slot].state = T.merge(into.state, from.state); holds refreshed (from unchanged)
case 'crdt.sync':      merge both ways in one step
case 'crdt.broadcast': for each other online actor: Message { id: `m${++seq}`, from, to, payload: V.opToValue(op), data: { slot, op } } per pending op; pending = []
case 'crdt.apply':     m = find(w.messages, id); state' = T.effect(rep.state, m.data.op); remove m; holds refreshed; record via = m.id
case 'crdt.compare':   (proposed) mark from vectorClock.compare(getReplica(a), getReplica(b))
```

Time: `ts` defaults to `world.clock`; lessons advance it with `tick`; `crdt.update.args` may carry
`{ ts }`. Ties are broken by the real implementation (`compareStamp`: ts, then node id) — a teaching
moment, not a bug. Unique tags are dots `${node}:${seq}`, so two runs of a topic produce identical worlds.

`holds[slot]` is always recomputed from the replica after any crdt command; value commands (`set`, …)
on a CRDT-managed slot throw (`ReducerError: slot "doc" is CRDT-managed; use crdt.update`) so lessons
cannot hand-write merge results. `Replica` therefore is `{ type: CrdtTypeName; state: unknown; seq: number; pending?: unknown[] }`.

### 7.3 Diff and auto-highlight

`diffWorld(prev, next)` walks `holds` per actor, keyed by `field.key` / `item.id` / `perNode` node /
`clock.entries` node; leaves compare `(kind, value, meta)`. Emits `value` changes with the deepest
changed path (a field whose scalar changed → that field; a new list item → the item path; meta-only → `op: 'meta'`).
`via` is filled for paths written by `deliver.into`/`crdt.apply` in this step (messages.ts records
`pendingVia` in a step-scoped scratch that the diff reads). Actors/messages/marks diff by id; `layout`
and `clock` by value.

`addAutoHighlights` adds `{ kind: 'highlight', tone: 'change', auto: true, path }` for each `value`
change, unless: the step has an explicit highlight/check/cross/conflict on that path; the mutating
command carried `quiet: true`; or the step declares `autoHighlight: false`. Auto marks are transient.

`changes` are the contract between reducer and renderer/tests: the renderer reads `message` changes
for exit outcomes, `value.via` for landing flashes, and `actor` changes for spawn emphasis; tests assert
on `changes` without rendering; the player uses them for sound/analytics and hold budgeting.

### 7.4 Timeline

```ts
export function buildTimeline(topic: Topic): Frame[] {
  const frames: Frame[] = []
  for (const [sceneIndex, scene] of topic.scenes.entries()) {
    const steps = resolveMessageTargets(scene.steps) // copy later deliver.into → the matching send's Message.into
    let world = initWorld(scene.world),
      prev: World | null = null
    for (const step of steps) {
      const { world: next, changes } = applyStep(world, step, ctx(scene))
      frames.push({
        index: frames.length,
        sceneId: scene.id,
        sceneIndex,
        step,
        world: next,
        prev,
        changes,
      })
      prev = world = next
    }
  }
  return frames
}
```

Memoized per topic module (`WeakMap<Topic, Frame[]>`); cheap enough to rebuild in tests. Look-ahead is
legitimate because the state at step _n_ is defined as a function of the whole step list.

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

- **Autoplay timer**: `useEffect([status, index, speed, move.seq])` → if playing, `setTimeout(next/auto, holdMs(frame, speed))`.
  `holdMs = (animBudget(frame.changes) + HOLD[step.hold ?? 'normal']) / speed` with `animBudget` =
  600ms if any message change, 350ms if any value/actor/layout change, else 0; `HOLD = { short: 1200, normal: 2200, long: 3600 }`.
  Under reduced motion `animBudget` = 0, holds unchanged (DSL rule). Timer cleared on any state change.
- **Dispatch routing**: `next` → plain `dispatch`; `prev`/`seek`/`load` → `useInstantCommit()(…dispatch)`.
  The stage receives `instant = move.kind !== 'next' || verifyMode`.
- **Keyboard** (topic page scope; ignored when focus is in inputs/`contenteditable` or a Radix dialog is open):
  `ArrowRight/ArrowLeft` = next/prev in LTR, swapped in RTL (matches the mirrored transport buttons),
  `Space` = toggle, `Home/End` = first/last, `.`/`,` = speed up/down, `Escape` = pause.
- **URL sync**: topic route declares `validateSearch` with Zod (`{ step: z.coerce.number().int().min(1).optional(), lab: z.literal('1').optional(), motion: z.literal('off').optional() }`).
  On mount: `load({ index: (search.step ?? 1) - 1 })`. On index change: `navigate({ search: (s) => ({ ...s, step: index + 1 }), replace: true })`
  (replace, so Back leaves the topic instead of un-stepping). Back/forward that changes `step` externally
  dispatches `seek`. URL `step` is 1-based; code is 0-based.
- **Events**: `onStep(frame, move)` fires after commit → `sound.tick()` (not on `load`), `track('step_view', { topic, step: step.id, source })`,
  progress store marks step seen. `onEvent` from the stage (`StageEvent = { t: 'message-gone'; message: MessageId; outcome: 'delivered' | 'dropped' }`, provided to primitives via `useStageEvents()`) → `sound.bloop()` / soft poof.
  `status → 'ended'` → `track('topic_complete')` + `sound.chord()`. `setSpeed` → settings store + `track('speed_change')`.
- **Scene change**: when `frames[index].sceneId` differs from the previous, the `<Stage key={sceneId}>`
  remounts (always an instant commit) with a 200ms cross-fade of the whole stage (that one transition
  is allowed at the shell level and respects `ms()`).

Determinism: `frames` is immutable; `index` → frame; `move.kind` → animated or not. Two users who reach
step 7 by any path see the same static frame; only the transition into it differs.

## 9. Testing

### 9.1 Reducer / timeline (Vitest, node)

- Golden tests per command on a fixture world; error tests for bad paths, CRDT-managed slots, unknown message ids.
- `buildTimeline(topic)` for every content topic: no throws; `changes` non-empty for every step except
  narration-only steps (those must be marked `do: []` deliberately); every `send` has a matching `deliver|drop` before scene end.
- Property tests (fast-check): for state-based types, `reduce(crdt.merge)` equals `mod.merge` directly,
  and merge order permutations yield equal `holds`; applying a timeline twice yields deep-equal frames.
- Snapshot `frames.map(f => ({ id: f.step.id, changes: f.changes }))` per topic (small, reviewable diffs).

### 9.2 Stage in jsdom (Vitest + Testing Library)

`src/test/setup.ts` adds `ResizeObserver` and `matchMedia` stubs and sets `MotionGlobalConfig.skipAnimations = true`.
Render `<StageMotionProvider speed={1} reducedSetting instant dir="ltr"><Stage frame /></StageMotionProvider>`
and assert the DOM contract: `[data-path="alice.doc.title"]` has `data-value="Draft"`, `[data-highlight]`
on changed paths, `[data-message]` count equals `world.messages.length`, actor cards carry the right
`data-slot` for the preset. `getBoundingClientRect` is zero in jsdom, so geometry-dependent assertions
(arc `d`) use an injected fake registry snapshot. Every primitive gets one "renders every kind" test and
one "renders tombstone/meta" test.

### 9.3 Playwright (`e2e/`)

- `e2e/topics.spec.ts` (Chromium/Firefox/WebKit): for each topic, load `/en/<module>/<unit>/<topic>?step=1&lab=1&motion=off`,
  walk every frame with `window.__lab`, assert narration and changed paths.
- `e2e/verify.spec.ts` (project `verify`, Chromium only, 1280×800, DPR 1, `emulateMedia({ reducedMotion: 'reduce' })`):
  same walk, plus `page.locator('[data-stage]').screenshot({ animations: 'disabled' })` per step to
  `verification/<module>/<unit>/<topic>/NN-<stepId>.png`, a `contact.png` (an HTML grid of the PNGs rendered
  and screenshotted by Playwright itself — no image deps) and an `index.html`. Dark theme: one contact
  sheet per unit rendered with `.dark` to keep the commit small.

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

`?motion=off` forces `instant` for the session (global `skipAnimations` + provider flag). In the walk,
Node-side code imports the same content + `buildTimeline` to cross-check `total` and the canonical
`data-value` strings, so the browser and the reducer must agree.

## 10. Risks with Motion layout animations, and mitigations

| Risk                                                   | Why it happens                                                                               | Mitigation                                                                                                                                                                                                                      |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Siblings snap instead of glide when one card grows     | Motion only measures components that re-render                                               | `LayoutGroup` at stage root; `layoutDependency={frame.index}` on cards/rows                                                                                                                                                     |
| Child content stretches while a parent resizes         | projection scales the box; non-motion children are not corrected                             | cards `layout="position"`; size-animated items are motion elements with numeric `borderRadius`; text-heavy nodes never animate size                                                                                             |
| Overlay arcs point at the wrong spot mid-glide         | overlay measured once after commit                                                           | in-flight tracking + 2 settle frames (§4)                                                                                                                                                                                       |
| `layoutId` across containers distorts/crossfades oddly | shared-element transition between an overlay and a card that is itself under a layout parent | don't; tokens fly on their own path (§5.2). `layoutId` only within one card                                                                                                                                                     |
| Exiting list items hold space                          | `AnimatePresence` keeps them in flow                                                         | `mode="popLayout"` + `anchorX` by `dir`; pass `root` if inside a portal                                                                                                                                                         |
| Scrollable value views mis-measure                     | projection assumes no scroll inside                                                          | stage has no scrollers; if a long list must clip, mark the container `layoutScroll` and cap items (legibility rule)                                                                                                             |
| Stage inside a transformed ancestor                    | projection measures against transformed parents                                              | the stage container is never transformed; app shell animates `width/opacity` only. If ever needed, `layoutRoot` on the stage container makes children resolve against it (it also makes that node's own layout changes instant) |
| Seek plays a cascade of interrupted animations         | each commit schedules animations                                                             | `useInstantTransition` wrapper (§6.1)                                                                                                                                                                                           |
| `reducedMotion`/`skipAnimations` toggles do nothing    | read at mount                                                                                | `key` the `MotionConfig` subtree on those flags                                                                                                                                                                                 |
| Fonts load after first measure                         | self-hosted variable fonts swap in                                                           | re-measure on `document.fonts.ready`; verify waits for it                                                                                                                                                                       |
| Tailwind `transition-*` utilities leak into the stage  | ignore speed/instant                                                                         | lint rule / review: no `transition-` or `animate-` classes under `src/stage/`                                                                                                                                                   |

## 11. RTL, dark mode, legibility

- RTL: logical properties everywhere (`ps-`, `ms-`, `text-start`); grid mirrors with `dir`; arrows and
  bolts are drawn from measured points (no mirroring needed); the overlay layers are the one sanctioned
  use of physical `left/top` (coordinates are measured); icons that imply direction get `rtl:-scale-x-100`.
  Data values (paths, UUIDs, timestamps, hex) are wrapped in `<bdi dir="ltr">` so bidi does not reorder them.
  Keyboard ←/→ follow the mirrored transport bar. Verify runs `/ar/...` on one topic per unit to catch regressions.
- Dark mode: every colour in the stage is a token (`bg-card`, `text-ink`, `stroke: var(--actor-a)`);
  highlights use `*-soft` fills + `*` rings so contrast holds in both themes; screenshots exist for both.
- Legibility: schema enforces ≤ 5 actors, ≤ 6 record fields, ≤ 8 list/set items shown (overflow → `+n` chip),
  scalar display ≤ 18 chars (middle ellipsis, full value in `title` and `data-value`), bytes 16 per row,
  text ≤ 2 lines at 40 chars, label ≤ 12 chars. Value font: JetBrains Mono 13px; badges 11px; no body
  text inside the stage (narration lives under it). Stage min height `--stage-min-h`; cards `min-width: 12rem`.

## 12. Recommended DSL changes (for `docs/animation-dsl.md`)

1. Define `Message` and `Mark` (with ids) and add `World.replicas` + `World.seq` (§2). Ids are generated
   by the reducer (`m1…`, `k1…`), never by content; `send.id` stays optional for readable references.
2. `send.into?: Path` as a destination hint; `deliver.into` stays and is copied back to the send by look-ahead.
3. `quiet?: boolean` on `set/patch/insert/delete/move`, and `autoHighlight?: false` on a Step.
4. `Tone = 'change' | 'info' | 'ok' | 'warn' | 'danger'`; actor colour is derived from `meta.node`/`from`, not a tone.
5. Path grammar formalized (§2) incl. `[from..to]` ranges for `bytes`/`text` (UUID bits, regex matches).
6. Add `{ t: 'crdt.compare'; a: Path; b: Path }` (vector clocks; result computed by `src/crdt/vectorClock.compare`)
   and `{ t: 'focus'; actors: ActorId[] | 'all' }` (dim others; cheaper than zoom).
7. `crdt.init.args` becomes a discriminated union per `CrdtType`; `crdt.update.args` may carry `{ ts }`
   to override the scene clock.
8. State that value commands on CRDT-managed slots are errors; that `holds` for such slots is always `toValue()`.
9. Transient marks get a fresh id every step (re-issuing a highlight re-pulses it); sticky marks keep
   their id and stay at rest until `clearMarks` (documented).

## 13. Open items

- Tree `[id]` addressing vs. index paths for the tree-building prototype: decide when the tree primitive lands.
- Whether `bytes` annotations should be marks (transient) or part of the value (persistent); current: value.
- Sandbox ("Try it") will drive the same reducer with user-generated commands; the player gets a
  `mode: 'lesson' | 'sandbox'` later — no change to the stage.
