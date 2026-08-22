# Content review 1 — adversarial pass

Two reviewers, one file. Each section lists, per topic, a verdict, the fixes made in the topic file, and what was left open (with why).

## Reviewer A — Unit I (The Problem), Unit II (State-based), UUIDs, Regex, Columnar stores

**Method.** Every topic was dry-run through the real reducer (`buildTimeline(topic, { assertMode: 'throw' })`)
with a scratch printer that dumped, per frame, the narration, every actor's holds (plain values + sidecar meta),
boards, messages, marks and lint. The printout was read twice: as a skeptical distributed-systems engineer
(is every claim true for `src/crdt/`, `src/regex/`, `src/uuid/` and the literature?) and as a junior developer
(jargon, pronouns, numbers the stage does not show, "Whoops" without a mark, summaries that do not land).
Every number in narration (byte sizes 388/441/73/44 B, try counts 7/38/84/368, `01a028e9b500`, 2^122,
−60, 600 ms, t=… stamps) was checked against the frame. The gate (`pnpm exec vitest run src/content`),
`tsc`, oxlint and Prettier are clean for this scope after the fixes. The scratch test was deleted.

**Fix counts (40 edits in `src/`, 1 mirror edit in `docs/animation-dsl.md`).**

| Category                                                                                        | Count | What                                                                                                                                                                                                                                                                                                        |
| ----------------------------------------------------------------------------------------------- | ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Correctness / exactness (stage ≠ narration, claims about real systems)                          | 12    | v4 annotation upsert bug, "pop c1" while c1 stays on the stack, DynamoDB "per cell", Riak "LWW sets", Automerge/Yjs "OR-Set", CQL `DESC` syntax, Figma "CRDT-inspired", "deliver each state eventually", "Carol merges Alice", "title has one writer", "list with one extra item", "Alice's change is gone" |
| Navigation (topic numbers the UI does not show: "topic 1", "topic I.4", "II.11", "Unit III.5"…) | 15    | replaced by titles or the unit numeral only (units are numbered in the sidebar, topics are not)                                                                                                                                                                                                             |
| Voice / jargon / clarity                                                                        | 12    | "simply", "just" ×3, "gossip", "tokens", "run", "B-tree", "index locality", one overlong summary, one awkward sentence, one missing "(simplified)"                                                                                                                                                          |
| Glossary first use                                                                              | 1     | `**OR-Set**` in the fixture scene (mirrored in the spec §15.2)                                                                                                                                                                                                                                              |

### Unit I — The Problem

**more-than-one-copy** — Verdict: sound; the hook lands and the "silent loss" beat is marked. Fixes: s10
"Alice's change is gone" → "On the server, Alice's change is gone" (her phone still shows it; the cross is
on her copy, the callout on the server). Nothing left open.

**locks-the-classic-answer** — Verdict: correct (transaction claim is marked simplified; −60 arithmetic checks).
Fixes: whenNotToUse "(topic I.4)" → "(see Not everything needs a transaction)" (topics are not numbered in
the UI). Left: none.

**locks-need-a-connection** — Verdict: correct; the 600 ms clock and three round trips match the HUD.
Fixes: s05 "back in topic 1" → "back in More than one copy"; whenToUse "can simply wait or fail" → "can
wait or fail" (filler). Left: none.

**not-everything-needs-a-transaction** — Verdict: correct; the hand merge says "(simplified)". Fixes: s06
"a list with one extra item does not" → "a list that is wrong for a moment does not" (the merged list is
right, the point is the cost of a short wrong period). Left: none.

**meet-crdts** — Verdict: correct; every merge result is computed by the real G-Set/LWW register and the
"unchanged" pill shows order-independence. Fixes: four numbered cross-references ("topic 1" ×2, "topic
I.4", "Unit II.6") → titles / unit numeral. Left: none.

**where-they-are-used** — Verdict: fine as a gallery. Fixes: realWorld "Figma (multiplayer design)" → "Figma
(multiplayer design, CRDT-inspired)" (Figma's own write-up says it is not a true CRDT). Left: the caveat
"Names are examples; details simplified" stays; Apple Notes / Riak / Redis Enterprise are correct.

### Unit II — State-based CRDTs

**the-shape-of-a-state-crdt** — Verdict: correct; max-register laws shown with the real "no change" pills.
Fixes: s05 "Carol merges Alice, whose copy…" → "Carol merges Alice's copy, which…"; s10 "The network only
needs to deliver each state eventually" → "Each copy only needs to hear the newest state eventually, by any
route" (the lost message was never delivered — Alice re-sent); whenNotToUse "II.11 The cost of state" →
"The cost of state". Left: none.

**lww-register** — Verdict: correct (tie-break by higher node id shown with the `compare[stamp]` verdict;
stale-arrival case shows the "unchanged" pill). Fixes: whenNotToUse "(Unit IV.1)" → "(Unit IV, Wall clocks
lie)", "(Unit III.5)" → "(Unit III, Sequences)"; realWorld "a cell in Cassandra or DynamoDB (last write wins
per cell)" → "a cell in Cassandra or an item in DynamoDB global tables (last write wins)" (DynamoDB resolves
per item, not per cell). Left: the fixture's s01 says "The sidecar also remembers who wrote it" without
bolding **sidecar** (defined in II.1 and in the glossary); left as is because the fixture is the spec's
worked example (§15.1) and II.1 precedes it.

**lww-map** — Verdict: correct; per-field race and the by-whom highlight are exact. Fixes: s05 "just
smaller" → "only smaller"; whenNotToUse "II.11" → "The cost of state". Left: none.

**g-counter** — Verdict: correct; the retry scene is the right "why a table" argument (5 vs 2 vs 3 all
check). Fixes: s04 "The edges gossip" → "The two edges sync with each other" (undefined jargon);
whenNotToUse "(II.5 PN-Counter)" → "(PN-Counter, next topic)". Left: none.

**pn-counter** — Verdict: correct; 1 − 2 = −1 oversell is the right interesting case. Fixes: s06
"(topic I.4)" → "(see Not everything needs a transaction)" and tightened; cart s06 "Topic II.10 builds…" →
"Later in this unit, a shared shopping list is built this way." Left: none.

**g-set** — Verdict: correct; no edits needed. Note: acks s04 runs three syncs (Alice, Bob, Alice) while the
narration says "Alice and Bob sync with the relay" — the third is the round that brings Bob's ack to Alice;
acceptable.

**two-phase-set** — Verdict: correct; gone-is-gone shown in both orders; the ignored re-add shows the
"unchanged" pill. No edits. Note: in no-re-add s06 Dan's tombstone also lands at Carol (auto-highlighted);
s07 says "two tombstones", so it is accounted for.

**lww-element-set** — Verdict: correct; bias decides equal stamps regardless of node id, as in
`src/crdt/lww-element-set.ts`. Fixes: realWorld "Riak-style LWW sets" (Riak has no LWW set; its sets are
OR-sets) → "Cassandra set columns (one timestamp per element; a tie goes to the remove)". Left: bias s03
says "the timestamps tie and cannot decide" while the stage already shows the bias-resolved result; the next
two steps explain it — acceptable, not changed.

**or-set** — Verdict: correct; observed-remove shown by tags, "add-wins by construction". Fixes: fixture s01
`**OR-Set**` first use (mirrored in docs/animation-dsl.md §15.2); whenNotToUse "(Unit III.7)" → "(Unit III)";
realWorld "the set structures inside Automerge and Yjs maps" (not OR-Sets) → "the ORSet in Akka Distributed
Data". Left: none.

**in-context-shopping-list** — Verdict: correct; remove-beats-edit-inside is the right last race and is
marked. Fixes: s05 "the title has one writer so far" → "the title is untouched so far" (only the seed wrote
it); whenNotToUse "(Unit III.5)" → "(Unit III)". Left: none.

**the-cost-of-state** — Verdict: correct; byte counts are the reducer's real token sizes (388/441/73/44 B).
Fixes: s03 "A delta is just a small state" → "A delta is itself a small state". Left (not fixable in
narration without new steps): delta-state CRDTs in the literature need causal delivery of deltas for some
types; the lesson marks the delta "(simplified)" and uses an OR-Set, where union keeps it safe.

### UUIDs

**uuid-v4** — Verdict: bit arithmetic correct (07→47, 2d→ad, 122 bits, 2^122 ≈ 5.3×10^36). Fixes: s04 had
three `annotate(... id: 'rand')` calls that upsert by id, so the stage showed "random" only over bits
66–128 while the narration said "everything else" — now three ids (`rand-a/b/c`) and all 122 bits are
labelled; whenNotToUse "insert-heavy B-tree table" → "a table with many inserts". Left: none.

**uuid-v7** — Verdict: correct (1787392800000 = 0x01a028e9b500 verified; sort demo exact). Fixes: s05
"74 bits" → "74 bits (simplified)" (RFC 9562 lets rand_a carry a sub-ms counter); whenToUse "index locality"
→ "new rows land together in the index". Left: id2 in s07 is drawn in hex while id is canonical (builder
default); harmless.

### Regex

**step-by-step-matching** — Verdict: correct; every cursor/try count pinned by `expect`. Fixes: s08 summary
tightened ("may take more or fewer characters"); order-id s06 "just the number" → "only the number". Left:
none.

**backtracking** — Verdict: correct (38/84/368 vs 17/26/50; Cloudflare 2019, 27 min). Fixes: s03 glosses
"run" ("its run, the span it holds"); s07 "pop c1" → "back to c1" (the stage still shows c1 with ×3 — the
choice point is reused, not popped; "pop" is right in which-branch s04 where the stack empties). Left: none.

### Columnar stores

**rows-vs-columns** — Verdict: correct and marked simplified where it matters (4 B/value, whole-block
reads). No edits.

**partition-and-clustering** — Verdict: correct (ALLOW FILTERING, hot partition fix). Fixes: s01 glosses
"tokens" ("a range of hash values, called tokens"); hot-partition s05 "is still not one for this table" →
"does not fit this table"; realWorld `PRIMARY KEY ((channel_id), sent_at DESC)` is not valid CQL → "PRIMARY
KEY ((channel_id), sent_at), clustering order sent_at DESC". Left: none.

### Remaining concerns (not fixed, with why)

- Topic-level numbering: the UI shows unit numerals (I–V) but not topic numbers; all "topic N" / "II.11"
  style references in this scope were replaced with titles. Units III–V content may still carry them.
- The two fixture scenes (`lww-register` update-and-merge, `or-set` tags) are the spec's worked examples;
  only the `**OR-Set**` first-use was changed there (mirrored in the spec) to keep them verbatim.
- `the-cost-of-state`: delta delivery-order caveat (above) is left to Unit III/IV.
- `where-they-are-used` realWorld keeps product names with the "details simplified" caveat.
