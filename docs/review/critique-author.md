# Animation DSL v1 — lesson-author critique

Lens: a lesson author writing real topic files against `docs/animation-dsl.md` (v1) with nothing
but the §8 authoring API. Method: write six hard scenes end to end, note every place the spec
forced a guess (`// ASSUME`), could not express the frame I wanted (`// GAP`), or made me type more
than the idea needed (`// VERBOSE`). Ids, stamps and merge results in the scripts were worked out
against the real code in `src/crdt/` (RGA sibling order, OR-Set tags, MV-Register clocks,
PN-Counter rows).

Severity: **BLOCKER** = the scene cannot be written without inventing semantics. **HIGH** = the
scene can be written but the frame or the test contract will be wrong. **MEDIUM** = authoring
hazard or a gap that will recur across topics. **LOW** = ergonomics / one-line clarifications.

---

## 1. Findings

### BLOCKER

**B1 — `{ set: schema }` (OR-Set of sub-documents) has no op semantics.** §5.1 says `add(v)` on a
`{ set }` "creates a sub-document" keyed by the add's tag, and nothing else: what `v` is, how the
sub-document's leaves start (an LWW `name` needs a value _and_ a stamp; a `pn-counter` starts at 0),
and what `remove` takes (the sub-document id? the value?). Scene 4 (shopping list) is unwritable
without guessing; `items[alice:1].qty` paths in §3 assume the answer.
_Fix:_ add a row to the op table: `doc · { set }: add(init?: Record<field, Scalar>)` → new
sub-document with id = this op's id; every register leaf named in `init` receives `set(value)`
with the adder's stamp; counters 0; nested sets/lists empty. `remove(id)` by sub-document id (the
OR-Set element _is_ the id). `opLabel`: `add {name: milk} #alice:1`, `remove alice:1`.

**B2 — `crdt.doc()` schema argument contradicts the `CrdtSchema` grammar.** §8.4 writes
`crdt.doc(actors, 'list', { title: 'lww-register', items: { set: { name: 'lww-register', qty: 'pn-counter' } } })`.
Neither the outer object nor `{ set: { name, qty } }` is a `CrdtSchema` (`{ set }` must wrap a
schema node, not a field record). §8.4 also offers `S.map / S.set(S.map(...))`, which is explicit.
_Fix:_ `crdt.doc(actors, slot, fields: Record<string, CrdtSchema>, args?)` — the argument is the
field record of an implicit top-level map; nested nodes are `CrdtSchema` (`S.set(S.map({...}))`).
Fix the example.

### HIGH

**H1 — Same-step send + deliver is invisible to `changes = diffWorld(prev, next)` (§6.3, §14).**
A message created and delivered inside one step exists in neither world, so the diff has no
`sent`/`delivered` change, no token animates, no bloop, `animBudget` ignores it, and
`Change.value.via` cannot be known from a diff. The spec's own 15.1 s07 (`crdt.send` + `deliver`),
`sendAndDeliver`, `broadcastState`, `applyAll` after `crdt.sync mode:'ops'`, and my scene 2 s09 all do
this. _Fix:_ define `changes` as the reducer's per-command event log (sent / parked / delivered /
dropped / value via) reconciled with the world diff, and state that a same-step send+deliver still
animates the full arc; or lint-forbid same-step send+deliver and drop the two macros.

**H2 — Marks are computed when the command runs but drawn on the end-of-step frame.** `compare`
followed by the merge it motivates in one step (v0 IV.4 s04 did exactly this) draws a `before` chip
over two clocks that are now equal; a `conflict` between two siblings that collapse later in the same
step leaves an anchor that no longer resolves. §13 checks paths "at the step where each command
runs", so the dry-run passes. _Fix:_ one sentence — "mark anchors are re-resolved against the
end-of-step world; unresolvable → `ReducerError`" — plus a lint: a `compare`/`conflict` path that a
later command in the same step mutates is an error. Authoring rule: the compare gets its own step
(my scenes 3 and 1 do this).

**H3 — No computable verdict for a stamp tie-break.** Scene 1 (RGA, same anchor, same ts) and the
II.2 `tie-break` scene must show "equal ts → higher node id wins". `compare` on two `@ts` gives
`equal`; node ids are strings, so `compare` on `@node` gives `different`. The one thing the frame
must prove is narration-only. _Fix:_ `compare` over two item/field paths whose nodes carry
`meta.ts` + `meta.node` computes `compareStamp` → `less`/`greater`, and the chip shows the reason
(`ts =` → `node`). Four lines in §10.

**H4 — RGA stamps come from the scene clock; the Lamport rule is the author's job, and `autoTick`
is ambiguous.** `Ctx.ts = clock.now + skew` for every type. An RGA insert that is not preceded by
`tick()` carries ts 0 like the seed, so its position among existing siblings is decided by the seq
tie-break — it happens to work in scene 1 only because seeds have lower seqs. `crdts.md` explicitly
says a fresh insert should carry ts ≥ anything seen. `clock.autoTick` = "advance before every
crdt.update that stamps a timestamp" — if that includes RGA, two concurrent inserts can never tie
and the tie-break lesson is unwritable; if it excludes RGA, the intent hazard stays. _Fix:_ list the
types `autoTick` touches (`lww-register`, `lww-map`, `lww-element-set`, `max-register`; not `rga`);
give `rga` `args.stamp: 'clock' | 'lamport'` (default `lamport` = max ts seen at this replica + 1,
matching the implementation's own advice) and say so in the op table.

**H5 — The "Whoops" lint (§13) fails the spec's own examples.** "A `hold:'long'` step carries a
`conflict`/`cross`/danger mark, and the next step exists" — 15.1 s09, 15.2 s07, 15.3 s08 are
summary steps with `hold:'long'`, no danger mark, and no next step. Every topic ends like that.
_Fix:_ key the lint on tone `danger` (or a `whoops: true` step flag), not on `hold`.

### MEDIUM

**M1 — Item ids derived from localizable data values break paths under overlays.** `list(['milk'])`
ids = values; OR-Set item id = `keyOf(e)`; MV-Register sibling ids = the value. §12 says data
values are localizable. A Spanish overlay that turns `'milk'` into `'leche'` would make
`alice.cart[milk]` unresolvable if the overlay touched the world. _Fix:_ state in §12 that overlays
are render-time only, the world is always computed from the authored data, ids never change, and
item labels are translated by id at draw time.

**M2 — MV-Register siblings are hard to address and under-specified.** Sibling ids are "the value
for scalars" → paths like `server.cart[milk, eggs]@vc` (legal per §3, ugly in `data-path` and
narration), and `v1…` for non-scalars, which are _positional in canonical order_ — `server.cart[v1]`
can change meaning between steps. After the register becomes a set, the root `@vc` (the Dynamo
"context" the client hands back) is not defined. How a non-scalar register payload
(`['milk','eggs']`, an object) becomes a `Value` is unspecified for `lww`/`mv`. _Fix:_ sibling ids
`s1…` in canonical order **and** `[0]` index addressing on `set` values; root `meta.vc` = joined
clock whenever a register has ≥ 1 version; `fromJson(v)` in §5.2 (array → list, ids by index;
object → record).

**M3 — `compare` on `@vc` metas and on tokens.** §10 defines the clock verdict for "two `clock`
values"; `@vc` is a `Meta` key (a `VectorClock`, not a `Value`). Say it compares like a clock. The
natural Dynamo frame compares the store's clock with the _token's_ clock, but `msg:` "takes the
rest verbatim" (fan-out ids contain `@`), so no selector can reach a payload's meta. _Fix:_ one
sentence for `@vc`; either allow `{ msg: id, meta: 'vc' }` in `compare.paths` or document the
workaround (compare with the sender's copy, which equals the snapshot).

**M4 — Several tokens on one arc overlap.** "A flying message sits at the midpoint of its arc";
`crdt.broadcast` with N pending ops (scene 1 s05: two), or the `type` macro (III.6: six tokens) puts
N tokens on the same midpoint. _Fix:_ tokens on the same (from, to) arc stack along the arc in
creation order; beyond 3, a `+n` pill.

**M5 — Op-message payload is unspecified.** `crdt.broadcast` "turns each pending op into one
`{ kind:'op' }` message" — what `payload` (the thing the token shows) is, is not said; the
`opLabel` example `remove {bob:1}` omits the element, so a remove token is unreadable. _Fix:_
`payload = { kind:'scalar', value: opLabel(op), meta: { tag: opId, tags?: removedTags } }`; label
formats `add milk #alice:1`, `remove milk {alice:1}`, `insert "h" after alice:1`, `delete alice:1`.

**M6 — Positional i18n keys `do[<index>]` churn on invisible commands.** Adding an `expect` (the
normal outcome of a review) shifts the keys of every later `callout`/`note` in the step. _Fix:_
index only commands that carry localizable fields, per kind (`callout[0]`, `note[0]`, `send[0]`), or
make `textId` required on `callout`/`note`.

**M7 — Narration lints are too literal.** (a) "Any number in `say` must appear in `data-value`":
"16 bytes", "48 bits", "74 in all", "2^122", "t=3 beats t=1" have no value node; words pass,
digits fail. (b) Sentence counting by `.` will split `a.*b`, `0.5`, `alice:1`, `…b501`. _Fix:_ lint
only tokens shaped like ids/clocks/values (`\w+:\d+`, `\{.*\}`, `t=\d+`, quoted values); accept
`Annotation.label` and meter/HUD text as `data-value`; tokenise code-ish spans before counting
sentences.

**M8 — Regex engine contract is too coarse for authoring.** `until:'step'` is one test, so a greedy
`.*` over 4 chars is 4–5 commands whose count the author cannot know without running the engine
(scene 6 s03); there is no `'token'` (pattern cursor advances) or `'fail'` event; `tries` is not
defined (tests? backtracks?); `regex.init` on an actor that already has engine slots (re-init for the
lazy variant) is unspecified; `text.cursor`/`pattern.cursor`/pattern tokens/stack items have no
path, so `expect`/`highlight` cannot pin them; plain values of `text`/`pattern`/`meter` for
`expect` are not listed in §4.5. _Fix:_ add `until: 'token' | 'fail'`; define `tries` = character
tests; re-init resets the five slots; `@cursor` pseudo-selector on `text`/`pattern`;
`pattern[tokenId]` with stable ids `p0…`; stack items `c1…`; `expect` plain: text → string,
pattern → source, meter → value.

**M9 — RGA `display:'text'` does not say the ids are drawn.** v0 C8 had "ids beneath"; v1 says only
"draws one-character items as a line". Scene 1's narration names `alice:1`, `bob:1`; the number
lint needs those in `data-value`. _Fix:_ "text display draws each character with its id (and ts)
beneath; tombstones struck through; `data-value` = the id".

**M10 — `bytes.range` comment contradicts the example.** The type says `(from, to]`; 15.3 s04 uses
`[6, 9]` to expand bytes 6–8 (i.e. `[from, to)`). Bit-unit annotations that span non-expanded bytes
(`66..128` while only 6–8 are expanded) are undefined. _Fix:_ `[from, to)`; bit annotations over
collapsed bytes snap to the byte.

**M11 — `uuid.v7({ ms, rand })` / `uuid.v4(hex)` are under-documented.** `rand` format (20 hex
chars = bytes 6–15 before masking, as 15.3 s07 implies?); whether the builder pre-annotates
(§8.2 says "bytes + version/variant annotations") and with which annotation ids, so a lesson can
`unannotate` them before building its own story. _Fix:_ document `rand`; builder annotations get
ids `time`, `ver`, `var`, `rand`.

**M12 — Scalar display ≤ 18 chars clashes with the spec's own example.** 15.3 s01 holds
`'2026-08-22T10:00:00.000Z'` (24 chars → middle-ellipsis); canonical UUID strings (36) in a list
would be ellipsised too. _Fix:_ exempt `bytes` in canonical display; raise the record-field limit to
24; use `'2026-08-22 10:00Z'` in the example.

**M13 — `crdt.sync` / `crdt.merge` with an offline participant.** Parking covers messages; the
instant forms are silent. _Fix:_ `ReducerError` — an instant merge implies a connection.

**M14 — `compare` builder is variadic, so `expect` has nowhere to go.** §8.3 shows
`compare('alice.A', 'bob.B')`; every vector-clock step wants `{ expect: 'concurrent' }`. _Fix:_
`compare(paths: Path[], opts?: { expect, sticky, id })`, `same(...paths)` stays variadic.

### LOW

- **L1** Seed helpers have no `path` form; composed-doc seeds are five literal `SeedOp`s. Add
  `seed.at(path, op, ...args)` / `seed.by(actor).at(path)…`. Also: `SeedOp.ts` default (clock.now at
  init?) and `seed.text` anchor (`HEAD`) are undocumented.
- **L2** `step(...).hold('long')` returns an object with a method, not plain data ("unknown keys
  rejected"). Use `step(id, say, cmds, { hold })` or `step.long(...)`.
- **L3** `merge('bob', 'm1')` carries a redundant actor; `apply('m1')` does not. Make it `merge('m1')`.
- **L4** `expect` collides with Vitest's `expect` in any spec that imports the builders. `assertEq`.
- **L5** Op ids are per (actor, slot); two CRDT slots on one actor both mint `alice:1`, and broadcast
  ids `alice:1@bob` collide. Prefix with the slot when > 1 CRDT slot exists, or `ReducerError`.
- **L6** `set` on `<actor>.<newSlot>` — slot creation is not listed (15.3 s02 relies on it).
- **L7** `list()` builder: does it accept `Value` items (bytes)? default ids for non-scalars? `sort`
  by `'value'` on bytes (bytewise?) is undefined.
- **L8** `crdt.send` has no `label`; a state token for a composed doc would draw a whole record.
  Define the state-token rendering (type chip + stamp/size; full value on hover) and allow `label`.
- **L9** `compare`/`same` on CRDT slots compare plain values, not sidecar — `same` says `=` when
  tags differ (15.2 s03). Document, or add `by: 'value' | 'state'`.
- **L10** RTL: `bytes`, canonical text, regex `text`/`pattern`, clock HUD must be LTR islands
  (`dir="ltr"`); the regex cursor moves LTR in an RTL page. One line in §9.
- **L11** `expect` on a `display:'text'` list: accept a string (`'what'`), not only `['w','h','a','t']`.
- **L12** `doc('list').at(path).inc(...)` cannot be typed per path; say `.at()` is loosely typed and
  validated by the dry-run, so the "compile error, not runtime surprise" claim is scoped.
- **L13** `crdt.send` "either clears `pending`" — a full-state send empties the op outbox, so a later
  `broadcast` has nothing; say "state sync and op sync do not mix in one slot".

### Verbose

- **V1** Composed-doc seeding (scene 4 s01): 5 literal `SeedOp`s with `path` — see L1.
- **V2** Greedy quantifier = N × `regex.advance('step')` — see M8 (`until:'token'`).
- **V3** Dynamo push = `crdt.send` in one step + `merge` in the next, five times in scene 3; fine,
  but a `push(from, to, slot, id)` alias for `crdt.send` + a `pull` alias for `crdt.merge` would read
  better than mixing `send`/`merge`/`crdt.merge`.
- **V4** `highlight('x@tomb', { tone: 'warn' })` recurs in every tombstone scene; a `tomb(path)`
  alias next to `bad`/`good` would be cheap.

What v1 handled well (no change): paths (`@tags`, `@tomb`, `@stats`, `[a..b]`), `crdt.broadcast` /
`apply` ids, parking, `expose`, `note`, `same`/`allSame`, `startFrom`, `expect` on everything CRDT,
`view`/`annotate` for bytes, `hub` layout with a named hub, typed per-CRDT sugar.

---

## 2. The six scripts (v1 authoring API only)

Conventions: `// ASSUME` = a guess the spec forced; `// GAP` = the frame I wanted is not
expressible; `// VERBOSE` = more typing than the idea. Ids and results in comments were computed
against `src/crdt/`.

### 2.1 RGA — concurrent insert at the same anchor, with a tombstone (III.5, scene `same-anchor`)

Start: `cat` seeded by Alice (`alice:1..3`). Alice inserts `h` after `c`, Bob inserts `w` after `c`
at the same stamp, Alice deletes `c`. Converges to `what` with the dead `c` still anchoring both.

```ts
import {
  scene,
  step,
  alice,
  bob,
  tick,
  highlight,
  conflict,
  compare,
  callout,
  clearMarks,
  same,
  expect,
  crdt,
  rga,
  seed,
  apply,
} from '@/lesson/builders'

scene(
  'same-anchor',
  {
    layout: 'pair',
    clock: { show: true },
    actors: [alice({ icon: 'laptop' }), bob({ icon: 'laptop' })],
  },
  [
    step(
      's01',
      'Both copies hold "cat". Every character has a name that never changes: alice:1, alice:2, alice:3.',
      crdt.init(['alice', 'bob'], 'text', 'rga', {
        display: 'text',
        seed: [seed.text('alice', 'cat')], // ASSUME anchors at HEAD; seed ts = clock.now (0) — neither is stated (L1)
        expose: ['stats'],
      }),
      highlight(['alice.text[alice:1]', 'bob.text[alice:1]']), // GAP M9: are ids drawn under the chars in display:'text'?
      expect('alice.text', ['c', 'a', 't']), // L11: would rather write 'cat'
    ),
    step(
      's02',
      'At time 1, Alice inserts "h" after alice:1. Her op says "after alice:1", not "at position 1".',
      tick(), // H4: without this the insert carries ts 0 like the seed; autoTick must NOT touch rga here
      rga('text').insertAfter('alice', 'alice:1', 'h'), // alice:4, ts 1
      highlight('alice.text[alice:4]'),
      expect('alice.text', ['c', 'h', 'a', 't']),
      expect('alice.text[alice:4]@ts', 1),
    ),
    step(
      's03',
      'At the same time Bob inserts "w" after alice:1. Same anchor, same stamp 1.',
      rga('text').insertAfter('bob', 'alice:1', 'w'), // bob:1, ts 1
      conflict('alice.text[alice:4]', 'bob.text[bob:1]'),
      expect('bob.text', ['c', 'w', 'a', 't']),
      expect('bob.text[bob:1]@ts', 1),
    ),
    step(
      's04',
      'Alice also deletes "c". It is not removed: it stays as a tombstone, a dead element that is still a name.',
      clearMarks(),
      rga('text').delete('alice', 'alice:1'), // alice:5
      highlight('alice.text[alice:1]@tomb', { tone: 'warn' }), // VERBOSE V4
      expect('alice.text', ['h', 'a', 't']),
      expect('alice.text[alice:1]@tomb', true),
    ),
    step(
      's05',
      'Both broadcast. Three ops are in the air: alice:4, alice:5 and bob:1.',
      crdt.broadcast('alice', 'text'), // alice:4@bob, alice:5@bob — two tokens on ONE arc (M4)
      crdt.broadcast('bob', 'text'), // bob:1@alice
    ),
    step(
      's06',
      'Bob applies alice:4. Now two elements sit after alice:1, both with stamp 1 — who goes first?',
      apply('alice:4@bob'),
      compare(['bob.text[bob:1]@ts', 'bob.text[alice:4]@ts']), // verdict 'equal' — shows the tie, not the break (H3, M14)
    ),
    step(
      's07',
      'Equal stamps: the higher node name goes first, and bob > alice. So "w" sits before "h": "cwhat".',
      callout('bob.text[bob:1]', 'tie → higher node first', { tone: 'info' }), // GAP H3: narration-only
      expect('bob.text', ['c', 'w', 'h', 'a', 't']),
    ),
    step(
      's08',
      'Bob applies the delete alice:5. The "c" becomes a tombstone on his side too: "what".',
      apply('alice:5@bob'), // deps {alice:4} satisfied; applying before alice:4 would throw — good
      highlight('bob.text[alice:1]@tomb', { tone: 'warn' }),
      expect('bob.text', ['w', 'h', 'a', 't']),
    ),
    step(
      's09',
      'Alice applies bob:1. Its anchor alice:1 is dead but still there, so "w" slots in after it: "what".',
      apply('bob:1@alice'),
      highlight('alice.text[bob:1]'),
      expect('alice.text', ['w', 'h', 'a', 't']),
    ),
    step(
      's10',
      'Both read "what". Six elements stored, four visible: the tombstone stays because ops may still point at it.',
      same('alice.text', 'bob.text'),
      highlight(['alice.text@stats', 'bob.text@stats']),
      expect('alice.text@stats', { stored: 6, visible: 4 }),
    ),
    step(
      's11',
      'Nobody won. Same anchor, same stamp, one fixed rule: every copy picks the same order.',
      callout('bob.text', 'bigger stamp first · tie → node name', { tone: 'info', sticky: true }),
    ).hold('long'), // H5: summary step, no danger mark, last step — the Whoops lint fails it
  ],
)
```

Frame check (what the stage must show): s05 two tokens on the Alice→Bob arc and one on Bob→Alice;
s06 Bob `c w h a t` with `w`/`h` both carrying `t=1`, the `=` chip between their stamps; s08/s09
`c` struck through on both cards, `stored 6 · visible 4` badges in s10.

### 2.2 OR-Set — add → remove → re-add across two replicas, tags on the wire (III.4, scene `add-remove-re-add`)

```ts
scene(
  'add-remove-re-add',
  { layout: 'pair', actors: [alice({ icon: 'phone' }), bob({ icon: 'laptop' })] },
  [
    step(
      's01',
      'An **OR-Set** gives every add a unique tag. A remove names the tags it has seen, nothing more.',
      crdt.init(['alice', 'bob'], 'cart', 'or-set'),
      note('rule', 'add → new tag · remove → the tags you saw · in set = one live tag'),
    ),
    step(
      's02',
      'Alice adds milk. The op mints tag alice:1, and the op waits in her outbox.',
      orSet('cart').add('alice', 'milk'), // alice:1
      highlight(['alice.cart[milk]@tags', 'alice@outbox']),
      expect('alice.cart[milk]@tags', [{ tag: 'alice:1', alive: true }]),
    ),
    step(
      's03',
      'She broadcasts. The op on the wire carries the element and its tag: add milk #alice:1.',
      crdt.broadcast('alice', 'cart'), // alice:1@bob — token payload unspecified (M5)
      callout('msg:alice:1@bob', 'element + tag', { tone: 'info' }),
    ),
    step(
      's04',
      'Bob applies it. His copy has milk with the same tag, alice:1.',
      apply('alice:1@bob'),
      same('alice.cart', 'bob.cart'), // compares values, not tags (L9) — fine here
      expect('bob.cart[milk]@tags', [{ tag: 'alice:1', alive: true }]),
    ),
    step(
      's05',
      'Bob removes milk. His op lists the tags he has seen for milk, {alice:1}, and milk has no live tag left.',
      clearMarks(),
      orSet('cart').remove('bob', 'milk'), // bob:1, carries tags [alice:1]
      highlight('bob.cart[milk]@tomb', { tone: 'warn' }),
      expect('bob.cart', []),
      expect('bob.cart[milk]@tags', [{ tag: 'alice:1', alive: false }]),
    ),
    step(
      's06',
      'The remove travels with that tag list. It does not say "remove milk"; it says "kill alice:1".',
      crdt.broadcast('bob', 'cart'), // bob:1@alice — the token MUST show {alice:1}; opLabel format undefined (M5)
      callout('msg:bob:1@alice', 'remove {alice:1}', { tone: 'warn' }),
    ),
    step(
      's07',
      'Alice applies it: alice:1 dies on her side too. Both carts are empty; the dead tag stays as history.',
      apply('bob:1@alice'),
      same('alice.cart', 'bob.cart'),
      expect('alice.cart', []),
    ),
    step(
      's08',
      'Alice adds milk again. A new add is a new tag: alice:2, and nothing about the old tag is reused.',
      orSet('cart').add('alice', 'milk'), // alice:2
      highlight('alice.cart[milk]@tags'),
      expect('alice.cart', ['milk']),
      expect('alice.cart[milk]@tags', [
        { tag: 'alice:1', alive: false },
        { tag: 'alice:2', alive: true },
      ]),
    ),
    step(
      's09',
      'Broadcast. Bob applies add milk #alice:2: milk is back, because alice:2 is a live tag he never removed.',
      crdt.broadcast('alice', 'cart'), // alice:2@bob
      apply('alice:2@bob'), // same-step send+deliver: invisible to diffWorld (H1)
      highlight('bob.cart[milk]@tags'),
      expect('bob.cart', ['milk']),
      expect('bob.cart[milk]@tags', [
        { tag: 'alice:1', alive: false },
        { tag: 'alice:2', alive: true },
      ]),
    ),
    step(
      's10',
      'Add, remove, add again: it works, unlike a 2P-Set. The price is one small tag per add, dead ones included.',
      same('alice.cart', 'bob.cart'),
      callout('bob.cart[milk]@tags', '1 dead + 1 live', { tone: 'info', sticky: true }),
    ).hold('long'),
  ],
)
```

Frame check: s03 token `add milk #alice:1`; s05 Bob's `milk` struck through with `alice:1` dimmed;
s06 token `remove milk {alice:1}`; s08–s10 both cards `milk · alice:1 (dead) · alice:2 (live)`.

### 2.3 Vector clocks — two concurrent writes become siblings, then resolve (IV.4, scene `siblings`)

Real `mv-register`; values are scalar strings so sibling ids stay within §3 (see M2 for why that is
painful).

```ts
scene(
  'siblings',
  {
    layout: 'hub',
    hub: 'server',
    actors: [
      server('Store'),
      alice({ icon: 'phone', label: 'Phone' }),
      bob({ icon: 'laptop', label: 'Laptop' }),
    ],
  },
  [
    step(
      's01',
      'A cart, Dynamo style: every copy carries a **version vector**, one counter per writer. Alice wrote first, so all three read {alice 1}.',
      crdt.init(['server', 'alice', 'bob'], 'cart', 'mv-register', {
        seed: [seed.by('alice', 'set', 'milk')],
      }),
      highlight(['server.cart@vc', 'alice.cart@vc', 'bob.cart@vc']),
      expect('alice.cart@vc', { alice: 1 }),
    ),
    step(
      's02',
      'Alice adds eggs on the phone. Her write bumps her own counter: {alice 2}.',
      mvReg('cart').set('alice', 'milk, eggs'),
      highlight('alice.cart@vc'),
      expect('alice.cart@vc', { alice: 2 }),
    ),
    step(
      's03',
      'Bob is offline. He adds bread on the laptop, starting from {alice 1}: his version is {alice 1, bob 1}.',
      offline('bob'),
      mvReg('cart').set('bob', 'milk, bread'),
      expect('bob.cart@vc', { alice: 1, bob: 1 }),
    ),
    step(
      's04',
      'Alice pushes her cart. The token carries the value and its version vector.',
      crdt.send('alice', 'server', 'cart', { id: 'm1' }),
    ),
    step(
      's05',
      'The store compares {alice 1} with {alice 2}: before. A fast-forward, so it just takes the new value.',
      compare(['server.cart@vc', 'alice.cart@vc'], { expect: 'before' }), // M3: @vc is a Meta, not a clock Value; M14: builder shape; GAP: cannot point at msg:m1's clock
    ),
    step(
      's06',
      'Merged. The store now reads milk, eggs at {alice 2}.',
      merge('server', 'm1'), // separate step from the compare, or the chip is drawn over equal clocks (H2)
      expect('server.cart', 'milk, eggs'),
      expect('server.cart@vc', { alice: 2 }),
    ),
    step(
      's07',
      'Bob comes back online and pushes {alice 1, bob 1}.',
      clearMarks(),
      online('bob'),
      crdt.send('bob', 'server', 'cart', { id: 'm2' }),
    ),
    step(
      's08',
      'Compare {alice 2} with {alice 1, bob 1}: each side has a bigger entry. Concurrent — neither saw the other.',
      compare(['server.cart@vc', 'bob.cart@vc'], { expect: 'concurrent' }),
    ),
    step(
      's09',
      'The store keeps both. Two **siblings**, each with its own version vector; it does not guess.',
      merge('server', 'm2'),
      conflict('server.cart[milk, eggs]', 'server.cart[milk, bread]'), // M2: ids = values → spaces and commas in paths
      callout('server.cart', '2 siblings', { tone: 'warn' }),
      expect('server.cart', ['milk, bread', 'milk, eggs']),
    ),
    step(
      's10',
      'Alice reads the cart. She gets both siblings, and the app must resolve them.',
      clearMarks(),
      crdt.merge('alice', 'server', 'cart'), // instant pull; a token here would be same-step send+deliver (H1)
      highlight('alice.cart', { tone: 'warn' }),
      expect('alice.cart', ['milk, bread', 'milk, eggs']),
    ),
    step(
      's11',
      'The app merges by union: milk, eggs, bread. Its write descends from both siblings: {alice 3, bob 1}.',
      mvReg('cart').set('alice', 'milk, eggs, bread'),
      highlight('alice.cart@vc'),
      expect('alice.cart', 'milk, eggs, bread'),
      expect('alice.cart@vc', { alice: 3, bob: 1 }),
    ),
    step(
      's12',
      'Push. {alice 3, bob 1} is after both siblings.',
      crdt.send('alice', 'server', 'cart', { id: 'm4' }),
      compare(['server.cart[milk, eggs]@vc', 'alice.cart@vc'], { expect: 'before' }), // GAP M2: root server.cart@vc (the joined "context") is undefined once siblings exist
    ),
    step(
      's13',
      'The store collapses the siblings to one value.',
      merge('server', 'm4'),
      check('server.cart'),
      expect('server.cart', 'milk, eggs, bread'),
    ),
    step(
      's14',
      'Bob pulls: one cart, three items, one version vector on every copy.',
      crdt.merge('bob', 'server', 'cart'),
      allSame('cart', ['server', 'alice', 'bob']),
    ),
    step(
      's15',
      'The version vector found the conflict; the app decided what to do about it. Two different jobs.',
      callout('server', 'detect (clock) ≠ resolve (app)', { tone: 'info', sticky: true }),
    ).hold('long'),
  ],
)
```

Frame check: s04 token `milk, eggs · {alice 2}` mid-arc; s05 `→` chip between the store's `{alice 1}`
and Alice's `{alice 2}` while the token is still flying; s08 `∥` chip; s09 the store card shows two
rows, each with its own `{…}` badge and a ⚡ between them.

### 2.4 Composed shopping list — LWW + OR-Set + PN-Counter, three phones, three syncs (II.10, scene `three-phones`)

```ts
const listSchema = S.map({
  title: S.lww(),
  items: S.set(S.map({ name: S.lww(), qty: S.pn() })), // B2: explicit S.* to dodge the crdt.doc() shorthand ambiguity
})

scene(
  'three-phones',
  {
    layout: 'triangle',
    clock: { show: true },
    actors: [alice({ icon: 'phone' }), bob({ icon: 'phone' }), carol({ icon: 'phone' })],
  },
  [
    step(
      's01',
      'One list on three phones: the title is LWW, the items are an OR-Set, and each item holds a name (LWW) and a qty (PN-Counter).',
      crdt.doc(['alice', 'bob', 'carol'], 'list', listSchema, {
        seed: [
          // VERBOSE V1 / L1: no seed helper takes a path
          { op: 'set', args: ['Groceries'], path: 'title' }, // by 'seed', ts ?? (L1)
          { by: 'alice', op: 'add', args: [{ name: 'milk' }], path: 'items' }, // alice:1 → items[alice:1]  // ASSUME B1: add(init) seeds the leaves
          { by: 'alice', op: 'inc', args: [2], path: 'items[alice:1].qty' }, // alice:2 (consumes her seq — ids are now hard to predict by eye)
          { by: 'bob', op: 'add', args: [{ name: 'eggs' }], path: 'items' }, // bob:1
          { by: 'bob', op: 'inc', args: [12], path: 'items[bob:1].qty' }, // bob:2
        ],
      }),
      highlight([
        'alice.list.title@type',
        'alice.list.items@type',
        'alice.list.items[alice:1].qty@type',
      ]),
      expect('alice.list.items[alice:1].qty', 2),
    ),
    step(
      's02',
      'Everyone goes offline for the weekend. Each phone keeps editing its own copy.',
      offline('alice'),
      offline('bob'),
      offline('carol'),
    ),
    step(
      's03',
      'Time 1. Alice renames the list and adds one more milk.',
      tick(),
      doc('list').at('title').set('alice', 'Party shop'),
      doc('list').at('items[alice:1].qty').inc('alice', 1),
      expect('alice.list.title@ts', 1),
    ),
    step(
      's04',
      'Time 2. Bob bought the eggs: he removes them, and drops milk by one.',
      tick(),
      doc('list').at('items').remove('bob', 'bob:1'), // ASSUME B1: remove by sub-document id
      doc('list').at('items[alice:1].qty').dec('bob', 1),
      highlight('bob.list.items[bob:1]@tomb', { tone: 'warn' }),
      expect('bob.list.items[alice:1].qty', 1),
    ),
    step(
      's05',
      'Time 3. Carol renames the list too, and adds bread: two titles, one race.',
      tick(),
      doc('list').at('title').set('carol', 'Sat shopping'),
      doc('list').at('items').add('carol', { name: 'bread' }), // carol:1
      conflict('alice.list.title', 'carol.list.title'),
    ),
    step(
      's06',
      'Sunday. All three are back online; Alice syncs with Bob first.',
      clearMarks(),
      online('alice'),
      online('bob'),
      online('carol'), // M13: sync while offline — error or allowed? I put online first to be safe
      crdt.sync('alice', 'bob', 'list'),
    ),
    step(
      's07',
      'Bob syncs with Carol. The title race is decided here: t=3 beats t=1.',
      crdt.sync('bob', 'carol', 'list'),
      highlight(['bob.list.title@ts', 'carol.list.title@ts']),
      expect('bob.list.title', 'Sat shopping'),
    ),
    step(
      's08',
      'Carol syncs with Alice. Three pair-syncs, in any order, and every copy is the same.',
      crdt.sync('carol', 'alice', 'list'),
      allSame('list', ['alice', 'bob', 'carol']),
    ),
    step(
      's09',
      'Title: LWW. "Sat shopping" at t=3 won; "Party shop" at t=1 lost, and nobody was asked.',
      highlight('alice.list.title@ts'),
      expect('alice.list.title', 'Sat shopping'),
    ),
    step(
      's10',
      'Eggs: OR-Set. Bob removed the only tag bob:1, and nobody added eggs again, so eggs are gone.',
      highlight('alice.list.items[bob:1]@tomb', { tone: 'warn' }),
      expect('alice.list.items[bob:1]@tomb', true),
    ),
    step(
      's11',
      'Milk qty is a PN-Counter: 2 + 1 from Alice, −1 from Bob, total 2. Both edits counted.',
      highlight([
        'alice.list.items[alice:1].qty[alice]@inc',
        'alice.list.items[alice:1].qty[bob]@dec',
      ]),
      callout('alice.list.items[alice:1].qty', '3 − 1 = 2', { tone: 'info' }),
      expect('alice.list.items[alice:1].qty', 2),
    ),
    step(
      's12',
      'Bread: a new item with tag carol:1, on all three phones.',
      highlight('bob.list.items[carol:1]@tags'),
      expect('bob.list.items[carol:1].name', 'bread'),
    ),
    step(
      's13',
      'Each part brought its own merge rule. No lock, no lost edit, no conflict screen.',
      callout('alice.list', 'LWW + OR-Set + PN, each by its own rule', {
        tone: 'info',
        sticky: true,
      }),
    ).hold('long'),
  ],
)
```

Frame check: each card = title (with `t=n · node` chip and `LWW` type chip) + an `OR-Set` block
with up to three rows (`milk`, `eggs` struck through after s04/s07, `bread`), each row `name` +
a two-row PN table. Dense but inside the §2 limits.

### 2.5 UUID v7 — read the bytes: timestamp / version / variant / random (`uuids`, scene `read-a-v7`)

```ts
scene(
  'read-a-v7',
  {
    layout: 'row',
    actors: [
      device('laptop', 'Laptop', 'a', {
        holds: {
          now: rec({ utc: '2026-08-22 10:00:00Z', ms: 1787392800000 }), // M12: the ISO form in 15.3 is 24 chars
          id: uuid.v7({ ms: 1787392800000, rand: '7be487712d66c0158af3' }), // ASSUME M11: rand = bytes 6–15 before masking
        },
      }),
    ],
  },
  [
    step(
      's01',
      'A UUID v7 is 16 bytes. Read it left to right: time first, then two fixed fields, then randomness.',
      view('laptop.id', 'hex'),
      unannotate('laptop.id'), // ASSUME M11: the builder pre-annotates; I want to build the story myself
      highlight('laptop.id'),
      expect('laptop.id', '01a028e9b5007be487712d66c0158af3'),
    ),
    step(
      's02',
      'Bytes 0–5 are the time: 01 a0 28 e9 b5 00 = 1787392800000 ms since 1970, which is 2026-08-22 10:00 UTC.',
      annotate('laptop.id', 0, 6, 'unix ms (48 bits)', { tone: 'change', id: 'time' }),
      highlight('laptop.now.ms'),
      expect('laptop.id[0..6]', '01a028e9b500'),
    ),
    step(
      's03',
      'Byte 6, top 4 bits: 0111 = 7. That is the version.',
      view('laptop.id', 'bits', [6, 7]), // M10: [from,to) per the example, (from,to] per the type comment
      annotate('laptop.id', 48, 52, 'version = 7', { unit: 'bit', tone: 'info', id: 'ver' }),
      expect('laptop.id[6]', '7b'),
    ),
    step(
      's04',
      'Byte 8, top 2 bits: 10. That is the variant, which says "a standard UUID".',
      view('laptop.id', 'bits', [8, 9]),
      annotate('laptop.id', 64, 66, 'variant = 10', { unit: 'bit', tone: 'info', id: 'var' }),
      expect('laptop.id[8]', '87'),
    ),
    step(
      's05',
      'Everything else is random: 12 bits after the version and 62 bits after the variant, 74 in all.',
      view('laptop.id', 'hex'),
      annotate('laptop.id', 52, 64, 'random (12 bits)', { unit: 'bit', tone: 'info', id: 'randA' }), // M10: bit ranges over collapsed bytes
      annotate('laptop.id', 66, 128, 'random (62 bits)', {
        unit: 'bit',
        tone: 'info',
        id: 'randB',
      }),
    ),
    step(
      's06',
      'Canonical text: 01a028e9-b500-7be4-8771-2d66c0158af3. The third group starts with 7, the fourth with 8.',
      view('laptop.id', 'canonical'),
      highlight(['laptop.id[6]', 'laptop.id[8]']),
    ),
    step(
      's07',
      'One millisecond later a new id starts …b501. A bigger time makes a bigger id, so text order is time order.',
      set('laptop.id2', uuid.v7({ ms: 1787392800001, rand: '7122b34455667788990a' })), // L6: set creates a slot?
      view('laptop.id2', 'canonical'),
      highlight(['laptop.id[5]', 'laptop.id2[5]']),
      expect('laptop.id2[0..6]', '01a028e9b501'),
    ),
    step(
      's08',
      'Sort three v7 ids as plain strings and you get time order (inside one millisecond, random order).',
      set(
        'laptop.ids',
        list([
          uuid.v7({ ms: 1787392800002, rand: '7102830405060708090a' }), // L7: list() of Values, item ids?
          uuid.v7({ ms: 1787392800000, rand: '7be487712d66c0158af3' }),
          uuid.v7({ ms: 1787392800001, rand: '7122b34455667788990a' }),
        ]),
      ),
      sort('laptop.ids', ['value']), // L7: bytewise?
      check('laptop.ids'),
    ),
    step(
      's09',
      'Anyone who sees a v7 id learns when it was made, to the millisecond. Decide if that is OK before you pick it.',
      callout('laptop.id', 'leaks creation time', { tone: 'warn', sticky: true }),
    ).hold('long'), // H5 again
  ],
)
```

Frame check: s03 bytes 6 expanded to `0111 1011` with `version = 7` over the first nibble; s05 the
hex row with three coloured bands (time / random / random) and the two bit-width labels; s08 the
three canonical strings re-ordering.

### 2.6 Regex backtracking over `a1b2b` (`regex`, scene `greedy-then-give-back`)

```ts
scene(
  'greedy-then-give-back',
  { layout: 'row', actors: [service('matcher', 'Matcher', 'neutral')] },
  [
    step(
      's01',
      'Pattern a.*b: an "a", then anything as much as possible, then a "b". Text: a1b2b.', // M7(b): "a.*b" contains a dot
      regex.init('matcher', 'a.*b', 'a1b2b'),
      callout('matcher.pattern', '3 tests', { tone: 'info' }), // GAP M8: cannot point at the .* token itself
    ),
    step(
      's02',
      'Position 0 is "a": pass. Both cursors move one to the right.',
      regex.advance('matcher', 'step'),
    ),
    step(
      's03',
      '.* is greedy. It takes 1, b, 2, b, everything to the end, and notes each grab as a place it could give back.',
      regex.advance('matcher', 'step'), // ASSUME/VERBOSE M8: one char per 'step'; count only known by running the engine
      regex.advance('matcher', 'step'),
      regex.advance('matcher', 'step'),
      regex.advance('matcher', 'step'),
      highlight('matcher.stack'),
    ),
    step(
      's04',
      'Test "b": we are at the end of the text and there is nothing there. Fail.',
      regex.advance('matcher', 'step'),
      cross('matcher.pattern'), // ASSUME: a failed non-start test is not auto-marked (§5.3 only lists failed *starts*)
    ),
    step(
      's05',
      'Backtrack: .* gives one character back and now holds 1b2. The text cursor moves to 4.',
      regex.advance('matcher', 'backtrack'),
      highlight('matcher.stack'), // GAP M8: no path to text@cursor to expect(…, 4)
    ),
    step(
      's06',
      'Try "b" at position 4: it is "b", pass. End of pattern: a match from 0 to 5, the whole text.',
      regex.advance('matcher', 'match'),
      check('matcher.text'),
    ),
    step(
      's07',
      'Note which "b" it matched: the last one. Greedy means the longest span that still matches.',
      highlight('matcher.text[4..5]'),
    ),
    step(
      's08',
      'The lazy version a.*?b takes as little as possible, then grows one character at a time.',
      regex.init('matcher', 'a.*?b', 'a1b2b'), // ASSUME M8: re-init resets the five slots
    ),
    step(
      's09',
      'It tries "b" at 1 (a "1", fail), grows by one, tries "b" at 2: pass. Match from 0 to 3.',
      regex.advance('matcher', 'match'),
      check('matcher.text'),
    ),
    step(
      's10',
      'Both are correct. They answer different questions: the longest span, or the shortest.',
      callout('matcher.pattern', 'greedy: a1b2b · lazy: a1b', { tone: 'info', sticky: true }),
    ),
    step(
      's11',
      'The cost: every give-back is a retry. One .* is cheap; nested ones are not — next scene.',
      highlight('matcher.tries', { tone: 'warn' }), // GAP M8: tries undefined, so no expect() and no number in narration
    ).hold('long'),
  ],
)
```

Frame check: s03 text `a|1b2b` with `1b2b` in the `change` band and four choice points in the
stack; s05 the band shrinks to `1b2`, stack pops one; s06 `0–5` in the `ok` band; s09 `0–3`.

---

## 3. Summary table

| #      | Severity | Where                 | One line                                                                                                                                                                                                                |
| ------ | -------- | --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B1     | BLOCKER  | §5.1 op table, `doc`  | `{ set }` add/remove semantics undefined                                                                                                                                                                                |
| B2     | BLOCKER  | §8.4 `crdt.doc`       | schema shorthand is not a `CrdtSchema`                                                                                                                                                                                  |
| H1     | HIGH     | §6.3, §14             | same-step send+deliver invisible to `diffWorld`                                                                                                                                                                         |
| H2     | HIGH     | §6, §13               | marks computed mid-step, drawn on end state                                                                                                                                                                             |
| H3     | HIGH     | §10 `compare`         | no verdict for `(ts, node)` tie-break                                                                                                                                                                                   |
| H4     | HIGH     | §5.1 Time, `autoTick` | RGA stamps need a Lamport rule; autoTick scope                                                                                                                                                                          |
| H5     | HIGH     | §13 lints             | Whoops lint fails every summary step                                                                                                                                                                                    |
| M1     | MEDIUM   | §12                   | value-derived item ids vs localizable values                                                                                                                                                                            |
| M2     | MEDIUM   | §5.1 mv-register      | sibling ids / root `@vc` / non-scalar payloads                                                                                                                                                                          |
| M3     | MEDIUM   | §10, §3               | `compare` on `@vc`; no selector on `msg:`                                                                                                                                                                               |
| M4     | MEDIUM   | §4.3                  | N tokens on one arc                                                                                                                                                                                                     |
| M5     | MEDIUM   | §5.1 broadcast, §5.2  | op-message payload / `opLabel` format                                                                                                                                                                                   |
| M6     | MEDIUM   | §12                   | positional `do[i]` keys churn on `expect`                                                                                                                                                                               |
| M7     | MEDIUM   | §13 lints             | number lint too broad; sentence lint vs `a.*b`                                                                                                                                                                          |
| M8     | MEDIUM   | §5.3 regex            | `until` granularity, `tries`, re-init, cursor/token paths, plain values                                                                                                                                                 |
| M9     | MEDIUM   | §5.1 rga, §2          | `display:'text'` — ids drawn? `data-value`                                                                                                                                                                              |
| M10    | MEDIUM   | §2 bytes, §4.2 view   | `range` `(from,to]` vs `[6,9]`; bit annotations over collapsed bytes                                                                                                                                                    |
| M11    | MEDIUM   | §5.4, §8.2            | `uuid.v7 rand` format; builder annotations + ids                                                                                                                                                                        |
| M12    | MEDIUM   | §2 limits             | 18-char scalar limit vs ISO strings / canonical UUIDs                                                                                                                                                                   |
| M13    | MEDIUM   | §5.1 merge/sync       | offline participant                                                                                                                                                                                                     |
| M14    | MEDIUM   | §8.3                  | `compare` builder has no `expect` slot                                                                                                                                                                                  |
| L1–L13 | LOW      | §8, §4.2, §5.1, §9    | seed `path` helper, `.hold()`, `merge(actor, id)`, `expect` name, id collisions, slot creation, `list()` items, state-token label, `same` on sidecar, RTL islands, text expect, `doc().at()` typing, send clears outbox |
