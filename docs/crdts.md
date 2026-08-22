# CRDT implementations (`src/crdt/`)

Real, framework-free, pure TypeScript implementations of every data type the CRDT module teaches.
Lessons drive these; the stage shows their real state. Nothing in `src/content/` hand-writes a merge
result. Every type follows the contract in `src/crdt/types.ts` and is checked with the property laws
in `src/crdt/laws.ts` (merge commutative / associative / idempotent, state convergence under random
gossip, op convergence under random causal delivery).

Conventions shared by every type:

- **Pure and immutable.** Every function returns a new state; inputs are never mutated (tests
  deep-freeze inputs). A no-op returns the same state object.
- **Canonical, JSON-serializable state.** Record keys are kept sorted, so structurally equal
  replicas serialize to the same string (`canon()` in laws.ts is the test comparator). State can
  round-trip through `JSON.parse(JSON.stringify(s))`.
- **Sidecar metadata.** Each type keeps the metadata the algorithm needs (stamps, tags, clocks,
  tombstones) in its state, and most export an `xxxRows()` / `xxxEntries()` / `xxxFields()` helper
  that lays it out for the stage.
- **Stamps** are `{ ts, node }`, ordered by `compareStamp` (higher `ts` wins, then higher node id).
  `ts` comes from `ctx.ts`, i.e. the scene clock — lessons `tick` explicitly.
- **Dots** are unique ids `node:seq` minted from `ctx.nextSeq()` (OR-Set tags, RGA element ids,
  op-counter op ids).

## Registry

`src/crdt/registry.ts` (re-exported by `index.ts`, which re-exports every module) exposes
`crdtRegistry: Record<CrdtName, AnyCrdtType>` (name → implementation, types erased to `unknown` at
that boundary) plus `CRDT_NAMES`, `CrdtName`, `isCrdtName()` and `getCrdtType()`. Registry keys equal
each implementation's `name`:

`max-register`, `lww-register`, `lww-map`, `mv-register`, `g-counter`, `pn-counter`, `op-counter`,
`g-set`, `two-phase-set`, `lww-element-set`, `or-set`, `rga`, `lamport-clock`, `vector-clock`, `hlc`.

These are the _leaf_ names. The composed document (`docCrdt` in `doc.ts`, see below) is not a leaf
and is not in the table; it is addressed by `DOC_NAME = 'doc'` (`ReplicaTypeName = CrdtName | 'doc'`).
The registry lives in its own module so `doc.ts` can look leaves up by name without an import cycle.
`clock-skew.ts` is a plain function module, exported but not registered.

---

## Registers

### Max Register — `max-register.ts`

- The simplest register: a number that only goes up. A write lands only if it is bigger; merge keeps
  the bigger number. No stamps, no node ids, no tie-breaks: `max` is already commutative,
  associative and idempotent.
- State `{ value: number | null }`; `null` = never set and loses to any number. Update / op
  `{ set: n }`; `effect` is the same max, so replays and reordering are harmless. Values must be
  finite (NaN / ±Infinity throw `RangeError` — they break `max` and are not JSON-safe).
- Use for: high-water marks, "largest version seen", a monotonic score. Not for: anything that
  must go down or whose author/time matters (use LWW).
- Pitfall: a smaller write is silently ignored — the register cannot tell you it happened.

### LWW Register — `lww-register.ts`

- A single value plus the stamp of the write that produced it. "Last writer wins" means "greatest
  stamp wins", not "latest in real time".
- State `{ value: V | null, ts, node }`; fresh = `{ value: null, ts: -1, node: '' }` (never written).
  Sidecar: `ts` and `node` of the winning write.
- Update: replace value and stamp. Merge: keep the side with the greater `compareStamp`; equal `ts`
  → higher node id wins; identical stamps → keep `a`. Op = stamped write; `effect` ignores an op
  whose stamp is not strictly greater (replays are no-ops).
- Use for: single fields where losing one side of a race is acceptable (status, title). Not for:
  counters, sets, anything where both sides' intent must survive.
- Pitfalls: a writer must advance `ts` between its own writes (same `(ts, node)` = same write). Wall
  clocks can make an older write win (`clock-skew.ts` stages that). Lessons that want a seeded value
  can apply one `update` with a chosen ctx, or `lwwWrite(state, value, stamp)`.

### LWW Map — `lww-map.ts`

- One LWW register per key; keys never interfere, so edits to different keys both survive a merge.
- State `{ entries: Record<key, LwwRegisterState<V>> }`. Remove = tombstone (value `null` + the
  remove's stamp), kept forever. Sidecar per key: `ts`, `node`, `tombstone` (`lwwMapFields()`).
- Update: write that key's register (set or tombstone). Merge: per-key LWW over the union of keys.
  A later set revives a tombstoned key; an older concurrent set loses to the remove.
- Use for: documents/records with independent fields (settings, profiles). Not for: fields whose
  values depend on each other, or maps whose keys churn (tombstones accumulate).
- Pitfalls: `value()` omits tombstones, `lwwMapFields()` shows them; removing an unknown key still
  records a tombstone.

### MV Register — `mv-register.ts`

- Multi-value register (Dynamo / Riak). Instead of picking a winner it keeps every write no other
  write has seen; concurrent writes become _siblings_ the application must resolve.
- State `{ versions: [{ value, clock }] }` where `clock` is a per-node counter map (`MvClock`).
  Sidecar: each version's vector clock; more than one version = conflict. `mvRegisterClock()` is the
  merged clock (the Dynamo "context"); `mvHasSiblings()`.
- Update at node n: clock = join of all current clocks with `n` bumped — it dominates and drops
  everything seen. Merge: union of versions minus any version dominated by another (an antichain),
  sorted canonically. Op = the new version; `effect` merges it in.
- Use for: when silently losing a write is unacceptable and the app (or user) can pick. Not for:
  UIs that cannot show a conflict; high write rates (sibling explosion).
- Pitfalls: siblings appear exactly on concurrency; a write made after seeing both collapses them.
  Two concurrent writes of the _same_ value are still two siblings.

## Counters

### G-Counter — `g-counter.ts`

- Grow-only counter. Each node only ever raises its own tally; the value is the sum.
- State `{ counts: Record<node, number> }` (no entry until a node increments). Sidecar: the per-node
  table (`gCounterEntries()`).
- Update: raise own entry by an integer ≥ 1 (RangeError otherwise). Merge: per-node max. Op = the
  node's new total; `effect` = per-node max (duplicates and reordering are harmless).
- Use for: likes, views, anything that only goes up. Not for: decrements, or huge node churn (one
  entry per node forever).
- Pitfalls: merge never double counts — a stale copy can never lower a tally.

### PN-Counter — `pn-counter.ts`

- Two G-Counters: `p` for increments, `n` for decrements; value = sum(p) − sum(n).
- State `{ p: GCounterState, n: GCounterState }`. Sidecar: per node `inc` / `dec`
  (`pnCounterEntries()`). Op = `{ side: 'p' | 'n', node, count }`.
- Update: `{ inc }` raises `p`, `{ dec }` raises `n`. Merge: per-side, per-node max.
- Use for: counters that go up and down (likes/unlikes, stock adjustments). Not for: anything with
  a hard floor — concurrent decrements can push it below zero.

### Op-Counter — `op-counter.ts`

- The purely operation-based counter: each replica keeps one running total and adds every op's
  delta. Addition commutes, so order does not matter — but it is not idempotent.
- State `{ total, node, seq }` (`seq` = last op id this replica minted, so ids read `node:seq`).
  Op = `{ id: Dot, add }`.
- Update/`effect`: total += add (any non-zero integer). **`merge(a, b)` returns `a`** — this is not
  a CvRDT; do not run the state-based laws on it (only `assertOpConvergence`).
- Use for: teaching why op-based CRDTs need exactly-once delivery; the delivery layer dedupes by id.
  Not for: state-based sync.
- Pitfall (the lesson): deliver one op twice and the total is wrong — 6, not 3.

## Sets

Element sets are generic in `E`. Elements are keyed by `keyOf(e)` (g-set.ts): a string is its own
key, anything else is canonical JSON with sorted keys. Do not mix strings and non-strings in one set
(`'1'` and `1` collide). Each set exports a factory `xxxType<E>()` and a string instance `xxx`.

### G-Set — `g-set.ts`

- Grow-only set: add, never remove. Merge = union.
- State `{ items: Record<key, E> }`. No stamps, no tombstones. Op = the element.
- Use for: append-only knowledge (seen ids, members that never leave). Not for: anything that must
  be removable.

### 2P-Set — `two-phase-set.ts`

- A G-Set of adds plus a G-Set of removes (tombstones); present = added and not removed.
- State `{ added: Record<key, E>, removed: Record<key, true> }`; `twoPhaseSetRows()` marks removed
  rows. Merge = union of both records.
- Remove has the classic precondition: `prepare`/`update` throw if the element was never added on
  this replica. `effect(remove)` needs no precondition (a tombstone may arrive before its add).
- Use for: sets where "gone is gone" is fine (revoked tokens). Not for: anything users re-add — a
  tombstoned element can never come back, no matter how many times it is added.
- Pitfall: the laws tests wrap `update`/`prepare` so random removes do not throw; the real type is
  strict.

### LWW-Element-Set — `lww-element-set.ts`

- Per element, keep the newest add stamp and the newest remove stamp; present when the add is newer.
  A removed element can be added back (unlike the 2P-Set).
- State `{ adds: Record<key, { e, ts, node }>, removes: Record<key, { ts, node }>, bias }`;
  `lwwElementSetRows()` gives `addTs/addNode/removeTs/removeNode/present`. `init` takes
  `{ bias: 'add' | 'remove' }`.
- Update: stamp the add or remove with `(ctx.ts, ctx.node)`; only a newer stamp (by `compareStamp`)
  replaces the stored one. Merge: per-side, per-key newest stamp; throws if biases differ.
- **Presence rule:** newest add `ts` vs newest remove `ts`; strictly greater wins; **equal `ts` →
  `bias` decides** (add-wins or remove-wins), regardless of node id. Node ids only pick which of two
  same-`ts` adds (or removes) is stored; that never changes presence.
- Use for: sets with removes when a clock is available and a biased tie rule is acceptable. Not for:
  exact "did I see that add" semantics (use the OR-Set).
- Pitfalls: removing something never seen is allowed and hides older adds; two writes by one node
  in the same tick are a tie.

### OR-Set — `or-set.ts`

- Observed-Remove set, add-wins. Every add mints a unique tag (`node:seq`); a remove tombstones
  exactly the tags the remover has seen. Present = at least one live tag. A concurrent re-add has a
  tag the remover never saw, so it survives.
- State `{ entries: Record<key, { e, tags: Record<Dot, true> }>, tombstones: Record<Dot, true> }`.
  Sidecar: every tag per element with alive/dead, plus the global tombstones (`orSetRows()`). Op:
  `{ add, tag }` or `{ remove: key, tags }` (the observed tags). `init(node, { seed })` can pre-tag
  elements.
- Merge: union of entries and tags, union of tombstones — a tag dead anywhere is dead everywhere.
- Use for: the general-purpose replicated set (shopping carts, memberships). Not for: tiny memory
  budgets — tags and tombstones grow with every add/remove (see the cost-of-state lesson).
- Pitfalls: removing an element with no live tags is a true no-op (no seq consumed); `value()` is
  sorted by key, not insertion order.

## Sequences

### RGA — `rga.ts`

- Replicated Growable Array for text and lists. Each element has a unique id, remembers the id it
  was inserted after (its anchor, or `'HEAD'`), and is only ever tombstoned, never removed.
- State `{ nodes: Record<Dot, { id, value, after, tombstone, ts }>, order: Dot[] }` — `order` is the
  materialized sequence of all elements (tombstones included), recomputed from `nodes`.
  `rgaRows()` adds `visibleIndex`; `rgaText()` joins a string document; `rgaVisibleIds()`.
- Update: `insertAfter`/`insertAt` (index among visible elements, clamped), `delete`/`deleteAt`.
  `prepare` resolves indexes into anchor-based ops at the source. Order rule among elements sharing
  one anchor: higher `ts` first, then higher node id, then higher seq — a function of ids and
  timestamps only, so every replica agrees. Merge = union of elements with tombstone OR.
- Op-based delivery must be causal: `effect` throws if an insert's anchor or a delete's target has
  not arrived. Re-delivered ops are idempotent. `deleteAt` on an empty list yields `{ noop: true }`.
- Use for: collaborative text, ordered lists. Not for: very large documents (per-update cost is
  O(n log n) here; production RGAs index differently).
- Pitfalls: convergence never depends on `ts`, but _intent_ does — a fresh insert should carry a
  `ts` ≥ anything it has seen (Lamport rule) so `insertAt(i)` really lands at `i` next to concurrent
  siblings. Two words typed at the same spot do not interleave.

## Clocks

### Lamport clock — `lamport-clock.ts`

- One integer per node: tick before a local event/send; on receive `max(local, remote) + 1`.
  Happened-before implies a smaller stamp; the reverse is not true.
- Functions `tick`, `receive`, `stamp(c, node)`, `compareLamportStamp`; also a `CrdtType` view
  (`lamportClock`: update `{ tick }` / `{ receive }`, merge = max) so the stage can drive it.
- Use for: total-ordering events cheaply. Not for: detecting concurrency.

### Vector clock — `vector-clock.ts`

- One counter per node in a record; tick your own entry; receive = per-node max then tick; compare =
  `'before' | 'after' | 'equal' | 'concurrent'` (missing entry = 0).
- `vcTick`, `vcMerge`, `vcReceive`, `vcCompare`, `vcDominates`, `vcEquals`, `vcOf`, `vcFromNodes`.
  `CrdtType` view `vectorClock`: `init(node, { nodes })` pre-fills zero rows; op = the sender's
  clock, `effect` = merge; `equals = vcEquals` (zero row = missing row).
- Use for: detecting concurrent writes (MV register, OR-style causality). Not for: many nodes (size
  grows per node).

### HLC — `hlc.ts`

- Hybrid Logical Clock (Kulkarni 2014): `{ wall, counter, node }`. `hlcNow(prev, wallNow)` and
  `hlcReceive(prev, remote, wallNow)` keep `wall` = max physical time seen, `counter` breaks ties and
  resets when `wall` advances. Strictly increasing per node even if the physical clock goes backwards.
- `hlcCompare` (wall, counter, node), `hlcToString` → `wall.counter@node`.
- `CrdtType` view `hlcClock` (registered as `hlc`): `init(node)` = `{ wall: 0, counter: 0, node }`;
  update `{ tick: true }` = `hlcNow(s, ctx.ts)` where `ctx.ts` is the actor's physical time (the
  reducer supplies it); op = `{ stamp }` (the new reading); `value` = `{ wall, counter }`.
  `effect(s, op)`: at the source (same node) the clock adopts its own stamp, so
  `update = effect(prepare(…))`; at any other replica it is a _receive_ with
  `wallNow = max(s.wall, op.stamp.wall)` (`effect` has no ctx, so the receive is driven by the two
  clocks alone; the reducer runs the explicit receive rules with real actor time through its own
  path). A receive is an event, so `effect` is **not idempotent** (deliver each op once) and
  **op convergence is not asserted** — replicas that received different numbers of ops legitimately
  read differently. `merge` is a join on the reading (greater `(wall, counter)` by `hlcCompare`)
  that keeps the holder's `node`; `equals = hlcSameReading` (the node is identity, not state), which
  is what the merge laws and state convergence use.
- Use for: LWW-style timestamps that stay close to real time but never violate causality.

### Clock skew demo — `clock-skew.ts`

- `skewedNow(trueNow, skewMs)` and `demonstrateLwwSkew(aliceSkewMs = -5000)`: Bob writes `'draft'`
  at t=10000, Alice writes `'final'` 2 s later with her clock 5 s behind; the real `compareStamp`
  picks `'draft'` → `laterWriteLost: true`. With skew 0, `'final'` wins.
- Sidecar per write: node, value, trueTime, skewMs, stampedTime; plus winner/loser.

## Composed documents

### Doc — `doc.ts`

- A schema-driven tree of parts, merged part by part. `DocSchema` mirrors `CrdtSchema` in
  `docs/animation-dsl.md` §5.1: a leaf name (`'lww-register'`), `{ type, args? }`,
  `{ const: scalar }`, `{ map: { field: schema } }`, `{ list: schema }` (an RGA of sub-documents),
  `{ set: schema }` (an OR-Set of sub-documents). `docCrdt: CrdtType<DocState, DocUpdate, DocOp,
DocValue, DocArgs>`, `init(node, { schema })`, name `'doc'` (`DOC_NAME`).
- State `{ schema, root }` where a part is `{ kind: 'leaf', type, state }` (the real leaf state),
  `{ kind: 'const', value }`, `{ kind: 'map', fields }` (sorted), `{ kind: 'set', membership:
OrSetState<Dot>, subs }` (element = the sub-document id) or `{ kind: 'list', seq: RgaState<Dot>,
subs }`. `subs` keeps every sub-document ever created, tombstoned ones included (a concurrent edit
  to a removed item still lands; the stage can dim it).
- Update `{ path?, op, args? }` — what a `crdt.update` command carries. Paths: `''` = root, `.key`
  steps into a map field, `[id]` into a sub-document (`'items[alice:1].qty'`; `parseDocPath` /
  `formatDocPath`). Leaf parts take the per-type vocabulary (`leafUpdateFor(type, op, args)`: `set`,
  `inc`, `dec`, `add`, `remove`, `insertAfter`, `insertAt`, `delete`, `deleteAt`, `tick`, `receive`
  — exported for the reducer's plain slots too). Set parts: `add(init?)` · `remove(id)`. List
  parts: `insertAfter(anchor, init?)` · `insertAt(i, init?)` · `delete(id)` · `deleteAt(i)`. Maps and
  consts take no ops (clear errors). Unknown paths / ops / arities throw.
- `add` / `insert` mint the sub-document id with **one** `ctx.nextSeq()` (`dot(node, seq)`); the
  OR-Set tag / RGA element id reuse the same number, so the reducer's op id and the sub-document id
  coincide. `init` (`Record<field, Scalar>`, dotted keys like `'meta.color'` allowed) writes the named
  **register** leaves (`max-register`, `lww-register`, `mv-register`) with `set(v)` and the adder's
  stamp; counters start at 0, nested sets/lists empty; naming a non-register throws before any seq
  is minted. Sub-document leaves are initialized for the creator's node (deterministic everywhere).
- Op: `{ kind: 'leaf', path, op }` | `{ kind: 'set', path, op: OrSetOp<Dot>, sub? }` |
  `{ kind: 'list', path, op: RgaOp<Dot>, sub? }` with `sub = { id, init, ops }` — the real leaf
  ops that `init` produced, so `effect` at any replica recreates the sub-document exactly. Leaf
  ops for a sub-document that has not arrived throw (causal delivery, like the RGA). `effect` of a
  replayed add keeps the existing sub-document (later edits are not undone).
- Merge: map → field by field; leaf → the leaf's `merge`; const → same; set → OR-Set merge of
  membership + key-wise merge of `subs` (one-sided sub-documents are copied); list → RGA merge +
  `subs`. Throws for different schemas. `equals` (`docEquals`) compares part by part, using a leaf's
  own `equals` when it has one (clocks).
- Value: map → object; leaf → its value; const → the scalar; set → `[{ id, ...fields }]` for alive
  members in canonical (id) order; list → the same in sequence order, visible elements only. A
  non-map item shows as `{ id, value }`.
- Sidecar: `docParts(state)` → `[{ path, kind, type?, state, part, alive }]` depth-first in
  canonical order (map fields by key, set members by id, list elements in sequence order,
  tombstoned members included with `alive: false`); `type`/`state` are the backing CRDT (`'or-set'`
  - membership for a set, `'rga'` + seq for a list); `docPartAt(state, path)`; `docSchemaAt`;
    `normalizeDocSchema`.
- Use for: the in-context examples (shopping list, poll, todo list) — every part is the real type,
  so every law a leaf obeys, the document obeys. Not for: `op-counter` leaves under state-based
  sync (its merge is not a join), or clocks inside set/list items (their node would be the creator's).
- Pitfall: removing a set member wins over concurrent edits to it (the id cannot be re-added; the
  edits sit in the tombstone). Laws tests drive `docCrdt` through symbolic updates that resolve ids
  against the local state (see `doc.test.ts`).

---

## How lessons drive these

The contract is `CrdtType<S, U, O, V, A>` in `src/crdt/types.ts`:

| Method                   | Used by                      | Meaning                                                   |
| ------------------------ | ---------------------------- | --------------------------------------------------------- |
| `init(node, args)`       | `crdt.init`                  | Fresh replica state for an actor.                         |
| `update(state, u, ctx)`  | `crdt.update` (state-based)  | Local change; equals `effect(state, prepare(state, u))`.  |
| `prepare(state, u, ctx)` | `crdt.update` then broadcast | Build the op at the source (may read state).              |
| `effect(state, op)`      | `crdt.apply`                 | Apply an op at any replica; commutes with concurrent ops. |
| `merge(a, b)`            | `crdt.merge` / `crdt.sync`   | State-based join: commutative, associative, idempotent.   |
| `value(state)`           | `toValue()`                  | The user-visible value the stage shows.                   |
| `equals?(a, b)`          | tests                        | Optional semantic equality (default: canonical JSON).     |

- `Ctx = { node, ts, nextSeq() }`. The reducer builds one per actor: `node` is the actor id, `ts` is
  the scene clock at the moment of the command (lessons `tick` explicitly; `crdt.update.ts` may
  override for skew lessons), `nextSeq()` is a per-actor monotonic counter that mints dots.
  `makeCtx(node, ts)` in types.ts is the test/tooling helper.
- The reducer stores opaque replica state in `world.replicas` and never inspects it; `holds[slot]`
  is always `type.value(state)`, and the per-type row/field helpers feed the sidecar visuals.
- Op-based scenes: `prepare` at the source, `effect` at the source immediately (that is what
  `update` does), then `effect` on every other actor when the message is delivered. RGA and the
  2P-Set assume causal delivery; the op-counter assumes exactly-once; every other type tolerates
  duplicates and reordering.
- Property laws (`src/crdt/laws.ts`): `assertMergeLaws`, `assertConvergence`, `assertOpConvergence`.
  Every registered type runs all three in its `*.test.ts`, except the op-counter (op convergence
  only, by design) and the HLC (merge laws + state convergence only: its `effect` is a receive, an
  event of its own). New types must do the same.
- Op names from lesson data (`crdt.update.op` + `args`) map onto a type's Update object through
  `leafUpdateFor(type, op, args)` in `doc.ts` — the same table for plain slots and document parts.
- Adding a type: implement the contract in its own file with a header comment (algorithm in plain
  words, sidecar metadata), add tests with the three laws, register it in `index.ts`
  (`CRDT_NAMES` + `crdtRegistry`), and add a section here.
