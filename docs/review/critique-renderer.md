# Renderer critique — Animation DSL v1 (`docs/animation-dsl.md`)

Lens: the person who has to implement `src/stage/` and `src/lesson/reducer/diff.ts` from this spec.
Also read: `docs/stage-architecture.md` (v0), `CLAUDE.md`, `overview.md`, `docs/curriculum/*`,
`src/crdt/*` (to check that the spec's CRDT claims match the code that exists).

Questions asked of every command and every `Value` kind:

1. Is the step renderable as a static frame from `world` alone?
2. Can the renderer animate `prev → next` with the described Motion strategy from `changes` (no
   pixels, no timings in content)?
3. Does anything require timing or coordinates in lesson data?
4. Is it deterministic for `prev` / `next` / `seek`?
5. RTL, reduced motion, speed?
6. Is the TypeScript consistent (names, discriminants, optionality) and does it survive Zod?

Method note: the 14 `export type` blocks of §2–§14 were extracted and compiled standalone with
`tsc --strict` (TS 6): **0 errors**. The defects below are semantic, not syntactic.

Severity: **High** = the stage cannot do what the spec says / the spec contradicts itself in a way
that breaks a worked example or a test. **Medium** = implementable, but ambiguous enough that two
implementers would build different things, or visibly degrades frames. **Low** = polish / wording.

---

## 1. Summary

| #   | Sev    | Where           | Finding                                                                                                                  |
| --- | ------ | --------------- | ------------------------------------------------------------------------------------------------------------------------ |
| H1  | High   | §4.3, §6, §14   | Same-step `send` + `deliver` (the dominant authoring pattern) produces no `message` change → no token flight.            |
| H2  | High   | §5.1            | `crdt.merge` / `crdt.sync` "a short arc flashes" has no world or `changes` representation; static frame is mute.         |
| M1  | Medium | §2, §4.1        | `note` text is a `scalar` on a board; the ≤ 18-char scalar rule truncates every rule card in the examples.               |
| M2  | Medium | §4.1, §5.1, §13 | `remove` and `crdt.init` reuse one `t` for two shapes; Zod v4 `discriminatedUnion` throws on duplicate values.           |
| M3  | Medium | §4.3, §3        | Parked messages: no DOM home, no anchor, no path selector (`@inbox`) — the tray cannot be drawn or pointed at.           |
| M4  | Medium | §4.3, §1        | `Message.into` by look-ahead from a later `deliver` breaks `state[n] = reduce(world0, steps[0..n])` and the sandbox.     |
| M5  | Medium | §4.3, §5.1      | State-snapshot tokens (`crdt.send` full) have no compact rendering; `type`/`broadcast` can put 6–12 tokens on one arc.   |
| M6  | Medium | §2, §4.2, §15.3 | `bytes.range` documented as `(from, to]` but used as `[from, to)`; bit annotations in `hex`/`canonical` undefined.       |
| M7  | Medium | §13, §15        | The "Whoops" lint (`hold:'long'` ⇒ danger mark + next step) rejects all three worked examples.                           |
| M8  | Medium | stage-arch      | `docs/stage-architecture.md` is v0 and contradicts v1 on ~15 points the implementer will copy from.                      |
| L1  | Low    | §6, §14         | `changes` is computed before auto-highlights and after clearing transient marks → mark diff is wrong both ways.          |
| L2  | Low    | §14             | `Frame.prev` is `null` at scene start, so the first step of every scene has no diff to animate or budget.                |
| L3  | Low    | §4.4, §2        | `highlight` takes `Path[]` but `Mark.highlight` has one `path`; `id` with an array is undefined.                         |
| L4  | Low    | §4.1, §4.3      | `remove { actor }` drops in-flight messages silently; a message created parked has no defined `Change` sequence.         |
| L5  | Low    | §2, §8.2        | `ActorSpec.color` is required although "derived from `owner`"; labels in examples exceed the 12-char rule.               |
| L6  | Low    | §4.2, §15.3     | `set` on a missing **slot** is undocumented; the UUID example relies on it (`laptop.id`, `laptop.id2`).                  |
| L7  | Low    | §2, §15.3       | `laptop.now.iso` is 24 chars; the scalar rule (≤ 18) would ellipsize the example's own value.                            |
| L8  | Low    | §10, §6         | `via` landing flash is hue-only; `compare` before/after arrows need RTL mirroring; callouts on `msg:` mid-flight.        |
| L9  | Low    | §2, §5.2        | `Meta.tags` / `applied` / `vc` badges are unbounded; no overflow rule like `+n` for items.                               |
| L10 | Low    | §4.3            | Control-message `deliver` without `into` leaves no trace in the frame.                                                   |
| L11 | Low    | §9, §2          | `hub` fallback when no server/service; `Clock.show` not forced on when `tick`/`skew` are used.                           |
| L12 | Low    | §5.2, §12       | Renderer chrome strings (`opLabel`, "no change", "init", status words, "no connection") are outside i18n.                |
| L13 | Low    | §5.3, §12       | `regex.init.input/pattern` and `bytes` must be non-localizable; `text` needs bidi isolation rules.                       |
| L14 | Low    | §5.1, src/crdt  | `lamport/vector tick(n)` vs impl `{ tick: true }`; `CRDT_NAMES` lacks `max-register`/`hlc`; `Ctx.nextSeq` ×2 rule.       |
| L15 | Low    | §3, §2          | Reserved roots `board`/`msg`; item ids containing `]`; `World.seq` vs `Replica.seq` naming; `Scene.world` + `startFrom`. |
| L16 | Low    | §4.2            | `view 'bits'` without `range` = 128 bits on one row; `annotate` lanes need a deterministic stacking rule.                |

Nothing in the command set requires durations, pixels or easing in content. `Hold` is categorical,
`tick`/`skew`/`start` are logical time, ranges are indices. ✓

---

## 2. High

### H1 — Same-step `send` + `deliver` is invisible to `diffWorld` (§4.3, §6 step 3, §14)

`changes = diffWorld(prev, next)` is a **state diff**. A message that is created and delivered in the
same step is in neither `prev.messages` nor `next.messages`, so no `{ kind:'message' }` change exists,
`MessageLayer` never mounts a token, no flight animates, and `animBudget` misses the 600 ms.

This is not an edge case. It is the default pattern in the scripts: `docs/curriculum/unit-1-2.md` has
23 `send` + `deliver` pairs inside one step (I.1 s02/s03/s08/s09 …), §15.1 s07 does it
(`crdt.send` + `deliver('m2')`), and §8.5 ships two macros that only do this (`sendAndDeliver`,
`broadcastState`). `relay` also delivers and re-sends inside one command.

Two consistent fixes; pick one and write it into §6/§14:

- **(a) Event log, not state diff.** `changes` is an ordered log the reducer **emits** while applying
  commands (`sent`, `delivered`, `parked`, `dropped`, plus value/actor/mark events), then de-duplicated
  against the state diff. A message that is sent and delivered in one step yields `sent` + `delivered`
  with `transient: true`; the renderer mounts a transient token, animates `offsetDistance 0% → 100%`
  (one `travel` transition, speed-scaled, instant under reduced motion), unmounts it, and flashes the
  destination in the sender's hue with a `via` chip (see L8). Static frame: the landed value with the
  via chip — legible and honest. The `Frame.changes` snapshot tests get richer, not weaker.
- **(b) Forbid it.** Schema lint: a message id may not be created and consumed in the same step; delete
  `sendAndDeliver`/`broadcastState`; rewrite §15.1 s07 and every curriculum script into two beats.

Recommend **(a)**: the scripts read as one beat ("Alice saves. The server takes her title."), invariant 2
is preserved (the _result_ is state; the flight is the diff), and `relay` falls out for free. Either
way, §6 step 3 and §14's claim that `changes` is a pure `diffWorld` must change, because a diff cannot
see a message that lived and died inside one step.

### H2 — `crdt.merge` / `crdt.sync` have no representation for "what happened" (§5.1)

"Instant forms (no token; a short arc flashes)" — there is nothing in `world` and nothing in `Change`
that says _a merge from A to B happened on slot S_. The renderer only sees value changes on B. So:

- it cannot draw the arc flash (it does not know the pair or the direction);
- the **static frame** does not say anything converged; a learner landing on §15.2 s03 by `seek` sees
  two equal sets and an `=` link only because the author added `same(...)`.

`crdt.sync` is the most used CRDT command (130 occurrences in the Unit I/II scripts). Fix: the reducer
adds a **reducer-generated transient mark**, exactly like `unchanged`:

```ts
| { id: MarkId; kind: 'flow'; from: Path; to: Path; both?: boolean } // reducer-generated by crdt.merge/sync
```

drawn as a faint arrow between `<from>.<slot>` and `<to>.<slot>` (double-headed for `sync`), with an
`unchanged` pill on the side that did not change. Plus `Change { kind:'sync'; a; b; slot; mode }` for
hold budgeting/sound. This makes the frame legible at rest and tells `MarkLayer` what to draw-on.

---

## 3. Medium

### M1 — `note` text vs. the 18-character scalar rule (§2 legibility, §4.1)

`note` "upserts a free-standing text card (a Board whose value is a scalar)". §2: "scalar display ≤ 18
characters (middle-ellipsis)", enforced by schema. The examples' notes are 23, 41 and 70+ characters
(`merge(a, b) = max(a, b)`, `merge: newer ts wins · tie → higher node id`, the OR-Set rule). Either the
schema rejects them or the renderer ellipsizes the rule. Fix: `note` creates a Board whose value is
`{ kind:'text', text }` and the text legibility rule (≤ 2 lines × 40 chars) applies; or exempt
`board.*` scalars from the 18-char rule explicitly. Also state where boards wrap (`text` already has a
2-line rule; `scalar` has none).

### M2 — Duplicate discriminants break `z.discriminatedUnion('t', …)` (§4.1, §5.1 vs §13)

§13: "Every type in this document, discriminated on `t`/`kind`". But:

- `{ t:'remove'; actor }` and `{ t:'remove'; board }` share `t:'remove'`;
- `{ t:'crdt.init'; type: CrdtName }` and `{ t:'crdt.init'; type:'doc'; schema }` share `t:'crdt.init'`.

Zod v4 throws `Duplicate discriminator value "remove"` at schema construction
(`node_modules/zod/v4/core/schemas.js:1153`). Fix: match the builders that already exist —
`{ t:'removeBoard'; board }` (builder `removeBoard()`), `{ t:'crdt.doc'; actors; slot; schema; args? }`
(builder `crdt.doc()`). Keep `Mark` `kind:'check'|'cross'` (Zod 4 multi-value literals are fine) but say so.

### M3 — Parked messages have no home (§4.3, §3, §14)

"A parked message sits in the recipient's inbox tray." Unanswered, and each answer changes the DOM:

- Is the tray inside the `ActorCard` (then a token moving flying → parked crosses containers, which
  stage-arch §10 forbids for `layoutId`) or in the `MessageLayer` overlay, positioned at a measured tray
  anchor?
- The path grammar has `@outbox` on an actor root but no `@inbox`, so `callout('bob@inbox', 'waiting at the door')`
  — the natural mark for the offline lesson — is unexpressible. `msg:<id>` works for one token, not the tray.
- How much space does the tray reserve? If it is sized by parked count, cards resize when a message
  parks (layout glide + sibling reflow) — fine, but it must be said so `layout="position"` cards do not snap.

Fix: the card renders a `data-inbox` region (always present, `min-height` = one token row, count badge
when > 3); parked tokens stay overlay-owned and are anchored to `actor:<id>@inbox` (registry key
`path:bob@inbox`); a flying token parks by animating `offsetDistance → 100%` then `x/y` to the tray
anchor; add `@inbox` to the actor-root selectors in §3. Also decide the `Change` sequence for a message
created parked (L4).

### M4 — `Message.into` by look-ahead breaks the step invariant (§4.3, §1)

§1: `state[n] = reduce(world0, steps[0..n])`. §4.3 `Message.into`: "look-ahead from `deliver.into`";
stage-arch §7.4 `resolveMessageTargets` copies a **later** step's `deliver.into` into the send's message.
So `state[n]` depends on `steps[n+1..]`, and the sandbox (§11, "same reducer, user-generated commands")
has no future to look at, so sandbox tokens aim at the card and lesson tokens at the field — different
arcs for the same state. Fix: no look-ahead. `send.into` is the hint; `deliver.into` defaults to
`message.into`; if both are given they must agree (dry-run check). The scripts already write `into` on
`deliver`; moving it to `send` is mechanical.

### M5 — Token payload legibility (§4.3 `payload`, §5.1 `crdt.send`/`broadcast`, `rga.type`)

- `crdt.send` full state: the token's `payload` is `toValue(state)` — an OR-Set with 5 elements × tags,
  an RGA with 20 elements, a composed doc. Drawn at the arc midpoint with `ValueChip` it is a second
  card floating over the stage. Define a **compact token** for `data.kind === 'state'`: type chip +
  value-only summary (≤ 18 chars, `+n`) + `size` when present; full payload in `title`/`data-value`.
- `rga.type('alice', anchor, ' world')` mints 6 ops; `crdt.broadcast` to two recipients = 12 tokens on
  two arcs. §16.14 rejected `batch` "to keep frames legible" but the `type` macro reintroduces the
  problem. Define per-pair stacking: same-pair same-direction tokens take deterministic distinct
  `offsetDistance` (50 %, 42 %, 58 %, …) and bulge by creation order (stage-arch §4 has the bulge rule;
  lift it into the DSL), and ≥ 4 tokens collapse into one "deck" token with a count (`6 ops`). Also
  worth a lint: ≤ 3 pending ops per `crdt.broadcast`.

### M6 — `bytes.range` and bit annotations (§2, §4.2, §15.3)

- `range?: [number, number] // bytes expanded in 'bits' display (from, to]` — but the example
  `view('laptop.id','bits',[6,9])` expands bytes 6, 7, 8 and every other range in the spec is half-open
  `[from, to)` (`Annotation.to` exclusive, `laptop.id[0..6]` = 6 bytes). Fix the comment: `[from, to)`.
- §15.3 s05 annotates bits 52–64 and 66–128 while the display is `hex`. A hex digit is a nibble; bit 66
  starts mid-nibble. Define: in `hex`/`canonical`/`dec` displays, bit annotations are drawn at nibble
  resolution, rounded outward, with `title` giving the exact bits; or require `range` to cover them.
- `view` with `range` absent: say it clears `range` (the example relies on it in s05/s06).

### M7 — The "Whoops" lint rejects the spec's own examples (§13 vs §15)

"`hold:'long'` step carries a `conflict`/`cross`/danger mark, and the next step exists." §15.1 s09,
§15.2 s07 and §15.3 s08 are `hold:'long'` summary steps; two have no mark, all three are last. As
written, `pnpm test` fails on all three worked examples. Fix: scope the lint to steps whose `say`
starts with "Whoops", or make it "a `hold:'long'` step with a danger mark must have a next step".

### M8 — `docs/stage-architecture.md` (v0) contradicts v1 on the points an implementer copies

Not a DSL defect, but the implementer will open both files. Where they disagree today:

| Topic               | stage-arch v0                                                                         | DSL v1                                                                                                                                 |
| ------------------- | ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `World`             | `layout: LayoutPreset`, `clock: number`, no boards/engines                            | `layout: { preset, hub }`, `clock: Clock`, `boards`, `engines`                                                                         |
| `Message`           | no `state`/`size`; `data: unknown`                                                    | `state: 'flying' or 'parked'`, `size`, typed `MessageData`                                                                             |
| `Mark`              | no `compare`/`unchanged`                                                              | both; `callout.at: Path` (no `ActorId` alt)                                                                                            |
| `Change`            | no `board`; actor ops lack `status`/`skew`; message lacks `parked`                    | all present                                                                                                                            |
| `Replica`           | `{ type, state, seq, pending? }`                                                      | `+ schema, args, version, applied, log`; `pending: Dot[]`                                                                              |
| `CrdtView`          | `toValue(state, {showMeta})`, `opToValue(op): Value`                                  | `toValue(state, ViewCtx)`, `opLabel(op): string`                                                                                       |
| `reduce` switch     | 19 commands                                                                           | 41 (+ `status`, `skew`, `note`, `sort`, `annotate`, `view`, `duplicate`, `relay`, `compare`, `unmark`, `expect`, `crdt.gc`, `regex.*`) |
| Path grammar        | `actor(.key                                                                           | [id])*`, regex rejects `board.`/`msg:`/`@`                                                                                             | §3 grammar with roots and `@` selectors |
| `AnchorKey`         | `actor:*` \| `path:*`                                                                 | needs `msg:*`, `board:*`, `path:<actor>@clock                                                                                          | @status                                 | @outbox | @inbox` |
| Token attribute     | `data-phase=flying`                                                                   | `data-state`                                                                                                                           |
| `ring` preset CSS   | no `hub` area                                                                         | "up to five around a centre" (and ≤ 5 actors ⇒ centre + 4)                                                                             |
| Component tree      | no Board gutter, inbox tray, outbox chips, Table, Pattern, Meter, status/clock badges | all required                                                                                                                           |
| §12 recommendations | `focus`, `crdt.compare`, `crdt.apply`                                                 | rejected / renamed in v1 §16                                                                                                           |

Fix: rebase stage-arch on v1 in the same PR that lands `src/lesson/types.ts`, or mark it superseded
section-by-section. Until then it is a trap.

---

## 4. Low

- **L1 — mark diff.** §6 order: clear transient marks → run commands → `diffWorld` → add auto highlights.
  So `changes` (a) reports every transient mark of `prev` as `removed` every step (noise), and (b) never
  contains the auto highlights as `mark added`. Diff marks against `clearTransientMarks(prev)` and compute
  the diff after auto-highlighting, or state that `changes.mark` covers explicit marks only.
- **L2 — first frame.** `prev: World | null // null at scene start` loses the diff of step 1 (`crdt.init`
  - highlight in §15.1 s01). `prev` should be `world0` (`initWorld(scene.world)` or the `startFrom`
    parent's final world). Scene entry is an instant commit anyway, so nothing animates wrongly; but hold
    budget, sound and snapshot tests need the changes.
- **L3 — `highlight` arrays.** Command `path: Path | Path[]`, mark `path: Path`, `id?` on the command.
  With an array and an id, is it N marks with one id? Give `Mark.highlight` `paths: Path[]` (one mark,
  many anchors) — `compare` already does this.
- **L4 — message lifecycle edges.** `remove { actor }` "in-flight messages to/from it are dropped": emit
  `{ kind:'message', op:'dropped' }` so tokens poof instead of vanishing. A message created parked
  (offline recipient): define `sent` + `parked` in one step (token flies the arc and slots into the
  tray) vs. `parked` only (appears in the tray). Pick one; the sound layer keys on it.
- **L5 — `ActorSpec.color`.** Required by the type (`Omit` keeps it) while the comment says "derived from
  `owner` when set". Make it optional in `ActorSpec`, required in `Actor`. §8.2 `device('laptop',
'Alice · laptop', …)` is 14 chars against the 12-char label rule in §13.
- **L6 — `set` creates slots.** §4.2 says `set` creates a missing record field / list item; §15.3 uses it to
  create slots (`laptop.id`, `laptop.id2`). Say: `set` on `<actor>.<slot>` creates the slot, appended in
  `holds` order (order matters — it drives layout inside the card and Motion keys).
- **L7 — scalar length in the example.** `laptop.now.iso = '2026-08-22T10:00:00.000Z'` (24 chars) would be
  middle-ellipsized under §2. Either the 18-char rule is per `display` (records may show ≤ 24) or the
  example should hold a shorter value.
- **L8 — colour-only / RTL signals.** "Values that landed via a message flash in the sender's hue" — add
  a non-colour signal (sender dot/initial as a `via` chip) to satisfy "colour is never the only signal"
  and to make screenshots self-explanatory. `compare` verdicts `→`/`←` (before/after) imply direction:
  mirror in RTL (`rtl:-scale-x-100`) or use `≺`/`≻`. A `callout` at `msg:<id>` during the enter flight
  tracks a moving anchor: either count token flights as "in flight" in the anchor registry or mount the
  bubble after the travel transition (same `ms()` contract as the sound).
- **L9 — badge overflow.** `Meta.tags` (OR-Set), `Meta.applied` (op-counter), `Meta.vc` can each be
  long. Add the same `+n` rule as items: show ≤ 3 tags / ≤ 3 applied ids / all vc entries but compact
  (`a2 b1 c0`), full text in `title`.
- **L10 — control messages.** `deliver` without `into` for a plain payload: "the token just disappears".
  The static frame shows nothing. Auto-highlight the recipient card in the sender's hue (same `via`
  mechanism) so "lock?" arriving at the server is visible at rest.
- **L11 — layout/clock defaults.** `hub` slot "else the first server/service" — define the fallback when
  there is none (first actor). `Clock.show` defaults `false`; `tick`/`skew` in a scene with `show:false`
  moves invisible time — lint it (or auto-show on first `tick`).
- **L12 — chrome strings.** `opLabel()` output ("inc 1", "add milk #alice:3"), the `unchanged` pill ("no
  change"), the `seed` chip ("init"), `ActorStatus` words, "no connection", verdict chip titles — all
  user-visible, none in the §12 list. Route them through `t()` with keys (`stage.op.add`, …) and say so.
- **L13 — non-localizable data.** `regex.init.pattern/input`, `bytes`, UUID hex and anything referenced by
  a char/bit range or `expect` must be marked non-localizable (localizing `input` moves every cursor index).
  `text`/`pattern`/`bytes`/`list display:'text'` must render inside `<bdi dir="ltr">` (stage-arch §11
  says so for data values; the DSL should own the rule because `Value` kinds are its contract).
- **L14 — CRDT claims vs `src/crdt`.** `lamport-clock`/`vector-clock` ops are `tick(n = 1)` in §5.1; the
  implementations accept `{ tick: true } | { receive }` (no count). `CRDT_NAMES` lacks `max-register` and
  `hlc` (tracked in §17; `hlc.ts` is free functions, not a `CrdtType`). "`Ctx.nextSeq()` returns that
  same number on its first call" — also say what happens when a type calls it twice in one `prepare`
  (doc `add` on a `{ set }` of sub-documents): `replica.seq` advances by the count, the op id is the
  first, and `version[actor]` counts seqs, not ops.
- **L15 — naming/grammar nits.** `board.rule` also parses as actor `board`, slot `rule`: reserve `board`
  and `msg` as actor ids in the schema. `insert` with a scalar item sets `id = String(value)`: a value
  containing `]` is unaddressable — lint. `World.seq` (message/mark counter) and `Replica.seq` (op
  counter) share a name; call the first `ids`. `Scene.world` is required even with `startFrom`: make it
  optional or say it is ignored.
- **L16 — bytes/annotation layout.** `view 'bits'` with no `range` is 128 bits (~150 chars) on one row:
  define wrapping (4 bytes per row) or require `range` for `bits`. Overlapping annotations (§15.3 s05
  has four) need a deterministic lane assignment (sort by `from`, then `id`; first free lane) so two
  renders — and LTR vs RTL — stack identically.

---

## 5. Renderability matrix

Static = renderable from `world` alone. Diff = animatable from `changes` + Motion without pixels in
content. RM/speed/RTL = covered by `tr()`/`ms()`, `MotionConfig`, measured overlays, logical CSS —
"✓" unless noted.

| Command / kind                                                                                 | Static | Diff | Notes                                                                                  |
| ---------------------------------------------------------------------------------------------- | :----: | :--: | -------------------------------------------------------------------------------------- |
| `spawn` / `remove actor`                                                                       |   ✓    |  ✓   | `AnimatePresence` + `layout="position"`; L4 for dropped messages                       |
| `remove board` / `note`                                                                        |   ✓    |  ✓   | M1 (text length), M2 (discriminant)                                                    |
| `layout`                                                                                       |   ✓    |  ✓   | grid areas; RTL mirrors by `direction`; L11 hub fallback                               |
| `tick` / `skew` / `status`                                                                     |   ✓    |  ✓   | HUD/badges; renderer formats by `clock.format`/`start`; L11                            |
| `offline` / `online`                                                                           |   ✓    |  ✓   | dim + badge; parked tray → M3                                                          |
| `set` / `patch` / `insert` / `delete` / `move` / `sort`                                        |   ✓    |  ✓   | `layout` + `layoutId` per item; `popLayout anchorX` by dir; L6                         |
| `annotate` / `unannotate` / `view`                                                             |   ✓    |  ✓   | per-byte `layoutId`, crossfade text; M6, L16                                           |
| `send` / `duplicate`                                                                           |   ✓    |  ✓*  | token at 50 %; *same-step deliver → H1; stacking → M5; `into` look-ahead → M4          |
| `deliver` (plain / state / op / stamp)                                                         |   ✓    |  ✓*  | exit 50→100 %, via flash; H1; L10 (no `into`)                                          |
| `deliver { park }`                                                                             |   ✓*   |  ✓*  | *only once the tray exists → M3                                                        |
| `drop`                                                                                         |   ✓    |  ✓   | poof                                                                                   |
| `relay`                                                                                        |   ✓    |  ✓*  | original delivered + N sent — works only under H1(a)                                   |
| `highlight` / `callout` / `conflict` / `check` / `cross` / `compare` / `unmark` / `clearMarks` |   ✓    |  ✓   | L3, L8                                                                                 |
| `unchanged` (generated)                                                                        |   ✓    |  ✓   | pill                                                                                   |
| `expect`                                                                                       |  n/a   | n/a  | invisible                                                                              |
| `crdt.init` / `crdt.update`                                                                    |   ✓    |  ✓   | outbox chips appear (derived; diff by presence — no `Change` kind, L1-adjacent)        |
| `crdt.send` / `crdt.broadcast`                                                                 |   ✓    |  ✓   | M5 token size/stacking; offline → parked (M3)                                          |
| `crdt.merge` / `crdt.sync`                                                                     |   ✗    |  ✗   | **H2** — nothing marks the merge                                                       |
| `crdt.gc`                                                                                      |   ✓    |  ✓   | tombstones exit; meta badges change                                                    |
| `regex.init` / `regex.advance`                                                                 |   ✓    |  ✓   | cursor = `layout` caret; annotations = generic value diff; L13 (bidi, non-localizable) |
| **Value kinds**                                                                                |        |      |                                                                                        |
| `scalar` / `record` (card, tree)                                                               |   ✓    |  ✓   | tree re-parenting has no command (stage-arch mentions it) — drop the mention           |
| `list` (row/column/text) / `set`                                                               |   ✓    |  ✓   | ≤ 8 visible + `+n`; `text` display needs bidi isolation                                |
| `counter` / `clock`                                                                            |   ✓    |  ✓   | rows in `actors` order (contract ✓)                                                    |
| `table`                                                                                        |   ✓    |  ✓   | column band `.key` anchor = union of header + last cell (`<col>` has no box)           |
| `bytes` / `text` / `pattern`                                                                   |   ✓    |  ✓   | M6, L16; `<bdi dir="ltr">`                                                             |
| `meter`                                                                                        |   ✓    |  ✓   | animate width via Motion, not CSS transitions                                          |
| `Meta` badges                                                                                  |   ✓    |  ✓   | L9 overflow; `hlc` wall formatted by `clock.format`                                    |

Determinism: message/mark ids (`world.seq`), op ids (`replica.seq`), bulge/stack order (creation order),
auto-highlights and `unchanged` marks are all pure functions of the step list → `prev`/`seek` are exact.
The only impurity found is M4 (look-ahead), which is deterministic but violates the stated invariant
and differs between lesson and sandbox.
