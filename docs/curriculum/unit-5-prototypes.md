# Unit V + prototype modules — lesson scripts and DSL stress test

Status: **draft v0** (authoring + DSL review input). Scope: Unit V (Choosing & using CRDTs) and the
prototype modules (UUIDs v4/v7, Regex, Columnar stores). Every step below carries its narration and
its commands, so this file can be lifted into `src/content/` once the DSL gaps in §3 are settled.

Companion docs: `CLAUDE.md` §4–§5 (rules), `docs/animation-dsl.md` (v0 DSL), `docs/curriculum/outline.md`.

---

## 0. Conventions used in this document

- **Command literals** are TypeScript object literals in the exact v0 shape from `docs/animation-dsl.md`.
  Anything not in v0 is tagged `// NEW (Gn)` and explained in §3 under gap _Gn_. One command per line;
  a few very short commands occasionally share a line (they are still separate entries in `do`).
- **Narration** is the `say` string: 1–2 sentences, Simple Technical English. Quoted values (`'Fix login'`)
  are shown with straight quotes so the Zod schema/i18n overlay can carry them verbatim.
- **Step ids** are `s01…` per scene. They are stable once published; append, never renumber.
- **Paths**: `actor.slot`, `.field` into records, `[id]` into list/set items, `.bytes[6]` into bytes,
  `.perNode.alice` into counters. Free-standing panels use the reserved root `board.<id>` (NEW, G4).
- **Timestamps**: LWW writes take their `ts` from `world.clock`; a `tick` precedes every LWW write
  whose order matters (G12). Node ids break ties (higher id wins — document this once in Unit II).
- **Generated ids**: items created by the real CRDT code get ids `${node}:${n}` (n = that node's op
  counter for the slot) — the `Dot` type already in `src/crdt/types.ts`. Seeded items carry
  author-chosen ids (`c1`, `t2`…). Paths in later steps reference these (G5).
- **Alignment with `src/crdt/` (as of this draft)**: `Ctx.ts` is set by the lesson from the scene
  clock (G12 confirmed); ties break on the greater node id; `mv-register` exists; RGA anchors are
  `Dot | 'HEAD'`. The composed `doc` type (G1) and `expose`/`seed` init args (G5/G11) do not exist yet.
- **CRDT op vocabulary** used with `crdt.update` (all executed by `src/crdt/`):
  `lww-register: set(v)` · `lww-map: set(k, v) | delete(k)` · `g-counter: inc(n)` ·
  `pn-counter: inc(n) | dec(n)` · `or-set: add(x) | remove(x)` ·
  `rga: insertAfter(anchor, v | 'chars…') | remove(id | id[]) | compact()` where `anchor` is an
  element id or `'HEAD'` (front) — matching `src/crdt/rga.ts`; `compact` is a teaching-only unsafe op
  (G14) · `mv-register: set(v)` · composed docs address a leaf by `path` (G1).
- **"Expected world (computed)"** blocks show what `toValue()` is expected to produce, _including the
  sidecar `meta`_, so renderer and author agree on what the stage draws. They are **not** authored
  data; the reducer computes them. `expect` lines (G8) are test-time assertions, invisible to learners.
- **Actors** (palette slots): alice=`a`, bob=`b`, carol=`c`, server/iCloud/nodes=`server`,
  devices phone/laptop=`a`/`b`, neutral panels=`neutral`. Max 4 actors per scene in this slice.
- Where v0 `callout.text` is shown, it is content and must be localizable (G13).

---

## 1. Unit V — Choosing & using CRDTs

### V.1 `which-crdt-for-which-data`

**Learning goal.** Given one piece of data and _how it changes_, pick register / counter / set / map /
list (and the right variant) and say why in one sentence.

**When to use this table**

- A field is edited on more than one device, and merges must happen without a server round-trip.
- You can describe how the field changes: replaced, added-to, members come and go, or ordered.
- You are designing a schema and want a default type per field before you write code.
- "Briefly wrong, then converged" is acceptable for this field.

**When not to use**

- The field has a rule that spans copies (balance ≥ 0, unique username, stock ≥ 0) → coordination (V.5).
- Only one writer ever exists → a plain value is fine; a CRDT adds metadata for nothing.
- The value is an opaque blob (image, PDF) → store by content hash, LWW the _reference_.
- You need "did my write win?" right now → that is a server question, not a merge question.

**Real-world anchor.** A task card in a kanban tool (Trello / Linear): title, owner, labels, votes,
checklist. Each field changes in a different way.

**Decision table (the artifact this topic builds; lives on `board.table`)**

| How does it change?                      | Example               | Use                                            |
| ---------------------------------------- | --------------------- | ---------------------------------------------- |
| A new write replaces the old value       | title, owner, status  | LWW register                                   |
| Writes add up                            | likes, quantity       | PN-Counter (G-Counter if it only grows)        |
| Many fields, edited separately           | a card, a profile     | LWW map (one register per field)               |
| Members come and go, order is irrelevant | labels, tags, members | OR-Set (2P-Set only if re-add is never needed) |
| Order matters, items inserted/removed    | checklist, text       | Sequence (RGA)                                 |

#### Scene 1 — "Replace, or add up?" (register vs. counter)

World: `layout: 'pair'`. Actors: `alice` (person, a), `bob` (person, b), both online, `holds: {}`.
Board: `board.table` = empty decision table (NEW G2/G4) with columns `how`, `use`.

- **s01** · "Alice and Bob each hold a copy of a likes count. We keep it two ways: as a register, and as a counter."
  ```ts
  { t:'crdt.init', actors:['alice','bob'], slot:'likes_reg', type:'lww-register', args:{ seed: 0 } }   // NEW args.seed (G5)
  { t:'crdt.init', actors:['alice','bob'], slot:'likes_ctr', type:'pn-counter' }
  ```
  Expected world (computed): `alice.likes_reg = {kind:'scalar', value:0, meta:{ts:0, node:'seed'}}`,
  `alice.likes_ctr = {kind:'counter', perNode:{}}` (renderer shows "0").
- **s02** · "Alice taps like. Her code reads 0, adds 1, and writes 1."
  ```ts
  { t:'tick' }
  { t:'crdt.update', actor:'alice', slot:'likes_reg', op:'set', args:[1] }
  { t:'crdt.update', actor:'alice', slot:'likes_ctr', op:'inc', args:[1] }
  ```
  Expected: `alice.likes_reg = {scalar 1, meta:{ts:1,node:'alice'}}`; `alice.likes_ctr.perNode = {alice:1}`.
- **s03** · "Bob taps like at the same time. His code also reads 0 and writes 1."
  ```ts
  { t:'tick' }
  { t:'crdt.update', actor:'bob', slot:'likes_reg', op:'set', args:[1] }
  { t:'crdt.update', actor:'bob', slot:'likes_ctr', op:'inc', args:[1] }
  ```
- **s04** · "Now the copies merge."
  ```ts
  { t:'crdt.sync', a:'alice', b:'bob', slot:'likes_reg' }
  { t:'crdt.sync', a:'alice', b:'bob', slot:'likes_ctr' }
  ```
- **s05** · "The register kept one 1 and dropped the other. One like is gone — whoops."
  ```ts
  { t:'highlight', path:['alice.likes_reg','bob.likes_reg'], tone:'bad' }
  { t:'callout', at:'bob.likes_reg', text:'one like lost', tone:'bad' }
  { t:'expect', path:'alice.likes_reg', equals: 1 }   // NEW (G8)
  ```
- **s06** · "The counter kept one tally per person: 1 + 1 = 2. Both likes count."
  ```ts
  { t:'highlight', path:['alice.likes_ctr','bob.likes_ctr'], tone:'good' }
  { t:'check', path:'alice.likes_ctr' }
  { t:'check', path:'bob.likes_ctr' }
  { t:'expect', path:'alice.likes_ctr', equals: 2 }   // NEW (G8) — counter value = sum
  ```
- **s07** · "Ask one question: does a new write replace the old value, or add to it? A title replaces; a like adds."
  ```ts
  { t:'clearMarks' }
  { t:'callout', at:'alice', text:'replace → register', sticky:true }
  { t:'callout', at:'bob', text:'add up → counter', sticky:true }
  ```
- **s08** · "Replace → register, add up → counter. Those are the first two rows of our table."
  ```ts
  { t:'insert', path:'board.table', index:0, item:{ id:'r1', cells:{ how:'replaces', use:'LWW register' } } }   // NEW table rows (G2)
  { t:'insert', path:'board.table', index:1, item:{ id:'r2', cells:{ how:'adds up', use:'PN-Counter' } } }
  { t:'highlight', path:['board.table[r1]','board.table[r2]'] }
  ```

#### Scene 2 — "One value, or many fields?" (register vs. map)

World: `layout: 'pair'`; `alice`, `bob`; `board.table` carries rows r1–r2 from Scene 1 (scenes in one
topic may declare `board` contents in their world; the table is re-declared here with two rows).

- **s01** · "The card has two fields. We keep it two ways: one register holding the whole card, and a map with one register per field."
  ```ts
  { t:'crdt.init', actors:['alice','bob'], slot:'card_reg', type:'lww-register', args:{ seed:{ title:'Fix login', owner:'—' } } }
  { t:'crdt.init', actors:['alice','bob'], slot:'card_map', type:'lww-map', args:{ seed:{ title:'Fix login', owner:'—' } } }
  ```
  Expected: `alice.card_reg = {kind:'record', fields:[title, owner], meta:{ts:0, node:'seed'}}` — a register
  whose value is a record carries **one** meta on the whole record; `alice.card_map = {kind:'record', …}` with
  **per-field** meta `{ts:0, node:'seed'}`. The renderer must draw that difference (one badge vs. one per field).
- **s02** · "Alice renames the card."
  ```ts
  { t:'tick' }
  { t:'crdt.update', actor:'alice', slot:'card_reg', op:'set', args:[{ title:'Fix login bug', owner:'—' }] }
  { t:'crdt.update', actor:'alice', slot:'card_map', op:'set', args:['title', 'Fix login bug'] }
  ```
- **s03** · "Bob is offline on a train. He assigns the card to Carol."
  ```ts
  { t:'offline', actor:'bob' }
  { t:'tick' }
  { t:'crdt.update', actor:'bob', slot:'card_reg', op:'set', args:[{ title:'Fix login', owner:'Carol' }] }
  { t:'crdt.update', actor:'bob', slot:'card_map', op:'set', args:['owner', 'Carol'] }
  ```
- **s04** · "Bob comes back online. The copies merge."
  ```ts
  { t:'online', actor:'bob' }
  { t:'crdt.sync', a:'alice', b:'bob', slot:'card_reg' }
  { t:'crdt.sync', a:'alice', b:'bob', slot:'card_map' }
  ```
- **s05** · "The whole-card register took Bob's card, because his write is later. Alice's new title is gone."
  ```ts
  { t:'highlight', path:['alice.card_reg','bob.card_reg'], tone:'bad' }
  { t:'cross', path:'alice.card_reg.title' }
  { t:'expect', path:'alice.card_reg.title', equals:'Fix login' }   // NEW (G8)
  ```
- **s06** · "The map merged field by field. Both edits survive."
  ```ts
  { t:'highlight', path:['alice.card_map.title','alice.card_map.owner','bob.card_map.title','bob.card_map.owner'], tone:'good' }
  { t:'check', path:'alice.card_map' }
  { t:'check', path:'bob.card_map' }
  { t:'expect', path:'alice.card_map.owner', equals:'Carol' }
  ```
- **s07** · "Ask: do people change the whole thing at once, or one field at a time? Fields → a map."
  ```ts
  { t:'clearMarks' }
  { t:'callout', at:'alice.card_map', text:'one register per field', sticky:true }
  ```
- **s08** · "Many fields, edited separately → map. Row three."
  ```ts
  { t:'insert', path:'board.table', index:2, item:{ id:'r3', cells:{ how:'many fields, edited separately', use:'LWW map' } } }
  { t:'highlight', path:'board.table[r3]' }
  ```

#### Scene 3 — "Members, or order?" (set vs. list, and re-add)

World: `layout:'pair'`; `alice`, `bob`; `board.table` rows r1–r3.

- **s01** · "Labels are a set: what matters is who is in. Checklist steps are a list: what matters is the order."
  ```ts
  { t:'crdt.init', actors:['alice','bob'], slot:'labels', type:'or-set', args:{ seed:[{ id:'seed:1', value:'bug' }] } }
  { t:'crdt.init', actors:['alice','bob'], slot:'steps',  type:'rga',    args:{ seed:[{ id:'t1', value:'write test' }, { id:'t2', value:'fix' }] } }
  ```
  Expected: `alice.labels = {kind:'set', items:[{id:'bug', value:{scalar 'bug'}, tags:['seed:1']}]}`;
  `alice.steps = {kind:'list', items:[{id:'t1', value:'write test'}, {id:'t2', value:'fix'}]}`.
- **s02** · "Alice adds the label 'urgent' while Bob adds 'backend'. Both at once."
  ```ts
  { t:'crdt.update', actor:'alice', slot:'labels', op:'add', args:['urgent'] }
  { t:'crdt.update', actor:'bob',   slot:'labels', op:'add', args:['backend'] }
  ```
  Expected: `alice.labels` gains `{id:'urgent', tags:['alice:1']}`; `bob.labels` gains `{id:'backend', tags:['bob:1']}`.
- **s03** · "Merge: the set has all three. Order does not matter for a set."
  ```ts
  { t:'crdt.sync', a:'alice', b:'bob', slot:'labels' }
  { t:'check', path:'alice.labels' }
  { t:'check', path:'bob.labels' }
  ```
- **s04** · "Now the list: Alice inserts 'review' after 'fix', and Bob inserts 'deploy' after 'fix'. Both at once."
  ```ts
  { t:'crdt.update', actor:'alice', slot:'steps', op:'insertAfter', args:['t2', 'review'] }
  { t:'crdt.update', actor:'bob',   slot:'steps', op:'insertAfter', args:['t2', 'deploy'] }
  ```
- **s05** · "Merge: both items are there, in the same order on both copies. The list chose that order by a rule, not by luck."
  ```ts
  { t:'crdt.sync', a:'alice', b:'bob', slot:'steps' }
  { t:'highlight', path:['alice.steps[alice:1]','alice.steps[bob:1]','bob.steps[alice:1]','bob.steps[bob:1]'] }
  { t:'compare', a:'alice.steps', b:'bob.steps' }   // NEW (G7): reducer verifies + draws "="
  ```
- **s06** · "One more question: can a member leave and come back? Alice removes 'bug'."
  ```ts
  { t:'crdt.update', actor:'alice', slot:'labels', op:'remove', args:['bug'] }
  ```
  Expected: `alice.labels` no longer lists `bug` (OR-Set removes the observed tag `seed:1`).
- **s07** · "Bob did not see that, and he adds 'bug' again at the same time. His add gets a fresh tag."
  ```ts
  { t:'crdt.update', actor:'bob', slot:'labels', op:'add', args:['bug'] }
  { t:'highlight', path:'bob.labels[bug]' }
  ```
  Expected: `bob.labels[bug].tags = ['seed:1','bob:2']`.
- **s08** · "Merge. 'bug' stays: Alice removed only the tag she saw, and Bob's new tag survives."
  ```ts
  { t:'crdt.sync', a:'alice', b:'bob', slot:'labels' }
  { t:'highlight', path:['alice.labels[bug]','bob.labels[bug]'], tone:'good' }
  { t:'expect', path:'alice.labels[bug].tags', equals:['bob:2'] }
  ```
- **s09** · "Ask: does order matter? No → set; yes → list; members come and go → a set with tags (OR-Set)."
  ```ts
  { t:'clearMarks' }
  { t:'callout', at:'alice.labels', text:'membership → OR-Set', sticky:true }
  { t:'callout', at:'alice.steps',  text:'order → sequence (RGA)', sticky:true }
  ```
- **s10** · "Two more rows, and the table is complete. Keep it — you will use it in every schema you design."
  ```ts
  { t:'insert', path:'board.table', index:3, item:{ id:'r4', cells:{ how:'members come and go', use:'OR-Set' } } }
  { t:'insert', path:'board.table', index:4, item:{ id:'r5', cells:{ how:'order matters', use:'Sequence (RGA)' } } }
  { t:'highlight', path:'board.table', tone:'good' }
  ```

#### Scene 4 — In context: "One task card" (composed document)

World: `layout:'pair'`; `alice`, `bob`. No board (stage space goes to the card).

- **s01** · "Here is the whole card. Each field has the type from our table."
  ```ts
  { t:'crdt.init', actors:['alice','bob'], slot:'card', type:'doc',       // NEW composed schema (G1)
    args:{ schema:{ title:'lww-register', owner:'lww-register', labels:'or-set', votes:'pn-counter', checklist:{ list:'lww-register' } },
           seed:{ title:'Fix login', owner:'—', labels:[{id:'seed:1', value:'bug'}], checklist:[{ id:'c1', value:'write test' }, { id:'c2', value:'fix' }] } } }
  ```
  Expected: `alice.card = record{ title:{scalar, meta{ts,node,note:'LWW'}}, owner, labels:{set, meta{note:'OR-Set'}}, votes:{counter, meta{note:'PN'}}, checklist:{list, meta{note:'RGA'}} }` — `meta.note` carries the type chip (G1).
- **s02** · "Alice renames the card."
  ```ts
  { t:'tick' }
  { t:'crdt.update', actor:'alice', slot:'card', path:'title', op:'set', args:['Fix login bug'] }   // NEW path (G1)
  ```
- **s03** · "Bob goes offline."
  ```ts
  { t:'offline', actor:'bob' }
  ```
- **s04** · "Offline, Bob adds a label and votes."
  ```ts
  { t:'crdt.update', actor:'bob', slot:'card', path:'labels', op:'add', args:['backend'] }
  { t:'crdt.update', actor:'bob', slot:'card', path:'votes',  op:'inc', args:[1] }
  ```
- **s05** · "Alice also votes, and adds a checklist step at the end."
  ```ts
  { t:'crdt.update', actor:'alice', slot:'card', path:'votes',     op:'inc', args:[1] }
  { t:'crdt.update', actor:'alice', slot:'card', path:'checklist', op:'insertAfter', args:['c2', 'ship it'] }
  ```
- **s06** · "Bob edits the title too: 'Login broken'. Two people, one register."
  ```ts
  { t:'tick' }
  { t:'crdt.update', actor:'bob', slot:'card', path:'title', op:'set', args:['Login broken'] }
  { t:'conflict', a:'alice.card.title', b:'bob.card.title' }
  ```
- **s07** · "Bob is back online, and one merge runs. Every field uses its own rule."
  ```ts
  { t:'online', actor:'bob' }
  { t:'clearMarks' }
  { t:'crdt.sync', a:'alice', b:'bob', slot:'card' }
  ```
- **s08** · "Title is a register, and Bob wrote later, so 'Login broken' wins. Alice's title is replaced — that is the rule we chose."
  ```ts
  { t:'highlight', path:['alice.card.title','bob.card.title'] }
  { t:'callout', at:'alice.card.title', text:'later write wins', tone:'neutral' }
  { t:'expect', path:'alice.card.title', equals:'Login broken' }
  ```
- **s09** · "Votes is a counter (1 + 1 = 2) and labels is a set (both kept). Checklist is a list, and 'ship it' sits at the end."
  ```ts
  { t:'highlight', path:['alice.card.votes','alice.card.labels','alice.card.checklist[alice:1]'], tone:'good' }
  { t:'expect', path:'alice.card.votes', equals:2 }
  ```
- **s10** · "Both copies are the same. Every field followed its own rule, with no server in the middle."
  ```ts
  { t:'compare', a:'alice.card', b:'bob.card' }   // NEW (G7)
  { t:'check', path:'alice.card' }
  { t:'check', path:'bob.card' }
  ```
- **s11** · "If losing a title edit is not OK, make the title a sequence of characters instead of a register. Next topic: composing."
  ```ts
  { t:'callout', at:'alice.card.title', text:'or: a text CRDT', sticky:true }
  ```

---

### V.2 `composing-a-document`

**Learning goal.** Design a document out of CRDT parts — one type per field, nested where needed, a
stable id on every item — and predict what one merge of the whole document does.

**When to use**

- A JSON-like document (card, note, profile, board) is edited on several devices, offline included.
- Different fields change in different ways (see V.1 table) and you control the schema.
- Deletes, moves, and "edit vs. delete" need a rule decided up front, not in a support ticket.
- You will use a document CRDT library (Automerge, Yjs) or a database map type (Riak) and want to model data for it.

**When not to use**

- The document is an opaque file (image, PDF) → version the reference, not the contents.
- A single server already orders every write and clients are always online → per-field LWW on the server is simpler (see V.4 Figma).
- Invariants across parts (a total must equal the sum of its rows) → a CRDT cannot keep that; coordinate or derive.

**Real-world anchor.** A kanban board (Trello-style): board → columns → cards → fields. Automerge and
Yjs nested maps/lists; Riak maps nesting registers, flags, counters, sets.

#### Scene 1 — "Pick a type for each field" (schema on a board)

World: `layout:'row'`. No actors. `board.schema` = empty record (NEW G4). Each step adds a field whose
value is a scalar naming the CRDT type; the renderer draws it as a schema tree.

- **s01** · "A card is a document made of parts. We choose one CRDT type per part, before we write any code."
  ```ts
  { t:'set', path:'board.schema', value:{ kind:'record', fields:[] } }
  ```
- **s02** · "Title: one short value that people replace. A LWW register."
  ```ts
  { t:'set', path:'board.schema.title', value:'LWW register' }     // set creates missing record fields (G21)
  { t:'callout', at:'board.schema.title', text:'replaces → register' }
  ```
- **s03** · "Description: long text that two people may type in at once. A sequence (RGA) of characters."
  ```ts
  { t:'set', path:'board.schema.description', value:'Sequence (RGA) of chars' }
  { t:'callout', at:'board.schema.description', text:'order matters → sequence' }
  ```
- **s04** · "Labels: members come and go, and their order does not matter. An OR-Set."
  ```ts
  { t:'set', path:'board.schema.labels', value:'OR-Set' }
  ```
- **s05** · "Votes: they add up. A PN-Counter."
  ```ts
  { t:'set', path:'board.schema.votes', value:'PN-Counter' }
  ```
- **s06** · "Checklist: ordered items, and each item is itself a small document with a text and a done flag."
  ```ts
  { t:'set', path:'board.schema.checklist', value:{ kind:'record', fields:[
      { key:'[item]', value:{ kind:'record', fields:[
          { key:'text', value:{ kind:'scalar', value:'LWW register' } },
          { key:'done', value:{ kind:'scalar', value:'LWW register' } } ] } } ] } }
  { t:'callout', at:'board.schema.checklist', text:'sequence of documents' }
  ```
- **s07** · "Every item needs a stable id, so an edit and a delete can point at the same thing. Never use the position as the id."
  ```ts
  { t:'highlight', path:'board.schema.checklist' }
  { t:'callout', at:'board.schema.checklist', text:'id = node:counter, or a UUID', sticky:true }
  ```
- **s08** · "That is the whole schema. Now we run real edits through it."
  ```ts
  { t:'check', path:'board.schema' }
  ```

#### Scene 2 — "One merge, many rules" (nested document)

World: `layout:'pair'`; `alice`, `bob`. Description is left out to keep the stage legible
(narration says so). Slot `card` = composed doc: `{ title: lww-register, labels: or-set, votes: pn-counter, checklist: { list: { text: lww-register, done: lww-register } } }`.

- **s01** · "Alice and Bob hold the same card (description hidden for space). Each checklist item has an id and two fields."
  ```ts
  { t:'crdt.init', actors:['alice','bob'], slot:'card', type:'doc',     // NEW (G1)
    args:{ schema:{ title:'lww-register', labels:'or-set', votes:'pn-counter',
                    checklist:{ list:{ text:'lww-register', done:'lww-register' } } },
           seed:{ title:'Fix login', labels:[{ id:'seed:1', value:'bug' }],
                  checklist:[{ id:'c1', value:{ text:'write test', done:false } }, { id:'c2', value:{ text:'fix', done:false } }] } } }
  { t:'highlight', path:'alice.card.checklist' }
  ```
  Expected: `alice.card.checklist = {kind:'list', items:[{id:'c1', value:{record: text{meta ts,node}, done{meta}}}, …], meta:{note:'RGA'}}`.
- **s02** · "Alice marks 'write test' as done."
  ```ts
  { t:'tick' }
  { t:'crdt.update', actor:'alice', slot:'card', path:'checklist[c1].done', op:'set', args:[true] }
  ```
- **s03** · "At the same time, Bob fixes a typo in the same item: 'write tests'."
  ```ts
  { t:'tick' }
  { t:'crdt.update', actor:'bob', slot:'card', path:'checklist[c1].text', op:'set', args:['write tests'] }
  ```
- **s04** · "Bob also adds a new item after 'fix': 'deploy'."
  ```ts
  { t:'crdt.update', actor:'bob', slot:'card', path:'checklist', op:'insertAfter', args:['c2', { text:'deploy', done:false }] }
  ```
  Expected: `bob.card.checklist` gains item `bob:1` whose value is a composed record (text/done registers).
- **s05** · "Merge."
  ```ts
  { t:'crdt.sync', a:'alice', b:'bob', slot:'card' }
  ```
- **s06** · "Inside item c1: 'done' took Alice's write, 'text' took Bob's. Different fields, no conflict."
  ```ts
  { t:'highlight', path:['alice.card.checklist[c1].done','alice.card.checklist[c1].text'], tone:'good' }
  { t:'expect', path:'alice.card.checklist[c1].done', equals:true }
  { t:'expect', path:'alice.card.checklist[c1].text', equals:'write tests' }
  ```
- **s07** · "The new item sits after 'fix' on both copies, with its own id."
  ```ts
  { t:'highlight', path:['alice.card.checklist[bob:1]','bob.card.checklist[bob:1]'] }
  ```
- **s08** · "The rule of a composed document: merge each part with its own rule, then put the parts back together."
  ```ts
  { t:'callout', at:'alice.card', text:'merge = merge every part', sticky:true }
  ```
- **s09** · "Both copies are equal again. That is why we gave every level its own type."
  ```ts
  { t:'compare', a:'alice.card', b:'bob.card' }   // NEW (G7)
  { t:'check', path:'alice.card' }
  { t:'check', path:'bob.card' }
  ```

#### Scene 3 — "Delete vs. edit"

World: `layout:'pair'`; `alice`, `bob`; slot `card` as Scene 2 (same seed). A second slot `card2` is
created mid-scene with a `deleted` flag instead of removal.

- **s01** · "Bob is offline. Alice deletes the item 'fix'."
  ```ts
  { t:'offline', actor:'bob' }
  { t:'crdt.update', actor:'alice', slot:'card', path:'checklist', op:'remove', args:['c2'] }
  ```
  Expected: `alice.card.checklist[c2].tombstone = true` (drawn struck-through, dimmed).
- **s02** · "Offline, Bob edits that same item: 'fix the bug'."
  ```ts
  { t:'tick' }
  { t:'crdt.update', actor:'bob', slot:'card', path:'checklist[c2].text', op:'set', args:['fix the bug'] }
  ```
- **s03** · "Bob comes back. Merge."
  ```ts
  { t:'online', actor:'bob' }
  { t:'crdt.sync', a:'alice', b:'bob', slot:'card' }
  ```
- **s04** · "The item is gone on both copies. The delete won, and Bob's edit went with it."
  ```ts
  { t:'highlight', path:['alice.card.checklist[c2]','bob.card.checklist[c2]'], tone:'bad' }
  { t:'callout', at:'bob.card.checklist[c2]', text:'edit lost', tone:'bad' }
  ```
- **s05** · "That is the rule for a sequence: a removed item stays removed. Often this is right — sometimes it is not."
  ```ts
  {
    t: 'clearMarks'
  }
  ```
- **s06** · "If an edit must never vanish, do not remove the item. Give it a 'deleted' flag — a register — and let the UI hide it."
  ```ts
  { t:'crdt.init', actors:['alice','bob'], slot:'card2', type:'doc',
    args:{ schema:{ checklist:{ list:{ text:'lww-register', done:'lww-register', deleted:'lww-register' } } },
           seed:{ checklist:[{ id:'c2', value:{ text:'fix', done:false, deleted:false } }] } } }
  { t:'callout', at:'alice.card2.checklist[c2].deleted', text:'a flag, not a removal' }
  ```
- **s07** · "Same story: Alice sets deleted = true while Bob, offline, edits the text."
  ```ts
  { t:'offline', actor:'bob' }
  { t:'tick' }
  { t:'crdt.update', actor:'alice', slot:'card2', path:'checklist[c2].deleted', op:'set', args:[true] }
  { t:'tick' }
  { t:'crdt.update', actor:'bob',   slot:'card2', path:'checklist[c2].text',    op:'set', args:['fix the bug'] }
  ```
- **s08** · "Merge: the item is still there, marked deleted, with Bob's new text. Nothing vanished."
  ```ts
  { t:'online', actor:'bob' }
  { t:'crdt.sync', a:'alice', b:'bob', slot:'card2' }
  { t:'highlight', path:['alice.card2.checklist[c2].deleted','alice.card2.checklist[c2].text'], tone:'good' }
  { t:'expect', path:'alice.card2.checklist[c2].text', equals:'fix the bug' }
  ```
- **s09** · "Now a person can decide: restore it, or let it go. The choice was made in the schema, up front."
  ```ts
  { t:'check', path:'alice.card2' }
  { t:'check', path:'bob.card2' }
  ```

#### Scene 4 — In context: "Moving a card between columns"

World: `layout:'pair'`; `alice`, `bob`. Slot `board1` = composed `{ todo: rga, doing: rga, done: rga }`
of card titles; seed `todo: [{id:'k1', value:'Fix login'}]`.

- **s01** · "A board with three columns. Each column is a sequence of cards."
  ```ts
  { t:'crdt.init', actors:['alice','bob'], slot:'board1', type:'doc',
    args:{ schema:{ todo:{ list:'lww-register' }, doing:{ list:'lww-register' }, done:{ list:'lww-register' } },
           seed:{ todo:[{ id:'k1', value:'Fix login' }] } } }
  ```
- **s02** · "Alice moves 'Fix login' from To do to Doing. A move is a delete plus an insert."
  ```ts
  { t:'crdt.update', actor:'alice', slot:'board1', path:'todo',  op:'remove',      args:['k1'] }
  { t:'crdt.update', actor:'alice', slot:'board1', path:'doing', op:'insertAfter', args:['HEAD', 'Fix login'] }
  ```
- **s03** · "Bob is offline. He moves the same card to Done."
  ```ts
  { t:'offline', actor:'bob' }
  { t:'crdt.update', actor:'bob', slot:'board1', path:'todo', op:'remove',      args:['k1'] }
  { t:'crdt.update', actor:'bob', slot:'board1', path:'done', op:'insertAfter', args:['HEAD', 'Fix login'] }
  ```
- **s04** · "Bob is back. Merge."
  ```ts
  { t:'online', actor:'bob' }
  { t:'crdt.sync', a:'alice', b:'bob', slot:'board1' }
  ```
- **s05** · "Whoops — the card is now in Doing _and_ in Done. Two inserts, both kept; each sequence did its job."
  ```ts
  { t:'highlight', path:['alice.board1.doing[alice:1]','alice.board1.done[bob:1]'], tone:'bad' }
  { t:'conflict', a:'alice.board1.doing[alice:1]', b:'alice.board1.done[bob:1]' }
  ```
- **s06** · "The schema caused this, not the CRDT. A move should be one change, not two."
  ```ts
  { t:'clearMarks' }
  { t:'callout', at:'alice.board1', text:'move = remove + insert = duplicate', tone:'bad' }
  ```
- **s07** · "Redesign: keep one list of cards. Give each card a 'column' field: a LWW register."
  ```ts
  { t:'crdt.init', actors:['alice','bob'], slot:'board2', type:'doc',
    args:{ schema:{ cards:{ list:{ title:'lww-register', column:'lww-register' } } },
           seed:{ cards:[{ id:'k1', value:{ title:'Fix login', column:'todo' } }] } } }
  { t:'callout', at:'alice.board2.cards[k1].column', text:'where it lives' }
  ```
- **s08** · "Alice sets column = Doing while Bob, offline, sets column = Done. Two writes to one register."
  ```ts
  { t:'tick' }
  { t:'crdt.update', actor:'alice', slot:'board2', path:'cards[k1].column', op:'set', args:['doing'] }
  { t:'offline', actor:'bob' }
  { t:'tick' }
  { t:'crdt.update', actor:'bob',   slot:'board2', path:'cards[k1].column', op:'set', args:['done'] }
  ```
- **s09** · "Merge: the card is in exactly one column, the later write, Done. A conflict, but a clean one."
  ```ts
  { t:'online', actor:'bob' }
  { t:'crdt.sync', a:'alice', b:'bob', slot:'board2' }
  { t:'highlight', path:['alice.board2.cards[k1].column','bob.board2.cards[k1].column'], tone:'good' }
  { t:'expect', path:'alice.board2.cards[k1].column', equals:'done' }
  ```
- **s10** · "Position inside a column is also a field: a sortable 'order' value between its neighbors. Same idea, no move."
  ```ts
  { t:'callout', at:'alice.board2.cards[k1]', text:'order: 0.5 (between 0 and 1)', sticky:true }
  ```
- **s11** · "Real tools do this. Figma stores a parent and a position on every object instead of moving it between lists (V.4)."
  ```ts
  { t:'check', path:'alice.board2' }
  { t:'check', path:'bob.board2' }
  ```

---

### V.3 `tradeoffs`

**Learning goal.** Name the cost of each choice — state vs. operations on the wire, metadata that
grows, tombstones, garbage collection — and pick the cheaper option for a given workload.

**When to use (each side)**

- State-based: small state (counters, sets, small maps); lossy or reordering networks; few replicas; you want the simplest code.
- Op-based: large documents with small, frequent edits (text); you already have reliable, causal delivery (or an op log you can replay).
- Delta-state: you want state-based safety with op-sized messages.
- GC/compaction: all replicas are known and can acknowledge; or a server can decide the "everyone has seen this" point.

**When not to use**

- Do not send the full state of a large document on every keystroke.
- Do not go op-based without exactly-once, causal delivery — a lost op is a permanent divergence.
- Do not drop tombstones while any replica may still hold the old item: it comes back.
- Do not promise "small metadata" for long-lived text without a GC story.

**Real-world anchor.** A likes counter across three data centers (Riak-style state sync) vs. a shared
document edited for a year (Yjs/Automerge, where deletes leave markers and GC needs agreement).

#### Scene 1 — "State or ops on the wire"

World: `layout:'pair'`; `alice`, `bob`. Two slots of the same lww-map (6 fields) — `doc_state` synced
by whole-state messages, `doc_ops` synced by op messages.

- **s01** · "Same document, two ways to sync it. Top sends the whole state; bottom sends only what you did."
  ```ts
  { t:'crdt.init', actors:['alice','bob'], slot:'doc_state', type:'lww-map', args:{ seed:{ title:'v1', owner:'Ann', due:'Fri', tags:'a,b', notes:'…', status:'open' } } }
  { t:'crdt.init', actors:['alice','bob'], slot:'doc_ops',   type:'lww-map', args:{ seed:{ title:'v1', owner:'Ann', due:'Fri', tags:'a,b', notes:'…', status:'open' } } }
  { t:'callout', at:'alice.doc_state', text:'state-based', sticky:true }
  { t:'callout', at:'alice.doc_ops',   text:'op-based',    sticky:true }
  ```
- **s02** · "Alice changes one field."
  ```ts
  { t:'tick' }
  { t:'crdt.update', actor:'alice', slot:'doc_state', op:'set', args:['title', 'v2'] }
  { t:'crdt.update', actor:'alice', slot:'doc_ops',   op:'set', args:['title', 'v2'] }
  ```
- **s03** · "State-based: Alice sends her entire document. Six fields travel for one change."
  ```ts
  { t:'send', from:'alice', to:'bob', payload:{ ref:'alice.doc_state' }, id:'m-state-1', label:'whole state · 6 fields' }
  ```
- **s04** · "Op-based: she sends one operation — set title = 'v2' at time 1."
  ```ts
  { t:'crdt.broadcast', from:'alice', slot:'doc_ops', id:'m-op-1' }   // NEW id on broadcast (G6) → message 'm-op-1→bob'
  ```
- **s05** · "Both land: Bob merges the state and applies the op. Same result, very different message sizes."
  ```ts
  { t:'deliver', message:'m-state-1' }
  { t:'crdt.merge', into:'bob', message:'m-state-1', slot:'doc_state' }   // NEW merge from message snapshot (G6)
  { t:'crdt.apply', message:'m-op-1→bob' }
  { t:'compare', a:'alice.doc_state', b:'bob.doc_state' }
  { t:'compare', a:'alice.doc_ops',   b:'bob.doc_ops' }
  ```
- **s06** · "Now the network drops a message. Alice edits again and sends both ways — and both messages are lost."
  ```ts
  { t:'tick' }
  { t:'crdt.update', actor:'alice', slot:'doc_state', op:'set', args:['status', 'done'] }
  { t:'crdt.update', actor:'alice', slot:'doc_ops',   op:'set', args:['status', 'done'] }
  { t:'send', from:'alice', to:'bob', payload:{ ref:'alice.doc_state' }, id:'m-state-2', label:'whole state' }
  { t:'crdt.broadcast', from:'alice', slot:'doc_ops', id:'m-op-2' }
  { t:'drop', message:'m-state-2' }
  { t:'drop', message:'m-op-2→bob' }
  ```
- **s07** · "State-based: no harm done. The next sync carries the whole state again, and merging twice is safe."
  ```ts
  { t:'send', from:'alice', to:'bob', payload:{ ref:'alice.doc_state' }, id:'m-state-3', label:'whole state' }
  { t:'deliver', message:'m-state-3' }
  { t:'crdt.merge', into:'bob', message:'m-state-3', slot:'doc_state' }
  { t:'check', path:'bob.doc_state.status' }
  { t:'expect', path:'bob.doc_state.status', equals:'done' }
  ```
- **s08** · "Op-based: that op is gone unless someone resends it. Bob is stuck on 'open'."
  ```ts
  { t:'cross', path:'bob.doc_ops.status' }
  { t:'callout', at:'bob.doc_ops', text:'needs reliable delivery', tone:'bad' }
  { t:'expect', path:'bob.doc_ops.status', equals:'open' }
  ```
- **s09** · "State: big messages, any network. Ops: small messages, but every op must arrive once and in causal order — or sit in a log you can replay."
  ```ts
  { t:'clearMarks' }
  { t:'callout', at:'alice.doc_state', text:'big · idempotent', sticky:true }
  { t:'callout', at:'alice.doc_ops',   text:'small · needs delivery guarantees', sticky:true }
  ```
- **s10** · "Middle ground: send only the part of the state that changed — a delta. Most real systems do this."
  ```ts
  { t:'send', from:'alice', to:'bob', payload:{ kind:'record', fields:[{ key:'status', value:{ kind:'scalar', value:'done', meta:{ ts:2, node:'alice' } } }] }, id:'m-delta', label:'delta · 1 field' }
  { t:'deliver', message:'m-delta' }
  { t:'crdt.merge', into:'bob', message:'m-delta', slot:'doc_state' }   // delta-state merge = same merge()
  ```

#### Scene 2 — "Metadata that does not leave" (tombstones)

World: `layout:'pair'`; `alice`, `bob`; slot `note` = rga of characters, empty. The list renderer draws
tombstoned chars struck-through and dimmed; `args.expose:['stats']` adds a small counter row
`stored / visible` next to the value (NEW G11).

- **s01** · "Alice types 'hello': five items, each with its own id. Bob syncs and has the same five."
  ```ts
  { t:'crdt.init', actors:['alice','bob'], slot:'note', type:'rga', args:{ expose:['stats'] } }   // NEW expose (G11)
  { t:'crdt.update', actor:'alice', slot:'note', op:'insertAfter', args:['HEAD', 'hello'] }          // multi-char sugar (G14)
  { t:'crdt.sync', a:'alice', b:'bob', slot:'note' }
  ```
  Expected: `alice.note = {kind:'list', items:[{id:'alice:1', value:'h'}, … {id:'alice:5', value:'o'}], meta:{note:'stored 5 · visible 5'}}`.
- **s02** · "Bob goes offline."
  ```ts
  { t:'offline', actor:'bob' }
  ```
- **s03** · "Alice deletes all five. They do not leave: each one becomes a tombstone."
  ```ts
  { t:'crdt.update', actor:'alice', slot:'note', op:'remove', args:[['alice:1','alice:2','alice:3','alice:4','alice:5']] }
  { t:'highlight', path:'alice.note' }
  ```
- **s04** · "She types 'hi'. Visible: 2 letters; stored: 7 items."
  ```ts
  { t:'crdt.update', actor:'alice', slot:'note', op:'insertAfter', args:['HEAD', 'hi'] }
  { t:'expect', path:'alice.note.stats.stored', equals:7 }
  { t:'expect', path:'alice.note.stats.visible', equals:2 }
  ```
- **s05** · "Why keep them? Bob is back, and his copy still says 'hello' exists."
  ```ts
  { t:'online', actor:'bob' }
  { t:'highlight', path:'bob.note' }
  ```
- **s06** · "Merge: the tombstones tell Bob's copy that those five were deleted, so both now show 'hi'. Without the markers, 'hello' would come back."
  ```ts
  { t:'crdt.sync', a:'alice', b:'bob', slot:'note' }
  { t:'compare', a:'alice.note', b:'bob.note' }
  { t:'expect', path:'bob.note.stats.visible', equals:2 }
  ```
- **s07** · "After a year of typing and deleting, the tombstones are most of the document. That is the cost of never forgetting."
  ```ts
  { t:'callout', at:'alice.note', text:'stored ≫ visible', tone:'bad', sticky:true }
  ```
- **s08** · "Same story elsewhere: a 2P-Set's removed set only grows, and every OR-Set tag is one more id to keep."
  ```ts
  { t:'callout', at:'bob.note', text:'2P-Set removed set · OR-Set tags', sticky:true }
  ```
- **s09** · "Smaller, not gone: Yjs keeps only id ranges for deleted runs; Automerge packs history into columns. Both still remember every delete."
  ```ts
  { t:'clearMarks' }
  { t:'callout', at:'alice.note', text:'compress, or agree to forget (next)', sticky:true }
  ```

#### Scene 3 — "Cleaning up needs agreement" (unsafe vs. safe GC)

World: `layout:'triangle'`; `alice`, `bob`, `carol`; slot `list` = rga seeded `['a','b','c']` with ids
`i1,i2,i3`.

- **s01** · "Three copies of a list. Everyone has seen items a, b, c."
  ```ts
  { t:'crdt.init', actors:['alice','bob','carol'], slot:'list', type:'rga', args:{ seed:[{id:'i1',value:'a'},{id:'i2',value:'b'},{id:'i3',value:'c'}], expose:['stats'] } }   // NEW expose (G11)
  ```
- **s02** · "Carol goes offline."
  ```ts
  { t:'offline', actor:'carol' }
  ```
- **s03** · "Alice deletes b and syncs with Bob. Both have the tombstone."
  ```ts
  { t:'crdt.update', actor:'alice', slot:'list', op:'remove', args:['i2'] }
  { t:'crdt.sync', a:'alice', b:'bob', slot:'list' }
  { t:'highlight', path:['alice.list[i2]','bob.list[i2]'] }
  ```
- **s04** · "Alice wants the space back, so she throws the tombstone away. Bob does too."
  ```ts
  { t:'crdt.update', actor:'alice', slot:'list', op:'compact', args:[] }   // teaching-only unsafe op (G14)
  { t:'crdt.update', actor:'bob',   slot:'list', op:'compact', args:[] }
  ```
  Expected: `alice.list.items = [i1, i3]` (i2 gone entirely, not tombstoned).
- **s05** · "Carol comes back, and she still has b. Merge."
  ```ts
  { t:'online', actor:'carol' }
  { t:'crdt.sync', a:'carol', b:'alice', slot:'list' }
  ```
- **s06** · "Whoops — b is back. Alice forgot it was ever deleted, so Carol's copy looks like new information."
  ```ts
  { t:'highlight', path:'alice.list[i2]', tone:'bad' }
  { t:'callout', at:'alice.list[i2]', text:'resurrected', tone:'bad' }
  { t:'expect', path:'alice.list.stats.visible', equals:3 }
  ```
- **s07** · "Rule: drop a tombstone only when every copy has seen the delete. Knowing that needs a record of who has seen what: a vector clock (Unit IV)."
  ```ts
  { t:'clearMarks' }
  { t:'callout', at:'alice', text:'stable = seen by all', sticky:true }
  ```
- **s08** · "Replay, the safe way. Carol is offline, Alice deletes b, Alice and Bob sync — and nobody compacts yet."
  ```ts
  { t:'crdt.init', actors:['alice','bob','carol'], slot:'list2', type:'rga', args:{ seed:[{id:'i1',value:'a'},{id:'i2',value:'b'},{id:'i3',value:'c'}], expose:['clock'] } }   // NEW expose clock (G11)
  { t:'offline', actor:'carol' }
  { t:'crdt.update', actor:'alice', slot:'list2', op:'remove', args:['i2'] }
  { t:'crdt.sync', a:'alice', b:'bob', slot:'list2' }
  ```
  Expected: `alice.list2.clock = {kind:'clock', entries:{alice:1, bob:0, carol:0}}`; Carol's clock still all zero.
- **s09** · "Carol returns and syncs. Now all three clocks show Alice's delete — it is stable."
  ```ts
  { t:'online', actor:'carol' }
  { t:'crdt.sync', a:'carol', b:'alice', slot:'list2' }
  { t:'crdt.sync', a:'carol', b:'bob',   slot:'list2' }
  { t:'highlight', path:['alice.list2.clock','bob.list2.clock','carol.list2.clock'], tone:'good' }
  ```
- **s10** · "Now everyone compacts, and b is gone for good. Space back, nothing comes back."
  ```ts
  { t:'crdt.update', actor:'alice', slot:'list2', op:'compact', args:[] }
  { t:'crdt.update', actor:'bob',   slot:'list2', op:'compact', args:[] }
  { t:'crdt.update', actor:'carol', slot:'list2', op:'compact', args:[] }
  { t:'crdt.sync', a:'alice', b:'carol', slot:'list2' }
  { t:'compare', a:'alice.list2', b:'carol.list2' }
  { t:'check', path:'alice.list2' }
  ```
- **s11** · "A server can do this for you: one log that knows when every client has caught up. Without one, GC is rare and careful."
  ```ts
  { t:'callout', at:'alice', text:'server log → safe compaction point', sticky:true }
  ```

#### Scene 4 — In context: "Pick for the workload"

World: `layout:'ring'`; servers `us` ("us-east"), `eu` ("eu-west"), `ap` ("ap-south"), all kind
`server`, color `server`. Board `board.summary` = table with columns `data`, `how`, `why` (NEW G2).

- **s01** · "Three data centers hold a likes counter and a shared document. Same network, two different choices."
  ```ts
  { t:'crdt.init', actors:['us','eu','ap'], slot:'likes', type:'pn-counter' }
  { t:'crdt.init', actors:['us','eu','ap'], slot:'doc',   type:'rga', args:{ seed:[{id:'d1',value:'H'},{id:'d2',value:'i'}] } }
  ```
- **s02** · "Likes: the state is tiny, one number per data center. Send the whole state, any time, in any order."
  ```ts
  { t:'crdt.update', actor:'us', slot:'likes', op:'inc', args:[3] }
  { t:'send', from:'us', to:['eu','ap'], payload:{ ref:'us.likes' }, id:'m-likes', label:'state · 3 numbers' }
  ```
- **s03** · "One message is lost. Nobody cares: the next state sync carries everything, and merging twice is harmless."
  ```ts
  { t:'deliver', message:'m-likes→eu' }
  { t:'crdt.merge', into:'eu', message:'m-likes→eu', slot:'likes' }
  { t:'drop', message:'m-likes→ap' }
  { t:'crdt.sync', a:'eu', b:'ap', slot:'likes' }
  { t:'compare', a:'us.likes', b:'ap.likes' }
  ```
- **s04** · "The document is large and each edit is tiny. Send operations, not state."
  ```ts
  { t:'crdt.update', actor:'eu', slot:'doc', op:'insertAfter', args:['d2', '!'] }
  { t:'crdt.broadcast', from:'eu', slot:'doc', id:'m-op' }
  ```
- **s05** · "Deliver each op once, in causal order. Real systems keep an op log to make that true."
  ```ts
  { t:'crdt.apply', message:'m-op→us' }
  { t:'crdt.apply', message:'m-op→ap' }
  { t:'compare', a:'us.doc', b:'ap.doc' }
  ```
- **s06** · "Tombstones pile up in the document. The data centers agree on an 'everyone has seen' point and compact together."
  ```ts
  { t:'crdt.update', actor:'us', slot:'doc', op:'remove', args:['d1'] }
  { t:'crdt.broadcast', from:'us', slot:'doc', id:'m-del' }
  { t:'crdt.apply', message:'m-del→eu' }
  { t:'crdt.apply', message:'m-del→ap' }
  { t:'crdt.update', actor:'us', slot:'doc', op:'compact', args:[] }
  { t:'crdt.update', actor:'eu', slot:'doc', op:'compact', args:[] }
  { t:'crdt.update', actor:'ap', slot:'doc', op:'compact', args:[] }
  ```
- **s07** · "Summary: small state → state-based; large data with small edits → op-based with a log. Long life → a GC plan."
  ```ts
  { t:'insert', path:'board.summary', index:0, item:{ id:'w1', cells:{ data:'likes counter', how:'state-based PN-Counter', why:'tiny state, lossy links' } } }
  { t:'insert', path:'board.summary', index:1, item:{ id:'w2', cells:{ data:'shared document', how:'op-based RGA + op log', why:'big doc, small edits' } } }
  { t:'insert', path:'board.summary', index:2, item:{ id:'w3', cells:{ data:'shopping list', how:'state-based OR-Set (deltas)', why:'small set, offline phones' } } }
  { t:'highlight', path:'board.summary', tone:'good' }
  ```

---

### V.4 `real-systems`

**Learning goal.** Recognize what Automerge, Yjs, Riak, Redis Enterprise, Apple Notes and Figma
actually use — and why each made that choice.

**When to use which**

- Automerge: JSON-like documents with full history, local-first apps, you want to _see_ conflicts.
- Yjs: collaborative editors (rich text, code); many editor bindings; small wire format; deletes are collected.
- Riak KV / Redis Enterprise Active-Active: CRDT types (counters, sets, maps) _inside_ the database, across regions; no custom sync code in the app.
- Apple-Notes style: an app-specific sequence CRDT behind a sync service (iCloud) for offline edits.
- Figma style: a central server orders writes; per-property last-writer-wins; simpler rules because a server is always there.

**When not to use**

- Do not pick a document CRDT library when every client is always online to one server — server ordering is simpler and cheaper.
- Do not use a document CRDT for a counter stored in a database — use the database's counter type.
- Do not assume "uses CRDTs" means "works offline for weeks": check the library's GC and history story (V.3).

**Real-world anchor.** The systems themselves; each scene is one of them. Facts below are simplified
to what is public; narration says "(simplified)" wherever we flatten a detail.

#### Scene 1 — "Two document libraries: Yjs and Automerge"

World: `layout:'pair'`; `alice`, `bob`. Slot `doc` = rga with `expose:['clock']` (state vector). A
second slot `title` = mv-register for the Automerge conflict view.

- **s01** · "Yjs and Automerge are libraries that give you a document that merges itself. Both put an id on every character — a sequence CRDT, like Unit III."
  ```ts
  { t:'crdt.init', actors:['alice','bob'], slot:'doc', type:'rga', args:{ expose:['clock'] } }   // NEW (G11)
  { t:'callout', at:'alice.doc', text:'(client, counter) ids', sticky:true }
  ```
  Expected: `alice.doc = {kind:'record', fields:[text:{list}, clock:{kind:'clock', entries:{alice:0,bob:0}}]}`.
- **s02** · "Alice types 'Hi'. Her clock says: alice has written 2 things."
  ```ts
  { t:'crdt.update', actor:'alice', slot:'doc', op:'insertAfter', args:['HEAD', 'Hi'] }
  { t:'highlight', path:'alice.doc.clock' }
  ```
- **s03** · "Bob types 'Yo' at the same time. His clock: bob 2, alice 0."
  ```ts
  { t:'crdt.update', actor:'bob', slot:'doc', op:'insertAfter', args:['HEAD', 'Yo'] }
  { t:'highlight', path:'bob.doc.clock' }
  ```
- **s04** · "Yjs sync, step one: Bob sends his state vector — 'I have alice:0, bob:2'. A vector clock by another name."
  ```ts
  { t:'send', from:'bob', to:'alice', payload:{ ref:'bob.doc.clock' }, id:'m-sv', label:'state vector' }
  { t:'deliver', message:'m-sv' }
  ```
- **s05** · "Alice compares. Bob is missing her 2 items, so she sends only those."
  ```ts
  { t:'crdt.broadcast', from:'alice', slot:'doc', id:'m-a', to:['bob'] }   // NEW to (G6)
  { t:'crdt.apply', message:'m-a→bob' }
  ```
- **s06** · "And back — both show the same text. In Yjs, messages are tiny, and deleted text is collected so the doc stays small."
  ```ts
  { t:'crdt.broadcast', from:'bob', slot:'doc', id:'m-b', to:['alice'] }
  { t:'crdt.apply', message:'m-b→alice' }
  { t:'compare', a:'alice.doc', b:'bob.doc' }
  ```
- **s07** · "Automerge does the same dance with hashes: every change has a hash, and peers compare 'heads' to find what is missing (simplified)."
  ```ts
  { t:'callout', at:'alice', text:'Automerge: compare heads (hashes)', sticky:true }
  { t:'callout', at:'bob',   text:'Yjs: compare state vectors',        sticky:true }
  ```
- **s08** · "Automerge also keeps concurrent writes to one field: it shows a winner, and keeps the others readable as conflicts."
  ```ts
  { t:'crdt.init', actors:['alice','bob'], slot:'title', type:'mv-register' }   // multi-value register from IV.4 (G14)
  { t:'tick' }
  { t:'crdt.update', actor:'alice', slot:'title', op:'set', args:['Plan'] }
  { t:'tick' }
  { t:'crdt.update', actor:'bob',   slot:'title', op:'set', args:['Roadmap'] }
  { t:'crdt.sync', a:'alice', b:'bob', slot:'title' }
  { t:'highlight', path:['alice.title','bob.title'] }
  ```
  Expected: `alice.title = {kind:'set', items:[{id:'Plan', meta{ts:1,node:'alice'}}, {id:'Roadmap', meta{ts:2,node:'bob'}}], meta:{note:'winner: Roadmap'}}`.
- **s09** · "Pick Yjs for editors (rich text, many bindings, small) and Automerge for JSON data with history you can inspect. Both run local-first."
  ```ts
  { t:'clearMarks' }
  { t:'callout', at:'alice', text:'Yjs → editors', sticky:true }
  { t:'callout', at:'bob',   text:'Automerge → JSON + history', sticky:true }
  ```

#### Scene 2 — "Two databases: Riak and Redis Enterprise"

World: `layout:'ring'`; servers `us`, `eu`, `ap` (kind `server`). Slots: `likes` pn-counter, `tags`
or-set seeded `{'sale'}`, `bio` mv-register.

- **s01** · "Riak and Redis Enterprise run CRDTs inside the database, across regions. You call INCR or ADD; the regions merge on their own."
  ```ts
  { t:'crdt.init', actors:['us','eu','ap'], slot:'likes', type:'pn-counter' }
  { t:'crdt.init', actors:['us','eu','ap'], slot:'tags',  type:'or-set', args:{ seed:[{ id:'seed:1', value:'sale' }] } }
  ```
- **s02** · "Three regions. Each takes likes locally: +3 in us-east, +2 in eu-west."
  ```ts
  { t:'crdt.update', actor:'us', slot:'likes', op:'inc', args:[3] }
  { t:'crdt.update', actor:'eu', slot:'likes', op:'inc', args:[2] }
  ```
- **s03** · "Regions exchange state. The counter is one tally per region, merged by max, read as a sum: 5 everywhere."
  ```ts
  { t:'crdt.sync', a:'us', b:'eu', slot:'likes' }
  { t:'crdt.sync', a:'eu', b:'ap', slot:'likes' }
  { t:'highlight', path:['us.likes','eu.likes','ap.likes'], tone:'good' }
  { t:'expect', path:'ap.likes', equals:5 }
  ```
- **s04** · "A set of tags: eu-west adds 'sale' again while ap-south removes it. Add wins — the new add has a tag the remove never saw."
  ```ts
  { t:'crdt.update', actor:'eu', slot:'tags', op:'add',    args:['sale'] }
  { t:'crdt.update', actor:'ap', slot:'tags', op:'remove', args:['sale'] }
  { t:'crdt.sync', a:'eu', b:'ap', slot:'tags' }
  { t:'highlight', path:['eu.tags[sale]','ap.tags[sale]'], tone:'good' }
  ```
- **s05** · "Riak's map nests types: a profile with a register (name), a flag (verified), a counter (logins). The composed document from topic 2, as a database value."
  ```ts
  { t:'crdt.init', actors:['us','eu','ap'], slot:'profile', type:'doc',
    args:{ schema:{ name:'lww-register', verified:'lww-register', logins:'pn-counter' },
           seed:{ name:'Ann', verified:false } } }   // Riak's flag is enable-wins; shown as a register (simplified) — see G14 'ew-flag'
  { t:'callout', at:'us.profile', text:'Riak map (simplified)', sticky:true }
  ```
- **s06** · "A plain value with no type? Riak keeps both versions as siblings with a version vector, and your app decides (Unit IV)."
  ```ts
  { t:'crdt.init', actors:['us','eu','ap'], slot:'bio', type:'mv-register' }
  { t:'tick' }
  { t:'crdt.update', actor:'us', slot:'bio', op:'set', args:['Hi!'] }
  { t:'tick' }
  { t:'crdt.update', actor:'eu', slot:'bio', op:'set', args:['Hello'] }
  { t:'crdt.sync', a:'us', b:'eu', slot:'bio' }
  { t:'highlight', path:['us.bio','eu.bio'] }
  { t:'callout', at:'us.bio', text:'siblings: app resolves' }
  ```
- **s07** · "Redis Enterprise Active-Active does the same per region: INCR sums, sets are add-wins, a plain SET is last-writer-wins (simplified)."
  ```ts
  { t:'clearMarks' }
  { t:'callout', at:'ap', text:'Redis: INCR sums · SADD add-wins · SET LWW', sticky:true }
  ```
- **s08** · "Pick a database type when you want CRDT rules on the server and no sync code in the app. The app just reads the merged value."
  ```ts
  { t:'check', path:'us.likes' }
  { t:'check', path:'us.tags' }
  ```

#### Scene 3 — "Two apps: Apple Notes and Figma"

World: starts `layout:'triangle'` with `phone` (device, a), `laptop` (device, b), `icloud` (server).
Mid-scene the actors are swapped for `alice`, `bob`, `figma` (server) and `layout:'hub'`.

- **s01** · "Apple Notes: your phone and laptop each keep the note; iCloud relays changes. The note text is a sequence CRDT (simplified, from the public data format)."
  ```ts
  { t:'crdt.init', actors:['phone','laptop','icloud'], slot:'note', type:'rga', args:{ seed:[{id:'n1',value:'M'},{id:'n2',value:'i'},{id:'n3',value:'l'},{id:'n4',value:'k'}] } }
  ```
- **s02** · "The phone is offline. You type on both devices."
  ```ts
  { t:'offline', actor:'phone' }
  { t:'crdt.update', actor:'phone',  slot:'note', op:'insertAfter', args:['n4', ', eggs'] }
  { t:'crdt.update', actor:'laptop', slot:'note', op:'insertAfter', args:['HEAD', 'Buy: '] }
  ```
- **s03** · "The laptop's change goes through iCloud. The phone comes back and its change follows the same path."
  ```ts
  { t:'crdt.broadcast', from:'laptop', slot:'note', id:'m-l', to:['icloud'] }
  { t:'crdt.apply', message:'m-l→icloud' }
  { t:'online', actor:'phone' }
  { t:'crdt.broadcast', from:'phone', slot:'note', id:'m-p', to:['icloud'] }
  { t:'crdt.apply', message:'m-p→icloud' }
  ```
- **s04** · "iCloud relays each change to the other device. Both end with the same note — no 'pick a version' dialog."
  ```ts
  { t:'relay', message:'m-l→icloud', to:['phone'],  id:'m-l2' }   // NEW relay (G6)
  { t:'relay', message:'m-p→icloud', to:['laptop'], id:'m-p2' }
  { t:'crdt.apply', message:'m-l2→phone' }
  { t:'crdt.apply', message:'m-p2→laptop' }
  { t:'compare', a:'phone.note', b:'laptop.note' }
  ```
- **s05** · "Figma is different: a server is always there. Every object is a map of properties, and each property is last-writer-wins — ordered by the server, not by clocks."
  ```ts
  { t:'remove', actor:'phone' } { t:'remove', actor:'laptop' } { t:'remove', actor:'icloud' }
  { t:'spawn', actor:{ id:'alice', kind:'person', label:'Alice', color:'a', online:true, holds:{} } }
  { t:'spawn', actor:{ id:'bob',   kind:'person', label:'Bob',   color:'b', online:true, holds:{} } }
  { t:'spawn', actor:{ id:'figma', kind:'server', label:'Figma server', color:'server', online:true, holds:{} } }
  { t:'layout', preset:'hub' }
  { t:'crdt.init', actors:['alice','bob','figma'], slot:'rect', type:'lww-map', args:{ seed:{ fill:'gray', x:0, parent:'frame-1' } } }
  ```
- **s06** · "Alice sets fill = red and Bob sets x = 10. Both go to the server, which applies them in arrival order and sends the result back."
  ```ts
  { t:'send', from:'alice', to:'figma', payload:{ kind:'scalar', value:'fill = red' }, id:'m-fill' }
  { t:'send', from:'bob',   to:'figma', payload:{ kind:'scalar', value:'x = 10' },     id:'m-x' }
  { t:'deliver', message:'m-fill' } { t:'tick' } { t:'crdt.update', actor:'figma', slot:'rect', op:'set', args:['fill','red'] }
  { t:'deliver', message:'m-x' }    { t:'tick' } { t:'crdt.update', actor:'figma', slot:'rect', op:'set', args:['x', 10] }
  { t:'crdt.merge', into:'alice', from:'figma', slot:'rect' }
  { t:'crdt.merge', into:'bob',   from:'figma', slot:'rect' }
  ```
- **s07** · "Different properties, both survive — the per-field map from Unit II."
  ```ts
  { t:'highlight', path:['alice.rect.fill','alice.rect.x','bob.rect.fill','bob.rect.x'], tone:'good' }
  ```
- **s08** · "Same property at once? The server's order decides, and the loser sees the color snap to the winner — simple, because one server is the one order."
  ```ts
  { t:'send', from:'alice', to:'figma', payload:{ kind:'scalar', value:'fill = blue' },  id:'m-f1' }
  { t:'send', from:'bob',   to:'figma', payload:{ kind:'scalar', value:'fill = green' }, id:'m-f2' }
  { t:'deliver', message:'m-f1' } { t:'tick' } { t:'crdt.update', actor:'figma', slot:'rect', op:'set', args:['fill','blue'] }
  { t:'deliver', message:'m-f2' } { t:'tick' } { t:'crdt.update', actor:'figma', slot:'rect', op:'set', args:['fill','green'] }
  { t:'crdt.merge', into:'alice', from:'figma', slot:'rect' }
  { t:'crdt.merge', into:'bob',   from:'figma', slot:'rect' }
  { t:'highlight', path:'alice.rect.fill' }
  { t:'expect', path:'alice.rect.fill', equals:'green' }
  ```
- **s09** · "Moving a layer: Figma writes a parent and a position on the object (a fraction between its neighbors). No delete + insert, no duplicate layers (topic 2)."
  ```ts
  { t:'send', from:'alice', to:'figma', payload:{ kind:'scalar', value:'parent = group-2, pos = 0.5' }, id:'m-mv' }
  { t:'deliver', message:'m-mv' } { t:'tick' }
  { t:'crdt.update', actor:'figma', slot:'rect', op:'set', args:['parent','group-2'] }
  { t:'crdt.update', actor:'figma', slot:'rect', op:'set', args:['pos', 0.5] }
  { t:'crdt.merge', into:'alice', from:'figma', slot:'rect' }
  { t:'crdt.merge', into:'bob',   from:'figma', slot:'rect' }
  ```
- **s10** · "Figma calls this 'CRDT-inspired': with a server you keep the easy rules and skip the hard parts. Know which world you are in."
  ```ts
  { t:'callout', at:'figma', text:'server = the one order', sticky:true }
  { t:'check', path:'alice.rect' }
  { t:'check', path:'bob.rect' }
  ```

#### Scene 4 — In context: "Which one would you pick?"

World: `layout:'row'`; `board.pick` = table with columns `need`, `pick`, `why` (NEW G2). Each step
adds one row and highlights it; the narration gives the reason.

- **s01** · "Four situations. For each, name the kind of system you would reach for."
  ```ts
  { t:'set', path:'board.pick', value:{ kind:'table', columns:[{key:'need',label:'You need'},{key:'pick',label:'Reach for'},{key:'why',label:'Because'}], rows:[] } }
  ```
- **s02** · "A notes app that works offline for days: a document CRDT library. Yjs for the editor, Automerge if you want history."
  ```ts
  { t:'insert', path:'board.pick', index:0, item:{ id:'p1', cells:{ need:'offline notes app', pick:'Yjs / Automerge', why:'sequence CRDT + sync' } } }
  { t:'highlight', path:'board.pick[p1]' }
  ```
- **s03** · "A global like counter: a database type, such as a Riak counter or Redis INCR. No app code for merging."
  ```ts
  { t:'insert', path:'board.pick', index:1, item:{ id:'p2', cells:{ need:'global like counter', pick:'Riak / Redis counter', why:'PN-Counter in the DB' } } }
  { t:'highlight', path:'board.pick[p2]' }
  ```
- **s04** · "A design tool with a server always present: per-property last-writer-wins, server ordered. Figma's way."
  ```ts
  { t:'insert', path:'board.pick', index:2, item:{ id:'p3', cells:{ need:'design tool + server', pick:'server-ordered LWW per property', why:'one order, simple rules' } } }
  { t:'highlight', path:'board.pick[p3]' }
  ```
- **s05** · "A shared spreadsheet of cells: a map of registers in Automerge or Yjs, one register per cell."
  ```ts
  { t:'insert', path:'board.pick', index:3, item:{ id:'p4', cells:{ need:'shared grid of cells', pick:'Yjs / Automerge map', why:'per-cell LWW, offline OK' } } }
  { t:'highlight', path:'board.pick[p4]' }
  ```
- **s06** · "The pattern: library when the client must work alone, database type when the server holds the data, server ordering when the server is always there."
  ```ts
  { t:'check', path:'board.pick' }
  ```

---

### V.5 `course-complete`

**Learning goal.** Check that you can name the types, the merge laws, the clocks and the choice rules —
and spot the cases where a CRDT is the wrong tool.

**When to use a CRDT at all**

- More than one writer, sometimes disconnected, and the data still has to come back together.
- "Briefly different, then the same everywhere" is acceptable for this data.
- The resolution rule can be fixed up front (last write, add-wins, sum).
- You want no coordinator in the write path (latency, offline, scale).

**When not to use**

- A rule must hold across copies at all times: balance ≥ 0, unique usernames, stock ≥ 0, one booking per seat.
- Someone needs "did my write win?" before moving on — that is a coordination question.
- A single server already serializes every write and clients are always online.
- Audit or regulation requires one true order of events.

**Real-world anchor.** A bank balance (needs a transaction) vs. the notes app from Unit IV (a CRDT
document) — the final round trip.

#### Scene 1 — "The checklist"

World: `layout:'row'`; `board.checklist` = list of nine items (seeded). Each step checks one.

- **s01** · "Nine things you can now do. Let us check them off."
  ```ts
  { t:'set', path:'board.checklist', value:{ kind:'list', items:[
      { id:'k1', value:{kind:'scalar', value:'What a CRDT is'} },
      { id:'k2', value:{kind:'scalar', value:'The three merge laws'} },
      { id:'k3', value:{kind:'scalar', value:'State-based vs. op-based'} },
      { id:'k4', value:{kind:'scalar', value:'Registers (LWW)'} },
      { id:'k5', value:{kind:'scalar', value:'Counters (G, PN)'} },
      { id:'k6', value:{kind:'scalar', value:'Sets (G, 2P, LWW-element, OR)'} },
      { id:'k7', value:{kind:'scalar', value:'Sequences (RGA)'} },
      { id:'k8', value:{kind:'scalar', value:'Clocks (wall, Lamport, vector)'} },
      { id:'k9', value:{kind:'scalar', value:'Choosing, composing, paying'} } ] } }
  ```
- **s02** · "A CRDT is a data type with its merge rule fixed up front. Copies merge in any order and end up equal."
  ```ts
  { t:'check', path:'board.checklist[k1]' }
  ```
- **s03** · "Merge is commutative, associative and idempotent: order does not matter, grouping does not matter, merging twice is harmless."
  ```ts
  { t:'check', path:'board.checklist[k2]' }
  ```
- **s04** · "State-based: send the state, merge. Op-based: send what you did; deliver once, in causal order."
  ```ts
  { t:'check', path:'board.checklist[k3]' }
  ```
- **s05** · "Registers replace. LWW needs a timestamp and a tie-break by node id."
  ```ts
  { t:'check', path:'board.checklist[k4]' }
  ```
- **s06** · "Counters add: one tally per node, merge by max, value by sum. PN is two of them."
  ```ts
  { t:'check', path:'board.checklist[k5]' }
  ```
- **s07** · "Sets: G only grows; 2P never re-adds; LWW-element picks by time; OR-Set tags every add so re-add works."
  ```ts
  { t:'check', path:'board.checklist[k6]' }
  ```
- **s08** · "Sequences: insert after an id, tombstones for deletes, one fixed tie-break for concurrent inserts."
  ```ts
  { t:'check', path:'board.checklist[k7]' }
  ```
- **s09** · "Clocks: wall clocks lie; Lamport gives an order; vector clocks tell before, after, or concurrent."
  ```ts
  { t:'check', path:'board.checklist[k8]' }
  ```
- **s10** · "Choose by how the data changes, compose a document from parts, and pay for metadata on purpose."
  ```ts
  { t:'check', path:'board.checklist[k9]' }
  { t:'highlight', path:'board.checklist', tone:'good' }
  ```

#### Scene 2 — "When not to use a CRDT"

World: `layout:'pair'`; `alice` ("Branch A"), `bob` ("Branch B"), both `person`. Slot `balance` =
pn-counter seeded `{ perNode:{ alice:100 } }` (the first deposit came in at Branch A).

- **s01** · "A bank balance of 100. Two branches, each with a copy, stored as a PN-Counter."
  ```ts
  { t:'crdt.init', actors:['alice','bob'], slot:'balance', type:'pn-counter', args:{ seed:{ perNode:{ alice:100 } } } }
  ```
- **s02** · "Alice's customer withdraws 80. Her copy says 20."
  ```ts
  { t:'crdt.update', actor:'alice', slot:'balance', op:'dec', args:[80] }
  ```
- **s03** · "At the same time, Bob's branch pays out 80 too. His copy also says 20."
  ```ts
  { t:'crdt.update', actor:'bob', slot:'balance', op:'dec', args:[80] }
  ```
- **s04** · "Merge. The counter is honest: 100 − 80 − 80 = −60."
  ```ts
  { t:'crdt.sync', a:'alice', b:'bob', slot:'balance' }
  { t:'highlight', path:['alice.balance','bob.balance'], tone:'bad' }
  { t:'expect', path:'alice.balance', equals:-60 }
  ```
- **s05** · "The math merged fine, but the rule 'never below zero' is broken. No merge function can protect a rule that spans copies."
  ```ts
  { t:'callout', at:'alice.balance', text:'invariant broken', tone:'bad' }
  ```
- **s06** · "A rule that spans copies needs coordination: a lock, a transaction, or one owner (Unit I). Use a CRDT only when 'briefly wrong' is acceptable."
  ```ts
  { t:'clearMarks' }
  { t:'callout', at:'alice', text:'invariant → coordinate', sticky:true }
  ```
- **s07** · "Another one: a unique username. Alice and Bob both claim 'hampton' at the same moment."
  ```ts
  { t:'crdt.init', actors:['alice','bob'], slot:'names', type:'lww-map' }
  { t:'tick' }
  { t:'crdt.update', actor:'alice', slot:'names', op:'set', args:['hampton', 'user-A'] }
  { t:'tick' }
  { t:'crdt.update', actor:'bob',   slot:'names', op:'set', args:['hampton', 'user-B'] }
  { t:'conflict', a:'alice.names.hampton', b:'bob.names.hampton' }
  ```
- **s08** · "Merge: one of them loses, after their screen already said 'yours'. Uniqueness needs a single place to ask first."
  ```ts
  { t:'crdt.sync', a:'alice', b:'bob', slot:'names' }
  { t:'cross', path:'alice.names.hampton' }
  { t:'expect', path:'alice.names.hampton', equals:'user-B' }
  ```
- **s09** · "So: CRDTs for shared, mergeable facts; coordination for invariants. Most real apps use both — that is not a failure, that is design."
  ```ts
  { t:'clearMarks' }
  { t:'callout', at:'alice', text:'CRDT: facts that merge', sticky:true }
  { t:'callout', at:'bob',   text:'lock/transaction: rules that must hold', sticky:true }
  ```

#### Scene 3 — In context: "One last round trip" (the notes app)

World: `layout:'hub'`; `phone` (device, a), `laptop` (device, b), `server` (server). Slot `note` =
composed `{ title: lww-register, body: rga, tags: or-set, pinned: lww-register, views: g-counter }`.

- **s01** · "The notes app from Unit IV, built from everything in the course. Each field has its own type."
  ```ts
  { t:'crdt.init', actors:['phone','laptop','server'], slot:'note', type:'doc',
    args:{ schema:{ title:'lww-register', body:'rga', tags:'or-set', pinned:'lww-register', views:'g-counter' },
           seed:{ title:'Trip', body:[{id:'b1',value:'P'},{id:'b2',value:'a'},{id:'b3',value:'c'},{id:'b4',value:'k'}], tags:[{id:'seed:1', value:'travel'}], pinned:false } } }
  ```
- **s02** · "The phone goes offline on the plane. You rename the note and type at the end."
  ```ts
  { t:'offline', actor:'phone' }
  { t:'tick' }
  { t:'crdt.update', actor:'phone', slot:'note', path:'title', op:'set', args:['Trip to Lisbon'] }
  { t:'crdt.update', actor:'phone', slot:'note', path:'body',  op:'insertAfter', args:['b4', ' bags'] }
  { t:'crdt.update', actor:'phone', slot:'note', path:'views', op:'inc', args:[1] }
  ```
- **s03** · "Meanwhile the laptop types at the start, adds a tag, and pins the note."
  ```ts
  { t:'crdt.update', actor:'laptop', slot:'note', path:'body',   op:'insertAfter', args:['HEAD', 'To do: '] }
  { t:'crdt.update', actor:'laptop', slot:'note', path:'tags',   op:'add', args:['lisbon'] }
  { t:'tick' }
  { t:'crdt.update', actor:'laptop', slot:'note', path:'pinned', op:'set', args:[true] }
  { t:'crdt.update', actor:'laptop', slot:'note', path:'views',  op:'inc', args:[2] }
  ```
- **s04** · "The laptop syncs with the server."
  ```ts
  { t:'crdt.sync', a:'laptop', b:'server', slot:'note' }
  ```
- **s05** · "The phone lands and syncs with the server."
  ```ts
  { t:'online', actor:'phone' }
  { t:'crdt.sync', a:'phone', b:'server', slot:'note' }
  ```
- **s06** · "The server syncs the laptop again. Three copies, one state."
  ```ts
  { t:'crdt.sync', a:'server', b:'laptop', slot:'note' }
  { t:'compare', a:'phone.note', b:'laptop.note' }
  { t:'compare', a:'laptop.note', b:'server.note' }
  ```
- **s07** · "Title and pinned: last write. Body: both edits in one fixed order; tags: the union; views: the sum."
  ```ts
  { t:'highlight', path:['phone.note.title','phone.note.body','phone.note.tags','phone.note.pinned','phone.note.views'], tone:'good' }
  { t:'expect', path:'phone.note.views', equals:3 }
  { t:'expect', path:'phone.note.title', equals:'Trip to Lisbon' }
  ```
- **s08** · "You chose every one of those rules — that is the course. Next door: UUIDs, how devices name things without asking anyone."
  ```ts
  { t:'check', path:'phone.note' }
  { t:'check', path:'laptop.note' }
  { t:'check', path:'server.note' }
  ```

---

## 2. Prototype modules

Each prototype is one or two topics, enough to prove the animation system can express that concept
family. Module ids: `uuids`, `regex`, `columnar-stores`.

### `uuids` / `uuid-v4`

**Learning goal.** Read a UUID v4 byte by byte — 122 random bits, a version nibble, two variant bits,
the 8-4-4-4-12 text form — and explain why two devices can make ids without talking.

**When to use**

- Ids minted on many devices or services with no coordinator (offline apps, microservices, CRDT op ids).
- Public ids in URLs that must not leak order or count.
- Any key where "random and unique" is all you need.

**When not to use**

- Primary keys in an insert-heavy B-tree table → v7 (next topic).
- When humans must read or type the id → short codes.
- When sorting by id should mean "sorted by time" → v7.

**Real-world anchor.** Order ids in a checkout service; Postgres `gen_random_uuid()`.

#### Scene 1 — "16 random bytes, 6 fixed bits"

World: `layout:'row'`; `laptop` (device, a) holds `id` (bytes). Bytes are fixed in the lesson data
("we rolled them once"): `3f a8 5c 12 9b e4 07 71 2d 66 c0 15 8a f3 41 b9`.

- **s01** · "A UUID is 16 bytes. Start with 16 random bytes."
  ```ts
  { t:'set', path:'laptop.id', value:{ kind:'bytes', bytes:[0x3f,0xa8,0x5c,0x12,0x9b,0xe4,0x07,0x71,0x2d,0x66,0xc0,0x15,0x8a,0xf3,0x41,0xb9], annotations:[] } }
  { t:'annotate', path:'laptop.id', from:0, to:16, label:'random', tone:'neutral' }   // NEW annotate (G9)
  ```
- **s02** · "Look at byte 6 (we count from 0). Its top 4 bits are replaced with the version: 0100 = 4."
  ```ts
  { t:'view', path:'laptop.id', mode:'bits', range:[6,7] }                               // NEW bit view (G3)
  { t:'set', path:'laptop.id.bytes[6]', value:0x47 }                                      // 0x07 → 0x47
  { t:'annotate', path:'laptop.id', unit:'bit', from:48, to:52, label:'version = 4', tone:'accent' }   // NEW bit-level (G3)
  ```
- **s03** · "Byte 8: its top 2 bits become 10. That is the 'variant' — it says 'this is a standard UUID'."
  ```ts
  { t:'view', path:'laptop.id', mode:'bits', range:[8,9] }
  { t:'set', path:'laptop.id.bytes[8]', value:0xad }                                      // 0x2d → 0xad
  { t:'annotate', path:'laptop.id', unit:'bit', from:64, to:66, label:'variant = 10', tone:'accent' }
  ```
- **s04** · "Everything else stays random: 122 bits."
  ```ts
  { t:'view', path:'laptop.id', mode:'hex' }
  { t:'annotate', path:'laptop.id', from:0, to:16, label:'random (122 bits)', tone:'neutral' }
  ```
- **s05** · "Write each byte as two hex digits, and add dashes in a 8-4-4-4-12 pattern."
  ```ts
  { t:'view', path:'laptop.id', mode:'canonical' }   // NEW (G3) → 3fa85c12-9be4-4771-ad66-c0158af341b9
  ```
- **s06** · "See the 4 at the start of the third group? That is the version nibble; the fourth group starts with 8, 9, a or b — the variant."
  ```ts
  { t:'highlight', path:'laptop.id.text[14]', tone:'accent' }   // NEW text-position paths in canonical view (G3)
  { t:'highlight', path:'laptop.id.text[19]', tone:'accent' }
  ```
- **s07** · "122 random bits give about 5 × 10^36 values. Two devices making ids at once will not collide in practice (odds, not a promise)."
  ```ts
  { t:'callout', at:'laptop.id', text:'2^122 ≈ 5·10^36', sticky:true }
  ```
- **s08** · "No counter, no server, no clock. That is why every device can make its own id."
  ```ts
  { t:'check', path:'laptop.id' }
  ```

#### Scene 2 — In context: "Two devices, two new orders"

World: `layout:'triangle'`; `phone` (device, a), `tablet` (device, b), `server` (server). `server.orders`
= empty list.

- **s01** · "Two devices, both offline. Each creates an order."
  ```ts
  { t:'offline', actor:'phone' }
  { t:'offline', actor:'tablet' }
  { t:'set', path:'server.orders', value:{ kind:'list', items:[] } }
  ```
- **s02** · "Each rolls its own v4 id. No call home."
  ```ts
  { t:'set', path:'phone.order',  value:{ kind:'record', fields:[{ key:'id', value:{ kind:'bytes', bytes:[0x3f,0xa8,0x5c,0x12,0x9b,0xe4,0x47,0x71,0xad,0x66,0xc0,0x15,0x8a,0xf3,0x41,0xb9], annotations:[], display:'canonical' } }, { key:'total', value:{ kind:'scalar', value:'€12' } }] } }
  { t:'set', path:'tablet.order', value:{ kind:'record', fields:[{ key:'id', value:{ kind:'bytes', bytes:[0x9c,0x01,0x7e,0x55,0x02,0xa1,0x4f,0x3d,0x91,0x0b,0x7a,0xe2,0x66,0x04,0x1c,0xd8], annotations:[], display:'canonical' } }, { key:'total', value:{ kind:'scalar', value:'€40' } }] } }
  { t:'highlight', path:['phone.order.id','tablet.order.id'] }
  ```
- **s03** · "Both come back online and send their orders to the server."
  ```ts
  { t:'online', actor:'phone' }
  { t:'online', actor:'tablet' }
  { t:'send', from:'phone',  to:'server', payload:{ ref:'phone.order' },  id:'m1' }
  { t:'send', from:'tablet', to:'server', payload:{ ref:'tablet.order' }, id:'m2' }
  { t:'deliver', message:'m1', into:'server.orders[+]' }   // `[+]` = append (G21)
  { t:'deliver', message:'m2', into:'server.orders[+]' }
  ```
- **s04** · "Different ids, no clash. The server did not have to hand out numbers."
  ```ts
  { t:'highlight', path:'server.orders', tone:'good' }
  { t:'check', path:'server.orders' }
  ```
- **s05** · "With serial numbers, both devices would have said 'order #1001'. Whoops."
  ```ts
  { t:'callout', at:'server.orders', text:'#1001 vs #1001', tone:'bad' }
  ```
- **s06** · "This is the trick Unit III used for op ids: every node names its own things, and the names never collide."
  ```ts
  { t:'clearMarks' }
  { t:'callout', at:'phone', text:'node names its own ops', sticky:true }
  ```
- **s07** · "One more thing: a v4 id tells you nothing — not when, not where. Good for privacy, bad for sorting; next, v7."
  ```ts
  { t:'callout', at:'server.orders', text:'no order inside the id', sticky:true }
  ```

---

### `uuids` / `uuid-v7`

**Learning goal.** Read a UUID v7 — a 48-bit millisecond timestamp first, then version and variant,
then random bits — and explain why it sorts by time and why databases like that.

**When to use**

- Primary keys in tables with many inserts (index locality, fewer page splits).
- Event, log, and message ids where "roughly time-ordered" is useful.
- Anywhere you wanted v4 but also want cheap "newest first".

**When not to use**

- Ids that must not reveal creation time (v7 leaks it to the millisecond).
- Strict global ordering — two ids in the same millisecond are in random order, and device clocks differ.
- Ids minted on devices whose clocks you do not trust (pair with a logical clock, or use v4).

**Real-world anchor.** Postgres primary keys with `uuidv7()` (PG 18); orders/events tables.

#### Scene 1 — "Time first, then random"

World: `layout:'row'`; `laptop` holds `now` (scalar) and `id` (bytes). Fixed time:
`2026-08-22T10:00:00.000Z` = `1787392800000` ms = `0x01a028e9b500`.

- **s01** · "Take the current time as milliseconds since 1970: 1787392800000 (2026-08-22 10:00:00 UTC)."
  ```ts
  { t:'set', path:'laptop.now', value:{ kind:'record', fields:[{ key:'iso', value:{kind:'scalar', value:'2026-08-22T10:00:00.000Z'} }, { key:'ms', value:{kind:'scalar', value:1787392800000} }] } }
  { t:'highlight', path:'laptop.now.ms' }
  ```
- **s02** · "Write that number as 6 bytes: 01 a0 28 e9 b5 00. They become the first 6 bytes of the id."
  ```ts
  { t:'set', path:'laptop.id', value:{ kind:'bytes', bytes:[0x01,0xa0,0x28,0xe9,0xb5,0x00, 0,0,0,0,0,0,0,0,0,0], annotations:[] } }
  { t:'annotate', path:'laptop.id', from:0, to:6, label:'unix ms (48 bits)', tone:'accent' }
  ```
- **s03** · "Byte 6: top 4 bits = 0111, version 7; byte 8: top 2 bits = 10, the variant. The same slots as v4."
  ```ts
  { t:'set', path:'laptop.id.bytes[6]', value:0x7b }
  { t:'set', path:'laptop.id.bytes[8]', value:0x87 }
  { t:'annotate', path:'laptop.id', unit:'bit', from:48, to:52, label:'version = 7' }
  { t:'annotate', path:'laptop.id', unit:'bit', from:64, to:66, label:'variant = 10' }
  ```
- **s04** · "The rest: 74 random bits."
  ```ts
  { t:'set', path:'laptop.id', value:{ kind:'bytes', bytes:[0x01,0xa0,0x28,0xe9,0xb5,0x00,0x7b,0xe4,0x87,0x71,0x2d,0x66,0xc0,0x15,0x8a,0xf3], annotations:[
      { from:0, to:6, label:'unix ms (48 bits)', tone:'accent' },
      { from:48, to:52, unit:'bit', label:'version = 7' }, { from:64, to:66, unit:'bit', label:'variant = 10' },
      { from:9, to:16, label:'random (74 bits, with the low bits of bytes 6–8)', tone:'neutral' } ] } }
  ```
- **s05** · "Canonical text: 01a028e9-b500-7be4-8771-2d66c0158af3. The 7 shows the version."
  ```ts
  { t:'view', path:'laptop.id', mode:'canonical' }
  { t:'highlight', path:'laptop.id.text[14]', tone:'accent' }
  ```
- **s06** · "One millisecond later, a new id: …b501-7122-…. The time part is bigger, so the text sorts after."
  ```ts
  { t:'set', path:'laptop.id2', value:{ kind:'bytes', bytes:[0x01,0xa0,0x28,0xe9,0xb5,0x01,0x71,0x22,0xb3,0x44,0x55,0x66,0x77,0x88,0x99,0xaa], annotations:[{ from:0, to:6, label:'unix ms', tone:'accent' }], display:'canonical' } }
  { t:'highlight', path:['laptop.id.bytes[5]','laptop.id2.bytes[5]'] }
  ```
- **s07** · "Sort a list of v7 ids as plain strings and you get time order (to the millisecond; inside one millisecond, random order)."
  ```ts
  { t:'set', path:'laptop.v7s', value:{ kind:'list', items:[
      { id:'c', value:{ kind:'scalar', value:'01a028e9-b502-7102-8304-05060708090a' } },
      { id:'a', value:{ kind:'scalar', value:'01a028e9-b500-7be4-8771-2d66c0158af3' } },
      { id:'b', value:{ kind:'scalar', value:'01a028e9-b501-7122-b344-5566778899aa' } } ] } }
  { t:'move', path:'laptop.v7s', id:'a', to:0 }
  { t:'move', path:'laptop.v7s', id:'b', to:1 }
  { t:'check', path:'laptop.v7s' }
  ```
- **s08** · "The same three things with v4 ids sort in a random order. Time is not in them."
  ```ts
  { t:'set', path:'laptop.v4s', value:{ kind:'list', items:[
      { id:'x', value:{ kind:'scalar', value:'3fa85c12-9be4-4771-ad66-c0158af341b9' } },
      { id:'y', value:{ kind:'scalar', value:'9c017e55-02a1-4f3d-910b-7ae266041cd8' } },
      { id:'z', value:{ kind:'scalar', value:'0b4e2d80-6c3a-4a19-bf52-1d9e0c7a6f31' } } ] } }
  { t:'move', path:'laptop.v4s', id:'z', to:0 }
  { t:'callout', at:'laptop.v4s', text:'sorted ≠ by time', tone:'neutral' }
  ```
- **s09** · "Anyone who sees a v7 id learns when it was made, to the millisecond. Decide if that is OK before you choose it."
  ```ts
  { t:'callout', at:'laptop.id', text:'leaks creation time', tone:'bad', sticky:true }
  ```

#### Scene 2 — In context: "Primary keys in a table"

World: `layout:'pair'`; `app` (device, a), `db` (server, "Postgres"). `db.index` = sorted list of keys
drawn as a strip of "pages" (a B-tree leaf level, simplified as one sorted list).

- **s01** · "A table's primary key index keeps keys in sorted order (a B-tree, drawn here as one sorted list)."
  ```ts
  { t:'set', path:'db.index', value:{ kind:'list', items:[
      { id:'k1', value:{kind:'scalar', value:'1a…'} }, { id:'k2', value:{kind:'scalar', value:'4f…'} },
      { id:'k3', value:{kind:'scalar', value:'7c…'} }, { id:'k4', value:{kind:'scalar', value:'b2…'} },
      { id:'k5', value:{kind:'scalar', value:'e9…'} } ] } }
  ```
- **s02** · "Insert three rows with v4 ids. Each lands somewhere in the middle."
  ```ts
  { t:'send', from:'app', to:'db', payload:{ kind:'scalar', value:'3f…' }, id:'i1' } { t:'deliver', message:'i1' }
  { t:'insert', path:'db.index', index:1, item:{ id:'n1', value:{kind:'scalar', value:'3f…'} } }
  { t:'send', from:'app', to:'db', payload:{ kind:'scalar', value:'9c…' }, id:'i2' } { t:'deliver', message:'i2' }
  { t:'insert', path:'db.index', index:4, item:{ id:'n2', value:{kind:'scalar', value:'9c…'} } }
  { t:'send', from:'app', to:'db', payload:{ kind:'scalar', value:'0b…' }, id:'i3' } { t:'deliver', message:'i3' }
  { t:'insert', path:'db.index', index:0, item:{ id:'n3', value:{kind:'scalar', value:'0b…'} } }
  { t:'highlight', path:['db.index[n1]','db.index[n2]','db.index[n3]'], tone:'bad' }
  ```
- **s03** · "Middle inserts touch random pages: cold caches, more page splits."
  ```ts
  { t:'callout', at:'db.index', text:'3 inserts → 3 different pages', tone:'bad' }
  ```
- **s04** · "Same three rows with v7 ids. Each lands at the end."
  ```ts
  { t:'clearMarks' }
  { t:'set', path:'db.index', value:{ kind:'list', items:[
      { id:'k1', value:{kind:'scalar', value:'01a0…00'} }, { id:'k2', value:{kind:'scalar', value:'01a0…0a'} },
      { id:'k3', value:{kind:'scalar', value:'01a0…1f'} }, { id:'k4', value:{kind:'scalar', value:'01a0…33'} },
      { id:'k5', value:{kind:'scalar', value:'01a0…41'} } ] } }
  { t:'insert', path:'db.index', index:5, item:{ id:'n4', value:{kind:'scalar', value:'01a0…52'} } }
  { t:'insert', path:'db.index', index:6, item:{ id:'n5', value:{kind:'scalar', value:'01a0…53'} } }
  { t:'insert', path:'db.index', index:7, item:{ id:'n6', value:{kind:'scalar', value:'01a0…53'} } }
  { t:'highlight', path:['db.index[n4]','db.index[n5]','db.index[n6]'], tone:'good' }
  ```
- **s05** · "Appends hit the same hot page. Fast inserts, and the newest rows sit next to each other."
  ```ts
  { t:'callout', at:'db.index', text:'3 inserts → 1 page', tone:'good' }
  ```
- **s06** · "Bonus: ORDER BY id is close to ORDER BY created_at. Inside one millisecond the order is random — say so in your docs."
  ```ts
  { t:'highlight', path:['db.index[n5]','db.index[n6]'] }
  ```
- **s07** · "Pick v4 when the id should say nothing. Pick v7 when it is a key you insert a lot."
  ```ts
  { t:'check', path:'db.index' }
  ```

---

### `regex` / `regex-matching`

**Learning goal.** See a regex as a list of small tests applied left to right with a cursor, and
recognize what a match, a failed attempt and a restart look like.

**When to use**

- Validating or extracting text with a fixed shape: ids, dates, codes, log fields.
- Search and replace in editors and scripts.
- Tokenizing simple formats before a real parser.

**When not to use**

- Nested structures (HTML, JSON, code) → a parser.
- "Anything a human might type" (names, full email rules) → be loose, or use a library.
- Hot paths over untrusted input without reading the next topic (backtracking).

**Real-world anchor.** Pulling `ORD-0042` out of a log line; form validation.

#### Scene 1 — "A pattern is a list of tests"

World: `layout:'row'`; single actor `matcher` (service, neutral, label "Matcher") holds
`pattern` (NEW kind `pattern`, G10) and `text` (`kind:'text'`, "the cat sat"). The renderer draws the
text with a cursor and per-position marks; the pattern as token chips with its own cursor.

- **s01** · "The pattern c.t has three tests: a 'c', then any one character, then a 't'."
  ```ts
  { t:'set', path:'matcher.pattern', value:{ kind:'pattern', tokens:[{ id:'p0', src:'c', kind:'literal' }, { id:'p1', src:'.', kind:'any' }, { id:'p2', src:'t', kind:'literal' }] } }   // NEW (G10)
  { t:'set', path:'matcher.text', value:{ kind:'text', text:'the cat sat' } }
  { t:'callout', at:'matcher.pattern', text:'3 tests, left to right' }
  ```
- **s02** · "Start at position 0 of the text. Test 1 wants 'c', we see 't': fail."
  ```ts
  { t:'set', path:'matcher.text.cursor', value:0 }
  { t:'set', path:'matcher.pattern.cursor', value:0 }
  { t:'set', path:'matcher.text.matches', value:[{ from:0, to:1, tone:'bad' }] }
  ```
- **s03** · "A fail means: slide the start one to the right and try again. Position 1 is 'h': fail."
  ```ts
  { t:'set', path:'matcher.text.cursor', value:1 }
  { t:'set', path:'matcher.text.matches', value:[{ from:0, to:1, tone:'bad' }, { from:1, to:2, tone:'bad' }] }
  ```
- **s04** · "Position 2 ('e') and position 3 (a space) fail too."
  ```ts
  { t:'set', path:'matcher.text.cursor', value:3 }
  { t:'set', path:'matcher.text.matches', value:[{ from:0, to:4, tone:'bad' }] }
  ```
- **s05** · "Position 4 is 'c', so test 1 passes. Both cursors move forward."
  ```ts
  { t:'set', path:'matcher.text.cursor', value:5 }
  { t:'set', path:'matcher.pattern.cursor', value:1 }
  { t:'set', path:'matcher.text.matches', value:[{ from:0, to:4, tone:'bad' }, { from:4, to:5, tone:'good' }] }
  ```
- **s06** · "Test 2 wants any one character, and 'a' is a character. Pass."
  ```ts
  { t:'set', path:'matcher.text.cursor', value:6 }
  { t:'set', path:'matcher.pattern.cursor', value:2 }
  { t:'set', path:'matcher.text.matches', value:[{ from:0, to:4, tone:'bad' }, { from:4, to:6, tone:'good' }] }
  ```
- **s07** · "Test 3 wants 't', we see 't': pass. All tests passed — a match from 4 to 7."
  ```ts
  { t:'set', path:'matcher.text.cursor', value:7 }
  { t:'set', path:'matcher.pattern.cursor', value:3 }
  { t:'set', path:'matcher.text.matches', value:[{ from:4, to:7, tone:'good' }] }
  { t:'check', path:'matcher.text' }
  ```
- **s08** · "Most engines stop at the first match. With the global flag they continue from 7 — no more 'c' here, so no more matches."
  ```ts
  { t:'set', path:'matcher.text.cursor', value:11 }
  { t:'callout', at:'matcher.text', text:'/g: keep going', sticky:true }
  ```
- **s09** · "That is the whole idea: a cursor in the text, a cursor in the pattern, and a restart on fail."
  ```ts
  { t:'clearMarks' }
  { t:'set', path:'matcher.text.matches', value:[{ from:4, to:7, tone:'good' }] }
  ```

Engine-driven alternative (preferred once G10 lands): replace the `set` triplets with
`{ t:'regex.init', actor:'matcher', pattern:'c.t', input:'the cat sat' }` and one
`{ t:'regex.advance', actor:'matcher', until:'next' | 'attempt' | 'match' }` per step; the real
matcher in `src/regex/` produces cursors, attempt marks and captures.

#### Scene 2 — In context: "Pull the order id out of a log line"

World: as Scene 1. Text: `2026-08-22 paid ORD-0042 ok`. Pattern: `ORD-\d{4}`, then `ORD-(\d{4})`.

- **s01** · "A log line, and we want the order id. Pattern: ORD- and then exactly 4 digits."
  ```ts
  { t:'set', path:'matcher.text', value:{ kind:'text', text:'2026-08-22 paid ORD-0042 ok' } }
  { t:'set', path:'matcher.pattern', value:{ kind:'pattern', tokens:[
      { id:'p0', src:'O', kind:'literal' }, { id:'p1', src:'R', kind:'literal' }, { id:'p2', src:'D', kind:'literal' },
      { id:'p3', src:'-', kind:'literal' }, { id:'p4', src:'\\d{4}', kind:'class', label:'4 digits' } ] } }
  ```
- **s02** · "Positions 0 to 15 fail on the first test — none of them is an 'O'. The engine slides past them."
  ```ts
  { t:'set', path:'matcher.text.matches', value:[{ from:0, to:16, tone:'bad' }] }
  { t:'set', path:'matcher.text.cursor', value:16 }
  { t:'set', path:'matcher.pattern.cursor', value:0 }
  ```
- **s03** · "Position 16: O, R, D, - pass, one by one."
  ```ts
  { t:'set', path:'matcher.text.cursor', value:20 }
  { t:'set', path:'matcher.pattern.cursor', value:4 }
  { t:'set', path:'matcher.text.matches', value:[{ from:0, to:16, tone:'bad' }, { from:16, to:20, tone:'good' }] }
  ```
- **s04** · "\d{4}: four digit tests. 0, 0, 4, 2."
  ```ts
  { t:'set', path:'matcher.text.cursor', value:24 }
  { t:'set', path:'matcher.pattern.cursor', value:5 }
  { t:'set', path:'matcher.text.matches', value:[{ from:0, to:16, tone:'bad' }, { from:16, to:24, tone:'good' }] }
  ```
- **s05** · "Match: 16 to 24."
  ```ts
  { t:'set', path:'matcher.text.matches', value:[{ from:16, to:24, tone:'good' }] }
  { t:'check', path:'matcher.text' }
  ```
- **s06** · "Put parentheses around the digits — a capture group — and the engine hands you just the number."
  ```ts
  { t:'set', path:'matcher.pattern', value:{ kind:'pattern', tokens:[
      { id:'p0', src:'O', kind:'literal' }, { id:'p1', src:'R', kind:'literal' }, { id:'p2', src:'D', kind:'literal' },
      { id:'p3', src:'-', kind:'literal' }, { id:'g1', src:'(', kind:'group' }, { id:'p4', src:'\\d{4}', kind:'class', label:'4 digits' }, { id:'g2', src:')', kind:'group' } ] } }
  { t:'set', path:'matcher.captures', value:{ kind:'record', fields:[{ key:'$1', value:{ kind:'scalar', value:'0042' } }] } }
  { t:'highlight', path:'matcher.captures.$1', tone:'good' }
  ```
- **s07** · "A line with no 'ORD-' fails at every start and ends with 'no match'. That is the slow path — next topic: why it can get very slow."
  ```ts
  { t:'set', path:'matcher.text', value:{ kind:'text', text:'2026-08-22 refund ok', matches:[{ from:0, to:20, tone:'bad' }] } }
  { t:'cross', path:'matcher.text' }
  ```

---

### `regex` / `regex-backtracking`

**Learning goal.** See a greedy quantifier take too much and give characters back one at a time — and
recognize patterns that backtrack too much.

**When to use `.*` and friends**

- Short lines with a fixed tail (`key=.*`).
- Lazy `.*?` when you want the shortest span between two markers.
- Anchored patterns (`^…$`) on input you control.

**When not to use**

- Nested quantifiers (`(a+)+`, `(\w+\s?)+`) on untrusted input — exponential backtracking.
- `.*` where a class says what you mean (`[^"]*`, `\d+`).
- Any regex in a hot path without a timeout or a linear-time engine (RE2, Go, Rust `regex`).

**Real-world anchor.** Cloudflare's 2019 outage: a single `.*.*=.*` in a firewall rule pinned CPUs
worldwide (simplified).

#### Scene 1 — "Greedy, then give back"

World: as regex-matching; text `a1b2b`; pattern `a.*b`. `matcher.stack` = list of choice points
(how much `.*` currently holds).

- **s01** · "Pattern a.*b: an 'a', then anything, as much as possible, then a 'b'. Text: a1b2b."
  ```ts
  { t:'set', path:'matcher.text', value:{ kind:'text', text:'a1b2b' } }
  { t:'set', path:'matcher.pattern', value:{ kind:'pattern', tokens:[{ id:'p0', src:'a', kind:'literal' }, { id:'p1', src:'.*', kind:'quant', label:'greedy' }, { id:'p2', src:'b', kind:'literal' }] } }
  { t:'set', path:'matcher.stack', value:{ kind:'list', items:[] } }
  ```
- **s02** · "Position 0: 'a'. Pass."
  ```ts
  { t:'set', path:'matcher.text.cursor', value:1 }
  { t:'set', path:'matcher.pattern.cursor', value:1 }
  { t:'set', path:'matcher.text.matches', value:[{ from:0, to:1, tone:'good' }] }
  ```
- **s03** · ".* is greedy. It takes everything it can: 1b2b, to the end of the text."
  ```ts
  { t:'set', path:'matcher.text.cursor', value:5 }
  { t:'set', path:'matcher.text.matches', value:[{ from:0, to:1, tone:'good' }, { from:1, to:5, tone:'accent' }] }
  { t:'set', path:'matcher.stack', value:{ kind:'list', items:[{ id:'c1', value:{ kind:'scalar', value:'.* holds 1b2b' } }] } }
  ```
- **s04** · "Test 'b': we are at the end, and nothing is there. Fail."
  ```ts
  { t:'set', path:'matcher.pattern.cursor', value:2 }
  { t:'cross', path:'matcher.pattern' }
  ```
- **s05** · "Backtrack: .* gives back one character and now holds 1b2. Try 'b' at position 4 — it is 'b', pass."
  ```ts
  { t:'clearMarks' }
  { t:'set', path:'matcher.stack', value:{ kind:'list', items:[{ id:'c2', value:{ kind:'scalar', value:'.* holds 1b2' } }] } }
  { t:'set', path:'matcher.text.cursor', value:5 }
  { t:'set', path:'matcher.pattern.cursor', value:3 }
  { t:'set', path:'matcher.text.matches', value:[{ from:0, to:1, tone:'good' }, { from:1, to:4, tone:'accent' }, { from:4, to:5, tone:'good' }] }
  ```
- **s06** · "Match: 0 to 5, the whole string. Note: it matched the last b, not the first."
  ```ts
  { t:'set', path:'matcher.text.matches', value:[{ from:0, to:5, tone:'good' }] }
  { t:'check', path:'matcher.text' }
  ```
- **s07** · "The lazy version a.*?b takes as little as possible, then grows. It tries 'b' at 1 ('1', fail), grows by one, tries 'b' at 2: pass."
  ```ts
  { t:'set', path:'matcher.pattern', value:{ kind:'pattern', tokens:[{ id:'p0', src:'a', kind:'literal' }, { id:'p1', src:'.*?', kind:'quant', label:'lazy' }, { id:'p2', src:'b', kind:'literal' }] } }
  { t:'set', path:'matcher.stack', value:{ kind:'list', items:[{ id:'c3', value:{ kind:'scalar', value:'.*? holds 1' } }] } }
  { t:'set', path:'matcher.text.cursor', value:3 }
  { t:'set', path:'matcher.pattern.cursor', value:3 }
  { t:'set', path:'matcher.text.matches', value:[{ from:0, to:3, tone:'good' }] }
  ```
- **s08** · "Both are correct. They answer different questions: the longest span, or the shortest."
  ```ts
  { t:'callout', at:'matcher.pattern', text:'greedy: a1b2b · lazy: a1b', sticky:true }
  ```
- **s09** · "The cost: every give-back is a retry. One .* is cheap; nested ones are not."
  ```ts
  { t:'highlight', path:'matcher.stack' }
  ```

#### Scene 2 — In context: "When backtracking explodes"

World: as Scene 1; text `aaaaX`; pattern `(a+)+b`. `matcher.tries` = scalar count of attempts
(author-provided numbers, verified by the engine once G10 lands).

- **s01** · "Pattern (a+)+b on aaaaX. It looks harmless."
  ```ts
  { t:'set', path:'matcher.text', value:{ kind:'text', text:'aaaaX' } }
  { t:'set', path:'matcher.pattern', value:{ kind:'pattern', tokens:[{ id:'g1', src:'(', kind:'group' }, { id:'p0', src:'a+', kind:'quant' }, { id:'g2', src:')+', kind:'quant' }, { id:'p1', src:'b', kind:'literal' }] } }
  { t:'set', path:'matcher.tries', value:{ kind:'scalar', value:0 } }
  ```
- **s02** · "The inner a+ takes aaaa and the outer + is satisfied. Test b sees 'X': fail."
  ```ts
  { t:'set', path:'matcher.text.cursor', value:4 }
  { t:'set', path:'matcher.text.matches', value:[{ from:0, to:4, tone:'accent' }, { from:4, to:5, tone:'bad' }] }
  { t:'set', path:'matcher.tries', value:1 }
  ```
- **s03** · "Backtrack: the inner a+ gives one back, and the outer + takes it as a second group. Test b fails again."
  ```ts
  { t:'set', path:'matcher.stack', value:{ kind:'list', items:[{ id:'c1', value:{kind:'scalar', value:'aaa | a'} }] } }
  { t:'set', path:'matcher.tries', value:2 }
  ```
- **s04** · "Every way to split aaaa between the two pluses gets tried: 8 ways for 4 a's, 16 for 5. For 30 a's, about a billion."
  ```ts
  { t:'set', path:'matcher.stack', value:{ kind:'list', items:[
      { id:'c1', value:{kind:'scalar', value:'aaaa'} }, { id:'c2', value:{kind:'scalar', value:'aaa|a'} }, { id:'c3', value:{kind:'scalar', value:'aa|aa'} }, { id:'c4', value:{kind:'scalar', value:'aa|a|a'} },
      { id:'c5', value:{kind:'scalar', value:'a|aaa'} }, { id:'c6', value:{kind:'scalar', value:'a|aa|a'} }, { id:'c7', value:{kind:'scalar', value:'a|a|aa'} }, { id:'c8', value:{kind:'scalar', value:'a|a|a|a'} } ] } }
  { t:'set', path:'matcher.tries', value:8 }
  { t:'highlight', path:'matcher.tries', tone:'bad' }
  ```
- **s05** · "Real outage: Cloudflare, 2019. One rule with ._._=.* pinned CPUs across the network for about half an hour (simplified)."
  ```ts
  { t:'callout', at:'matcher.pattern', text:'2^n tries', tone:'bad', sticky:true }
  ```
- **s06** · "Fix: say what you mean. a+b has one plus, one way to match, no explosion."
  ```ts
  { t:'clearMarks' }
  { t:'set', path:'matcher.pattern', value:{ kind:'pattern', tokens:[{ id:'p0', src:'a+', kind:'quant' }, { id:'p1', src:'b', kind:'literal' }] } }
  { t:'set', path:'matcher.stack', value:{ kind:'list', items:[{ id:'c1', value:{kind:'scalar', value:'aaaa'} }] } }
  { t:'set', path:'matcher.tries', value:5 }   // 4 give-backs + 1 fail (linear)
  { t:'highlight', path:'matcher.tries', tone:'good' }
  ```
- **s07** · "Or use an engine that never backtracks (RE2, Go, Rust regex): no blowups, and fewer features such as backreferences."
  ```ts
  { t:'callout', at:'matcher', text:'linear-time engines: RE2, Go, Rust', sticky:true }
  ```
- **s08** · "Rule for untrusted input: no nested quantifiers, anchor the pattern, prefer [^x]* over .*."
  ```ts
  { t:'check', path:'matcher.pattern' }
  ```

---

### `columnar-stores` / `row-vs-column`

**Learning goal.** See the same table laid out on disk row by row vs. column by column, and why one
query reads far less with columns while another reads far more.

**When to use columnar**

- Analytics: scan a few columns over many rows (sums, averages, group by).
- Append-heavy event and log data; compression matters.
- Queries are known to touch few columns and many rows.

**When not to use**

- Fetch or update whole rows by key (OLTP) — many small random writes.
- Wide single-row reads ("show me this record").
- Small data where layout does not matter yet.

**Real-world anchor.** An `events` table in ClickHouse / BigQuery / Parquet files vs. the same rows
in Postgres. (Cassandra is often called "wide column"; its trick is partitioning — next topic.)

#### Scene 1 — "One query, two layouts"

World: `layout:'row'`. `board.events` = table (NEW G2) with 6 rows × 4 columns (`id, user, price,
country`). Actors `rows` (server, "Row store") holds `blocks` (list of 6 row records); `cols`
(server, "Column store") holds `blocks` (list of 4 column lists). `reads` meters on each (NEW G15).

- **s01** · "Six rows, four columns. The same data stored two ways."
  ```ts
  { t:'set', path:'board.events', value:{ kind:'table', columns:[{key:'id',label:'id'},{key:'user',label:'user'},{key:'price',label:'price'},{key:'country',label:'country'}], rows:[
      { id:'e1', cells:{ id:1, user:'ann', price:12, country:'US' } }, { id:'e2', cells:{ id:2, user:'bo',  price:40, country:'US' } },
      { id:'e3', cells:{ id:3, user:'cy',  price:7,  country:'US' } }, { id:'e4', cells:{ id:4, user:'di',  price:25, country:'FR' } },
      { id:'e5', cells:{ id:5, user:'ed',  price:18, country:'FR' } }, { id:'e6', cells:{ id:6, user:'fay', price:30, country:'DE' } } ] } }
  { t:'set', path:'rows.blocks', value:{ kind:'list', items:[
      { id:'r1', value:{kind:'scalar', value:'1 ann 12 US'} }, { id:'r2', value:{kind:'scalar', value:'2 bo 40 US'} }, { id:'r3', value:{kind:'scalar', value:'3 cy 7 US'} },
      { id:'r4', value:{kind:'scalar', value:'4 di 25 FR'} }, { id:'r5', value:{kind:'scalar', value:'5 ed 18 FR'} }, { id:'r6', value:{kind:'scalar', value:'6 fay 30 DE'} } ] } }
  { t:'set', path:'cols.blocks', value:{ kind:'list', items:[
      { id:'c-id', value:{kind:'scalar', value:'1 2 3 4 5 6'} }, { id:'c-user', value:{kind:'scalar', value:'ann bo cy di ed fay'} },
      { id:'c-price', value:{kind:'scalar', value:'12 40 7 25 18 30'} }, { id:'c-country', value:{kind:'scalar', value:'US US US FR FR DE'} } ] } }
  { t:'set', path:'rows.reads', value:{ kind:'meter', value:0, max:24, label:'values read' } }   // NEW meter (G15)
  { t:'set', path:'cols.reads', value:{ kind:'meter', value:0, max:24, label:'values read' } }
  ```
- **s02** · "Row store: each row's values sit together on disk. Row 1, then row 2, and so on."
  ```ts
  { t:'highlight', path:'board.events[e1]' }
  { t:'highlight', path:'rows.blocks[r1]' }
  ```
- **s03** · "Column store: each column's values sit together. All ids, then all users, then all prices…"
  ```ts
  { t:'highlight', path:'board.events.cols[price]' }   // NEW column path (G2)
  { t:'highlight', path:'cols.blocks[c-price]' }
  ```
- **s04** · "Query: the average price. It needs one column."
  ```ts
  { t:'clearMarks' }
  { t:'callout', at:'board.events', text:'SELECT avg(price)', sticky:true }
  { t:'highlight', path:'board.events.cols[price]', tone:'accent', sticky:true }
  ```
- **s05** · "Row store: to find every price, read every row — all 24 values — and keep 6."
  ```ts
  { t:'highlight', path:'rows.blocks', tone:'bad' }
  { t:'set', path:'rows.reads', value:24 }
  ```
- **s06** · "Column store: read the price block only. 6 values."
  ```ts
  { t:'highlight', path:'cols.blocks[c-price]', tone:'good' }
  { t:'set', path:'cols.reads', value:6 }
  ```
- **s07** · "Same answer, four times less reading. With 100 columns, a hundred times less."
  ```ts
  { t:'callout', at:'cols.reads', text:'6 vs 24', tone:'good' }
  ```
- **s08** · "Bonus: one column holds one type of value, so it compresses well. 'US US US FR FR DE' becomes 'US×3 FR×2 DE'."
  ```ts
  { t:'set', path:'cols.blocks[c-country]', value:{ kind:'scalar', value:'US×3 FR×2 DE' } }
  { t:'highlight', path:'cols.blocks[c-country]', tone:'good' }
  ```
- **s09** · "The other query: 'show me row 3'. The row store reads one block; the column store must visit every column."
  ```ts
  { t:'clearMarks' }
  { t:'callout', at:'board.events', text:'SELECT * WHERE id = 3', sticky:true }
  { t:'highlight', path:'board.events[e3]', tone:'accent', sticky:true }
  { t:'highlight', path:'rows.blocks[r3]', tone:'good' }
  { t:'set', path:'rows.reads', value:4 }
  { t:'highlight', path:'cols.blocks', tone:'bad' }
  { t:'set', path:'cols.reads', value:24 }   // every column block touched (simplified: whole blocks)
  ```
- **s10** · "Rows for 'get this record', columns for 'sum this field over everything'. Pick by the question you ask most."
  ```ts
  { t:'check', path:'rows.blocks' }
  { t:'check', path:'cols.blocks' }
  ```

---

### `columnar-stores` / `partition-and-clustering`

**Learning goal.** See how a partition key chooses the node and a clustering key sets the order inside
the partition — and why a query that names both is fast and one that names neither is slow.

**When to use (Cassandra-style)**

- Huge write volume; queries known up front and keyed by an entity plus time (messages by channel, events by device).
- Multi-datacenter replication and no single master.
- Append-mostly data read back in key order.

**When not to use**

- Ad-hoc queries, joins, aggregations across partitions → a column store or a warehouse.
- Small data or few queries per second → a relational database is simpler.
- "Find rows where text contains…" → a search index.

**Real-world anchor.** A chat `messages` table: `PRIMARY KEY ((channel_id), sent_at DESC)`.

#### Scene 1 — "The partition key picks the node, the clustering key picks the order"

World: `layout:'ring'` with `client` (device, a) in the center (NEW G17); servers `node-a`, `node-b`,
`node-c` tagged with token ranges `0–33`, `34–66`, `67–99` (NEW `tag`, G16). Each node holds
`partitions` (record: channel id → list of messages, each message a record `{ sent_at, body }`).

- **s01** · "Three nodes in a ring. Each node owns a range of 'tokens' — numbers from 0 to 99 (simplified)."
  ```ts
  { t:'tag', actor:'node-a', tags:['tokens 0–33'] }    // NEW (G16)
  { t:'tag', actor:'node-b', tags:['tokens 34–66'] }
  { t:'tag', actor:'node-c', tags:['tokens 67–99'] }
  ```
- **s02** · "A message arrives: channel 42, 10:00, 'hi'. The partition key is channel_id."
  ```ts
  { t:'set', path:'client.msg', value:{ kind:'record', fields:[{key:'channel_id', value:{kind:'scalar', value:42}}, {key:'sent_at', value:{kind:'scalar', value:'10:00'}}, {key:'body', value:{kind:'scalar', value:'hi'}}] } }
  { t:'highlight', path:'client.msg.channel_id', tone:'accent' }
  ```
- **s03** · "hash(42) = 51 (made up for the lesson). Token 51 is in node B's range, so node B stores it."
  ```ts
  { t:'send', from:'client', to:'node-b', payload:{ ref:'client.msg' }, id:'m1', label:'hash(42) = 51' }
  { t:'deliver', message:'m1', into:'node-b.partitions.42[+]' }
  ```
- **s04** · "Another message, channel 7. hash(7) = 80 → node C."
  ```ts
  { t:'set', path:'client.msg', value:{ kind:'record', fields:[{key:'channel_id', value:{kind:'scalar', value:7}}, {key:'sent_at', value:{kind:'scalar', value:'10:01'}}, {key:'body', value:{kind:'scalar', value:'yo'}}] } }
  { t:'send', from:'client', to:'node-c', payload:{ ref:'client.msg' }, id:'m2', label:'hash(7) = 80' }
  { t:'deliver', message:'m2', into:'node-c.partitions.7[+]' }
  ```
- **s05** · "Channel 42 again: hash(42) is always 51, so always node B. All of channel 42 lives together."
  ```ts
  { t:'set', path:'client.msg', value:{ kind:'record', fields:[{key:'channel_id', value:{kind:'scalar', value:42}}, {key:'sent_at', value:{kind:'scalar', value:'10:05'}}, {key:'body', value:{kind:'scalar', value:'lunch?'}}] } }
  { t:'send', from:'client', to:'node-b', payload:{ ref:'client.msg' }, id:'m3', label:'hash(42) = 51' }
  { t:'deliver', message:'m3', into:'node-b.partitions.42[+]' }
  { t:'highlight', path:'node-b.partitions.42' }
  ```
- **s06** · "Inside the partition, rows are kept sorted by the clustering key: sent_at, newest first."
  ```ts
  { t:'move', path:'node-b.partitions.42', id:'m3', to:0 }
  { t:'highlight', path:'node-b.partitions.42[m3]', tone:'accent' }
  ```
- **s07** · "Query: 'last 20 messages in channel 42'. One hash, one node, one sorted run — fast."
  ```ts
  { t:'callout', at:'client', text:'WHERE channel_id = 42 LIMIT 20', sticky:true }
  { t:'send', from:'client', to:'node-b', payload:{ kind:'scalar', value:'channel 42?' }, id:'q1', label:'hash(42) = 51' }
  { t:'deliver', message:'q1' }
  { t:'highlight', path:'node-b.partitions.42', tone:'good' }
  ```
- **s08** · "Query: 'all messages that say hi', with no partition key. Every node, every partition — slow, and Cassandra refuses unless you insist."
  ```ts
  { t:'clearMarks' }
  { t:'callout', at:'client', text:"WHERE body = 'hi'", sticky:true }
  { t:'send', from:'client', to:['node-a','node-b','node-c'], payload:{ kind:'scalar', value:'body = hi?' }, id:'q2' }
  { t:'deliver', message:'q2→node-a' } { t:'deliver', message:'q2→node-b' } { t:'deliver', message:'q2→node-c' }
  { t:'highlight', path:['node-a.partitions','node-b.partitions','node-c.partitions'], tone:'bad' }
  { t:'cross', path:'client' }
  ```
- **s09** · "Rule: design the table from the query. Partition key = what you look up by; clustering key = how you want it sorted."
  ```ts
  { t:'clearMarks' }
  { t:'callout', at:'node-b', text:'partition → node · clustering → order', sticky:true }
  ```

#### Scene 2 — In context: "A hot partition, and the fix"

World: as Scene 1, with `node-b.partitions.42` holding many rows (drawn as a tall stack, `meter` of
row counts per node, NEW G15).

- **s01** · "Channel 42 is busy: a million messages, all on node B. Node B is hot; the others sit idle."
  ```ts
  { t:'set', path:'node-a.load', value:{ kind:'meter', value:3,   max:100, label:'load' } }
  { t:'set', path:'node-b.load', value:{ kind:'meter', value:97,  max:100, label:'load' } }
  { t:'set', path:'node-c.load', value:{ kind:'meter', value:5,   max:100, label:'load' } }
  { t:'highlight', path:'node-b.load', tone:'bad' }
  ```
- **s02** · "Fix: add the day to the partition key — (channel_id, day). Each day hashes somewhere else."
  ```ts
  { t:'callout', at:'client', text:'PRIMARY KEY ((channel_id, day), sent_at)', sticky:true }
  ```
- **s03** · "Three days, three nodes. The load spreads."
  ```ts
  { t:'send', from:'client', to:'node-a', payload:{ kind:'scalar', value:'(42, Aug 20)' }, id:'d1', label:'hash = 12' }
  { t:'send', from:'client', to:'node-c', payload:{ kind:'scalar', value:'(42, Aug 21)' }, id:'d2', label:'hash = 71' }
  { t:'send', from:'client', to:'node-b', payload:{ kind:'scalar', value:'(42, Aug 22)' }, id:'d3', label:'hash = 51' }
  { t:'deliver', message:'d1', into:'node-a.partitions.42/Aug20[+]' }
  { t:'deliver', message:'d2', into:'node-c.partitions.42/Aug21[+]' }
  { t:'deliver', message:'d3', into:'node-b.partitions.42/Aug22[+]' }
  { t:'set', path:'node-a.load', value:33 } { t:'set', path:'node-b.load', value:35 } { t:'set', path:'node-c.load', value:32 }
  { t:'highlight', path:['node-a.load','node-b.load','node-c.load'], tone:'good' }
  ```
- **s04** · "The cost: 'last 20 messages' may now touch two partitions — today and yesterday. Two reads, still fast."
  ```ts
  { t:'send', from:'client', to:['node-b','node-c'], payload:{ kind:'scalar', value:'(42, today), (42, yesterday)' }, id:'q3' }
  { t:'deliver', message:'q3→node-b' } { t:'deliver', message:'q3→node-c' }
  { t:'highlight', path:['node-b.partitions.42/Aug22','node-c.partitions.42/Aug21'], tone:'good' }
  ```
- **s05** · "'How many messages per country?' is still not a question for this table. That is the column store's job (previous topic)."
  ```ts
  { t:'clearMarks' }
  { t:'callout', at:'client', text:'analytics → column store', sticky:true }
  ```
- **s06** · "Use both: partitions for the app's questions, columns for the analyst's questions."
  ```ts
  { t:'check', path:'node-a.partitions' } { t:'check', path:'node-b.partitions' } { t:'check', path:'node-c.partitions' }
  ```

---

## 3. DSL gaps found while writing this slice

Severity: **blocker** = a topic in this slice cannot be authored without it; **important** = authorable
with an ugly workaround that will rot; **nice** = polish. Ids `Gn` are referenced from the scripts.

| Id  | Gap                                                                                                                        | Severity                                                    | Hit in                                                   |
| --- | -------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- | -------------------------------------------------------- |
| G1  | Composed CRDT documents (schema + path-addressed ops + recursive merge + `meta.note` type chips)                           | blocker                                                     | V.1 s4, V.2 all, V.4 s2, V.5 s3 (and II.10, III.6, IV.6) |
| G2  | `table` Value kind with row/column paths and column highlight                                                              | blocker (columnar), important (V.1/V.3/V.4 decision tables) | columnar both, V.1, V.3 s4, V.4 s4                       |
| G3  | `bytes`: bit-level annotations, display modes (hex/bits/canonical), `view` command, `text[n]` positions                    | blocker                                                     | uuid-v4, uuid-v7                                         |
| G4  | Free-standing panels (`board.<id>`) not owned by an actor; declared in the scene world                                     | important                                                   | V.1, V.2 s1, V.3 s4, V.4 s4, V.5 s1, columnar            |
| G5  | `crdt.init` seeded state with author ids; documented generated-id scheme `node:n`                                          | important                                                   | every CRDT scene                                         |
| G6  | Message plumbing: `crdt.broadcast {id,to}`, `crdt.merge {message}`, `relay`, broadcast message naming `id→to`              | important                                                   | V.3 s1/s4, V.4 s1/s3 (and all of Unit III)               |
| G7  | `compare` (reducer-computed equality / clock relation, draws "=" or "≠")                                                   | important                                                   | every convergence moment                                 |
| G8  | `expect` test-time assertion                                                                                               | important                                                   | every step whose narration states a computed value       |
| G9  | `annotate` / `unannotate` commands (incremental annotations)                                                               | important                                                   | uuid-v4, uuid-v7                                         |
| G10 | `pattern` Value kind + `regex.*` engine-driven commands (`regex.init`, `regex.advance`) with captures and attempt marks    | important                                                   | regex both                                               |
| G11 | `crdt.init args.expose: ['clock' \| 'stats']` → version vector / stored-vs-visible counts as Values                        | important                                                   | V.3 s2/s3, V.4 s1                                        |
| G12 | LWW timestamp semantics (`ts` = `world.clock`; optional `ts` override; auto-tick option)                                   | important                                                   | every LWW scene                                          |
| G13 | i18n addressing for text inside commands (callout text, table cells, tags, board scalars)                                  | important                                                   | everywhere                                               |
| G14 | RGA sugar (`insertAfter` with a string, `remove` with id list), teaching-only `compact`, `mv-register` and `ew-flag` types | important / nice                                            | V.3 s2/s3, V.4 s1/s2                                     |
| G15 | `meter` Value kind (value/max/label)                                                                                       | nice                                                        | V.3 (stats), columnar                                    |
| G16 | `tag` command (small persistent chips on an actor)                                                                         | nice                                                        | V.4, columnar                                            |
| G17 | Layout: ring with a center actor; slot column labels inside an actor card; `focus`                                         | nice                                                        | columnar, V.1 s1–s3                                      |
| G18 | Actor kinds `storage`, `region`, `library`, `board` (or free-form `icon`)                                                  | nice                                                        | V.4, columnar                                            |
| G19 | `list` display `inline` (text-like run of chars) vs `cells`                                                                | nice                                                        | V.3 s2, V.4 s1/s3, V.5 s3                                |
| G20 | "Try it" choices (`choice` command / sandbox ops)                                                                          | nice                                                        | out of slice                                             |
| G21 | Clarify `set` creating record fields; `[+]` append in `deliver.into`; `delete` on record keys                              | nice                                                        | V.2 s1, uuid s2, columnar                                |
| G22 | Message payload size hint (`size` or rendered byte count)                                                                  | nice                                                        | V.3 s1                                                   |

### G1 — Composed CRDT documents (blocker)

Needed: a document whose fields are CRDTs of different types, nested (lists of composed items), merged
as one unit by real code. v0 `crdt.init` has one flat `type` per slot; there is no way to say "title is
LWW, labels is OR-Set, checklist is an RGA of {text: LWW, done: LWW}".

Proposal:

```ts
type CrdtSchema =
  | CrdtType // leaf: 'lww-register' | 'pn-counter' | 'or-set' | 'rga' | …
  | { map: Record<string, CrdtSchema> } // fixed fields (a "struct"); shorthand: a plain object
  | { list: CrdtSchema } // RGA whose item values follow the schema
  | { dict: CrdtSchema } // LWW/OR-keyed map of dynamic keys → schema (Riak map, Y.Map)
  | { t: 'crdt.init'; actors; slot; type: 'doc'; args: { schema: CrdtSchema; seed?: unknown } }
  | { t: 'crdt.update'; actor; slot; path?: string; op: string; args: unknown[] } // path addresses the leaf: 'checklist[c1].done'
```

`src/crdt/doc.ts` implements `ComposedDoc` with recursive `merge`, and `toValue()` returns nested
`record`/`list` Values. Each leaf's Value carries its own `meta` (ts/node for LWW, tags for OR-Set,
tombstones for RGA) and `meta.note` = the type name so the renderer can draw a tiny type chip.
`crdt.sync`/`crdt.merge`/`crdt.broadcast` work on the whole slot unchanged. Property tests cover
the composed merge laws.

### G2 — `table` Value kind (blocker for columnar)

```ts
| { kind:'table'; columns: Array<{ key: string; label: string }>; rows: Array<{ id: string; cells: Record<string, Scalar | Value> }>; meta?: Meta }
```

Paths: `x.table[rowId]` (row), `x.table.cols[key]` (column), `x.table[rowId].cells[key]` (cell).
`insert`/`delete`/`move` work on rows; `highlight` accepts row, column and cell paths (column
highlight draws a vertical band). Renderer: header row, mono values, wraps inside its own
`overflow-x:auto`. Also serves decision tables (V.1, V.3 s4, V.4 s4) and the "rows vs. columns" story.

### G3 — `bytes` needs bits and views (blocker for uuids)

Needed: annotate 4 bits of byte 6 and 2 bits of byte 8; show the same 16 bytes as hex, as bits (for a
byte range), and as the canonical `8-4-4-4-12` string; highlight single characters of that string.

```ts
| { kind:'bytes'; bytes: number[]; annotations: Array<{ from: number; to: number; unit?: 'byte' | 'bit'; label: string; tone?: Tone }>;
    display?: 'hex' | 'bits' | 'canonical' | 'dec'; bitsRange?: [number, number]; groups?: number[] }
| { t:'view'; path: Path; mode: 'hex' | 'bits' | 'canonical' | 'dec'; range?: [number, number] }   // animates between views
```

Paths `x.bytes[6]` (one byte, settable) and `x.text[14]` (one character of the canonical text) must
resolve. The `bits` view expands the requested byte range inline (no separate zoom needed). Optional
later: `uuid.make { into, version, seed, timeMs }` so `src/uuid/` computes the bytes (today the bytes
are fixed lesson data, computed once and checked by a unit test against a reference implementation).

### G4 — Free-standing boards (important)

Decision tables, schemas, checklists, regex matchers and disk layouts are not "held" by a person or
server. Workaround today: a `neutral` `service` actor with a label, which draws an avatar and an
online badge that mean nothing. Proposal: `World.boards: Record<BoardId, { label: string; value: Value }>`,
declared in the scene world, addressed as `board.<id>`; the renderer draws a plain card (no avatar,
no online state) and the layout preset places boards beside/below actors. `set`, `insert`, `highlight`,
`check`, `callout` work on board paths unchanged. (Alternatively `Actor.kind: 'board'` with the same
rendering rule — fewer types, same effect.)

### G5 — Seeded CRDT state and stable generated ids (important)

Every scene starts mid-story ("the card already says 'Fix login'"). Proposal: `crdt.init args.seed`
— the per-type seed shape (`scalar` for registers, `Record` for maps, `{perNode}` for counters,
`Array<{id, value}>` for sets/lists) with **author-chosen ids** so later paths can reference them. Items
created by ops get ids `${node}:${n}` where `n` is that node's op counter within the slot; this scheme
is part of the DSL contract (Zod validates path references against a dry-run of the reducer at test
time, so a typo in `steps[alice:1]` fails `pnpm test`). Scene worlds may declare `crdts: [...]` so
`crdt.init` does not have to be the first step.

### G6 — Message plumbing for sync scenes (important)

- `crdt.broadcast` needs `id` (the lesson must later `drop`/`apply` a specific message) and optional
  `to: ActorId[]` (hub topologies). Fan-out messages are named `${id}→${to}`.
- `crdt.merge { into, message }` merges the **payload snapshot** carried by a delivered message, so
  "what traveled" is exactly what is merged (today `merge {into, from}` reads the sender's _live_
  state, which is wrong after the sender edits again — V.3 s1 depends on this).
- `relay { message, to, id }`: a server forwards a received message (Apple Notes via iCloud).
- `send` payload `{ ref }` should snapshot at send time (document it).

### G7 — `compare` (important)

CLAUDE.md lists `compare`; v0 lacks it. `{ t:'compare'; a: Path; b: Path; expect?: 'equal' | 'different' | 'before' | 'after' | 'concurrent' }`.
The reducer computes the verdict (deep-equal of `toValue()` for values, clock relation for `clock`
Values) and the renderer draws `=` / `≠` / `→` / `∥` between the two. When `expect` is given and the
verdict differs, `pnpm test` fails — this is how "both copies are the same" becomes a proven claim.

### G8 — `expect` (important)

`{ t:'expect'; path: Path; equals: Scalar | string[] }` — no visual; evaluated by the schema/reducer
tests. Narration states numbers ("1 + 1 = 2", "−60", "stored 7"); because real code computes them, the
narration can silently drift from the stage. `expect` pins the claim. The verify walker can also
assert it in the browser.

### G9 — `annotate` / `unannotate` (important)

CLAUDE.md lists `annotate`; v0 only has `bytes.annotations` as data. Replacing the whole `bytes`
value to add one label re-highlights all 16 bytes. Proposal:
`{ t:'annotate'; path; from; to; unit?: 'byte'|'bit'; label; tone?; id? }` and
`{ t:'unannotate'; path; id | all }`. Also valid on `text` (ranges) and `table` (rows/columns).

### G10 — `pattern` Value + engine-driven regex (important)

```ts
| { kind:'pattern'; tokens: Array<{ id: string; src: string; kind: 'literal'|'any'|'class'|'quant'|'group'|'anchor'|'alt'; label?: string }>; cursor?: number }
| { t:'regex.init'; actor; pattern: string; input: string; flags?: string }
| { t:'regex.advance'; actor; until: 'next' | 'attempt' | 'backtrack' | 'match' | 'end' }
```

`src/regex/` is a small backtracking VM that exposes its trace (text cursor, pattern cursor,
attempt ranges, choice-point stack, captures, try count). `toValue()` writes `text`, `pattern`,
`stack`, `captures`, `tries` into the actor. The scripts above are authored with `set` so they work
today; once G10 lands they shrink to one `regex.advance` per step and the numbers in Scene 2 of
backtracking become computed, not typed.

### G11 — Expose CRDT internals as Values (important)

`crdt.init args.expose: Array<'clock' | 'stats'>`: the slot's Value becomes
`record { value, clock?, stats? }` where `clock` is the replica's version vector (`kind:'clock'`) and
`stats` is `record { stored, visible, tombstones }`. Needed for the Yjs state-vector dance (V.4 s1),
stable-GC (V.3 s3) and metadata growth (V.3 s2). Unit III/IV want the same.

### G12 — LWW timestamp semantics (important)

v0 never says where an LWW write gets its `ts`. Proposal: `ts = world.clock` at the time of the
`crdt.update`; `tick` is explicit in lessons (readable, deterministic). Add `crdt.update.ts?: number`
to override (clock-skew lessons in Unit IV) and a scene option `autoTick: true` to bump the clock
before every update for scenes where ordering is not the point. Tie-break: higher node id wins;
document once.

### G13 — i18n for text inside commands (important)

`callout.text`, `tag.tags`, table cells, board scalars and `send.label` are user-visible content but
live inside `do`, not `say`. Overlay JSON needs a stable address. Proposal: overlays key on
`${stepId}.do[${index}].${field}` (e.g. `s07.do[1].text`), generated by a script that extracts all
localizable strings from content; plus an optional `textId` on any command for authors who want a
readable key. The Zod schema marks which fields are localizable.

### G14 — RGA sugar, teaching ops, extra types (important / nice)

- `insertAfter(afterId, 'hello')` inserts one item per character (the most common authoring need).
- `remove(id | id[])`.
- `compact()` — drops tombstones without a stability check, **for teaching only** (V.3 s3 shows the
  resurrection bug by design). Mark the op as `unsafe` in the implementation so it is never used
  outside lessons.
- `mv-register` (multi-value register, Riak siblings / Automerge conflicts) — needed by IV.4 anyway.
- `ew-flag` (enable-wins flag, Riak) — nice; V.4 s2 uses a register "(simplified)" until it exists.

### G15–G22 — nice to have

- **G15 `meter`**: `{ kind:'meter'; value: number; max?: number; label?: string; tone? }` — reads
  counted, load per node, stored vs. visible.
- **G16 `tag`**: `{ t:'tag'; actor; tags: string[] }` — persistent chips (token ranges, "op-based",
  library facts). Sticky callouts work but clutter.
- **G17 layout**: `{ t:'layout'; preset:'ring'; center?: ActorId }`; per-slot column labels when an
  actor holds several slots side by side (V.1 "as a register / as a counter"); `focus` is not needed
  once `view bits` (G3) exists.
- **G18 actor kinds**: `storage`, `region`, `library`, or a free `icon` name.
- **G19 list display**: `display: 'inline'` draws an RGA of characters as text with tombstones as faint
  struck glyphs; `cells` (default) draws chips with ids.
- **G20 Try it**: out of this slice; note that every scene here has an obvious sandbox ("add your own
  label", "pick a partition key") if `choice` arrives.
- **G21 clarifications**: `set` on a missing record field creates it; `delete` on a record removes a
  key; `deliver.into` accepts `[+]` (append) on a list path; `set` on `x.bytes[i]` replaces one byte.
- **G22 size hint**: `send.size?: 'xs'|'s'|'m'|'l'` or a computed byte count drawn on the envelope.

---

## 4. Authoring ergonomics — builder helpers

Writing ~300 steps by hand made the following helpers obviously worth building in `src/lesson/builders`:

1. **Actors**: `actors.alice()`, `actors.bob()`, `actors.carol()`, `actors.server('iCloud')`,
   `actors.device('phone', 'a')`, `actors.node('us-east')`, `actors.board('table', label)` — fixed
   palette slots and kinds; labels localizable by id.
2. **Scene/step**: `scene({ id, layout, actors, boards?, crdts? }, [...steps])`,
   `step('s01', 'Narration.', ...cmds)`, `step.hold('long')`. `topic({ id, goal, whenToUse, whenNotToUse, anchor, scenes })`.
   The builder asserts: ids unique and zero-padded, ≤ 2 sentences in `say` (simple sentence splitter),
   no `{`/`}` in narration, every Path resolves in a dry-run reduce.
3. **CRDT schema**: `lww(seed?)`, `lwwMap({...})`, `pn()`, `g()`, `orSet([...])`, `rga([...] | 'chars')`,
   `mvr()`, `doc({ title: lww('Fix login'), labels: orSet(['bug']), checklist: list(doc({ text: lww(), done: lww(false) })) })`
   → typed `CrdtSchema` + seed in one call; `init(['alice','bob'], 'card', schema)`.
4. **Typed ops by path**: `on('alice','card').title.set('x')`, `on('bob','card').labels.add('bug')`,
   `on('alice','card').checklist.insertAfter('c2','ship it')`, `.checklist.item('c1').done.set(true)` —
   the schema type drives autocomplete, so `inc` on a register is a compile error, not a runtime surprise.
5. **Sync shorthands**: `sync('alice','bob','card')`, `syncAll('likes')` (ring order), `merge('bob').from('alice')`,
   `broadcast('alice','doc').as('m1').to('bob')`, `apply('m1→bob')`, `drop('m1→bob')`.
6. **Time**: `at(3, ...cmds)` sets the clock and runs the commands; `tick()`; or `scene.autoTick`.
7. **Marks**: `bad(path, text?)`, `good(path)`, `ok(path)` → check, `nope(path)` → cross,
   `note(at, text)` → callout, `pin(at, text)` → sticky callout, `zap(a, b)` → conflict, `clear()`.
8. **Assertions**: `expect(path).toBe(12)`, `converged('alice.card','bob.card')` (= `compare` with `expect:'equal'`).
9. **Bytes**: `uuid.v4(bytes)`, `uuid.v7({ ms, rand })` (computed by `src/uuid/` at build time, snapshot-tested),
   `annot(path).bits(6, 0, 4, 'version = 4')`, `view(path).canonical()`.
10. **Tables/boards**: `table(['how','use'])`, `row('r1', { how, use })`, `addRow('board.table', row)`.
11. **Regex**: `regex('c.t').on('the cat sat')` for `regex.init`; `advance('match')`.
12. **Messages in hub scenes**: `via('icloud')` helper that expands to broadcast-to-hub + relay.
13. **Narration lint (test-time)**: sentence count, word count (< 28), banned-jargon list with the
    glossary as the allow-list, straight quotes only, "(simplified)" required when a flagged phrase appears.
14. **Path template**: `p\`alice.card.checklist[${id}].done\`` validated against the dry-run world.
15. **Storyboard link**: each `topic` gets a generated `verification/<module>/<topic>.html` link in the
    authoring docs so reviewers see frames next to the script.

With these, Scene 1 of V.1 reads roughly:

```ts
scene({ id:'replace-or-add', layout:'pair', actors:[actors.alice(), actors.bob()], boards:[table('table', ['how','use'])] }, [
  step('s01', 'Alice and Bob each hold a copy of a likes count. We keep it two ways: as a register, and as a counter.',
    init(['alice','bob'], 'likes_reg', lww(0)), init(['alice','bob'], 'likes_ctr', pn())),
  step('s02', 'Alice taps like. Her code reads 0, adds 1, and writes 1.',
    tick(), on('alice','likes_reg').set(1), on('alice','likes_ctr').inc(1)),
  step('s03', 'Bob taps like at the same time. His code also reads 0 and writes 1.',
    tick(), on('bob','likes_reg').set(1), on('bob','likes_ctr').inc(1)),
  step('s04', 'Now the copies merge.', sync('alice','bob','likes_reg'), sync('alice','bob','likes_ctr')),
  step('s05', 'The register kept one 1 and dropped the other. One like is gone — whoops.',
    bad(['alice.likes_reg','bob.likes_reg']), note('bob.likes_reg', 'one like lost', 'bad'), expect('alice.likes_reg').toBe(1)),
  step('s06', 'The counter kept one tally per person: 1 + 1 = 2. Both likes count.',
    good(['alice.likes_ctr','bob.likes_ctr']), ok('alice.likes_ctr'), ok('bob.likes_ctr'), expect('alice.likes_ctr').toBe(2)),
  …
])
```

---

## 5. Topic → real-world anchor (for the "When to use / example" strip)

| Topic                         | Anchor                                                                                                                                                                                        |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| V.1 which-crdt-for-which-data | A task card in a kanban tool (Trello / Linear): title, owner, labels, votes, checklist                                                                                                        |
| V.2 composing-a-document      | A kanban board (columns → cards); Automerge/Yjs nested maps & lists; Riak maps; the "duplicate card on move" bug                                                                              |
| V.3 tradeoffs                 | Likes counter across 3 data centers (state sync) vs. a document typed for a year (tombstones, GC)                                                                                             |
| V.4 real-systems              | Yjs & Automerge (editors / JSON+history); Riak & Redis Enterprise (DB types across regions); Apple Notes (sequence CRDT via iCloud); Figma (server-ordered per-property LWW, "CRDT-inspired") |
| V.5 course-complete           | Bank balance & unique username (need coordination) vs. the Unit IV notes app (CRDT)                                                                                                           |
| uuid-v4                       | Order ids minted offline; Postgres `gen_random_uuid()`                                                                                                                                        |
| uuid-v7                       | Insert-heavy primary keys; Postgres `uuidv7()`; "newest first" event tables                                                                                                                   |
| regex-matching                | Pulling `ORD-0042` out of a log line; form validation                                                                                                                                         |
| regex-backtracking            | Cloudflare 2019 outage (`.*.*=.*`); linear-time engines (RE2/Go/Rust)                                                                                                                         |
| row-vs-column                 | `events` table in ClickHouse / BigQuery / Parquet vs. Postgres rows                                                                                                                           |
| partition-and-clustering      | Cassandra `messages ((channel_id), sent_at DESC)`; hot partitions and day bucketing                                                                                                           |

## 6. Outline changes proposed from this slice

- Split each prototype module into two topics (ids above): `uuid-v4` / `uuid-v7`,
  `regex-matching` / `regex-backtracking`, `row-vs-column` / `partition-and-clustering`. Each first
  topic is the atomic concept; each second topic is the "and now the consequence" with its own
  in-context scene. One topic per module was too thin to prove the animation system.
- V.1 ends with a **decision table** that V.2 and V.5 reuse (same board shape) — keep the table
  shape identical across topics so learners recognize it.
- V.2 gained a "Delete vs. edit" scene and the "duplicate card on move" in-context scene; both are the
  questions coworkers actually ask, and both are schema decisions rather than CRDT internals.
- V.5 Scene 2 ("When not to use a CRDT") is the most important new content in the unit — it uses the
  real PN-Counter to go negative and the real LWW-map to lose a username; consider linking to it from
  Unit I.4 (not-everything-needs-a-transaction).
- Unit IV should introduce `mv-register` (siblings) so V.4 can reuse it; Unit III should introduce
  `expose:['clock']` so V.4's Yjs state-vector scene is a callback, not a first sight.
