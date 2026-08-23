# Unit I + Unit II — lesson scripts and DSL stress test (v0)

Scope: **Unit I — The Problem** (6 topics) and **Unit II — State-based CRDTs** (11 topics).
Written against `docs/animation-dsl.md` v0. Every topic below has: learning goal, when/when-not
bullets, real-world anchor, full scene scripts (stable step ids + narration + commands), and the DSL
gaps it exposed. Consolidated gaps and authoring-ergonomics proposals are at the end (§3, §4).

This document is meant to be lifted into `src/content/crdts/unit-1/*.ts` and `unit-2/*.ts` almost
line-for-line once the builders in §4 exist.

---

## 0. Conventions used in this document

### 0.1 Notation

- Commands are written as v0 object literals, one per line, `t` first:
  `{t:'set', path:'alice.doc.title', value:'Q3 plan'}`.
- Commands that do not exist in v0 are tagged **NEW (Gn)** and point at a gap in §3.
- Value shorthand (these become builders, §4):
  - a bare string / number / boolean is `{kind:'scalar', value}`;
  - `rec({k: v, …})` = record of scalars (nesting allowed);
  - `list(['a','b'])` = list, item id = the value string;
  - `sset(['a','b'])` = set, item id = the value string;
  - `cnt({alice: 2, bob: 1})` = counter `perNode`.
- Paths follow the grammar proposed in G8: `actor.slot.field`, `[id]` for list/set items and
  per-node counter entries, `@ts` / `@node` / `@tags` / `@tomb` to address sidecar metadata.
- Narration is in quotes. One or two sentences. Nothing else is spoken.
- `hold` is omitted unless it is not `normal`.

### 0.2 Actors and palette

| id                                | kind    | color     | notes                                           |
| --------------------------------- | ------- | --------- | ----------------------------------------------- |
| `alice`                           | person  | a         | usually on a **phone** (icon, G13)              |
| `bob`                             | person  | b         | usually on a **laptop**                         |
| `carol`                           | person  | c         | third editor when needed                        |
| `server`                          | server  | server    | sometimes labeled "Relay" when it only forwards |
| `edge-us` / `edge-eu` / `edge-ap` | service | a / b / c | used once (G-Counter in context)                |

Never more than 5 actors on stage. Values stay short (≤ 12 chars) so the stage stays legible.

### 0.3 Timestamps and the scene clock

Unit II uses **logical time** only: the scene clock is an integer shown as `t=3`. `tick` advances
it. Every `crdt.update` stamps its op with the current clock and the acting node (G1). Wall-clock
skew is Unit IV's problem; we say so once in LWW (II.2) and move on.

### 0.4 Sidecar rendering contract (what the renderer must draw from `Value.meta`)

| CRDT            | sidecar in `Value`                               | drawn as                                            |
| --------------- | ------------------------------------------------ | --------------------------------------------------- |
| LWW register    | `scalar.meta = {ts, node}`                       | value, then a small mono tag `t=3 · alice`          |
| LWW map         | each field's value has its own `meta {ts, node}` | tag per field                                       |
| G / PN counter  | `counter.perNode`, `counter.negative`            | a small table, one row per node, total on the right |
| G-Set / 2P-Set  | `set.items[].tombstone`                          | tombstoned items stay, struck through, dimmed       |
| LWW-Element-Set | `set.items[].meta {addTs, removeTs}` (G9)        | two tiny tags under each item, `+t4  −t3`           |
| OR-Set          | `set.items[].tags`                               | item, then tag chips `a1 b2`                        |

### 0.5 The "in-context" rule

Every atomic topic ends with an `in-context` scene: a realistic composed document or system that
uses the new concept together with concepts already taught. Scenes are tagged `[in-context]`.

### 0.6 Gap index (details in §3)

| id  | severity  | one line                                                                                                      |
| --- | --------- | ------------------------------------------------------------------------------------------------------------- |
| G1  | blocker   | `crdt.update` has no timestamp/node source; reducer must pass `{now, node}` ctx; `tick` drives it             |
| G2  | blocker   | OR-Set tags / ids must be short and deterministic (`a1`, `b2`); inject an `IdGen` into CRDT impls             |
| G3  | blocker   | Composite CRDT documents: `crdt.init type:'doc' schema:{…}` + path-addressed `crdt.update`                    |
| G4  | important | State on the wire as a static frame: `crdt.send` (snapshot/delta + byte size) and `crdt.merge from:{message}` |
| G5  | important | `same` mark — the positive twin of `conflict` ("these copies are equal")                                      |
| G6  | important | `note` — a free-standing stage card (rule cards like "merge = max"), with id + sticky                         |
| G7  | important | actor `status` badge: `lock` / `waiting` / `busy` (Unit I locks)                                              |
| G8  | important | Path grammar incl. `[id]` and `@ts/@node/@tags/@tomb` so highlights can point at sidecar                      |
| G9  | important | `Meta` needs `addTs`/`removeTs` (LWW-Element-Set) — or a generic `extra` bag                                  |
| G10 | important | No-op visibility: reducer auto-marks `unchanged` when a `crdt.*` command changes nothing                      |
| G11 | important | `send`/`crdt.send` carry `size` (bytes) for the cost-of-state topic; envelope drawn proportionally            |
| G12 | important | multi-recipient `send` needs per-recipient message ids (`m1:bob`, `m1:carol`)                                 |
| G13 | nice      | actor `icon` (phone/laptop/tablet/cloud) independent of `kind`; `owner` for "Alice's phone"                   |
| G14 | nice      | scene clock config `{now, visible, format:'int'                                                               | 'ms' | 'hh:mm'}` |
| G15 | nice      | `deliver … outcome:'reject'` (bounce) so a server can refuse a write                                          |
| G16 | nice      | marks need ids; `unmark id` (remove one sticky callout without `clearMarks`)                                  |
| G17 | nice      | `highlight` should accept an `ActorId` like `callout` does                                                    |
| G18 | nice      | stable item order in `toValue()` for sets/counters (no reshuffle on merge) — a reducer contract               |
| G19 | nice      | `tryIt` declaration per scene (which ops the sandbox exposes) — open question 4                               |
| P1  | pedagogy  | add a tiny `max-register` CRDT to `src/crdt/` for II.1 (three laws with one number)                           |

---

## 1. Unit I — The Problem

Unit I has no CRDTs (except two clearly labeled previews). Copies are plain `Value`s changed with
`set`; where a "good" merge result is shown by hand, the narration says so.

### I.1 `more-than-one-copy`

**Goal.** See that as soon as data has more than one copy, two copies can change at the same time,
and one of the changes can silently disappear.

**This problem applies when**

- data is cached, replicated, or kept on a device and on a server;
- more than one person or process can write;
- writers are not forced to wait for each other.

**This problem does not apply when**

- there is exactly one copy and one writer;
- every write goes through one place that serializes them (that is I.2).

**Real-world anchor.** Renaming a shared document from your phone while a teammate renames it
from a laptop (Google Docs, Notion, Apple Notes).

#### Scene `copies` — three copies, two edits, one loss

World: layout `hub`; clock hidden.

- `server` (server) holds `doc = rec({title:'Q3 plan'})`
- `alice` (person, a, icon phone) holds nothing
- `bob` (person, b, icon laptop) holds nothing

```
s01 "One document lives on the server. It has one field: a title."
    {t:'highlight', path:'server.doc.title'}
s02 "Alice opens it on her phone. The phone now has its own copy."
    {t:'send', from:'server', to:'alice', payload:{ref:'server.doc'}, id:'m1', label:'open'}
    {t:'deliver', message:'m1', into:'alice.doc'}
s03 "Bob opens it on his laptop. That is a third copy."
    {t:'send', from:'server', to:'bob', payload:{ref:'server.doc'}, id:'m2', label:'open'}
    {t:'deliver', message:'m2', into:'bob.doc'}
s04 "Three copies. Right now they all agree."
    {t:'same', paths:['server.doc.title','alice.doc.title','bob.doc.title']}   NEW (G5)
s05 "Alice changes the title on her phone."
    {t:'clearMarks'}
    {t:'set', path:'alice.doc.title', value:'Q3 plan v2'}
s06 "At the same moment, Bob changes it too. He has not seen Alice's change."
    {t:'set', path:'bob.doc.title', value:'Q3 roadmap'}
s07 "Whoops — now we have a problem. Two copies disagree, and neither is wrong."
    {t:'conflict', a:'alice.doc.title', b:'bob.doc.title'}
s08 "Alice saves first. The server takes her title."
    {t:'clearMarks'}
    {t:'send', from:'alice', to:'server', payload:{ref:'alice.doc'}, id:'m3', label:'save'}
    {t:'deliver', message:'m3', into:'server.doc'}
s09 "Bob saves a moment later. The server takes his title."
    {t:'send', from:'bob', to:'server', payload:{ref:'bob.doc'}, id:'m4', label:'save'}
    {t:'deliver', message:'m4', into:'server.doc'}
s10 "Alice's change is gone. Nobody was told."
    {t:'cross', path:'alice.doc.title'}
    {t:'callout', at:'server.doc.title', text:'last write silently won', tone:'warn'}
s11 "This is the whole course in one picture: more than one copy, writes at the same time, and no rule for what should happen."
    hold: long
    {t:'clearMarks'}
    {t:'highlight', path:['alice.doc.title','bob.doc.title','server.doc.title'], tone:'warn'}
```

#### Scene `copies-everywhere` — [in-context] where copies hide in a normal app

World: layout `row`; clock hidden. Start with only `server` (label "API") holding `doc = rec({title:'Q3 plan'})`.

```
s01 "You may think you have one copy. A normal web app has many."
    {t:'highlight', path:'server.doc'}
s02 "A database replica holds one."
    {t:'spawn', actor:{id:'replica', kind:'server', label:'DB replica', color:'neutral', online:true, holds:{doc:rec({title:'Q3 plan'})}}}
s03 "A cache in front of the API holds one."
    {t:'spawn', actor:{id:'cache', kind:'service', label:'Cache', color:'neutral', online:true, holds:{doc:rec({title:'Q3 plan'})}}}
s04 "The browser tab holds one. The phone app holds one."
    {t:'spawn', actor:{id:'alice', kind:'person', label:'Alice · browser', color:'a', online:true, holds:{doc:rec({title:'Q3 plan'})}}}
    {t:'spawn', actor:{id:'bob', kind:'person', label:'Bob · phone', color:'b', online:true, holds:{doc:rec({title:'Q3 plan'})}}}
s05 "Five copies, and we only drew the obvious ones."
    {t:'same', paths:['server.doc.title','replica.doc.title','cache.doc.title','alice.doc.title','bob.doc.title']}   NEW (G5)
s06 "Any two of them can change at the same time. The last scene can happen between any pair."
    {t:'clearMarks'}
    {t:'set', path:'alice.doc.title', value:'Q3 plan v2'}
    {t:'set', path:'bob.doc.title', value:'Q3 roadmap'}
    {t:'conflict', a:'alice.doc.title', b:'bob.doc.title'}
s07 "Every system with more than one copy needs an answer to this. Next: the classic answer."
    hold: long
```

**Gaps hit.** G5 (`same`), G13 (phone/laptop icons), G16 (remove one mark), G17 (highlight an actor).

---

### I.2 `locks-the-classic-answer`

**Goal.** See how a lock makes writers take turns, so the second writer always sees the first
writer's change before writing.

**When to use a lock / transaction**

- the data must never be wrong, even for a moment (money, stock levels, unique usernames);
- all writers can reach one coordinator quickly;
- writes are short and rare compared to reads;
- you need "all or nothing" across several fields or rows.

**When not to use**

- writers are often offline or far away (I.3);
- many people edit the same thing at once (a lock makes them queue);
- a short wrong period is acceptable and cheap to fix (I.4).

**Real-world anchor.** A database row lock (`SELECT … FOR UPDATE`), a wiki page lock, a file
"checked out" in a design tool.

#### Scene `take-turns` — one lock, two writers

World: layout `hub`; clock hidden.

- `server` (server) holds `doc = rec({title:'Q3 plan'})` and `lock = 'free'`
- `alice` (person, a) holds `doc = rec({title:'Q3 plan'})`
- `bob` (person, b) holds `doc = rec({title:'Q3 plan'})`

```
s01 "Same setup as before. This time the server also holds a lock. Only the lock holder may write."
    {t:'highlight', path:'server.lock'}
s02 "Alice wants to edit. First she asks for the lock."
    {t:'send', from:'alice', to:'server', payload:'lock?', id:'m1', label:'lock?'}
    {t:'deliver', message:'m1'}
s03 "The lock is free, so the server gives it to Alice."
    {t:'set', path:'server.lock', value:'alice'}
    {t:'send', from:'server', to:'alice', payload:'ok', id:'m2', label:'ok'}
    {t:'deliver', message:'m2'}
    {t:'status', actor:'alice', status:'lock'}   NEW (G7)
s04 "Bob wants to edit too. He asks for the lock."
    {t:'send', from:'bob', to:'server', payload:'lock?', id:'m3', label:'lock?'}
    {t:'deliver', message:'m3'}
s05 "The lock is taken. Bob must wait."
    {t:'send', from:'server', to:'bob', payload:'wait', id:'m4', label:'wait'}
    {t:'deliver', message:'m4'}
    {t:'status', actor:'bob', status:'waiting'}   NEW (G7)
s06 "Alice edits and saves. The server accepts, because she holds the lock."
    {t:'set', path:'alice.doc.title', value:'Q3 plan v2'}
    {t:'send', from:'alice', to:'server', payload:{ref:'alice.doc'}, id:'m5', label:'save'}
    {t:'deliver', message:'m5', into:'server.doc'}
s07 "Alice releases the lock."
    {t:'send', from:'alice', to:'server', payload:'unlock', id:'m6', label:'unlock'}
    {t:'deliver', message:'m6'}
    {t:'set', path:'server.lock', value:'free'}
    {t:'status', actor:'alice', status:null}   NEW (G7)
s08 "Now Bob gets the lock. With it, he gets the latest document."
    {t:'set', path:'server.lock', value:'bob'}
    {t:'send', from:'server', to:'bob', payload:{ref:'server.doc'}, id:'m7', label:'ok + doc'}
    {t:'deliver', message:'m7', into:'bob.doc'}
    {t:'status', actor:'bob', status:'lock'}   NEW (G7)
s09 "Bob sees Alice's title before he types. He edits on top of it."
    {t:'highlight', path:'bob.doc.title'}
    {t:'set', path:'bob.doc.title', value:'Q3 roadmap v2'}
s10 "Bob saves and releases. Both edits survived, one after the other."
    {t:'send', from:'bob', to:'server', payload:{ref:'bob.doc'}, id:'m8', label:'save'}
    {t:'deliver', message:'m8', into:'server.doc'}
    {t:'set', path:'server.lock', value:'free'}
    {t:'status', actor:'bob', status:null}   NEW (G7)
    {t:'check', path:'server.doc.title'}
s11 "A lock turns 'at the same time' into 'one after the other'. That is what a database transaction does (simplified)."
    hold: long
    {t:'note', id:'rule', text:'Lock: writers take turns. The second writer sees the first.', sticky:true}   NEW (G6)
```

#### Scene `bank-transfer` — [in-context] why banks lock

World: layout `hub`; clock hidden.

- `server` (server, label "Bank") holds `account = rec({balance:100})` and `lock = 'free'`
- `alice` (person, a) holds nothing
- `bob` (person, b) holds nothing

```
s01 "One account, 100 in it. Alice and Bob share it."
    {t:'highlight', path:'server.account.balance'}
s02 "Both try to take 80 at the same time."
    {t:'send', from:'alice', to:'server', payload:'take 80', id:'m1', label:'take 80'}
    {t:'send', from:'bob', to:'server', payload:'take 80', id:'m2', label:'take 80'}
s03 "Alice's request arrives first. The bank locks the account for her."
    {t:'deliver', message:'m1'}
    {t:'set', path:'server.lock', value:'alice'}
    {t:'status', actor:'alice', status:'lock'}   NEW (G7)
s04 "Bob's request arrives. It must wait behind the lock."
    {t:'deliver', message:'m2'}
    {t:'status', actor:'bob', status:'waiting'}   NEW (G7)
s05 "The bank checks: 100 is enough for 80. Balance becomes 20."
    {t:'set', path:'server.account.balance', value:20}
    {t:'set', path:'server.lock', value:'free'}
    {t:'status', actor:'alice', status:null}   NEW (G7)
s06 "Now Bob's turn. The bank checks: 20 is not enough for 80. Refused."
    {t:'set', path:'server.lock', value:'bob'}
    {t:'status', actor:'bob', status:'lock'}   NEW (G7)
    {t:'cross', path:'server.account.balance'}
    {t:'send', from:'server', to:'bob', payload:'refused', id:'m3', label:'refused'}
    {t:'deliver', message:'m3'}
s07 "Without the lock, both checks would have passed and the balance would be −60. Money must take turns."
    hold: long
    {t:'set', path:'server.lock', value:'free'}
    {t:'status', actor:'bob', status:null}   NEW (G7)
    {t:'callout', at:'server.account.balance', text:'never below zero', tone:'ok'}
```

**Gaps hit.** G6 (`note` rule card), G7 (`status` badge). `payload:'lock?'` as a scalar message
label works, but a `send` with no payload (`payload: null`) and only a `label` would read better
for control messages.

---

### I.3 `locks-need-a-connection`

**Goal.** See what a lock costs: every writer needs a live connection to one coordinator, and
everyone waits on the slowest link.

**This cost matters when**

- devices go offline (tunnels, planes, flaky Wi-Fi);
- writers are far from the coordinator (every lock is a round trip);
- many people edit one thing at once (they form a queue);
- the coordinator itself can go down (one place to get stuck).

**This cost is fine when**

- writers are servers in one data center with fast, reliable links;
- writes are rare and short.

**Real-world anchor.** Editing a note on a plane; a global team on one database in one region;
"someone else is editing this page" banners.

#### Scene `offline` — the lock you cannot reach

World: layout `hub`; clock hidden.

- `server` (server) holds `doc = rec({title:'Q3 plan'})` and `lock = 'free'`
- `alice` (person, a, icon phone) holds `doc = rec({title:'Q3 plan'})`
- `bob` (person, b, icon laptop) holds `doc = rec({title:'Q3 plan'})`

```
s01 "Same lock as before. Alice is on a train and enters a tunnel."
    {t:'offline', actor:'alice'}
s02 "She wants to edit. Her phone asks for the lock."
    {t:'send', from:'alice', to:'server', payload:'lock?', id:'m1', label:'lock?'}
s03 "The request never arrives. No connection, no lock."
    {t:'drop', message:'m1'}
    {t:'status', actor:'alice', status:'waiting'}   NEW (G7)
s04 "Alice has two choices. Wait for the tunnel to end, or edit anyway without the lock."
    {t:'callout', at:'alice', text:'wait… or edit without the lock?', tone:'warn'}
s05 "If she edits anyway, we are back in topic 1. The lock did not help."
    {t:'clearMarks'}
    {t:'set', path:'alice.doc.title', value:'Q3 plan v2'}
    {t:'cross', path:'server.lock'}
s06 "Now the other direction. Bob takes the lock, then his laptop goes to sleep."
    {t:'clearMarks'}
    {t:'set', path:'alice.doc.title', value:'Q3 plan'}
    {t:'status', actor:'alice', status:null}   NEW (G7)
    {t:'set', path:'server.lock', value:'bob'}
    {t:'status', actor:'bob', status:'lock'}   NEW (G7)
    {t:'offline', actor:'bob'}
s07 "Alice is back online and asks for the lock. The server says wait."
    {t:'online', actor:'alice'}
    {t:'send', from:'alice', to:'server', payload:'lock?', id:'m2', label:'lock?'}
    {t:'deliver', message:'m2'}
    {t:'status', actor:'alice', status:'waiting'}   NEW (G7)
s08 "And wait. Bob is gone, and he took the lock with him."
    {t:'tick'}
    {t:'callout', at:'server.lock', text:'held by bob (offline)', tone:'warn'}
s09 "Real systems add timeouts and lease renewals for this. They work, but they add more rules and more waiting."
    hold: long
    {t:'note', id:'lesson', text:'A lock needs one coordinator and a live connection to it.', sticky:true}   NEW (G6)
```

#### Scene `latency` — every lock is a round trip

World: layout `pair`; clock visible, format `ms` (G14), starts at 0.

- `alice` (person, a, label "Alice · Tokyo") holds `doc = rec({title:'Q3 plan'})`
- `server` (server, label "DB · Virginia") holds `doc = rec({title:'Q3 plan'})` and `lock = 'free'`

```
s01 "Alice is in Tokyo. The database is in Virginia. One message takes about 150 ms (simplified)."
    {t:'highlight', path:'server.lock'}
s02 "Ask for the lock: one trip out."
    {t:'send', from:'alice', to:'server', payload:'lock?', id:'m1', label:'lock?'}
    {t:'tick', by:150}
    {t:'deliver', message:'m1'}
    {t:'set', path:'server.lock', value:'alice'}
s03 "The answer comes back: one trip home. Alice can finally type."
    {t:'send', from:'server', to:'alice', payload:'ok', id:'m2', label:'ok'}
    {t:'tick', by:150}
    {t:'deliver', message:'m2'}
    {t:'status', actor:'alice', status:'lock'}   NEW (G7)
s04 "She types. Then the save goes out, and its confirmation comes back."
    {t:'set', path:'alice.doc.title', value:'Q3 plan v2'}
    {t:'send', from:'alice', to:'server', payload:{ref:'alice.doc'}, id:'m3', label:'save'}
    {t:'tick', by:150}
    {t:'deliver', message:'m3', into:'server.doc'}
    {t:'send', from:'server', to:'alice', payload:'saved', id:'m4', label:'saved'}
    {t:'tick', by:150}
    {t:'deliver', message:'m4'}
s05 "Then the unlock. Six trips, almost a second, for one title change."
    {t:'send', from:'alice', to:'server', payload:'unlock', id:'m5', label:'unlock'}
    {t:'tick', by:150}
    {t:'deliver', message:'m5'}
    {t:'set', path:'server.lock', value:'free'}
    {t:'send', from:'server', to:'alice', payload:'ok', id:'m6', label:'ok'}
    {t:'tick', by:150}
    {t:'deliver', message:'m6'}
    {t:'status', actor:'alice', status:null}   NEW (G7)
s06 "Every editor in Tokyo pays this on every edit. The further from the coordinator, the slower the lock."
    hold: long
    {t:'callout', at:'alice', text:'~900 ms per edit', tone:'warn'}
```

#### Scene `shared-doc` — [in-context] three editors, one lock

World: layout `hub`; clock hidden.

- `server` (server) holds `doc = rec({title:'Q3 plan', body:'…'})` and `lock = 'free'`
- `alice`, `bob`, `carol` (persons a/b/c) each hold `doc = rec({title:'Q3 plan', body:'…'})`

```
s01 "Three people open the same document. Each wants to type."
    {t:'highlight', path:['alice.doc','bob.doc','carol.doc']}
s02 "Alice gets the lock. Bob and Carol must wait."
    {t:'set', path:'server.lock', value:'alice'}
    {t:'status', actor:'alice', status:'lock'}   NEW (G7)
    {t:'status', actor:'bob', status:'waiting'}   NEW (G7)
    {t:'status', actor:'carol', status:'waiting'}   NEW (G7)
s03 "Alice types one word and saves."
    {t:'set', path:'alice.doc.body', value:'Goals…'}
    {t:'send', from:'alice', to:'server', payload:{ref:'alice.doc'}, id:'m1', label:'save'}
    {t:'deliver', message:'m1', into:'server.doc'}
s04 "Now Bob. Carol still waits. Every keystroke is a turn in the queue."
    {t:'set', path:'server.lock', value:'bob'}
    {t:'status', actor:'alice', status:null}   NEW (G7)
    {t:'status', actor:'bob', status:'lock'}   NEW (G7)
    {t:'send', from:'server', to:'bob', payload:{ref:'server.doc'}, id:'m2', label:'doc'}
    {t:'deliver', message:'m2', into:'bob.doc'}
s05 "This is why collaborative editors do not lock the document. They need another answer."
    hold: long
    {t:'callout', at:'carol', text:'still waiting', tone:'warn'}
s06 "Next: which data actually needs the lock — and which data does not."
    {t:'clearMarks'}
```

**Gaps hit.** G7 (`status`), G14 (clock format `ms`), G6 (`note`). `drop` exists and is exactly
right for the tunnel.

---

### I.4 `not-everything-needs-a-transaction`

**Goal.** Learn to sort data by what a wrong answer costs. Only some data needs a lock; the rest can
merge.

**Use a transaction when a wrong value, even briefly, is**

- money lost or created;
- something given away twice (one seat, one username, one coupon);
- a broken invariant across several fields (debit without credit).

**Merging is enough when**

- the data is a set of things people add (list items, tags, comments);
- the data is a preference or label where "newest wins" is fine (title, status, color);
- a count may be slightly behind for a moment (likes, views);
- people expect to keep working offline.

**Real-world anchor.** An online shop: payment needs a transaction; the cart, wish list and
delivery note do not.

#### Scene `money-vs-list` — same race, different cost

World: layout `row`; clock hidden.

- `alice` (person, a) holds `account = rec({balance:100})` and `list = list(['bread'])`
- `bob` (person, b) holds `account = rec({balance:100})` and `list = list(['bread'])`

```
s01 "Two kinds of data, two copies each. No lock this time."
    {t:'highlight', path:['alice.account','bob.account','alice.list','bob.list']}
s02 "Both take 80 from the account at the same time. Each copy says 'yes, 100 is enough'."
    {t:'set', path:'alice.account.balance', value:20}
    {t:'set', path:'bob.account.balance', value:20}
s03 "Put the copies together and the truth is −60. Real money is gone."
    {t:'conflict', a:'alice.account.balance', b:'bob.account.balance'}
    {t:'callout', at:'alice.account.balance', text:'true balance: −60', tone:'danger'}
s04 "Now the shopping list. Alice adds milk; Bob adds eggs, at the same time."
    {t:'clearMarks'}
    {t:'insert', path:'alice.list', index:1, item:{id:'milk', value:'milk'}}
    {t:'insert', path:'bob.list', index:1, item:{id:'eggs', value:'eggs'}}
s05 "Put these together. The right answer is obvious: keep both."
    {t:'insert', path:'alice.list', index:2, item:{id:'eggs', value:'eggs'}}
    {t:'insert', path:'bob.list', index:2, item:{id:'milk', value:'milk'}}
    {t:'same', paths:['alice.list','bob.list']}   NEW (G5)
s06 "(We wrote that result by hand. In Unit II a rule will compute it.)"
    {t:'callout', at:'alice.list', text:'merged by hand — for now', tone:'info'}
s07 "The difference is cost. A wrong balance hurts. A list with one extra item does not."
    hold: long
    {t:'clearMarks'}
    {t:'callout', at:'alice.account.balance', text:'needs a transaction', tone:'danger', sticky:true}
    {t:'callout', at:'alice.list', text:'can merge', tone:'ok', sticky:true}
```

#### Scene `sort-the-order` — [in-context] one order, field by field

World: layout `pair`; clock hidden.

- `server` (server, label "Shop") holds
  `order = rec({payment:'pending', items:'2 items', note:'ring bell', stock:'4 left', coupon:'unused'})`
- `alice` (person, a, icon phone) holds the same `order`

```
s01 "One online order. Five fields. Let's sort them."
    {t:'highlight', path:'server.order'}
s02 "Payment: charged twice or never is a disaster. Transaction."
    {t:'callout', at:'server.order.payment', text:'transaction', tone:'danger', sticky:true}
s03 "Items in the cart: adding from phone and laptop should just combine. Merge."
    {t:'callout', at:'server.order.items', text:'merge', tone:'ok', sticky:true}
s04 "Delivery note: newest text wins is fine. Merge."
    {t:'callout', at:'server.order.note', text:'merge (newest wins)', tone:'ok', sticky:true}
s05 "Coupon: it may be used once. Transaction."
    {t:'callout', at:'server.order.coupon', text:'transaction', tone:'danger', sticky:true}
s06 "Stock count: it depends. Selling one extra T-shirt is fine; selling one extra concert seat is not."
    {t:'callout', at:'server.order.stock', text:'depends on cost', tone:'warn', sticky:true}
s07 "Most apps are mostly 'merge' with a little 'transaction'. The rest of this course is about the 'merge' part."
    hold: long
```

**Gaps hit.** G5. Sticky callouts on five fields at once need to lay out without overlap — the
callout renderer must stack or place them around the record; note in §3 (G6/G16 discussion).

---

### I.5 `meet-crdts`

**Goal.** Meet the idea: agree on the merge rule up front, then every copy can update on its own,
merge in any order, and end up the same.

**When to use**

- the data can be described by a merge rule everyone accepts (Unit II gives you a catalog);
- writers may be offline or far apart;
- you would rather keep everyone working than make them wait.

**When not to use**

- a wrong value, even for a moment, is expensive (I.4);
- you need "exactly one winner" decided right now (a seat, a username);
- the merge rule would surprise users (e.g. a paragraph where two edits must not both survive).

**Real-world anchor.** Tags on a shared task: two people add tags while offline; later both see
both tags. (Preview: this is a G-Set, Unit II.6.)

Definition shown once in this topic: **CRDT** — a data type with a merge rule that always works,
in any order. The name stands for Conflict-free Replicated Data Type. _Eventual consistency_ —
once every copy has received every change, every copy is the same.

#### Scene `rule-up-front` — decide the rule before the race

World: layout `triangle`; clock hidden.

- `alice`, `bob`, `carol` (persons a/b/c); no holds yet.

```
s01 "Three people, one set of tags. Before anyone types, we agree on one rule."
    {t:'note', id:'rule', text:'Rule: merge = union (keep every tag anyone added)', sticky:true}   NEW (G6)
s02 "Each person gets a copy. It is empty. (Preview: this is a real CRDT, a G-Set. Details in Unit II.)"
    {t:'crdt.init', actors:['alice','bob','carol'], slot:'tags', type:'g-set'}
s03 "Alice adds 'urgent'. Bob adds 'bug'. Carol adds 'ui'. Nobody waits for anybody."
    {t:'crdt.update', actor:'alice', slot:'tags', op:'add', args:['urgent']}
    {t:'crdt.update', actor:'bob', slot:'tags', op:'add', args:['bug']}
    {t:'crdt.update', actor:'carol', slot:'tags', op:'add', args:['ui']}
s04 "Three copies, three different states. In topic 1 this was the problem."
    {t:'highlight', path:['alice.tags','bob.tags','carol.tags']}
s05 "Alice sends her state to Bob. Bob merges with the rule: union."
    {t:'crdt.send', from:'alice', to:'bob', slot:'tags', id:'m1'}   NEW (G4)
    {t:'crdt.merge', into:'bob', from:{message:'m1'}, slot:'tags'}   NEW (G4)
s06 "Carol sends hers to Bob. Union again."
    {t:'crdt.send', from:'carol', to:'bob', slot:'tags', id:'m2'}   NEW (G4)
    {t:'crdt.merge', into:'bob', from:{message:'m2'}, slot:'tags'}   NEW (G4)
s07 "Bob sends his state to Alice and to Carol. Both merge."
    {t:'crdt.send', from:'bob', to:['alice','carol'], slot:'tags', id:'m3'}   NEW (G4, G12)
    {t:'crdt.merge', into:'alice', from:{message:'m3:alice'}, slot:'tags'}   NEW (G4)
    {t:'crdt.merge', into:'carol', from:{message:'m3:carol'}, slot:'tags'}   NEW (G4)
s08 "All three copies are the same. Nothing was lost, and nobody waited."
    {t:'same', paths:['alice.tags','bob.tags','carol.tags']}   NEW (G5)
s09 "This is a CRDT: a data type with a merge rule that always works. The rule is the whole trick."
    hold: long
```

#### Scene `any-order` — the order of merges does not matter

World: layout `triangle`; clock hidden. Same three actors, fresh `tags` slot; rule note stays.

```
s01 "Same three tags. This time, the messages arrive in a different order."
    {t:'crdt.init', actors:['alice','bob','carol'], slot:'tags', type:'g-set'}
    {t:'crdt.update', actor:'alice', slot:'tags', op:'add', args:['urgent']}
    {t:'crdt.update', actor:'bob', slot:'tags', op:'add', args:['bug']}
    {t:'crdt.update', actor:'carol', slot:'tags', op:'add', args:['ui']}
s02 "Everyone sends to everyone. Six messages are in flight."
    {t:'crdt.send', from:'alice', to:['bob','carol'], slot:'tags', id:'a'}   NEW (G4, G12)
    {t:'crdt.send', from:'bob', to:['alice','carol'], slot:'tags', id:'b'}   NEW (G4, G12)
    {t:'crdt.send', from:'carol', to:['alice','bob'], slot:'tags', id:'c'}   NEW (G4, G12)
s03 "Alice gets Carol's state first, then Bob's."
    {t:'crdt.merge', into:'alice', from:{message:'c:alice'}, slot:'tags'}   NEW (G4)
    {t:'crdt.merge', into:'alice', from:{message:'b:alice'}, slot:'tags'}   NEW (G4)
s04 "Bob gets Alice's first, then Carol's."
    {t:'crdt.merge', into:'bob', from:{message:'a:bob'}, slot:'tags'}   NEW (G4)
    {t:'crdt.merge', into:'bob', from:{message:'c:bob'}, slot:'tags'}   NEW (G4)
s05 "Carol's copy of Bob's message is delayed. She only has Alice's for now."
    {t:'crdt.merge', into:'carol', from:{message:'a:carol'}, slot:'tags'}   NEW (G4)
    {t:'callout', at:'carol', text:'one message still in flight', tone:'info'}
s06 "Alice and Bob already agree, even though they merged in opposite orders."
    {t:'same', paths:['alice.tags','bob.tags']}   NEW (G5)
s07 "Bob's message finally lands. Now all three agree. This is eventual consistency."
    {t:'clearMarks'}
    {t:'crdt.merge', into:'carol', from:{message:'b:carol'}, slot:'tags'}   NEW (G4)
    {t:'same', paths:['alice.tags','bob.tags','carol.tags']}   NEW (G5)
s08 "Eventual means: when every message has arrived. Not 'right now', but always 'the same in the end'."
    hold: long
```

#### Scene `title-again` — [in-context] topic 1, with a rule this time

World: layout `hub`; clock visible (`t=0`).

- `server` (server, label "Relay"), `alice` (a, phone), `bob` (b, laptop); no holds yet.

```
s01 "Back to the title from topic 1. This time we pick a rule first: the newest write wins. (Preview of Unit II.2.)"
    {t:'note', id:'rule', text:'Rule: newest timestamp wins', sticky:true}   NEW (G6)
    {t:'crdt.init', actors:['server','alice','bob'], slot:'title', type:'lww-register', args:{value:'Q3 plan'}}
s02 "Alice edits at time 1."
    {t:'tick'}
    {t:'crdt.update', actor:'alice', slot:'title', op:'set', args:['Q3 plan v2']}
s03 "Bob edits at time 2. He has not seen Alice's edit."
    {t:'tick'}
    {t:'crdt.update', actor:'bob', slot:'title', op:'set', args:['Q3 roadmap']}
    {t:'conflict', a:'alice.title', b:'bob.title'}
s04 "Both save. The relay merges each one with the rule. Order does not matter."
    {t:'clearMarks'}
    {t:'crdt.send', from:'bob', to:'server', slot:'title', id:'m1'}   NEW (G4)
    {t:'crdt.merge', into:'server', from:{message:'m1'}, slot:'title'}   NEW (G4)
    {t:'crdt.send', from:'alice', to:'server', slot:'title', id:'m2'}   NEW (G4)
    {t:'crdt.merge', into:'server', from:{message:'m2'}, slot:'title'}   NEW (G4)
s05 "Alice's save arrived last, but Bob's has the newer time. The relay keeps Bob's."
    {t:'highlight', path:'server.title@ts'}   (G8)
    {t:'check', path:'server.title'}
s06 "The relay sends the result back. Every copy agrees, and everyone can see why."
    {t:'crdt.send', from:'server', to:['alice','bob'], slot:'title', id:'m3'}   NEW (G4, G12)
    {t:'crdt.merge', into:'alice', from:{message:'m3:alice'}, slot:'title'}   NEW (G4)
    {t:'crdt.merge', into:'bob', from:{message:'m3:bob'}, slot:'title'}   NEW (G4)
    {t:'same', paths:['server.title','alice.title','bob.title']}   NEW (G5)
s07 "Alice's edit still lost. But it lost by a rule everyone knows, not by luck. Unit II shows rules that lose less."
    hold: long
```

**Gaps hit.** G4 (`crdt.send` + merge-from-message: without it s02 of `any-order` cannot show six
messages in flight as a static frame), G5, G6, G12 (per-recipient ids), G8 (`@ts`), G1 (LWW
timestamp from the scene clock).

---

### I.6 `where-they-are-used`

**Goal.** See the range of real systems that use CRDTs, and the one shape they all share: many
copies, one merge rule, no coordinator.

**Good fits**

- collaborative documents and whiteboards (many cursors, no lock);
- local-first and offline-first apps (notes, to-dos, field work);
- multi-region databases and caches (every region writes locally);
- presence, counters, and settings that sync between devices;
- game and simulation state that many clients update.

**Poor fits**

- money movement, inventory with hard limits, unique names;
- anything where users expect "the server said no" immediately.

**Real-world anchor.** Figma (multiplayer design), Apple Notes and Automerge/Yjs-based apps
(offline editing), Riak and Redis Enterprise (multi-region data), Soundcloud (counters).
Names are examples, not endorsements; details simplified.

#### Scene `gallery` — six systems, one shape

World: layout `grid`; clock hidden. Starts empty.

```
s01 "CRDTs are best known from collaborative editors. Many people type, nobody locks."
    {t:'spawn', actor:{id:'docs', kind:'service', label:'Docs editor', color:'a', online:true, holds:{shares:'text'}}}
s02 "Design tools: every object on the canvas is shared data. Two people move shapes at once."
    {t:'spawn', actor:{id:'design', kind:'service', label:'Design tool', color:'b', online:true, holds:{shares:'objects'}}}
s03 "Notes apps: you edit on the plane, your laptop edits at home, both survive."
    {t:'spawn', actor:{id:'notes', kind:'service', label:'Notes app', color:'c', online:true, holds:{shares:'notes'}}}
s04 "Databases: several regions accept writes and merge later."
    {t:'spawn', actor:{id:'db', kind:'service', label:'Multi-region DB', color:'server', online:true, holds:{shares:'rows'}}}
s05 "Counters and presence: likes, views, 'who is online'."
    {t:'spawn', actor:{id:'counts', kind:'service', label:'Counters', color:'neutral', online:true, holds:{shares:'numbers'}}}
s06 "Different products. One shape: many copies, one rule, no coordinator."
    hold: long
    {t:'note', id:'shape', text:'Many copies · one merge rule · no coordinator', sticky:true}   NEW (G6)
s07 "Next unit: the rules, one data type at a time."
```

#### Scene `notes-sync` — [in-context] a notes app with a relay that only forwards

World: layout `hub`; clock visible (`t=0`).

- `server` (server, label "Relay") — holds a copy but never decides anything
- `alice` (a, phone), `bob` (b, laptop)

```
s01 "A notes app. The relay forwards states; it does not hold a lock. (Preview: a map of newest-wins fields, Unit II.3.)"
    {t:'crdt.init', actors:['server','alice','bob'], slot:'note', type:'lww-map', args:{title:'Trip', body:'pack socks'}}
s02 "Alice's phone goes offline. She keeps editing."
    {t:'offline', actor:'alice'}
    {t:'tick'}
    {t:'crdt.update', actor:'alice', slot:'note', op:'set', args:['body','pack socks, charger']}
s03 "Bob renames the note from the laptop."
    {t:'tick'}
    {t:'crdt.update', actor:'bob', slot:'note', op:'set', args:['title','Trip to Lisbon']}
s04 "Bob's change reaches the relay. The relay merges and keeps it."
    {t:'crdt.send', from:'bob', to:'server', slot:'note', id:'m1'}   NEW (G4)
    {t:'crdt.merge', into:'server', from:{message:'m1'}, slot:'note'}   NEW (G4)
s05 "Alice is back online. Phone and relay swap states."
    {t:'online', actor:'alice'}
    {t:'crdt.sync', a:'alice', b:'server', slot:'note'}
s06 "The relay forwards to Bob. All three copies agree: new title, new body."
    {t:'crdt.send', from:'server', to:'bob', slot:'note', id:'m2'}   NEW (G4)
    {t:'crdt.merge', into:'bob', from:{message:'m2'}, slot:'note'}   NEW (G4)
    {t:'same', paths:['alice.note','bob.note','server.note']}   NEW (G5)
s07 "No lock, no waiting, no lost edit. This is the goal. Unit II shows how each piece works."
    hold: long
```

**Gaps hit.** `spawn` with a full `Actor` literal is verbose; a builder (`actors.service('docs',
'Docs editor')`) fixes it (§4). `holds:{shares:'text'}` is a hack to put a one-word label inside the
card — a `note` per actor or an Actor `subtitle` field would be cleaner (G13). G4, G5, G6.

---

## 2. Unit II — State-based CRDTs (send your state, merge)

All document state in this unit is computed by `src/crdt/`. The reducer calls the real `update`,
`merge`, and `toValue`. Scripts never write a merge result; they only say what it is.

Shared vocabulary, defined once in II.1 and reused: **state** (what one copy holds, including its
sidecar), **merge** (a function that takes two states and returns one), **sidecar** (the extra
bookkeeping a CRDT carries next to the value — timestamps, node ids, tags, tombstones).

### II.1 `max-value` (was `the-shape-of-a-state-crdt`)

**Goal.** Learn the shape every state-based CRDT has: a local state, local updates, and a `merge`
that is commutative, associative, and idempotent — shown with one number.

**When to use (state-based in general)**

- the network may duplicate, reorder, or delay messages and you want to stop caring;
- peers can exchange whole states cheaply (small data, or infrequent sync);
- you want the simplest possible protocol: "send me what you have".

**When not to use**

- the state is large and changes often (Unit II.11, then Unit III);
- you need the _history_ of operations, not just the latest merged state.

**Real-world anchor.** A game's "best score" synced between a console, a phone and the cloud,
with offline play.

**Pedagogy note (P1).** This topic uses a `max-register` (state = one number, merge = max). It is
the smallest possible state CRDT and makes the three laws visible with arithmetic. It needs a
~20-line type in `src/crdt/max-register.ts`. The same "merge = max of something" idea comes back
in G-Counter (per node) and LWW (per timestamp).

#### Scene `state-and-merge` — two copies, one rule

World: layout `pair`; clock hidden.

- `alice` (a, label "Alice · phone"), `bob` (b, label "Bob · console"); no holds yet.

```
s01 "Every state-based CRDT has three parts: a state, local updates, and a merge rule."
    {t:'note', id:'parts', text:'state · update · merge', sticky:true}   NEW (G6)
s02 "Our first state is one number: the best score. The rule: merge = max."
    {t:'note', id:'rule', text:'merge(a, b) = max(a, b)', sticky:true}   NEW (G6)
    {t:'crdt.init', actors:['alice','bob'], slot:'best', type:'max-register', args:{value:0}}   (P1)
s03 "Alice plays and scores 3. Her copy changes. Nobody else knows yet."
    {t:'crdt.update', actor:'alice', slot:'best', op:'set', args:[3]}
s04 "Bob plays on the console and scores 5."
    {t:'crdt.update', actor:'bob', slot:'best', op:'set', args:[5]}
s05 "Alice sends her whole state to Bob. That is what 'state-based' means."
    {t:'crdt.send', from:'alice', to:'bob', slot:'best', id:'m1'}   NEW (G4)
s06 "Bob merges: max(5, 3) = 5. His state does not change."
    {t:'crdt.merge', into:'bob', from:{message:'m1'}, slot:'best'}   NEW (G4, G10 auto 'unchanged' mark)
s07 "Bob sends his state to Alice. She merges: max(3, 5) = 5."
    {t:'crdt.send', from:'bob', to:'alice', slot:'best', id:'m2'}   NEW (G4)
    {t:'crdt.merge', into:'alice', from:{message:'m2'}, slot:'best'}   NEW (G4)
s08 "Both copies say 5. No coordinator, no lock, no waiting."
    {t:'same', paths:['alice.best','bob.best']}   NEW (G5)
s09 "The trick is to design a state so that a merge like this exists. The rest of this unit is a catalog of such states."
    hold: long
```

#### Scene `three-laws` — why merge must be commutative, associative, idempotent

World: layout `triangle`; clock hidden.

- `alice` (a), `bob` (b), `carol` (c); `best` pre-initialised to 3 / 5 / 4 (via `crdt.init` + three updates in s01). Rule note stays.

```
s01 "Three copies: 3, 5 and 4. Three laws make the merge safe. Let's see each one."
    {t:'crdt.init', actors:['alice','bob','carol'], slot:'best', type:'max-register', args:{value:0}}
    {t:'crdt.update', actor:'alice', slot:'best', op:'set', args:[3]}
    {t:'crdt.update', actor:'bob', slot:'best', op:'set', args:[5]}
    {t:'crdt.update', actor:'carol', slot:'best', op:'set', args:[4]}
s02 "Law 1, commutative: merge(a, b) = merge(b, a). Alice merges Bob's state…"
    {t:'note', id:'law', text:'1 · commutative: merge(a,b) = merge(b,a)', sticky:true}   NEW (G6)
    {t:'crdt.send', from:'bob', to:'alice', slot:'best', id:'m1'}   NEW (G4)
    {t:'crdt.merge', into:'alice', from:{message:'m1'}, slot:'best'}   NEW (G4)
s03 "…and Bob merges Alice's old state. Opposite order, same answer: 5."
    {t:'crdt.send', from:'alice', to:'bob', slot:'best', id:'m2'}   NEW (G4)   (note: snapshot must be Alice's *pre-merge* state — see G4 on snapshot timing)
    {t:'crdt.merge', into:'bob', from:{message:'m2'}, slot:'best'}   NEW (G4)
    {t:'same', paths:['alice.best','bob.best']}   NEW (G5)
s04 "Law 2, associative: grouping does not matter. Carol merges Alice, then Bob."
    {t:'clearMarks'}
    {t:'note', id:'law', text:'2 · associative: (a⊔b)⊔c = a⊔(b⊔c)', sticky:true}   NEW (G6, replaces same id)
    {t:'crdt.send', from:'alice', to:'carol', slot:'best', id:'m3'}   NEW (G4)
    {t:'crdt.merge', into:'carol', from:{message:'m3'}, slot:'best'}   NEW (G4)
    {t:'crdt.send', from:'bob', to:'carol', slot:'best', id:'m4'}   NEW (G4)
    {t:'crdt.merge', into:'carol', from:{message:'m4'}, slot:'best'}   NEW (G4)
s05 "Bob already had Alice's. Carol had Bob's via Alice's. Different groupings, same 5."
    {t:'same', paths:['alice.best','bob.best','carol.best']}   NEW (G5)
s06 "Law 3, idempotent: merging the same state twice changes nothing. Bob sends again."
    {t:'clearMarks'}
    {t:'note', id:'law', text:'3 · idempotent: merge(a,a) = a', sticky:true}   NEW (G6)
    {t:'crdt.send', from:'bob', to:'carol', slot:'best', id:'m5'}   NEW (G4)
    {t:'crdt.merge', into:'carol', from:{message:'m5'}, slot:'best'}   NEW (G4, G10 'unchanged')
s07 "Still 5. A duplicate message is harmless. That is why we never need 'exactly once' delivery."
    {t:'callout', at:'carol.best', text:'no change', tone:'ok'}
s08 "Three laws, one result: any copy can merge anything, in any order, any number of times."
    hold: long
    {t:'clearMarks'}
    {t:'note', id:'law', text:'commutative · associative · idempotent', sticky:true}   NEW (G6)
```

#### Scene `bad-network` — [in-context] the network does its worst

World: layout `triangle`; clock hidden. Same three actors; `best` = 3 / 5 / 4 again via init + updates in s01.

```
s01 "Now a bad network: late, duplicated, and lost messages. Watch the three laws do the work."
    {t:'crdt.init', actors:['alice','bob','carol'], slot:'best', type:'max-register', args:{value:0}}
    {t:'crdt.update', actor:'alice', slot:'best', op:'set', args:[3]}
    {t:'crdt.update', actor:'bob', slot:'best', op:'set', args:[5]}
    {t:'crdt.update', actor:'carol', slot:'best', op:'set', args:[4]}
s02 "Everyone sends to everyone."
    {t:'crdt.send', from:'alice', to:['bob','carol'], slot:'best', id:'a'}   NEW (G4, G12)
    {t:'crdt.send', from:'bob', to:['alice','carol'], slot:'best', id:'b'}   NEW (G4, G12)
    {t:'crdt.send', from:'carol', to:['alice','bob'], slot:'best', id:'c'}   NEW (G4, G12)
s03 "Bob's message to Carol is lost."
    {t:'drop', message:'b:carol'}
s04 "Carol gets Alice's message twice (the network retried)."
    {t:'crdt.merge', into:'carol', from:{message:'a:carol'}, slot:'best'}   NEW (G4)
    {t:'crdt.send', from:'alice', to:'carol', slot:'best', id:'a2'}   NEW (G4)
    {t:'crdt.merge', into:'carol', from:{message:'a2'}, slot:'best'}   NEW (G4, G10)
s05 "Alice and Bob merge whatever arrives, in whatever order."
    {t:'crdt.merge', into:'alice', from:{message:'c:alice'}, slot:'best'}   NEW (G4)
    {t:'crdt.merge', into:'alice', from:{message:'b:alice'}, slot:'best'}   NEW (G4)
    {t:'crdt.merge', into:'bob', from:{message:'c:bob'}, slot:'best'}   NEW (G4)
    {t:'crdt.merge', into:'bob', from:{message:'a:bob'}, slot:'best'}   NEW (G4)
s06 "Carol is behind: she never got 5. Alice and Bob agree on 5."
    {t:'same', paths:['alice.best','bob.best']}   NEW (G5)
    {t:'callout', at:'carol.best', text:'missing one message', tone:'warn'}
s07 "Later, any peer that has 5 can send it again. Alice does. Now everyone agrees."
    {t:'clearMarks'}
    {t:'crdt.send', from:'alice', to:'carol', slot:'best', id:'a3'}   NEW (G4)
    {t:'crdt.merge', into:'carol', from:{message:'a3'}, slot:'best'}   NEW (G4)
    {t:'same', paths:['alice.best','bob.best','carol.best']}   NEW (G5)
s08 "Lost, late, duplicated: the laws absorbed all of it. The network only needs to deliver each state eventually."
    hold: long
```

**Gaps hit.** G4 (two-phase send/merge; and it must snapshot the sender's state at `send` time —
s03 of `three-laws` depends on that), G5, G6 (`note` with a stable id that can be replaced), G10
(an `unchanged` mark when a merge is a no-op — the idempotent law is invisible without it), G12,
P1 (`max-register`).

---

### II.2 `lww-register`

**Goal.** Learn the LWW register: one value, one timestamp, one node id. On merge the newest
timestamp wins; ties go to a fixed node order.

**When to use**

- single-value fields where "the newest edit wins" is what users expect (title, status, color, a setting);
- the field is set as a whole (not edited inside, like text);
- you can give every write a timestamp that is good enough (logical or hybrid; Unit IV).

**When not to use**

- two edits should both survive (use a set, a counter, or a sequence);
- clocks on devices cannot be trusted and losing an edit is costly (Unit IV.1 shows the failure);
- the value is long text edited by several people at once (Unit III.5).

**Real-world anchor.** A Slack-style status line set from phone and laptop; a column value in
Cassandra / DynamoDB (cell-level last-writer-wins).

Definition shown once: **LWW** — Last-Writer-Wins. **timestamp** — a number that says when a
write happened; here a logical counter `t=1, 2, 3…`, not a wall clock.

#### Scene `update-and-merge` — value + timestamp

World: layout `pair`; clock visible, starts `t=0`.

- `alice` (a, phone), `bob` (b, laptop); no holds yet.

```
s01 "An LWW register holds a value and a timestamp. The sidecar also remembers who wrote it."
    {t:'crdt.init', actors:['alice','bob'], slot:'status', type:'lww-register', args:{value:'Offline'}}
    {t:'highlight', path:['alice.status@ts','alice.status@node']}   (G8)
s02 "The rule: on merge, the newer timestamp wins."
    {t:'note', id:'rule', text:'merge: newer ts wins · tie → higher node id', sticky:true}   NEW (G6)
s03 "Time moves to 1. Alice sets her status. Her copy records value, t=1, node alice."
    {t:'tick'}
    {t:'crdt.update', actor:'alice', slot:'status', op:'set', args:['In a meeting']}   (G1: ts=1, node=alice)
s04 "Time 2. Bob sets a different status on the laptop."
    {t:'tick'}
    {t:'crdt.update', actor:'bob', slot:'status', op:'set', args:['Lunch']}
    {t:'conflict', a:'alice.status', b:'bob.status'}
s05 "Alice sends her state to Bob."
    {t:'clearMarks'}
    {t:'crdt.send', from:'alice', to:'bob', slot:'status', id:'m1'}   NEW (G4)
s06 "Bob compares timestamps: 2 is newer than 1. He keeps 'Lunch'."
    {t:'crdt.merge', into:'bob', from:{message:'m1'}, slot:'status'}   NEW (G4, G10 'unchanged')
    {t:'highlight', path:'bob.status@ts'}   (G8)
    {t:'check', path:'bob.status'}
s07 "Bob sends his state to Alice. She compares: 2 beats 1. She takes 'Lunch'."
    {t:'crdt.send', from:'bob', to:'alice', slot:'status', id:'m2'}   NEW (G4)
    {t:'crdt.merge', into:'alice', from:{message:'m2'}, slot:'status'}   NEW (G4)
s08 "Both copies agree, and both carry the same sidecar: t=2, bob."
    {t:'same', paths:['alice.status','bob.status']}   NEW (G5)
s09 "Alice's status was lost. LWW always loses one side of a race. That is the deal you accept when you pick it."
    hold: long
```

#### Scene `tie-break` — same timestamp, who wins?

World: layout `pair`; clock visible, starts `t=2`. Fresh `status` slot = 'Lunch' at t=2 (init in s01 with `args:{value:'Lunch', ts:2, node:'bob'}`).

```
s01 "Timestamps can tie. Both write at time 3, with no message in between."
    {t:'crdt.init', actors:['alice','bob'], slot:'status', type:'lww-register', args:{value:'Lunch', ts:2, node:'bob'}}
    {t:'tick'}
    {t:'crdt.update', actor:'alice', slot:'status', op:'set', args:['Away']}
    {t:'crdt.update', actor:'bob', slot:'status', op:'set', args:['Busy']}
    {t:'conflict', a:'alice.status', b:'bob.status'}
s02 "Same t=3 on both sides. The timestamp cannot decide."
    {t:'highlight', path:['alice.status@ts','bob.status@ts'], tone:'warn'}   (G8)
s03 "So the rule has a second part: compare node ids. 'bob' sorts after 'alice', so Bob wins."
    {t:'clearMarks'}
    {t:'highlight', path:['alice.status@node','bob.status@node']}   (G8)
s04 "They sync. Both copies pick 'Busy'."
    {t:'crdt.sync', a:'alice', b:'bob', slot:'status'}
    {t:'same', paths:['alice.status','bob.status']}   NEW (G5)
s05 "Any fixed rule works, as long as every copy uses the same one. Without it, two copies could disagree forever."
    hold: long
    {t:'callout', at:'bob.status', text:'tie → higher node id', tone:'info'}
```

#### Scene `any-order` — three writers, messages out of order

World: layout `triangle`; clock visible, `t=0`.

- `alice`, `bob`, `carol`; fresh `status` = 'Offline' (init in s01).

```
s01 "Three copies. Three writes at three different times."
    {t:'crdt.init', actors:['alice','bob','carol'], slot:'status', type:'lww-register', args:{value:'Offline'}}
    {t:'tick'}
    {t:'crdt.update', actor:'alice', slot:'status', op:'set', args:['Coding']}
    {t:'tick'}
    {t:'crdt.update', actor:'bob', slot:'status', op:'set', args:['Lunch']}
    {t:'tick'}
    {t:'crdt.update', actor:'carol', slot:'status', op:'set', args:['Focus']}
s02 "Alice and Bob both send their states to Carol. Alice's message is slow."
    {t:'crdt.send', from:'alice', to:'carol', slot:'status', id:'m1'}   NEW (G4)
    {t:'crdt.send', from:'bob', to:'carol', slot:'status', id:'m2'}   NEW (G4)
s03 "Bob's (t=2) arrives first. Carol has t=3. She keeps 'Focus'."
    {t:'crdt.merge', into:'carol', from:{message:'m2'}, slot:'status'}   NEW (G4, G10)
s04 "Alice's (t=1) arrives last. Still older than 3. 'Focus' stays."
    {t:'crdt.merge', into:'carol', from:{message:'m1'}, slot:'status'}   NEW (G4, G10)
s05 "Carol sends to both. Everyone ends on 'Focus', t=3."
    {t:'crdt.send', from:'carol', to:['alice','bob'], slot:'status', id:'m3'}   NEW (G4, G12)
    {t:'crdt.merge', into:'alice', from:{message:'m3:alice'}, slot:'status'}   NEW (G4)
    {t:'crdt.merge', into:'bob', from:{message:'m3:bob'}, slot:'status'}   NEW (G4)
    {t:'same', paths:['alice.status','bob.status','carol.status']}   NEW (G5)
s06 "Arrival order did not matter. Only the timestamp did. That is the three laws at work again."
    hold: long
```

#### Scene `status-sync` — [in-context] phone, laptop, relay

World: layout `hub`; clock visible, `t=0`.

- `server` (label "Relay"), `alice` (a, phone), `bob` (b, label "Alice · laptop", color a — same person, two devices; G13 `owner`)

Pedagogy: one person, two devices. Names in narration: "the phone" / "the laptop".

```
s01 "One person, two devices, one relay. The relay holds a copy and merges like everyone else."
    {t:'crdt.init', actors:['server','alice','bob'], slot:'status', type:'lww-register', args:{value:'Offline'}}
s02 "The phone goes offline in the subway."
    {t:'offline', actor:'alice'}
s03 "Time 5. On the phone she sets 'Commuting'. It cannot send yet."
    {t:'tick', by:5}
    {t:'crdt.update', actor:'alice', slot:'status', op:'set', args:['Commuting']}
s04 "Time 7. At her desk she sets 'At desk' on the laptop. It syncs with the relay right away."
    {t:'tick', by:2}
    {t:'crdt.update', actor:'bob', slot:'status', op:'set', args:['At desk']}
    {t:'crdt.send', from:'bob', to:'server', slot:'status', id:'m1'}   NEW (G4)
    {t:'crdt.merge', into:'server', from:{message:'m1'}, slot:'status'}   NEW (G4)
s05 "Time 9. The phone is back online and sends its old state."
    {t:'tick', by:2}
    {t:'online', actor:'alice'}
    {t:'crdt.send', from:'alice', to:'server', slot:'status', id:'m2'}   NEW (G4)
s06 "The relay compares: 'Commuting' is t=5, 'At desk' is t=7. Newer wins, even though it arrived earlier."
    {t:'crdt.merge', into:'server', from:{message:'m2'}, slot:'status'}   NEW (G4, G10)
    {t:'highlight', path:'server.status@ts'}   (G8)
s07 "The relay answers with its state. The phone updates. No 'stale write' bug."
    {t:'crdt.send', from:'server', to:'alice', slot:'status', id:'m3'}   NEW (G4)
    {t:'crdt.merge', into:'alice', from:{message:'m3'}, slot:'status'}   NEW (G4)
    {t:'same', paths:['alice.status','bob.status','server.status']}   NEW (G5)
s08 "One caveat: we used logical time. Real device clocks drift. Unit IV shows what that breaks and how to fix it."
    hold: long
```

**Gaps hit.** G1 (timestamp source: every `crdt.update` must stamp `world.clock` + actor id;
`crdt.init` needs optional `ts`/`node` for a pre-existing value), G8 (`@ts`, `@node` highlights
are essential here), G10, G13 (two devices, one owner color), G4, G5, G6.

---

### II.3 `lww-map`

**Goal.** Learn the LWW map: each field is its own LWW register. Edits to different fields both
survive; edits to the same field race, and the newest wins.

**When to use**

- records with independent fields edited by different people (task cards, profiles, settings);
- each field is small and set as a whole;
- "newest wins per field" matches what users expect.

**When not to use**

- two people often edit the _same_ field at once and both edits matter;
- fields depend on each other (e.g. `start` must stay before `end`) — LWW per field can break the pair;
- a field is long text (use a sequence CRDT, Unit III).

**Real-world anchor.** A task card in a tracker (owner, status, due date) edited by two teammates;
Riak maps; Automerge/Yjs maps of registers.

#### Scene `different-fields` — both edits survive

World: layout `pair`; clock visible, `t=0`.

- `alice` (a), `bob` (b); no holds yet.

```
s01 "A task has three fields. Each field is its own LWW register, with its own timestamp and node."
    {t:'crdt.init', actors:['alice','bob'], slot:'task', type:'lww-map', args:{owner:'—', status:'Todo', due:'Fri'}}
    {t:'highlight', path:['alice.task.owner@ts','alice.task.status@ts','alice.task.due@ts']}   (G8)
s02 "The rule is the same as before, but applied field by field."
    {t:'note', id:'rule', text:'merge: for each field, newer ts wins', sticky:true}   NEW (G6)
s03 "Time 1. Alice assigns the task to Bob. Only the owner field changes."
    {t:'tick'}
    {t:'crdt.update', actor:'alice', slot:'task', op:'set', args:['owner','Bob']}
s04 "Time 2. Bob, who has not seen that, moves the status to Doing."
    {t:'tick'}
    {t:'crdt.update', actor:'bob', slot:'task', op:'set', args:['status','Doing']}
s05 "Two edits, two different fields. No conflict at all."
    {t:'highlight', path:['alice.task.owner','bob.task.status']}
s06 "They sync. Each field merges on its own: owner takes t=1, status takes t=2."
    {t:'clearMarks'}
    {t:'crdt.sync', a:'alice', b:'bob', slot:'task'}
s07 "Both copies have both edits. Nothing was lost."
    {t:'same', paths:['alice.task','bob.task']}   NEW (G5)
s08 "This is why a map of registers beats one big register: the race is per field, not per document."
    hold: long
```

#### Scene `same-field` — the race still exists, inside one field

World: layout `pair`; clock continues at `t=2`. Same `task` slot, converged state from the last scene (re-created in s01).

```
s01 "Now both change the due date. Alice at time 3, Bob at time 4."
    {t:'crdt.init', actors:['alice','bob'], slot:'task', type:'lww-map', args:{owner:{value:'Bob',ts:1,node:'alice'}, status:{value:'Doing',ts:2,node:'bob'}, due:'Fri'}}
    {t:'tick'}
    {t:'crdt.update', actor:'alice', slot:'task', op:'set', args:['due','Thu']}
    {t:'tick'}
    {t:'crdt.update', actor:'bob', slot:'task', op:'set', args:['due','Mon']}
    {t:'conflict', a:'alice.task.due', b:'bob.task.due'}
s02 "They sync. For this field, t=4 beats t=3. Monday wins."
    {t:'clearMarks'}
    {t:'crdt.sync', a:'alice', b:'bob', slot:'task'}
    {t:'highlight', path:'alice.task.due@ts'}   (G8)
s03 "Alice's Thursday is gone. Same deal as the single register, just smaller."
    {t:'cross', path:'alice.task.due'}
    {t:'same', paths:['alice.task','bob.task']}   NEW (G5)
s04 "Owner and status were untouched by this race. Only the field that raced paid."
    hold: long
    {t:'clearMarks'}
    {t:'check', path:'alice.task.owner'}
    {t:'check', path:'alice.task.status'}
```

#### Scene `team-board` — [in-context] three people, one card, one relay

World: layout `hub`; clock visible, `t=0`.

- `server` (label "Relay"), `alice` (a), `bob` (b), `carol` (c); no holds yet.

```
s01 "A task card shared by a team. The relay forwards states and merges like any other copy."
    {t:'crdt.init', actors:['server','alice','bob','carol'], slot:'card', type:'lww-map', args:{title:'Fix login', owner:'—', status:'Todo', priority:'P2'}}
s02 "Time 1. Carol raises the priority. Time 2. Bob takes the task. Time 3. Alice renames it."
    {t:'tick'}
    {t:'crdt.update', actor:'carol', slot:'card', op:'set', args:['priority','P1']}
    {t:'tick'}
    {t:'crdt.update', actor:'bob', slot:'card', op:'set', args:['owner','Bob']}
    {t:'tick'}
    {t:'crdt.update', actor:'alice', slot:'card', op:'set', args:['title','Fix SSO login']}
s03 "All three send to the relay. Each message carries the whole card."
    {t:'crdt.send', from:'alice', to:'server', slot:'card', id:'m1'}   NEW (G4)
    {t:'crdt.send', from:'bob', to:'server', slot:'card', id:'m2'}   NEW (G4)
    {t:'crdt.send', from:'carol', to:'server', slot:'card', id:'m3'}   NEW (G4)
s04 "The relay merges them as they land. Field by field, newest wins — but no two edits touched the same field."
    {t:'crdt.merge', into:'server', from:{message:'m2'}, slot:'card'}   NEW (G4)
    {t:'crdt.merge', into:'server', from:{message:'m3'}, slot:'card'}   NEW (G4)
    {t:'crdt.merge', into:'server', from:{message:'m1'}, slot:'card'}   NEW (G4)
s05 "The relay fans the result back out."
    {t:'crdt.send', from:'server', to:['alice','bob','carol'], slot:'card', id:'m4'}   NEW (G4, G12)
    {t:'crdt.merge', into:'alice', from:{message:'m4:alice'}, slot:'card'}   NEW (G4)
    {t:'crdt.merge', into:'bob', from:{message:'m4:bob'}, slot:'card'}   NEW (G4)
    {t:'crdt.merge', into:'carol', from:{message:'m4:carol'}, slot:'card'}   NEW (G4)
    {t:'same', paths:['server.card','alice.card','bob.card','carol.card']}   NEW (G5)
s06 "Now a real race. Time 4: Bob sets status Doing. Time 5: Carol sets status Blocked."
    {t:'clearMarks'}
    {t:'tick'}
    {t:'crdt.update', actor:'bob', slot:'card', op:'set', args:['status','Doing']}
    {t:'tick'}
    {t:'crdt.update', actor:'carol', slot:'card', op:'set', args:['status','Blocked']}
    {t:'conflict', a:'bob.card.status', b:'carol.card.status'}
s07 "Both sync through the relay. Blocked (t=5) wins everywhere. Bob sees his change replaced — and sees who and when."
    {t:'clearMarks'}
    {t:'crdt.sync', a:'bob', b:'server', slot:'card'}
    {t:'crdt.sync', a:'carol', b:'server', slot:'card'}
    {t:'crdt.sync', a:'bob', b:'server', slot:'card'}
    {t:'crdt.sync', a:'alice', b:'server', slot:'card'}
    {t:'highlight', path:'bob.card.status@node'}   (G8)
    {t:'same', paths:['server.card','alice.card','bob.card','carol.card']}   NEW (G5)
s08 "A map of registers: independent fields merge freely, racing fields pick a winner you can explain."
    hold: long
```

**Gaps hit.** `crdt.init args` for an LWW map needs to accept either plain initial values or
`{value, ts, node}` per field (G1). `crdt.sync` three times in a row (s07) is clumsy: a
`crdt.sync` with `via:'server'` or a `crdt.gossip` that syncs a list of pairs in order would read
better (§4 helper `syncAll(['bob','server'], ['carol','server'], …)` is enough — no new command).
G4, G5, G6, G8, G12.

---

### II.4 `g-counter`

**Goal.** Learn the G-Counter: each node counts only its own increments; merge takes the max per
node; the value is the sum.

**When to use**

- counts that only go up (views, downloads, "times opened");
- many writers, each incrementing locally;
- a slightly stale total is fine.

**When not to use**

- the count must go down (II.5 PN-Counter);
- you need an exact, instantly consistent number (a transaction);
- the set of writers is huge and unbounded (the per-node table grows with it — mention, details in Unit V).

**Real-world anchor.** Page-view counters merged across edge servers; Riak / Redis Enterprise
counters (simplified).

Definition shown once: **node** — one copy that can write. Each node has an id.

#### Scene `count-separately` — one row per node

World: layout `triangle`; clock hidden.

- `alice` (a), `bob` (b), `carol` (c); no holds yet.

```
s01 "A G-Counter is a small table: one row per node. Each node only writes its own row."
    {t:'crdt.init', actors:['alice','bob','carol'], slot:'views', type:'g-counter'}
    {t:'highlight', path:'alice.views'}
s02 "The value is the sum of all rows. The rule: merge = max, row by row."
    {t:'note', id:'rule', text:'merge: per node, keep the max · value = sum', sticky:true}   NEW (G6)
s03 "Alice counts two views. Only her row moves."
    {t:'crdt.update', actor:'alice', slot:'views', op:'inc', args:[1]}
    {t:'crdt.update', actor:'alice', slot:'views', op:'inc', args:[1]}
    {t:'highlight', path:'alice.views[alice]'}   (G8)
s04 "Bob counts one."
    {t:'crdt.update', actor:'bob', slot:'views', op:'inc', args:[1]}
s05 "Alice sends her table to Bob. Bob merges: row alice = max(0, 2), row bob = max(1, 0)."
    {t:'crdt.send', from:'alice', to:'bob', slot:'views', id:'m1'}   NEW (G4)
    {t:'crdt.merge', into:'bob', from:{message:'m1'}, slot:'views'}   NEW (G4)
    {t:'highlight', path:['bob.views[alice]','bob.views[bob]']}   (G8)
s06 "Bob's total is now 3. Alice still shows 2; she has not heard from Bob."
    {t:'clearMarks'}
    {t:'callout', at:'bob.views', text:'2 + 1 = 3', tone:'info'}
s07 "Carol counts one, then merges Bob's table. Her total: 2 + 1 + 1 = 4."
    {t:'clearMarks'}
    {t:'crdt.update', actor:'carol', slot:'views', op:'inc', args:[1]}
    {t:'crdt.send', from:'bob', to:'carol', slot:'views', id:'m2'}   NEW (G4)
    {t:'crdt.merge', into:'carol', from:{message:'m2'}, slot:'views'}   NEW (G4)
s08 "Carol sends to both. Everyone merges. All three tables, and all three totals, agree."
    {t:'crdt.send', from:'carol', to:['alice','bob'], slot:'views', id:'m3'}   NEW (G4, G12)
    {t:'crdt.merge', into:'alice', from:{message:'m3:alice'}, slot:'views'}   NEW (G4)
    {t:'crdt.merge', into:'bob', from:{message:'m3:bob'}, slot:'views'}   NEW (G4)
    {t:'same', paths:['alice.views','bob.views','carol.views']}   NEW (G5)
s09 "Max per row is safe because a node's own row only ever goes up. That is why the G stands for 'grow-only'."
    hold: long
```

#### Scene `why-not-one-number` — the two wrong designs

World: layout `pair`; clock hidden.

- `alice` (a) holds `n = 2`, `bob` (b) holds `n = 1` (plain scalars, **not** a CRDT)

```
s01 "Why a table? Try a plain number first. Alice has counted 2, Bob 1. The true total is 3."
    {t:'highlight', path:['alice.n','bob.n']}
s02 "Merge by max? Bob takes max(1, 2) = 2. His one view vanished."
    {t:'set', path:'bob.n', value:2}
    {t:'cross', path:'bob.n'}
    {t:'callout', at:'bob.n', text:'lost 1', tone:'danger'}
s03 "Merge by sum, then? Bob takes 1 + 2 = 3. Looks right…"
    {t:'clearMarks'}
    {t:'set', path:'bob.n', value:3}
    {t:'check', path:'bob.n'}
s04 "…until Alice's message arrives again, or Alice merges Bob back: 2 + 3 = 5. Double counted."
    {t:'clearMarks'}
    {t:'set', path:'alice.n', value:5}
    {t:'cross', path:'alice.n'}
    {t:'callout', at:'alice.n', text:'counted twice', tone:'danger'}
s05 "Sum is not idempotent. Max is idempotent but loses data. A per-node table gives you both: max per row, sum for the value."
    hold: long
    {t:'clearMarks'}
    {t:'note', id:'why', text:'max per row (safe) + sum of rows (complete)', sticky:true}   NEW (G6)
```

#### Scene `edge-counters` — [in-context] page views across three regions

World: layout `triangle`; clock hidden.

- `edge-us` (service, a, label "US edge"), `edge-eu` (service, b, label "EU edge"), `edge-ap` (service, c, label "AP edge"); no holds yet.

```
s01 "A page-view counter on three edge servers. Each region counts its own visitors locally, instantly."
    {t:'crdt.init', actors:['edge-us','edge-eu','edge-ap'], slot:'views', type:'g-counter'}
s02 "A burst of traffic: US gets 3, EU gets 2, AP gets 1. No cross-region calls."
    {t:'crdt.update', actor:'edge-us', slot:'views', op:'inc', args:[3]}
    {t:'crdt.update', actor:'edge-eu', slot:'views', op:'inc', args:[2]}
    {t:'crdt.update', actor:'edge-ap', slot:'views', op:'inc', args:[1]}
s03 "Every few seconds they gossip: US ↔ EU."
    {t:'crdt.sync', a:'edge-us', b:'edge-eu', slot:'views'}
s04 "Then EU ↔ AP. AP now knows about all three regions."
    {t:'crdt.sync', a:'edge-eu', b:'edge-ap', slot:'views'}
s05 "A retry sends the same US table to EU again. Max per row: nothing changes. No double count."
    {t:'crdt.send', from:'edge-us', to:'edge-eu', slot:'views', id:'m1'}   NEW (G4)
    {t:'crdt.merge', into:'edge-eu', from:{message:'m1'}, slot:'views'}   NEW (G4, G10)
    {t:'callout', at:'edge-eu.views', text:'duplicate — no change', tone:'ok'}
s06 "One more round of gossip and every region shows 6."
    {t:'clearMarks'}
    {t:'crdt.sync', a:'edge-ap', b:'edge-us', slot:'views'}
    {t:'same', paths:['edge-us.views','edge-eu.views','edge-ap.views']}   NEW (G5)
s07 "Fast local writes, eventual global total. This is how counters survive multi-region."
    hold: long
```

**Gaps hit.** G8 (`alice.views[alice]` addresses a per-node row), G18 (rows must keep a stable
order across merges — insertion order of actors — or Motion will reshuffle the table), G10
(duplicate-merge no-op mark), G6. The `counter` Value should expose the derived total for the
renderer (`toValue` can add `meta.note` = total, or the renderer sums; decide once).

---

### II.5 `pn-counter`

**Goal.** Learn the PN-Counter: two G-Counters, one for increments and one for decrements;
value = P − N.

**When to use**

- counts that go up and down (likes/unlikes, items in a cart, "unread" badges);
- many writers, each adjusting locally;
- a temporary stale value is fine.

**When not to use**

- the count must never cross a limit (stock must not go below 0, seats must not oversell) — a
  PN-Counter cannot enforce a floor or ceiling;
- you need "who did what" history (Unit III ops);
- the writer set is unbounded (two tables grow with it).

**Real-world anchor.** Like counts with unlike; cart quantities edited from two devices; Redis
Enterprise counters.

#### Scene `likes-and-unlikes` — two tables

World: layout `pair`; clock hidden.

- `alice` (a), `bob` (b); no holds yet.

```
s01 "A PN-Counter is two G-Counters side by side: P for pluses, N for minuses."
    {t:'crdt.init', actors:['alice','bob'], slot:'likes', type:'pn-counter'}
    {t:'highlight', path:'alice.likes'}
s02 "The value is (sum of P) − (sum of N). Merge is the same as before: max per row, in both tables."
    {t:'note', id:'rule', text:'value = ΣP − ΣN · merge = max per row in P and in N', sticky:true}   NEW (G6)
s03 "Alice likes the post. P[alice] = 1."
    {t:'crdt.update', actor:'alice', slot:'likes', op:'inc', args:[1]}
    {t:'highlight', path:'alice.likes[alice]'}   (G8)
s04 "Bob likes it too. P[bob] = 1."
    {t:'crdt.update', actor:'bob', slot:'likes', op:'inc', args:[1]}
s05 "Alice changes her mind and unlikes. Not P[alice] − 1: instead N[alice] = 1. P never goes down."
    {t:'crdt.update', actor:'alice', slot:'likes', op:'dec', args:[1]}
    {t:'highlight', path:'alice.likes@neg[alice]', tone:'warn'}   (G8 — address the N table)
s06 "Alice's value: P 1 − N 1 = 0. Bob's value: 1. They sync."
    {t:'clearMarks'}
    {t:'crdt.sync', a:'alice', b:'bob', slot:'likes'}
s07 "Both now hold P = {alice 1, bob 1}, N = {alice 1}. Value: 2 − 1 = 1."
    {t:'same', paths:['alice.likes','bob.likes']}   NEW (G5)
    {t:'callout', at:'bob.likes', text:'2 − 1 = 1', tone:'info'}
s08 "Why not subtract from P? Because then a row could go down, and 'max per row' would lose decrements. Two grow-only tables keep the math safe."
    hold: long
```

#### Scene `no-floor` — the limit a counter cannot hold

World: layout `pair`; clock hidden. Fresh slot `stock` (PN-Counter) starting at 1 (init + one `inc` by `server`? No server here: `alice` incs 1 in s01).

```
s01 "One item left in stock. Both shops sell it at the same time."
    {t:'crdt.init', actors:['alice','bob'], slot:'stock', type:'pn-counter'}
    {t:'crdt.update', actor:'alice', slot:'stock', op:'inc', args:[1]}
    {t:'crdt.sync', a:'alice', b:'bob', slot:'stock'}
    {t:'highlight', path:['alice.stock','bob.stock']}
s02 "Each copy sees 1, says yes, and decrements."
    {t:'crdt.update', actor:'alice', slot:'stock', op:'dec', args:[1]}
    {t:'crdt.update', actor:'bob', slot:'stock', op:'dec', args:[1]}
s03 "They sync. Value: 1 − 2 = −1. The counter did exactly what it was told."
    {t:'crdt.sync', a:'alice', b:'bob', slot:'stock'}
    {t:'cross', path:'alice.stock'}
    {t:'callout', at:'bob.stock', text:'−1: oversold', tone:'danger'}
s04 "A counter cannot say no. If a floor matters, that decision needs a transaction (I.4)."
    hold: long
```

#### Scene `cart-item` — [in-context] name (LWW) + quantity (PN) in one item

World: layout `pair`; clock visible, `t=0`.

- `alice` (a, phone), `bob` (b, label "Alice · laptop", color a); no holds yet.

```
s01 "A cart line has a name and a quantity. Name: LWW register. Quantity: PN-Counter. One document, two CRDTs."
    {t:'crdt.init', actors:['alice','bob'], slot:'item', type:'doc', schema:{name:'lww-register', qty:'pn-counter'}, args:{name:'Oat milk'}}   NEW (G3)
s02 "Time 1. On the phone she adds two more. qty +2."
    {t:'tick'}
    {t:'crdt.update', actor:'alice', slot:'item', path:'qty', op:'inc', args:[2]}   NEW (G3 path-addressed)
s03 "Time 2. On the laptop she removes one, and fixes the name."
    {t:'tick'}
    {t:'crdt.update', actor:'bob', slot:'item', path:'qty', op:'dec', args:[1]}   NEW (G3)
    {t:'crdt.update', actor:'bob', slot:'item', path:'name', op:'set', args:['Oat milk 1L']}   NEW (G3)
s04 "They sync. Each part merges with its own rule: the name by timestamp, the quantity by max-per-row."
    {t:'crdt.sync', a:'alice', b:'bob', slot:'item'}
s05 "Both show 'Oat milk 1L' × 1 (2 − 1). Neither device's change was lost."
    {t:'same', paths:['alice.item','bob.item']}   NEW (G5)
    {t:'callout', at:'alice.item.qty', text:'+2 −1 = 1', tone:'info'}
s06 "Composing CRDTs is just nesting them. Each field brings its own merge rule. More of this in II.10."
    hold: long
```

**Gaps hit.** G3 (composite `doc` type with a schema and path-addressed updates — first real
use), G8 (need to address the N table: proposed `@neg[alice]`), G5, G6.

---

### II.6 `g-set`

**Goal.** Learn the G-Set: a set you can only add to; merge = union; nothing ever leaves.

**When to use**

- things that are only ever added (ids of messages you have seen, peers you have met, events that happened);
- "has X ever happened?" questions;
- the simplest possible set when delete is truly never needed.

**When not to use**

- anything that needs remove (II.7–II.9);
- the set grows without bound and memory matters (it never shrinks).

**Real-world anchor.** "Seen message ids" for de-duplication; the set of peers a node knows;
"who has acknowledged this announcement".

#### Scene `union` — adds from three sides

World: layout `triangle`; clock hidden.

- `alice`, `bob`, `carol`; no holds yet.

```
s01 "A G-Set is a bag of things. The only operation is add. The rule: merge = union."
    {t:'crdt.init', actors:['alice','bob','carol'], slot:'seen', type:'g-set'}
    {t:'note', id:'rule', text:'merge = union', sticky:true}   NEW (G6)
s02 "Each node has seen some message ids. Alice: m1, m2. Bob: m2, m3. Carol: m4."
    {t:'crdt.update', actor:'alice', slot:'seen', op:'add', args:['m1']}
    {t:'crdt.update', actor:'alice', slot:'seen', op:'add', args:['m2']}
    {t:'crdt.update', actor:'bob', slot:'seen', op:'add', args:['m2']}
    {t:'crdt.update', actor:'bob', slot:'seen', op:'add', args:['m3']}
    {t:'crdt.update', actor:'carol', slot:'seen', op:'add', args:['m4']}
s03 "Alice sends to Bob. Union: m1, m2, m3. m2 was on both sides; it appears once."
    {t:'crdt.send', from:'alice', to:'bob', slot:'seen', id:'x1'}   NEW (G4)
    {t:'crdt.merge', into:'bob', from:{message:'x1'}, slot:'seen'}   NEW (G4)
    {t:'highlight', path:'bob.seen[m2]'}   (G8)
s04 "Bob sends to Carol. Carol sends to Alice."
    {t:'crdt.send', from:'bob', to:'carol', slot:'seen', id:'x2'}   NEW (G4)
    {t:'crdt.merge', into:'carol', from:{message:'x2'}, slot:'seen'}   NEW (G4)
    {t:'crdt.send', from:'carol', to:'alice', slot:'seen', id:'x3'}   NEW (G4)
    {t:'crdt.merge', into:'alice', from:{message:'x3'}, slot:'seen'}   NEW (G4)
s05 "Bob is one message behind. Alice and Carol already agree."
    {t:'same', paths:['alice.seen','carol.seen']}   NEW (G5)
s06 "Alice sends to Bob. Now all three: m1 m2 m3 m4."
    {t:'clearMarks'}
    {t:'crdt.send', from:'alice', to:'bob', slot:'seen', id:'x4'}   NEW (G4)
    {t:'crdt.merge', into:'bob', from:{message:'x4'}, slot:'seen'}   NEW (G4)
    {t:'same', paths:['alice.seen','bob.seen','carol.seen']}   NEW (G5)
s07 "Union is commutative, associative and idempotent by nature. The G-Set gets the three laws for free."
    hold: long
```

#### Scene `no-remove` — the operation that does not exist

World: layout `pair`; clock hidden. `alice`, `bob` hold `tags` = {draft, urgent} (init + adds + sync in s01).

```
s01 "A task's tags as a G-Set: draft, urgent."
    {t:'crdt.init', actors:['alice','bob'], slot:'tags', type:'g-set'}
    {t:'crdt.update', actor:'alice', slot:'tags', op:'add', args:['draft']}
    {t:'crdt.update', actor:'alice', slot:'tags', op:'add', args:['urgent']}
    {t:'crdt.sync', a:'alice', b:'bob', slot:'tags'}
s02 "The task ships. Alice wants to remove 'draft'. There is no such operation."
    {t:'cross', path:'alice.tags[draft]'}   (G8)
    {t:'callout', at:'alice.tags', text:'G-Set has no remove', tone:'warn'}
s03 "Even if she deleted it locally, Bob's copy still has it. The next union brings it back."
    {t:'clearMarks'}
    {t:'callout', at:'bob.tags[draft]', text:'would come back on merge', tone:'warn'}
s04 "If you need remove, you need more sidecar. That is the next three topics."
    hold: long
    {t:'clearMarks'}
```

#### Scene `acks` — [in-context] who has seen the announcement

World: layout `hub`; clock visible, `t=0`.

- `server` (label "Relay"), `alice` (a), `bob` (b), `carol` (c); no holds yet.

```
s01 "An announcement: a title (LWW) and the set of people who acknowledged it (G-Set)."
    {t:'crdt.init', actors:['server','alice','bob','carol'], slot:'post', type:'doc', schema:{title:'lww-register', acked:'g-set'}, args:{title:'Office closed Fri'}}   NEW (G3)
s02 "Alice acknowledges. Carol is offline and acknowledges too; it waits on her device."
    {t:'crdt.update', actor:'alice', slot:'post', path:'acked', op:'add', args:['alice']}   NEW (G3)
    {t:'offline', actor:'carol'}
    {t:'crdt.update', actor:'carol', slot:'post', path:'acked', op:'add', args:['carol']}   NEW (G3)
s03 "Time 1. Bob fixes a typo in the title and acknowledges."
    {t:'tick'}
    {t:'crdt.update', actor:'bob', slot:'post', path:'title', op:'set', args:['Office closed Friday']}   NEW (G3)
    {t:'crdt.update', actor:'bob', slot:'post', path:'acked', op:'add', args:['bob']}   NEW (G3)
s04 "Alice and Bob sync with the relay."
    {t:'crdt.sync', a:'alice', b:'server', slot:'post'}
    {t:'crdt.sync', a:'bob', b:'server', slot:'post'}
    {t:'crdt.sync', a:'alice', b:'server', slot:'post'}
s05 "Carol comes back. Her ack joins the union; she gets the fixed title."
    {t:'online', actor:'carol'}
    {t:'crdt.sync', a:'carol', b:'server', slot:'post'}
s06 "Final sync round. Everyone sees three acks and the corrected title."
    {t:'crdt.sync', a:'alice', b:'server', slot:'post'}
    {t:'crdt.sync', a:'bob', b:'server', slot:'post'}
    {t:'same', paths:['server.post','alice.post','bob.post','carol.post']}   NEW (G5)
s07 "An ack can never be un-acked by accident. For this data, 'no remove' is a feature."
    hold: long
```

**Gaps hit.** G3 again (doc schema), G8 (`[draft]` item addressing), G18 (set items must keep a
stable order: first-seen order on that replica, so union does not reshuffle). `crdt.sync` chains
(s04, s06) want the `syncAll` helper.

---

### II.7 `two-phase-set`

**Goal.** Learn the 2P-Set: an add-set plus a remove-set (tombstones). Remove wins, forever; a
removed element can never come back.

**When to use**

- things that, once removed, must stay removed (revoked keys, banned users, unsubscribed emails);
- you want remove with the least sidecar possible;
- elements are unique and will not be re-added by design.

**When not to use**

- users may add, remove, and add again (II.8, II.9);
- the tombstone set would grow large (every remove is kept forever);
- you need "the latest intent" rather than "remove sticks".

**Real-world anchor.** API-key revocation lists; "do not email" lists; banned-user sets.

Definition shown once: **tombstone** — a marker that says "this was here and was removed". The
marker stays so that a later merge cannot bring the element back.

#### Scene `add-and-remove` — the second set

World: layout `pair`; clock hidden.

- `alice` (a), `bob` (b); no holds yet.

```
s01 "A 2P-Set is two G-Sets: added, and removed. The second one holds tombstones."
    {t:'crdt.init', actors:['alice','bob'], slot:'guests', type:'2p-set'}
    {t:'note', id:'rule', text:'in set = added and not removed · merge = union of both', sticky:true}   NEW (G6)
s02 "Alice invites Dan and Eve."
    {t:'crdt.update', actor:'alice', slot:'guests', op:'add', args:['dan']}
    {t:'crdt.update', actor:'alice', slot:'guests', op:'add', args:['eve']}
s03 "They sync. Bob has both guests."
    {t:'crdt.sync', a:'alice', b:'bob', slot:'guests'}
    {t:'same', paths:['alice.guests','bob.guests']}   NEW (G5)
s04 "Bob un-invites Dan. Dan is not deleted. He gets a tombstone."
    {t:'clearMarks'}
    {t:'crdt.update', actor:'bob', slot:'guests', op:'remove', args:['dan']}
    {t:'highlight', path:'bob.guests[dan]@tomb', tone:'warn'}   (G8)
s05 "Bob's set reads as: eve. Dan is drawn struck through: present in the data, absent from the answer."
    {t:'callout', at:'bob.guests[dan]', text:'tombstone', tone:'info'}
s06 "Bob sends to Alice. Union of added, union of removed. Dan is tombstoned on both."
    {t:'clearMarks'}
    {t:'crdt.send', from:'bob', to:'alice', slot:'guests', id:'m1'}   NEW (G4)
    {t:'crdt.merge', into:'alice', from:{message:'m1'}, slot:'guests'}   NEW (G4)
    {t:'same', paths:['alice.guests','bob.guests']}   NEW (G5)
s07 "The tombstone is the sidecar that makes remove safe. Without it, Alice's next merge would re-add Dan (II.6)."
    hold: long
```

#### Scene `no-re-add` — the tombstone wins forever

World: layout `pair`; clock hidden. `guests` as left by the last scene (re-created in s01).

```
s01 "Dan apologizes. Alice tries to invite him again."
    {t:'crdt.init', actors:['alice','bob'], slot:'guests', type:'2p-set'}
    {t:'crdt.update', actor:'alice', slot:'guests', op:'add', args:['dan']}
    {t:'crdt.update', actor:'alice', slot:'guests', op:'add', args:['eve']}
    {t:'crdt.update', actor:'alice', slot:'guests', op:'remove', args:['dan']}
    {t:'crdt.sync', a:'alice', b:'bob', slot:'guests'}
    {t:'crdt.update', actor:'alice', slot:'guests', op:'add', args:['dan']}   (G10: no-op — reducer marks 'unchanged')
s02 "Nothing happens. 'dan' is already in added, and in removed. Removed wins."
    {t:'cross', path:'alice.guests[dan]'}   (G8)
    {t:'callout', at:'alice.guests[dan]', text:'add ignored — tombstone wins', tone:'warn'}
s03 "Even a brand-new copy that never saw Dan cannot bring him back: the tombstone travels with every merge."
    {t:'clearMarks'}
    {t:'spawn', actor:{id:'carol', kind:'person', label:'Carol', color:'c', online:true, holds:{}}}
    {t:'layout', preset:'triangle'}
    {t:'crdt.init', actors:['carol'], slot:'guests', type:'2p-set'}   (init on one more actor, same slot)
    {t:'crdt.update', actor:'carol', slot:'guests', op:'add', args:['dan']}
s04 "Carol added Dan fresh. She merges Alice's state."
    {t:'crdt.send', from:'alice', to:'carol', slot:'guests', id:'m1'}   NEW (G4)
    {t:'crdt.merge', into:'carol', from:{message:'m1'}, slot:'guests'}   NEW (G4)
    {t:'highlight', path:'carol.guests[dan]@tomb', tone:'warn'}   (G8)
s05 "Dan is tombstoned on Carol's copy too. Remove always wins, in any order."
    {t:'same', paths:['alice.guests','bob.guests','carol.guests']}   NEW (G5)
s06 "Good for revocations. Bad for a shopping list. Pick a set by what 'remove' should mean."
    hold: long
```

#### Scene `revoked-keys` — [in-context] API keys that must stay dead

World: layout `hub`; clock visible, `t=0`.

- `server` (label "Auth · US"), `alice` (service, a, label "Auth · EU"), `bob` (service, b, label "Auth · AP"); no holds yet.

```
s01 "Three auth servers share one record per customer: a plan (LWW) and a set of active API keys (2P-Set)."
    {t:'crdt.init', actors:['server','alice','bob'], slot:'acct', type:'doc', schema:{plan:'lww-register', keys:'2p-set'}, args:{plan:'Free'}}   NEW (G3)
s02 "EU issues key k1. AP issues key k2. Both sync to US."
    {t:'crdt.update', actor:'alice', slot:'acct', path:'keys', op:'add', args:['k1']}   NEW (G3)
    {t:'crdt.update', actor:'bob', slot:'acct', path:'keys', op:'add', args:['k2']}   NEW (G3)
    {t:'crdt.sync', a:'alice', b:'server', slot:'acct'}
    {t:'crdt.sync', a:'bob', b:'server', slot:'acct'}
s03 "Time 1. The customer upgrades in EU. Time 2. A leaked key k1 is revoked in AP, which still lists k1."
    {t:'tick'}
    {t:'crdt.update', actor:'alice', slot:'acct', path:'plan', op:'set', args:['Pro']}   NEW (G3)
    {t:'tick'}
    {t:'crdt.update', actor:'bob', slot:'acct', path:'keys', op:'remove', args:['k1']}   NEW (G3)
s04 "Meanwhile a stale EU replica re-adds k1 from an old cache. Tombstone wins: the add is ignored."
    {t:'crdt.sync', a:'bob', b:'server', slot:'acct'}
    {t:'crdt.sync', a:'alice', b:'server', slot:'acct'}
    {t:'crdt.update', actor:'alice', slot:'acct', path:'keys', op:'add', args:['k1']}   NEW (G3) (G10 no-op)
    {t:'cross', path:'alice.acct.keys[k1]'}   (G8)
s05 "One more sync. Every region: plan Pro, keys {k2}, k1 dead for good."
    {t:'clearMarks'}
    {t:'crdt.sync', a:'alice', b:'server', slot:'acct'}
    {t:'crdt.sync', a:'bob', b:'server', slot:'acct'}
    {t:'same', paths:['server.acct','alice.acct','bob.acct']}   NEW (G5)
s06 "A revoked key that came back would be a security hole. Here, 'cannot re-add' is exactly the guarantee you want."
    hold: long
```

**Gaps hit.** `crdt.init` for an actor spawned mid-scene into an existing slot (s03 of
`no-re-add`) — the command works if `init` on an existing slot adds replicas rather than resetting
others; spell that out in the DSL doc. G8 (`@tomb`), G10 (ignored add needs an automatic mark),
G3, G4, G5, G6.

---

### II.8 `lww-element-set`

**Goal.** Learn the LWW-Element-Set: every element has an add time and a remove time; the newer
one decides. Ties go to a chosen bias (add-wins or remove-wins).

**When to use**

- sets where add and remove both happen often and the latest intent should win (favorites, follows, toggles);
- you already have good-enough timestamps (you are using LWW elsewhere);
- re-adding after remove must work.

**When not to use**

- concurrent add and remove of the same element are common and you want "add wins" without
  depending on clocks (II.9 OR-Set);
- clocks cannot be trusted (Unit IV);
- you need "remove only what I saw" semantics.

**Real-world anchor.** Follow/unfollow lists; favorites synced across devices; Riak's
LWW-flavored sets (simplified).

#### Scene `two-times-per-element` — add-ts and remove-ts

World: layout `pair`; clock visible, `t=0`.

- `alice` (a), `bob` (b); no holds yet.

```
s01 "Each element carries two timestamps: when it was last added, and when it was last removed."
    {t:'crdt.init', actors:['alice','bob'], slot:'fav', type:'lww-element-set', args:{bias:'add'}}
    {t:'note', id:'rule', text:'in set if addTs > removeTs · tie → bias (add)', sticky:true}   NEW (G6)
s02 "Time 1. Alice favorites jazz. Time 2. Bob favorites rock."
    {t:'tick'}
    {t:'crdt.update', actor:'alice', slot:'fav', op:'add', args:['jazz']}
    {t:'tick'}
    {t:'crdt.update', actor:'bob', slot:'fav', op:'add', args:['rock']}
    {t:'highlight', path:['alice.fav[jazz]@addTs','bob.fav[rock]@addTs']}   (G8, G9)
s03 "They sync. Both: jazz (+t1), rock (+t2)."
    {t:'crdt.sync', a:'alice', b:'bob', slot:'fav'}
    {t:'same', paths:['alice.fav','bob.fav']}   NEW (G5)
s04 "Time 3. Bob removes jazz. Jazz stays in the data with removeTs = 3."
    {t:'clearMarks'}
    {t:'tick'}
    {t:'crdt.update', actor:'bob', slot:'fav', op:'remove', args:['jazz']}
    {t:'highlight', path:'bob.fav[jazz]@removeTs', tone:'warn'}   (G8, G9)
s05 "Time 4. Alice, who has not seen that, re-adds jazz on her side. addTs = 4."
    {t:'tick'}
    {t:'crdt.update', actor:'alice', slot:'fav', op:'add', args:['jazz']}
    {t:'conflict', a:'alice.fav[jazz]', b:'bob.fav[jazz]'}
s06 "They sync. Per element, keep the max of each timestamp: jazz has +t4 and −t3. 4 > 3, so jazz is in."
    {t:'clearMarks'}
    {t:'crdt.sync', a:'alice', b:'bob', slot:'fav'}
    {t:'highlight', path:['alice.fav[jazz]@addTs','alice.fav[jazz]@removeTs']}   (G8, G9)
    {t:'same', paths:['alice.fav','bob.fav']}   NEW (G5)
s07 "Re-add works, unlike the 2P-Set. The price: two timestamps per element, kept forever."
    hold: long
```

#### Scene `bias` — when the timestamps tie

World: layout `pair`; clock visible, `t=4`. Each actor holds **two** slots: `favA` (bias add) and `favR` (bias remove), both containing pop? No — both empty; the scene adds/removes at the same tick.

```
s01 "Two copies of the same set, with different tie rules: add-wins on the left, remove-wins on the right."
    {t:'crdt.init', actors:['alice','bob'], slot:'favA', type:'lww-element-set', args:{bias:'add'}}
    {t:'crdt.init', actors:['alice','bob'], slot:'favR', type:'lww-element-set', args:{bias:'remove'}}
    {t:'note', id:'rule', text:'favA: tie → add wins · favR: tie → remove wins', sticky:true}   NEW (G6)
s02 "Time 5. Alice adds pop. At the same time 5, Bob removes pop. Same in both sets."
    {t:'tick'}
    {t:'crdt.update', actor:'alice', slot:'favA', op:'add', args:['pop']}
    {t:'crdt.update', actor:'bob', slot:'favA', op:'remove', args:['pop']}
    {t:'crdt.update', actor:'alice', slot:'favR', op:'add', args:['pop']}
    {t:'crdt.update', actor:'bob', slot:'favR', op:'remove', args:['pop']}
s03 "Sync both. addTs = removeTs = 5 on both sides. The timestamps cannot decide."
    {t:'crdt.sync', a:'alice', b:'bob', slot:'favA'}
    {t:'crdt.sync', a:'alice', b:'bob', slot:'favR'}
    {t:'highlight', path:['alice.favA[pop]@addTs','alice.favA[pop]@removeTs'], tone:'warn'}   (G8, G9)
s04 "Add-wins set: pop is in. Remove-wins set: pop is out. Both copies of each set agree — the bias is part of the rule."
    {t:'clearMarks'}
    {t:'check', path:'alice.favA[pop]'}
    {t:'cross', path:'alice.favR[pop]'}
    {t:'same', paths:['alice.favA','bob.favA']}   NEW (G5)
    {t:'same', paths:['alice.favR','bob.favR']}   NEW (G5)
s05 "Pick the bias by cost: is a wrongly-present item or a wrongly-missing item worse? Decide once, up front."
    hold: long
```

#### Scene `follows` — [in-context] follow, unfollow, follow again

World: layout `hub`; clock visible, `t=0`.

- `server` (label "Relay"), `alice` (a, phone), `bob` (b, label "Alice · laptop", color a); no holds yet.

```
s01 "A profile: display name (LWW) and the set of accounts she follows (LWW-Element-Set, add-wins)."
    {t:'crdt.init', actors:['server','alice','bob'], slot:'profile', type:'doc', schema:{name:'lww-register', follows:'lww-element-set'}, args:{name:'alice', follows:{bias:'add'}}}   NEW (G3)
s02 "Time 1, phone: follow @dan. Syncs to the relay."
    {t:'tick'}
    {t:'crdt.update', actor:'alice', slot:'profile', path:'follows', op:'add', args:['@dan']}   NEW (G3)
    {t:'crdt.sync', a:'alice', b:'server', slot:'profile'}
s03 "The phone goes offline. Time 2, laptop: unfollow @dan, and rename the profile."
    {t:'offline', actor:'alice'}
    {t:'tick'}
    {t:'crdt.sync', a:'bob', b:'server', slot:'profile'}
    {t:'crdt.update', actor:'bob', slot:'profile', path:'follows', op:'remove', args:['@dan']}   NEW (G3)
    {t:'crdt.update', actor:'bob', slot:'profile', path:'name', op:'set', args:['Alice L.']}   NEW (G3)
    {t:'crdt.sync', a:'bob', b:'server', slot:'profile'}
s04 "Time 3, phone (still offline): she taps follow @dan again."
    {t:'tick'}
    {t:'crdt.update', actor:'alice', slot:'profile', path:'follows', op:'add', args:['@dan']}   NEW (G3)
s05 "The phone reconnects and syncs. @dan: +t3 vs −t2. Newer wins: following."
    {t:'online', actor:'alice'}
    {t:'crdt.sync', a:'alice', b:'server', slot:'profile'}
    {t:'crdt.sync', a:'bob', b:'server', slot:'profile'}
    {t:'highlight', path:['server.profile.follows[@dan]@addTs','server.profile.follows[@dan]@removeTs']}   (G8, G9)
s06 "Everyone agrees: name 'Alice L.', following @dan. Her last tap won, which is what she meant."
    {t:'same', paths:['server.profile','alice.profile','bob.profile']}   NEW (G5)
    hold: long
```

**Gaps hit.** G9 is the headline: `Meta` has one `ts`; this type needs `addTs` and `removeTs`
per element (and `@addTs` / `@removeTs` path suffixes, G8). `crdt.init args` for a doc schema
needs per-field args (`follows:{bias:'add'}`) — fold into G3. `@dan` inside `[...]` must be a
legal item id (G8 grammar: anything but `]`).

---

### II.9 `or-set`

**Goal.** Learn the OR-Set: every add gets a unique tag; remove deletes only the tags you have
seen. Add after remove works, and a concurrent add and remove keeps the element — no clocks needed.

**When to use**

- sets with frequent add/remove where "add wins" on a race is the right call (cart items, tags, members);
- you do not want to depend on timestamps;
- re-adding must always work.

**When not to use**

- remove should beat a concurrent add (use remove-wins LWW-Element-Set, or a transaction);
- metadata growth is a concern and you cannot compact (each add leaves a tag; removes leave tombstoned tags in some designs — Unit III.7);
- elements are huge (tags per element add up).

**Real-world anchor.** Riak sets; the set structures inside Automerge/Yjs maps; shared cart /
playlist items.

Definition shown once: **tag** — a small unique id attached to one add, like `a1` ("Alice's 1st
add"). Tags are generated by the node; real systems use UUIDs (see the UUID module). Here they are
short so you can read them (G2).

#### Scene `tags` — remove what you saw, keep what you did not

World: layout `pair`; clock hidden.

- `alice` (a), `bob` (b); no holds yet.

```
s01 "An OR-Set remembers, for each element, the tags of the adds that put it there."
    {t:'crdt.init', actors:['alice','bob'], slot:'cart', type:'or-set'}
    {t:'note', id:'rule', text:'add → new tag · remove → drop the tags you have seen · in set = has a tag', sticky:true}   NEW (G6)
s02 "Alice adds milk. The add gets tag a1."
    {t:'crdt.update', actor:'alice', slot:'cart', op:'add', args:['milk']}   (G2: tag 'a1')
    {t:'highlight', path:'alice.cart[milk]@tags'}   (G8)
s03 "They sync. Bob has milk with tag a1."
    {t:'crdt.sync', a:'alice', b:'bob', slot:'cart'}
    {t:'same', paths:['alice.cart','bob.cart']}   NEW (G5)
s04 "Bob removes milk. He has seen tag a1, so he removes a1. Milk has no tags left: gone."
    {t:'clearMarks'}
    {t:'crdt.update', actor:'bob', slot:'cart', op:'remove', args:['milk']}
    {t:'highlight', path:'bob.cart', tone:'warn'}
s05 "At the same time, Alice adds milk again. New add, new tag: a2."
    {t:'crdt.update', actor:'alice', slot:'cart', op:'add', args:['milk']}   (G2: tag 'a2')
    {t:'highlight', path:'alice.cart[milk]@tags'}   (G8)
s06 "They sync. Bob's remove only covered a1. Alice's a2 was never seen by Bob, so it survives. Milk is in, with {a2}."
    {t:'clearMarks'}
    {t:'crdt.sync', a:'alice', b:'bob', slot:'cart'}
    {t:'same', paths:['alice.cart','bob.cart']}   NEW (G5)
    {t:'highlight', path:'bob.cart[milk]@tags'}   (G8)
s07 "This is 'observed remove': you can only remove what you observed. A concurrent add always wins, and no clock was needed."
    hold: long
```

#### Scene `vs-timestamps` — the same race, no timestamps

World: layout `pair`; clock hidden. `cart` = {eggs {b1}} on both (init + Bob adds + sync in s01).

```
s01 "Both have eggs, added by Bob (tag b1)."
    {t:'crdt.init', actors:['alice','bob'], slot:'cart', type:'or-set'}
    {t:'crdt.update', actor:'bob', slot:'cart', op:'add', args:['eggs']}
    {t:'crdt.sync', a:'alice', b:'bob', slot:'cart'}
s02 "Bob removes eggs (drops b1). Alice, concurrently, adds eggs again (tag a1)."
    {t:'crdt.update', actor:'bob', slot:'cart', op:'remove', args:['eggs']}
    {t:'crdt.update', actor:'alice', slot:'cart', op:'add', args:['eggs']}
    {t:'conflict', a:'alice.cart[eggs]', b:'bob.cart'}   (G8: conflict between an item and an empty set — see note)
s03 "With LWW we would compare timestamps and hope the clocks agree. Here we compare tags."
    {t:'clearMarks'}
    {t:'highlight', path:'alice.cart[eggs]@tags'}   (G8)
s04 "Sync. Bob's remove knew b1, not a1. Eggs stay, with {a1}. Same answer on both sides, every time."
    {t:'crdt.sync', a:'alice', b:'bob', slot:'cart'}
    {t:'same', paths:['alice.cart','bob.cart']}   NEW (G5)
s05 "OR-Set means add-wins by construction. If remove must win on a race, the OR-Set is the wrong tool."
    hold: long
```

#### Scene `group-cart` — [in-context] three people, one offline

World: layout `triangle`; clock hidden.

- `alice` (a), `bob` (b), `carol` (c); no holds yet.

```
s01 "A shared cart as an OR-Set. Carol is offline in a shop."
    {t:'crdt.init', actors:['alice','bob','carol'], slot:'cart', type:'or-set'}
    {t:'crdt.update', actor:'alice', slot:'cart', op:'add', args:['bread']}
    {t:'crdt.sync', a:'alice', b:'bob', slot:'cart'}
    {t:'crdt.sync', a:'alice', b:'carol', slot:'cart'}
    {t:'offline', actor:'carol'}
s02 "Carol buys the bread and removes it (she saw a1). Still offline."
    {t:'crdt.update', actor:'carol', slot:'cart', op:'remove', args:['bread']}
s03 "Bob, online, adds bread again because the first loaf is for the party. Tag b1."
    {t:'crdt.update', actor:'bob', slot:'cart', op:'add', args:['bread']}
    {t:'crdt.sync', a:'alice', b:'bob', slot:'cart'}
    {t:'highlight', path:'alice.cart[bread]@tags'}   (G8)
s04 "Carol reconnects and syncs with Alice. Her remove of a1 lands; Bob's b1 survives. Bread: {b1}."
    {t:'clearMarks'}
    {t:'online', actor:'carol'}
    {t:'crdt.sync', a:'carol', b:'alice', slot:'cart'}
    {t:'highlight', path:'carol.cart[bread]@tags'}   (G8)
s05 "One more sync and all three agree: bread is on the list exactly once, for the right reason."
    {t:'crdt.sync', a:'alice', b:'bob', slot:'cart'}
    {t:'same', paths:['alice.cart','bob.cart','carol.cart']}   NEW (G5)
s06 "Tags make 'what you saw' explicit. The cost is one small tag per add — and that is the topic after next."
    hold: long
```

**Gaps hit.** G2 is the headline: tags must be deterministic and short (`a1`, `b1`) — both for
the screenshots and so narration can name them; inject an id generator into the CRDT. G8
(`@tags`). `conflict` between an item and an empty set (s02 of `vs-timestamps`) has no clean
target — allow `conflict` with a set path on one side and draw the ⚡ at the set.

---

### II.10 `in-context-shopping-list`

**Goal.** Compose everything from this unit into one document two phones can edit offline: LWW
fields, an OR-Set of items, a PN-Counter quantity per item. Watch each part merge by its own rule.

**When this composition fits**

- shared lists and boards edited offline (groceries, packing, chores);
- each piece of data has an obvious "right" merge when you look at it alone;
- a short disagreement window is acceptable.

**When it does not**

- the list has a strict order that both users reorder (needs a sequence CRDT, Unit III.5);
- quantities are inventory with a hard floor;
- you need an audit log of who did what (Unit III ops).

**Real-world anchor.** Shared grocery apps (Apple Reminders lists, AnyList, Bring!), with offline
editing on two phones.

The document schema (this is what `crdt.init type:'doc'` receives — G3):

```
list: {
  title:   lww-register,
  items:   or-set<item-id> of {
    name:  lww-register,
    qty:   pn-counter
  }
}
```

#### Scene `build-it` — the pieces, in place

World: layout `pair`; clock visible, `t=0`.

- `alice` (a, phone), `bob` (b, label "Bob · phone"); no holds yet.

```
s01 "One shared list. Title: LWW. Items: OR-Set. Each item: name (LWW) and quantity (PN-Counter)."
    {t:'crdt.init', actors:['alice','bob'], slot:'list', type:'doc', schema:{title:'lww-register', items:{'or-set':{name:'lww-register', qty:'pn-counter'}}}, args:{title:'Groceries'}}   NEW (G3)
    {t:'highlight', path:'alice.list'}
s02 "Alice adds milk. The item gets an id (tag) and starts with qty 0."
    {t:'crdt.update', actor:'alice', slot:'list', path:'items', op:'add', args:['milk']}   NEW (G3) (G2: item id 'a1')
s03 "She sets the quantity to 2. That is two increments on the item's counter."
    {t:'crdt.update', actor:'alice', slot:'list', path:'items[milk].qty', op:'inc', args:[2]}   NEW (G3)
s04 "Bob adds eggs with qty 12."
    {t:'crdt.update', actor:'bob', slot:'list', path:'items', op:'add', args:['eggs']}   NEW (G3)
    {t:'crdt.update', actor:'bob', slot:'list', path:'items[eggs].qty', op:'inc', args:[12]}   NEW (G3)
s05 "They sync. The set unions. Each item's counter merges by max-per-row."
    {t:'crdt.sync', a:'alice', b:'bob', slot:'list'}
    {t:'same', paths:['alice.list','bob.list']}   NEW (G5)
s06 "Look at the sidecar: a tag on each item, a timestamp on the title, a per-node row on each quantity."
    {t:'highlight', path:['alice.list.title@ts','alice.list.items[milk]@tags','alice.list.items[milk].qty']}   (G8)
s07 "Every part brought its own merge rule. Now let's break the network."
    hold: long
    {t:'clearMarks'}
```

#### Scene `offline-weekend` — both phones edit, then reconcile

World: layout `pair`; clock continues (`t=0` of this scene). State from `build-it` re-created in s01.

```
s01 "Saturday. Both phones have the same list. Then both go offline."
    {t:'crdt.init', actors:['alice','bob'], slot:'list', type:'doc', schema:{title:'lww-register', items:{'or-set':{name:'lww-register', qty:'pn-counter'}}}, args:{title:'Groceries'}}   NEW (G3)
    {t:'crdt.update', actor:'alice', slot:'list', path:'items', op:'add', args:['milk']}
    {t:'crdt.update', actor:'alice', slot:'list', path:'items[milk].qty', op:'inc', args:[2]}
    {t:'crdt.update', actor:'bob', slot:'list', path:'items', op:'add', args:['eggs']}
    {t:'crdt.update', actor:'bob', slot:'list', path:'items[eggs].qty', op:'inc', args:[12]}
    {t:'crdt.sync', a:'alice', b:'bob', slot:'list'}
    {t:'offline', actor:'alice'}
    {t:'offline', actor:'bob'}
s02 "Time 1. Alice renames the list and adds one more milk."
    {t:'tick'}
    {t:'crdt.update', actor:'alice', slot:'list', path:'title', op:'set', args:['Party shop']}
    {t:'crdt.update', actor:'alice', slot:'list', path:'items[milk].qty', op:'inc', args:[1]}
s03 "Time 2. Bob removes eggs (he bought them), and drops milk by one."
    {t:'tick'}
    {t:'crdt.update', actor:'bob', slot:'list', path:'items', op:'remove', args:['eggs']}
    {t:'crdt.update', actor:'bob', slot:'list', path:'items[milk].qty', op:'dec', args:[1]}
s04 "Time 3. Bob also renames the list."
    {t:'tick'}
    {t:'crdt.update', actor:'bob', slot:'list', path:'title', op:'set', args:['Sat shopping']}
    {t:'conflict', a:'alice.list.title', b:'bob.list.title'}
s05 "Sunday. Both come online and sync. Watch each part."
    {t:'clearMarks'}
    {t:'online', actor:'alice'}
    {t:'online', actor:'bob'}
    {t:'crdt.sync', a:'alice', b:'bob', slot:'list'}
s06 "Title: LWW, t=3 beats t=1. 'Sat shopping'."
    {t:'highlight', path:'alice.list.title@ts'}   (G8)
s07 "Eggs: OR-Set. Bob removed the tag he saw; nobody re-added. Eggs are gone."
    {t:'highlight', path:'alice.list.items', tone:'info'}
s08 "Milk qty: PN-Counter. 2 (Alice) + 1 (Alice) − 1 (Bob) = 2. Both edits counted."
    {t:'highlight', path:'alice.list.items[milk].qty'}   (G8)
    {t:'callout', at:'alice.list.items[milk].qty', text:'2 + 1 − 1 = 2', tone:'info'}
s09 "Both phones: 'Sat shopping', milk × 2. No lock, no lost edit, no manual conflict screen."
    {t:'clearMarks'}
    {t:'same', paths:['alice.list','bob.list']}   NEW (G5)
    hold: long
```

#### Scene `one-more-race` — remove vs edit-inside

World: layout `pair`; clock continues. State from the end of `offline-weekend` re-created in s01 (title 'Sat shopping' t=3, milk × 2, no eggs).

```
s01 "One last race. Alice removes milk. At the same time, Bob bumps milk's quantity to 3."
    {t:'crdt.init', actors:['alice','bob'], slot:'list', type:'doc', schema:{title:'lww-register', items:{'or-set':{name:'lww-register', qty:'pn-counter'}}}, args:{title:{value:'Sat shopping', ts:3, node:'bob'}}}   NEW (G3)
    {t:'crdt.update', actor:'alice', slot:'list', path:'items', op:'add', args:['milk']}
    {t:'crdt.update', actor:'alice', slot:'list', path:'items[milk].qty', op:'inc', args:[2]}
    {t:'crdt.sync', a:'alice', b:'bob', slot:'list'}
    {t:'crdt.update', actor:'alice', slot:'list', path:'items', op:'remove', args:['milk']}
    {t:'crdt.update', actor:'bob', slot:'list', path:'items[milk].qty', op:'inc', args:[1]}
    {t:'conflict', a:'alice.list.items', b:'bob.list.items[milk]'}
s02 "Sync. The OR-Set decides membership: Alice removed the only tag; Bob added no new tag. Milk is gone — with its counter."
    {t:'clearMarks'}
    {t:'crdt.sync', a:'alice', b:'bob', slot:'list'}
    {t:'same', paths:['alice.list','bob.list']}   NEW (G5)
s03 "Bob's +1 vanished with the item. Editing inside an element does not protect it from a remove. Decide if that is what you want."
    {t:'callout', at:'bob.list.items', text:'edit-inside lost to remove', tone:'warn'}
s04 "If 'any edit should keep the item', the app can re-add on edit (a new tag). That is an app rule on top of the CRDT — and a fine one."
    hold: long
```

**Gaps hit.** G3 end-to-end: nested schema (`or-set` of docs), path-addressed updates with item
ids (`items[milk].qty`), per-field init args incl. `{value, ts, node}`. G2 (item tags). G8
(`[milk]` and `@tags` inside a nested path). Re-creating state at the start of each scene is long
(s01 blocks) — a `scene.startFrom: <previous scene id>` or `world.from` option would let scenes
inherit a prior scene's final world (§3 G20).

---

### II.11 `the-cost-of-state`

**Goal.** See the price of state-based sync: the whole state goes on the wire on every sync, and
sidecar grows. Deltas shrink the wire cost; operations (Unit III) are the other answer.

**State-based is fine when**

- the state is small (a status, a counter, a short set);
- syncs are rare (on reconnect, every few seconds);
- simplicity matters more than bandwidth.

**Look further when**

- the state is large and edits are small and frequent (a document, a long list);
- many peers sync often (n × state size, every round);
- sidecar (tags, tombstones, per-node rows) keeps growing and you cannot compact it.

**Real-world anchor.** Riak's full-state replication vs. delta-state CRDTs; Automerge's sync
protocol (sends only what the other side lacks).

#### Scene `full-state` — one word, the whole list

World: layout `pair`; clock hidden. `list` = OR-Set with 12 items (init + 12 adds + sync in s01; items: apples, bananas, bread, butter, cheese, coffee, eggs, flour, milk, onions, rice, salt).

```
s01 "A shared list with twelve items, already in sync."
    {t:'crdt.init', actors:['alice','bob'], slot:'list', type:'or-set'}
    {t:'crdt.update', actor:'alice', slot:'list', op:'add', args:['apples']}
    {t:'crdt.update', actor:'alice', slot:'list', op:'add', args:['bananas']}
    {t:'crdt.update', actor:'alice', slot:'list', op:'add', args:['bread']}
    {t:'crdt.update', actor:'alice', slot:'list', op:'add', args:['butter']}
    {t:'crdt.update', actor:'alice', slot:'list', op:'add', args:['cheese']}
    {t:'crdt.update', actor:'alice', slot:'list', op:'add', args:['coffee']}
    {t:'crdt.update', actor:'alice', slot:'list', op:'add', args:['eggs']}
    {t:'crdt.update', actor:'alice', slot:'list', op:'add', args:['flour']}
    {t:'crdt.update', actor:'alice', slot:'list', op:'add', args:['milk']}
    {t:'crdt.update', actor:'alice', slot:'list', op:'add', args:['onions']}
    {t:'crdt.update', actor:'alice', slot:'list', op:'add', args:['rice']}
    {t:'crdt.update', actor:'alice', slot:'list', op:'add', args:['salt']}
    {t:'crdt.sync', a:'alice', b:'bob', slot:'list'}
s02 "Alice adds one item: tea."
    {t:'crdt.update', actor:'alice', slot:'list', op:'add', args:['tea']}
s03 "To sync, she sends her state. All thirteen items and their tags, for one new word."
    {t:'crdt.send', from:'alice', to:'bob', slot:'list', id:'m1', mode:'full'}   NEW (G4, G11: reducer computes size label, e.g. '412 B')
    {t:'callout', at:'alice', text:'whole state, every time', tone:'warn'}
s04 "Bob merges. Twelve of the thirteen items were already there."
    {t:'clearMarks'}
    {t:'crdt.merge', into:'bob', from:{message:'m1'}, slot:'list'}   NEW (G4)
s05 "Bob removes salt. Same story back: the whole state for one change."
    {t:'crdt.update', actor:'bob', slot:'list', op:'remove', args:['salt']}
    {t:'crdt.send', from:'bob', to:'alice', slot:'list', id:'m2', mode:'full'}   NEW (G4, G11)
    {t:'crdt.merge', into:'alice', from:{message:'m2'}, slot:'list'}   NEW (G4)
s06 "With a big document and many peers, this adds up fast: size × peers × syncs."
    hold: long
    {t:'note', id:'cost', text:'wire cost ≈ state size × peers × sync rounds', sticky:true}   NEW (G6)
```

#### Scene `delta` — send only what changed

World: layout `pair`; clock hidden. Same 12-item list (re-created in s01, as above).

```
s01 "Same list. This time Alice sends a delta: a tiny state that holds only her change."
    (re-create the 12-item list as in full-state s01)
    {t:'crdt.update', actor:'alice', slot:'list', op:'add', args:['tea']}
    {t:'crdt.send', from:'alice', to:'bob', slot:'list', id:'m1', mode:'delta'}   NEW (G4, G11: size label e.g. '24 B')
s02 "Bob merges the delta with the same merge() as before. A delta is just a small state."
    {t:'crdt.merge', into:'bob', from:{message:'m1'}, slot:'list'}   NEW (G4)
    {t:'same', paths:['alice.list','bob.list']}   NEW (G5)
s03 "Compare the two envelopes: about 400 bytes vs about 24. Same result."
    {t:'callout', at:'bob.list', text:'full ≈ 400 B · delta ≈ 24 B (computed)', tone:'ok'}
s04 "The catch: you must know what the other side has not seen yet. Lose track, and you fall back to full state (simplified)."
    {t:'clearMarks'}
    {t:'callout', at:'alice', text:'needs: what has Bob seen?', tone:'info'}
s05 "Deltas keep the three laws: commutative, associative, idempotent. That is why the same merge() works."
    hold: long
    {t:'clearMarks'}
```

#### Scene `sidecar-grows` — the other cost

World: layout `pair`; clock hidden. `cart` = OR-Set; `alice`, `bob`.

```
s01 "State also grows inside. Watch an OR-Set through a busy day."
    {t:'crdt.init', actors:['alice','bob'], slot:'cart', type:'or-set'}
    {t:'crdt.update', actor:'alice', slot:'cart', op:'add', args:['milk']}
    {t:'crdt.sync', a:'alice', b:'bob', slot:'cart'}
s02 "Add, remove, add, remove, add. Each add is a new tag. Each remove leaves a record of what it removed (in many designs)."
    {t:'crdt.update', actor:'bob', slot:'cart', op:'remove', args:['milk']}
    {t:'crdt.update', actor:'alice', slot:'cart', op:'add', args:['milk']}
    {t:'crdt.sync', a:'alice', b:'bob', slot:'cart'}
    {t:'crdt.update', actor:'bob', slot:'cart', op:'remove', args:['milk']}
    {t:'crdt.update', actor:'alice', slot:'cart', op:'add', args:['milk']}
    {t:'crdt.sync', a:'alice', b:'bob', slot:'cart'}
    {t:'highlight', path:'alice.cart[milk]@tags'}   (G8)
s03 "One item in the cart. Several tags in the sidecar. Tombstones in the 2P-Set never leave at all."
    {t:'callout', at:'alice.cart', text:'1 visible item · growing sidecar', tone:'warn'}
s04 "Real systems compact: they drop sidecar everyone has seen. That needs to know what everyone has seen — Unit IV."
    hold: long
    {t:'clearMarks'}
```

#### Scene `choose` — [in-context] small doc, big doc

World: layout `row`; clock hidden.

- `alice` (a) holds `status = 'Lunch'` (plain scalar, illustrative) and `doc = rec({pages:'40', words:'12 000'})`

```
s01 "Two pieces of data on one phone. A status line and a long document."
    {t:'highlight', path:['alice.status','alice.doc']}
s02 "Status: a few bytes. Send the whole state every time. Done."
    {t:'callout', at:'alice.status', text:'state-based: fine', tone:'ok', sticky:true}
s03 "Document: thousands of words, edited one letter at a time. Full state per keystroke is absurd."
    {t:'callout', at:'alice.doc', text:'state-based: too heavy', tone:'danger', sticky:true}
s04 "For the document, send what you did, not what you have. That is Unit III: operation-based CRDTs."
    hold: long
```

**Gaps hit.** G11 (message `size` computed by the reducer from the real serialized state or delta
— the lesson must not hand-write byte counts), G4 (`mode:'delta'` needs the CRDT impl to expose
`delta(since)`; for v1 a delta can be "the state of the most recent op(s)" for set/counter types,
and the narration says "(simplified)"), G6, G5. A 12-item init block is noisy: an `init` `args`
that accepts initial elements (`args:{items:[…]}` for sets) halves it.

---

## 3. DSL gaps — consolidated proposals

Ordered by severity. Each says what was needed, the proposal, and which topics need it.

### G1 — Timestamp and node source for `crdt.update` · **blocker**

**Needed by:** II.2, II.3, II.8, I.5/I.6 previews, II.10.
**Problem:** LWW types need `(ts, node)` per write. v0 `crdt.update` has neither, and nothing ties
`world.clock` to CRDT ops.
**Proposal:** the reducer passes a context to every CRDT op: `{ now: world.clock, node: actor,
ids: IdGen }`. `tick` is the only way time moves. Optional override `at?: number` on
`crdt.update` for "this write happened at t=5" without ticking. `crdt.init args` accepts either a
plain initial value (stamped `ts:0, node:'init'`) or `{value, ts, node}` per field.

### G2 — Deterministic, short ids and tags · **blocker**

**Needed by:** II.9, II.10, II.11 (and Unit III op ids).
**Problem:** OR-Set tags, item ids, and later op ids must be stable across runs (tests,
storyboards, i18n of narration that names them) and short enough to draw.
**Proposal:** CRDT constructors take an `IdGen`; the reducer supplies one per scene that yields
`${nodeLetter}${seq}` (`a1`, `b2`). Narration may quote these ids. Property tests use random ids;
lesson runs use the deterministic gen.

### G3 — Composite CRDT documents · **blocker**

**Needed by:** II.5, II.6, II.7, II.8 in-context scenes; II.10 entirely; I.6 preview; Unit V.
**Problem:** `crdt.init` creates one type per slot. Real documents nest: map of registers, set of
docs with counters inside.
**Proposal:**

```ts
{ t:'crdt.init', actors, slot, type:'doc',
  schema: Schema, args?: Record<string, unknown> }
type Schema = CrdtType | { [field: string]: Schema } | { 'or-set': Schema } | { 'lww-map': true }
{ t:'crdt.update', actor, slot, path?: string, op, args }   // path addresses a sub-CRDT: 'items[milk].qty'
```

`toValue` of a doc is a `record` whose fields are the children's `toValue`, so the renderer needs
nothing new. Per-field init args (`args:{follows:{bias:'add'}}`) ride along.

### G4 — State on the wire as a static frame · **important**

**Needed by:** every Unit II scene, I.5, I.6.
**Problem:** `crdt.merge into/from` teleports state. Lessons need "send state (frame N) … merge on
arrival (frame N+1)", out-of-order arrival, drops, duplicates — i.e. messages that carry CRDT
state and exist between steps.
**Proposal:**

```ts
{ t:'crdt.send', from, to: ActorId | ActorId[], slot, id?, mode?: 'full' | 'delta' }
  // snapshots the sender's state *at this step*; message payload = toValue(snapshot); size computed
{ t:'crdt.merge', into, from: ActorId | { message: string }, slot }
```

Keep `crdt.merge from: ActorId` as sugar for "send + merge in one step" and `crdt.sync` for both
directions. `crdt.send` to several recipients creates one message per recipient (G12).

### G5 — `same` mark · **important**

**Needed by:** every topic (convergence is the whole point).
**Proposal:** `{ t:'same', paths: Path[] }` — draws "=" links / a shared check across the named
values. Transient like other marks unless `sticky`. The reducer should assert structural equality
of the `toValue` trees in test mode (a `same` on unequal values is a content bug).

### G6 — `note` (free-standing stage card) · **important**

**Needed by:** rule cards in all of Unit II; lesson summaries in Unit I.
**Proposal:** `{ t:'note', id, text, tone?, sticky?: boolean }` placed in a stage gutter (not
attached to an actor or path). Same `id` replaces the previous note (used in II.1 to step through
the three laws). Removed by `clearMarks` or `unmark` (G16). Text is localizable by step id.

### G7 — Actor status badge · **important**

**Needed by:** I.2, I.3.
**Proposal:** `{ t:'status', actor, status: 'lock' | 'waiting' | 'busy' | 'error' | null }` →
`Actor.status`. Drawn as a small labeled badge (icon + word, not color only). `offline` stays a
separate boolean.

### G8 — Path grammar · **important**

**Needed by:** all of Unit II (highlighting sidecar), I.5.
**Proposal:** `Path := actor ( '.' key | '[' id ']' )* ( '@' metaKey )?` where `[id]` indexes
list/set items and counter rows; `metaKey ∈ {ts, node, tags, tomb, addTs, removeTs, neg[...]}`.
Examples: `alice.views[alice]`, `alice.likes@neg[alice]`, `bob.fav[jazz]@removeTs`,
`alice.list.items[milk].qty`. The renderer maps `@…` to the sidecar tag element of the value.
Item ids may contain anything but `]`.

### G9 — Richer `Meta` · **important**

**Needed by:** II.8.
**Proposal:** `Meta = { ts?, node?, tag?, tombstone?, note?, addTs?, removeTs?, extra?: Record<string, string | number | boolean> }`.
`extra` is the escape hatch for later types (HLC, vector-clock entries on a register).

### G10 — No-op visibility · **important**

**Needed by:** II.1 (idempotence), II.2, II.4, II.7.
**Proposal:** when a `crdt.update`/`crdt.merge` leaves the slot's `toValue` unchanged, the
reducer adds a transient mark `{ kind:'unchanged', at: '<actor>.<slot>' }` drawn as a small
"no change" pill. Narration can then say "nothing changed" and the frame proves it.

### G11 — Message size · **important**

**Needed by:** II.11.
**Proposal:** `Message.size?: number` (bytes), set by `crdt.send` from the serialized snapshot or
delta; `send` may set it explicitly. Renderer draws the size label and scales envelope thickness
(bounded). Lessons never hand-write sizes.

### G12 — Per-recipient message ids · **important**

**Needed by:** I.5, II.1, II.2, II.3, II.4.
**Proposal:** `send`/`crdt.send` with `to: ActorId[]` creates messages `${id}:${to}`; `deliver`,
`drop`, `crdt.merge from:{message}` address them individually.

### G13 — Actor icon and owner · **nice**

**Proposal:** `Actor.icon?: 'person' | 'phone' | 'laptop' | 'tablet' | 'server' | 'cloud' | 'service'`
and `Actor.owner?: ActorId` (same person, two devices → same hue, small "Alice's" caption).
Also `Actor.subtitle?: string` for the I.6 gallery instead of the `holds:{shares:…}` hack.

### G14 — Scene clock config · **nice**

**Proposal:** `World.clock: { now: number; visible: boolean; format: 'int' | 'ms' | 'hh:mm' }`.
Unit I.3 uses `ms`; Unit II uses `int`.

### G15 — Reject/bounce on deliver · **nice**

**Proposal:** `{ t:'deliver', message, into?, outcome?: 'ok' | 'reject' }` — reject animates a
bounce and leaves a ✗ on the message. Used nowhere yet (I.2 composes `cross` + a reply message),
but Unit III "rejected op" scenes will want it.

### G16 — Mark ids and `unmark` · **nice**

**Proposal:** `callout`/`note`/`highlight` accept `id?`; `{ t:'unmark', id }` removes one.
Today every multi-callout scene ends in `clearMarks`, which also wipes rule notes.

### G17 — `highlight` an actor · **nice**

**Proposal:** `highlight.path` accepts `ActorId` (whole card), matching `callout.at`.

### G18 — Stable item order in `toValue` · **nice (renderer contract)**

Sets and counters must render in a deterministic order that does not change on merge (first-seen
on that replica, then by id). Otherwise Motion `layout` reshuffles rows and the "what changed"
signal is lost.

### G19 — `tryIt` declaration · **nice (open question 4)**

Per scene: `tryIt?: { slot, actors, ops: Array<{ op, label, args?: 'prompt' | unknown[] }> }`.
Unit II topics would expose exactly the ops their scenes use (`set`, `inc/dec`, `add/remove`,
`sync`).

### G20 — Scene inherits a previous scene's final world · **nice**

`scene.startFrom?: SceneId` — avoids the long s01 re-creation blocks in II.3, II.7, II.10. The
reducer computes the parent's final state; seeking stays deterministic.

### P1 — `max-register` CRDT · **pedagogy**

~20 lines in `src/crdt/`. Used only by II.1. Makes the three laws demonstrable with one number.

### Clarifications the DSL doc should state (no new commands)

- `send payload:{ref: Path}` snapshots the value at send time (messages are immutable).
- A message that is sent but not yet delivered sits at the midpoint of its route in every
  static frame until `deliver`/`drop`.
- `crdt.init` on a slot that already exists for other actors **adds replicas** (II.7 spawns
  Carol mid-scene); it does not reset existing ones.
- `crdt.sync a b` = merge both directions in one step (two messages, both delivered).
- `set` of a non-CRDT scalar on a path inside a CRDT slot must be a schema error.

---

## 4. Authoring ergonomics — builder helpers these scripts want

The raw object literals above are exact but long. With the helpers below, a typical step is one
to three short lines. All helpers are pure constructors (no logic, no closures over state), so the
output is still plain data that the Zod schema validates.

### 4.1 Structure

```ts
topic({ id:'lww-register', title, goal, whenToUse:[…], whenNotToUse:[…], realWorld, scenes:[…] })
scene('update-and-merge', world({ layout:'pair', clock:{ visible:true } , actors:[alice.phone(), bob.laptop()] }), [
  step('s01', 'An LWW register holds a value and a timestamp…', [ … ]),
  step('s02', '…').hold('long'),
])
```

`scene(…).startFrom('build-it')` for G20. Step ids are explicit strings (never generated) so
translations stay stable.

### 4.2 Actors

```ts
alice()              // person, color a
alice.phone()        // icon phone, label 'Alice · phone'
alice.laptop()       // second device, owner alice (G13)
bob(), carol()
server('Relay')      // kind server; label optional
service('edge-us', 'US edge', 'a')
actor(...).holds({ doc: rec({ title:'Q3 plan' }), lock:'free' })   // Unit I plain values
```

### 4.3 Values

```ts
rec({ title: 'Q3 plan', owner: 'Bob' }) // record of scalars (nestable)
list(['bread', 'milk']) // list, ids = values
sset(['a', 'b']) // set
cnt({ alice: 2, bob: 1 }) // counter
```

### 4.4 Primitive commands (thin wrappers, same names as `t`)

```ts
set('alice.doc.title', 'Q3 plan v2')
send('alice', 'server', ref('alice.doc'), { id:'m3', label:'save' })
send('server', 'bob', 'wait', { id:'m4' })            // scalar payload = control message
deliver('m3', { into:'server.doc' })
drop('m1')
offline('alice'); online('alice')
status('alice', 'lock'); status('bob', null)           // G7
highlight('bob.status@ts'); highlight(['a','b'], { tone:'warn' })
callout('server.doc.title', 'last write silently won', { tone:'warn', sticky:true, id:'c1' })
note('rule', 'merge = max', { sticky:true })           // G6
conflict('alice.doc.title', 'bob.doc.title')
same('alice.doc.title', 'bob.doc.title', …)           // G5, variadic
check(path); cross(path); tick(); tick(150); clearMarks(); unmark('c1'); layout('triangle')
```

### 4.5 CRDT commands

```ts
crdt.init(['alice', 'bob'], 'status', 'lww-register', { value: 'Offline' })
crdt.doc(
  ['alice', 'bob'],
  'list',
  { title: lwwReg(), items: orSet({ name: lwwReg(), qty: pnCounter() }) },
  { title: 'Groceries' },
) // G3
crdt.update('alice', 'status', 'set', 'In a meeting') // args spread
crdt.update('alice', 'list', 'items[milk].qty', 'inc', 2) // path form
crdt.send('alice', 'bob', 'status', { id: 'm1', mode: 'delta' }) // G4
crdt.merge('bob', { message: 'm1' }, 'status')
crdt.merge('bob', 'alice', 'status') // one-step sugar
crdt.sync('alice', 'bob', 'status')
```

Type-specific sugar reads best in content and keeps op names typed per type:

```ts
lww('status').set('alice', 'In a meeting')
lwwMap('task').set('bob', 'status', 'Doing')
gcounter('views').inc('alice', 2)
pncounter('likes').dec('alice')
gset('seen').add('alice', 'm1')
twoPSet('guests').remove('bob', 'dan')
lwwSet('fav').add('alice', 'jazz')
orSet('cart').remove('bob', 'milk')
doc('list').at('items[milk].qty').inc('bob', 1)
```

### 4.6 Multi-step macros (expand to plain commands at build time; still data)

```ts
syncAll('list', ['alice','server'], ['bob','server'], ['alice','server'])   // ordered pair syncs (II.3, II.6, II.7)
broadcastState('carol', ['alice','bob'], 'views', 'm3')                     // crdt.send to many + merge each (I.5, II.2, II.4)
allSame('views', ['alice','bob','carol'])                                    // same(...) over `<actor>.<slot>`
initSet('list', ['alice','bob'], ['apples','bananas', …])                   // init + adds + sync (II.11)
```

Macros must expand to the same command list a human would write, so the reducer and tests never
see them.

### 4.7 Narration helpers

- `step(id, say, do)` — `say` is a single string; two sentences max enforced by a lint rule
  (count of `. ! ?` ≤ 2, length ≤ 160 chars).
- `term('LWW', 'Last-Writer-Wins')` marks a first-use definition in `say` so the glossary and the
  style-guide check can find it.

### 4.8 Paths

A typed `p` helper is worth it: `p.alice.status.ts` → `'alice.status@ts'`,
`p.alice.list.items('milk').qty` → `'alice.list.items[milk].qty'`. At test time the Zod schema
checks every path in a scene against the world the reducer actually builds at that step.

---

## 5. Topic changes vs. `outline.md`

No topics were split or merged. Additions and renames, all within the outline's ids:

| topic   | change                                                                                                                                                                               |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| I.1–I.4 | each gained an `[in-context]` scene (a real system diagram, a bank transfer, a three-editor doc, an order record) so Unit I follows the same "atomic → in-context" rhythm as Unit II |
| I.5     | uses a **real** G-Set and a **real** LWW register as labeled previews (no hand-written merges)                                                                                       |
| I.6     | second scene is a notes-app sync with a real LWW map (preview) rather than a static slide                                                                                            |
| II.1    | uses a new tiny `max-register` (P1) to show the three laws with one number; adds a "bad network" in-context scene                                                                    |
| II.2    | four scenes: update/merge, tie-break, any-order, phone+laptop+relay                                                                                                                  |
| II.5    | adds `no-floor` (the oversell failure) so "when not to use" is shown, not just listed                                                                                                |
| II.8    | `bias` scene shows add-wins and remove-wins side by side in two slots                                                                                                                |
| II.10   | adds `one-more-race` (remove vs edit-inside) — the composition gotcha people actually hit                                                                                            |
| II.11   | adds `sidecar-grows` so "cost" covers bytes on the wire **and** metadata growth                                                                                                      |

Step counts: Unit I — 6 topics, 14 scenes, 109 steps. Unit II — 11 topics, 32 scenes, 235 steps.
(Counts are approximate; see the scripts.)

### Adversarial-review flags to carry into the content pass

- II.2 s05/s06 and II.3 s06: the narration says "sends", the command is `crdt.sync` in some
  scenes — the verify walker should assert that a frame with an in-flight message exists wherever
  the narration says "sends".
- II.9 `vs-timestamps` s02: `conflict` between an item and an empty set needs a renderer decision.
- Every `(simplified)` is deliberate: I.3 latency numbers, II.11 delta explanation, I.2 "what a
  transaction does".
- Names of real products appear only in "real-world anchor" text and the I.6 gallery labels;
  verify wording with the style guide before publishing.
