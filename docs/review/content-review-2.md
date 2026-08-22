# Content review 2 — adversarial pass, Units III–V

Reviewer B — Unit III (Operation-based), Unit IV (Vector clocks & causality), Unit V (Choosing & using).
Per topic: a verdict, the fixes made in the topic file, and what was left open (with why).

**Method.** Every topic was dry-run through the real reducer (`buildTimeline(topic, { assertMode: 'throw' })`)
with a scratch Vitest printer that wrote, per frame, the narration, every actor's holds (plain values plus
sidecar meta: ts/node/hlc/tags/tombstone/vc/applied/stats/type), outbox chips and op ids, parked inbox
ids, boards, messages in flight, marks and the lint result. The printout was read twice: as a skeptical
distributed-systems engineer (is every claim exactly true for `src/crdt/`, the delivery layer in
`src/lesson/reducer/crdt.ts`, and the literature — exactly-once + causal delivery, dots and version
vectors, RGA tie-break, tombstone stability, Lamport's limitation, vector-clock verdicts, MV siblings and
collapse, HLC monotonicity, state vs ops, what Automerge / Yjs / Riak / Redis / Apple Notes / Figma
really do) and as a junior developer (undefined jargon, sentences needing two reads, ids the stage does not
show, "Whoops" without a mark, summaries that do not land). Every id, stamp, byte count (200 / 57 B),
vector and verdict in narration was checked against the frame. Two claims were checked against the
public source (Yjs `clientID` is `random.uint53` — the "53-bit" claim stands; Automerge lists have no
shipped move op — fixed). The gate (`pnpm exec vitest run src/content`), `tsc` (for this scope), oxlint
and Prettier are clean after the fixes. The scratch test was deleted.

**Fix counts (59 edits across 16 of the 18 topic files; no glossary additions were needed).**

| Category                                                                       | Count | What                                                                                                                                                                                                                                                                                                                                                                                                  |
| ------------------------------------------------------------------------------ | ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Correctness / exactness (implementation, literature, real systems)             | 23    | dedupe "belongs to every op-based CRDT", applied list as "the type's sidecar", Automerge catch-up, Automerge move op, "Yjs and Automerge prove stability", "OR-Set needs no tombstones", "safe to lose a delta", Bob's no-op gc narrated as done, "most common LWW bug", TrueTime, HLC "counter absorbs the skew" ×2, "every device shows this order", five `realWorld` lines naming non-CRDT systems |
| Navigation (topic numbers the UI does not show: "(III.1)", "[II.2](…)", "V.4") | 30    | replaced by the topic title (link text or "(see …)") or the unit numeral only, matching Reviewer A's rule                                                                                                                                                                                                                                                                                             |
| Clarity / voice / jargon                                                       | 5     | RGA tie-break wording ×2 ("bob sorts after alice" → "the higher node id goes first: bob beats alice"), OR-Set rule card, "causal LWW", "LWW the reference"                                                                                                                                                                                                                                            |
| Glossary first use                                                             | 1     | `**version vector**` in IV.3 `what-do-i-send-you` s01 (entry already existed)                                                                                                                                                                                                                                                                                                                         |

### Unit III — Operation-based CRDTs

**ops-instead-of-state** — Verdict: sound. The plain scene shows the double-apply, the real op-counter
scene shows id + applied list, the OR-Set scene parks `alice:2@bob` until `alice:1` lands; every id and
count matches the frame. Fix: `every-op-once` s10 "Every op-based CRDT needs this check. It belongs to
the code that moves ops…" → "This check lives in the code that moves ops, not in the data type. Some
types shrug off a repeat (a tagged add); a counter cannot." (a tagged OR-Set add or an RGA insert is
idempotent; only non-idempotent effects need the list). Left: none.

**every-device-needs-a-name** — Verdict: correct. The Yjs "53-bit" claim was checked against
`yjs/src/utils/Transaction.js` (`generateNewClientId = random.uint53`) and stands; Automerge 128-bit
actor ids and Cassandra host UUIDs are right; the gap-parking of `alice:3@bob` is the reducer's real
readiness rule. Fixes: none. Left: none.

**op-counter** — Verdict: correct; all totals (3 / 1 / pizza 3, sushi 1) and applied lists are computed
by the real type through the delivery layer. Fixes: `increments-commute` s09 "That list is the
**sidecar** of this type" → "The counter itself is one number; that **sidecar** list is what makes a
repeat harmless" (consistent with III.1: the list belongs to delivery, not to the counter); `team-poll`
s10 "how Yjs and Automerge catch a peer up" → "how Yjs catches a peer up" (Automerge compares change
hashes, as V.4 says); realWorld "Slack, Discord … YouTube view counts" → Redis Enterprise / Riak counters,
with reactions and view counts named as the same shape, "though most apps tally them on one server";
whenToUse "(III.1)" → "(see Ops instead of state)". Left: none.

**op-or-set** — Verdict: correct; the add/remove race is decided by tags (`bob:1` dies, `bob:2` lives),
the playlist shows an op landing in a tombstoned sub-document and a fresh counter on re-add. Fixes: rule
card "in set = one live tag" → "in the set = at least one live tag"; realWorld "Labels on an issue
(Linear, GitHub); people in a shared photo album; …" → "Riak sets and Redis Enterprise Active-Active sets
are OR-Sets; issue labels and shared-album members are the shape they fit" (the named apps are not known
to use CRDT sets); whenNotToUse "(III.1)" → "(see Ops instead of state)". Left: none.

**sequences-rga** — Verdict: correct; the tie-break (`compare … => less [stamp]`, Y before X, then Z with
stamp 2 first) is the real `rga.ts` order. Fixes: `same-anchor-tie` s05 "Higher stamp first, then higher
node id: bob sorts after alice, so Y goes first" → "Same stamp, so the higher node id goes first: bob
beats alice, and Y lands before X" (two reads became one); realWorld "Google-Docs-style editing; …" →
Yjs / Automerge / Apple Notes (per public reverse-engineering), with Google Docs named as OT, not a CRDT;
whenToUse/whenNotToUse "(III.7)" / "(III.6)" → title / "(next topic)". Left: none.

**in-context-collab-text** — Verdict: correct; "Hi! Bob" and the doubled "Buy milk" are the real RGA.
Fixes: `two-people-typing` s06 tie-break wording (as above); s11 "how collaborative editors work" → "how
CRDT text editors work" (OT editors do not); `todo-list-move` s08 "a real move op (Automerge has one)" →
"a move op the CRDT understands (Loro has one)" — Automerge's list move is published research, not a
shipped op; realWorld "Google Docs; Notion block lists; Figma layer order; Automerge lists with a move
operation" → Yjs/Automerge editors, Figma's position field (Unit V), Google Docs as OT. Left: s05 shows
an `unchanged` pill on both lists although the step also inserts (the concurrent delete is a no-op, the
insert is not); the reducer emits it per command and content cannot suppress it — acceptable, noted.

**tombstones-and-garbage** — Verdict: correct and the stability proof is real (`crdt.gc upTo` is refused
until every replica's version covers the delete). Fixes: `safe-to-collect` s10 "Real systems collect
when they can prove stability; Yjs and Automerge do" → "Few systems prove stability: Yjs and Automerge
keep every delete, only smaller (Unit V)" (Yjs keeps deleted id ranges, Automerge keeps history; this
contradicted V.3 s10); whenNotToUse "Not every type needs them: an OR-Set remove kills tags" → "Every
type pays somewhere: OR-Set dead tags, LWW-map removed keys, RGA and 2P-Set tombstones" (the stage in
III.4 and V.3 shows dead tags staying). Left: none.

### Unit IV — Vector clocks & causality

**wall-clocks-lie** — Verdict: correct; every stamp (10:06 vs 10:03, v3 dropped at 10:02, theme 10:05 vs
10:02/10:03) is the real LWW register/map under the scene clock. Fixes: s07 "the most common LWW bug"
→ "a common LWW bug"; realWorld TrueTime "atomic clocks" → "GPS and atomic clocks"; whenToUse "(IV.5)" →
"(see Hybrid logical clocks)". Left: the register ignores a lower-stamped local write (v3) — that is what
`lww-register.ts` does and what Cassandra read-reconciliation does; some libraries would accept it
locally and lose it on merge. Same lesson either way.

**lamport-clocks** — Verdict: correct; 2/3/4/5, the equal tie, `less` vs `greater` with and without a
message, and the chat order (1, 2, 3 with server clock 5) all check. Fixes: `chat-in-order` s07 "Every
device that sorts by stamp shows this same order" → "Any copy that sorts by stamp gets this same order"
(the stage only shows the server sorted); whenToUse "causal LWW" → "LWW with logical stamps". Left: none.

**vector-clocks** — Verdict: correct; all four verdicts come from `vcCompare`, the ops-sync sends exactly
the gap (5 down, 2 up, then 5 down). Fixes: `what-do-i-send-you` s01 bolds **version vector** (first use
in the unit; glossary entry existed); realWorld "the idea behind git commit graphs" → "Voldemort and Bayou
before them" (git does not use vector clocks); whenToUse "(III.7)" → "(Unit III)". Left: the course
treats "vector clock" and "version vector" as one table; the glossary keeps both entries and IV.3 names
the difference only by use. Fine for this audience.

**detecting-conflicts** — Verdict: correct; sibling vectors, fast-forward, the `{alice 3, bob 1}` collapse
and the Dynamo "eggs came back" example are all the real MV register; the Dynamo §4.4 citation is right.
Fixes: none. Left: none.

**hybrid-logical-clocks** — Verdict: correct; (10:06,0) → (10:06,1) → (10:06,2), the jump-back that the
HLC ignores, the reset to (10:07,0) and "Final (10:06,2) > Draft (10:06,0)" are the real `hlc.ts`.
Fixes: s05 "the counter absorbs the skew" → "the HLC runs ahead, and the counter keeps his edits in order
meanwhile" (the wall part absorbs skew; the counter orders); whenNotToUse "the counter absorbs small skew,
not wild clocks" → "one wild clock drags every HLC hours ahead of real time"; realWorld "many offline-first
sync engines" → names Actual Budget (its CRDT package stamps with an HLC). Left: none.

**in-context-notes-sync** — Verdict: correct; fast-forward vs concurrent vs same-field siblings and the
collapse are the real composed document. Fixes: realWorld "Apple Notes; Evernote …; Dropbox …" → Evernote
and Dropbox as siblings shown to the user, "Apple Notes merges instead (Unit V, Real systems)" (V.4 says
Notes never asks); whenNotToUse "(III.6)" → "(Unit III)". Left: none.

### Unit V — Choosing & using CRDTs

**which-crdt-for-which-data** — Verdict: sound; each race is real and the table reads as a decision aid
(data → on merge → pick → watch out). Fixes: seven link texts "[II.2](…)" etc. → topic titles;
whenNotToUse "store it by hash and LWW the reference" → "store by hash; the reference is the LWW
register". Left: the table has no row for the MV register ("the app must see the conflict") or a
grow-only counter; adding one would be a new final step — left for the author.

**composing-a-document** — Verdict: correct; per-part merge, the duplicate-card move and the column-field
fix are all computed. Fixes: s11 link "[V.4](…)" → "[Real systems](…)". Left: none.

**tradeoffs** — Verdict: mostly correct; the byte counts 200 / 57 were verified against the reducer's
`size`. Fixes: s10 "It is still safe to lose or apply twice" → "Twice is harmless; lost is not, unless
you resend it" (a lost delta is lost until re-sent); whenToUse "most real systems do this" → "many";
`cleaning-up` s04 said "both throw the tombstone away" but Bob's `crdt.gc unsafe` was a no-op on stage
(his copy got the delete by state merge and the item is a seed, whose dot is never in a version — see
concerns) → narration now "Alice wants the space back, so she throws the tombstone away…" and Bob's gc
command removed (nothing later depends on it); s12 link → "[Tombstones and garbage](…)". Left: none.

**real-systems** — Verdict: careful and well hedged (Apple Notes marked as reverse-engineered, Figma
"CRDT-inspired", Redis "(simplified)"). Fixes: `two-apps` s01 "never asks you to pick a version" → "does
not ask"; three link texts → titles. Left: none.

**course-complete** — Verdict: correct; −60, the username race and the final note are all real. Fixes:
eight link texts → titles. Left: none.

### Remaining concerns (not fixed, with why)

- **Reducer, gc of seeded items.** `gcPredicate` treats `unsafe` as "skip the proof" only when there is
  no killer op and no item dot; a tombstone whose delete arrived by state merge falls back to the item's
  own dot, and seed dots are never in any version, so `crdt.gc { unsafe: true }` is a silent no-op there
  (V.3 `cleaning-up` s04, Bob). Worked around in content; the reducer should make `unsafe` unconditional
  or reject it loudly.
- **Reducer, `unchanged` pill.** A step that applies a no-op op and a real op in one `applyAll` shows the
  pill next to a value that did change (III.6 `todo-list-move` s05). Presentation only.
- **Real-system facts** (Loro move op, Actual Budget HLC, Yjs uint53, Apple Notes reverse-engineering)
  are correct as of the public sources checked; re-verify at publish time.
- **V.1 table** lacks MV-register and G-Counter rows (see above).
- **Stage density** in V.3 `cleaning-up` s08–s12: two lists per actor stay on stage for the safe replay.
  Legible (≤ 6 fields) but busy; a fresh scene would be cleaner and is a structural change, so left.
