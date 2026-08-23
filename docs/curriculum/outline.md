# Curriculum outline — v0 (to be refined)

Module: **CRDTs — Distributed Data Types**. Audience: working programmers + product people.
Promise: finish the module and you can pick the right CRDT for a given piece of data and explain why.

## Unit I — The Problem

1. more-than-one-copy — phone/laptop/server each hold a copy; concurrent edits; "Whoops".
2. locks-the-classic-answer — a lock/transaction serializes writers; works when everyone is connected.
3. locks-need-a-connection — offline device can't take the lock; latency; single coordinator.
4. not-everything-needs-a-transaction — bank balance vs. shopping list / doc title; what "wrong" costs.
5. meet-crdts — rules decided up front; merge in any order; every copy converges (eventual consistency).
6. where-they-are-used — collaborative docs, design tools, notes apps, databases, game state, and more.

## Unit II — State-based CRDTs (send your state, merge)

1. max-value — state + merge(); merge is commutative, associative, idempotent (shown, not just said).
2. lww-register — value + timestamp (+ node id tie-break). Update, merge, any order.
3. lww-map — per-field LWW; a team-assignment doc where two people edit different fields.
4. g-counter — per-node counts; merge = per-node max; value = sum.
5. pn-counter — two G-Counters; likes/unlikes.
6. g-set — union only.
7. two-phase-set — add set + removed set (tombstones); cannot re-add.
8. lww-element-set — per-element timestamps; add-wins vs remove-wins bias.
9. or-set — unique tag per add; remove only the tags you saw; re-add works.
10. in-context-shopping-list — composed doc: LWW fields + OR-Set items + PN-Counter quantities.
11. the-cost-of-state — full state on the wire; delta-state idea (brief).

## Unit III — Operation-based CRDTs (send what you did)

1. ops-instead-of-state — send operations; needs exactly-once + causal delivery.
2. every-device-needs-a-name — node ids; op ids (node, counter); UUIDs (link to UUID module).
3. op-counter — increments commute.
4. op-or-set — add(tag) / remove(seen tags) under causal delivery.
5. sequences-rga — insert-after-id, tombstones, tie-break on concurrent insert; collaborative text.
6. in-context-collab-text — two people typing at once; a todo list with reorder.
7. tombstones-and-garbage — why deletes leave markers; compaction/GC ideas.

## Unit IV — Vector clocks & causality

1. wall-clocks-lie — clock skew breaks LWW; "newer" isn't always later.
2. lamport-clocks — logical time.
3. vector-clocks — per-node counters; before / after / concurrent.
4. detecting-conflicts — siblings (Dynamo-style) and resolution.
5. hybrid-logical-clocks — brief.
6. in-context-notes-sync — a notes app using vector clocks to decide what to merge.

## Unit V — Choosing & using CRDTs

1. which-crdt-for-which-data — decision table: register / counter / set / map / list.
2. composing-a-document — schema design with CRDT parts.
3. tradeoffs — state vs op; metadata growth; tombstones; GC.
4. real-systems — Automerge, Yjs, Riak, Redis, Apple Notes, Figma (what they use and why).
5. course-complete — checklist + "when to use / when not to".

## Prototype modules (one or two topics each, to prove the animation system)

- uuids: v4 (random bytes, version/variant bits annotated), v7 (time prefix → sortable).
- regex: a matcher stepping through text with a cursor; backtracking shown.
- columnar-stores: row vs column layout; partition key + clustering; why it's fast for some queries.
