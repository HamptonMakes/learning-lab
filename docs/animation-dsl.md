# Animation DSL — v0 draft (to be refined)

This document defines how lessons describe what happens on the stage. Lessons are **data**.
The stage renders **world states**; the player moves between states; Motion animates the difference.

## Vocabulary

- **Module** › **Unit** › **Topic** › **Scene** › **Step**. URLs address topics: `/:locale/:module/:unit/:topic`.
- A **Scene** owns a **World**. A **Step** = `{ id, say, do }`. `say` is 1–2 sentences of narration.
  `do` is an ordered list of **commands** (typed data). `state[n] = reduce(world0, steps[0..n])`.

## World model

```ts
type World = {
  layout: LayoutPreset // 'row' | 'pair' | 'triangle' | 'hub' | 'ring' | 'grid' (hints, not pixels)
  actors: Record<ActorId, Actor> // people/devices/servers; ordered by insertion
  messages: Message[] // in flight between actors
  marks: Mark[] // highlights, callouts, conflicts, checks — transient unless sticky
  clock: number // a logical "now" shown in the corner when a scene uses timestamps
}

type Actor = {
  id: ActorId // 'alice' | 'bob' | 'carol' | 'server' | 'laptop' | …
  kind: 'person' | 'device' | 'server' | 'service'
  label: string // display name (localizable)
  color: ActorColor // semantic palette slot: 'a' | 'b' | 'c' | 'd' | 'server' | 'neutral'
  online: boolean // offline actors are drawn dimmed with a "no connection" badge
  holds: Record<string, Value> // named values this actor has a copy of, e.g. { doc: … }
}

// Values are a typed tree. The renderer knows how to draw each kind. CRDT "sidecar" metadata lives in `meta`.
type Value =
  | { kind: 'scalar'; value: string | number | boolean | null; meta?: Meta }
  | { kind: 'record'; fields: Array<{ key: string; value: Value }>; meta?: Meta }
  | { kind: 'list'; items: Array<{ id: string; value: Value; tombstone?: boolean }>; meta?: Meta }
  | {
      kind: 'set'
      items: Array<{ id: string; value: Value; tags?: string[]; tombstone?: boolean }>
      meta?: Meta
    }
  | {
      kind: 'counter'
      perNode: Record<ActorId, number>
      negative?: Record<ActorId, number>
      meta?: Meta
    }
  | { kind: 'tree'; root: TreeNode; meta?: Meta }
  | {
      kind: 'bytes'
      bytes: number[]
      annotations: Array<{ from: number; to: number; label: string; tone?: Tone }>
    }
  | {
      kind: 'text'
      text: string
      cursor?: number
      matches?: Array<{ from: number; to: number; tone?: Tone }>
    }
  | { kind: 'clock'; entries: Record<ActorId, number> } // vector clock

type Meta = { ts?: number; node?: ActorId; tag?: string; tombstone?: boolean; note?: string }
```

## Commands (primitive, concept-agnostic)

```ts
| { t: 'spawn'; actor: Actor }                         // add an actor (animates in)
| { t: 'remove'; actor: ActorId }                      // animates out
| { t: 'set'; path: Path; value: Value | Scalar }      // replace value at path (auto-highlights the change)
| { t: 'patch'; path: Path; meta: Partial<Meta> }      // update sidecar metadata only
| { t: 'insert'; path: Path; index: number; item: … }  // list/set insert
| { t: 'delete'; path: Path; id: string; tombstone?: boolean }
| { t: 'move'; path: Path; id: string; to: number }    // reorder in a list
| { t: 'send'; from: ActorId; to: ActorId | ActorId[]; payload: Value | { ref: Path }; id?: string; label?: string }
| { t: 'deliver'; message: string; into?: Path }       // message lands; optional: write payload into a path
| { t: 'drop'; message: string }                       // message lost (animates a poof)
| { t: 'offline'; actor: ActorId } | { t: 'online'; actor: ActorId }
| { t: 'highlight'; path: Path | Path[]; tone?: Tone; sticky?: boolean }
| { t: 'callout'; at: Path | ActorId; text: string; tone?: Tone; sticky?: boolean }
| { t: 'conflict'; a: Path; b: Path }                  // draws the ⚡ between two values
| { t: 'check'; path: Path } | { t: 'cross'; path: Path }
| { t: 'tick'; by?: number }                           // advance the scene clock
| { t: 'clearMarks' }
| { t: 'layout'; preset: LayoutPreset }
```

`Path` is a string like `alice.doc.title` or `server.list[item-3]`.

## Commands (domain: CRDT-aware, computed by real code in `src/crdt/`)

```ts
| { t: 'crdt.init'; actors: ActorId[]; slot: string; type: CrdtType; args?: … }  // every actor gets its own replica
| { t: 'crdt.update'; actor: ActorId; slot: string; op: string; args: unknown[] } // e.g. op 'set' | 'inc' | 'add' | 'remove' | 'insertAfter'
| { t: 'crdt.merge'; into: ActorId; from: ActorId; slot: string }                // state-based merge (real merge())
| { t: 'crdt.sync'; a: ActorId; b: ActorId; slot: string }                       // both directions
| { t: 'crdt.broadcast'; from: ActorId; slot: string }                           // op-based: emits messages carrying the op(s)
| { t: 'crdt.apply'; message: string }                                           // op-based: apply op on arrival
```

The reducer turns CRDT state into `Value` trees via per-type `toValue()` so the renderer never knows
about CRDT internals. Fields that changed are auto-highlighted.

## Step timing & player

- A step has an optional `hold: 'short' | 'normal' | 'long'` (default normal) → base auto-advance delay.
- Speed multiplier s ∈ {0.5, 0.75, 1, 1.5, 2, 3}: transition durations × 1/s, hold × 1/s.
- Reduced motion: transitions instant, holds unchanged.
- Keyboard: ← → step, space play/pause, `.` `,` speed.

## Open questions for the design review

1. Is `Value` expressive enough for: per-field LWW maps, OR-Set tags, RGA lists with tombstones,
   vector clock comparisons, UUID byte annotation, regex matching, sorting, tree building, columnar tables?
2. Do we need explicit `focus`/zoom commands, or is layout + highlight enough?
3. How should "in context" composed documents be expressed (nested records of CRDT values)?
4. How does a lesson express _choices_ for the "Try it" sandbox (user-driven ops)?
5. What's the minimum command set that still reads well when authoring?
