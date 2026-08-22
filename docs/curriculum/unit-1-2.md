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

| id | kind | color | notes |
| --- | --- | --- | --- |
| `alice` | person | a | usually on a **phone** (icon, G13) |
| `bob` | person | b | usually on a **laptop** |
| `carol` | person | c | third editor when needed |
| `server` | server | server | sometimes labeled "Relay" when it only forwards |
| `edge-us` / `edge-eu` / `edge-ap` | service | a / b / c | used once (G-Counter in context) |

Never more than 5 actors on stage. Values stay short (≤ 12 chars) so the stage stays legible.

### 0.3 Timestamps and the scene clock

Unit II uses **logical time** only: the scene clock is an integer shown as `t=3`. `tick` advances
it. Every `crdt.update` stamps its op with the current clock and the acting node (G1). Wall-clock
skew is Unit IV's problem; we say so once in LWW (II.2) and move on.

### 0.4 Sidecar rendering contract (what the renderer must draw from `Value.meta`)

| CRDT | sidecar in `Value` | drawn as |
| --- | --- | --- |
| LWW register | `scalar.meta = {ts, node}` | value, then a small mono tag `t=3 · alice` |
| LWW map | each field's value has its own `meta {ts, node}` | tag per field |
| G / PN counter | `counter.perNode`, `counter.negative` | a small table, one row per node, total on the right |
| G-Set / 2P-Set | `set.items[].tombstone` | tombstoned items stay, struck through, dimmed |
| LWW-Element-Set | `set.items[].meta {addTs, removeTs}` (G9) | two tiny tags under each item, `+t4  −t3` |
| OR-Set | `set.items[].tags` | item, then tag chips `a1 b2` |

### 0.5 The "in-context" rule

Every atomic topic ends with an `in-context` scene: a realistic composed document or system that
uses the new concept together with concepts already taught. Scenes are tagged `[in-context]`.

### 0.6 Gap index (details in §3)

| id | severity | one line |
| --- | --- | --- |
| G1 | blocker | `crdt.update` has no timestamp/node source; reducer must pass `{now, node}` ctx; `tick` drives it |
| G2 | blocker | OR-Set tags / ids must be short and deterministic (`a1`, `b2`); inject an `IdGen` into CRDT impls |
| G3 | blocker | Composite CRDT documents: `crdt.init type:'doc' schema:{…}` + path-addressed `crdt.update` |
| G4 | important | State on the wire as a static frame: `crdt.send` (snapshot/delta + byte size) and `crdt.merge from:{message}` |
| G5 | important | `same` mark — the positive twin of `conflict` ("these copies are equal") |
| G6 | important | `note` — a free-standing stage card (rule cards like "merge = max"), with id + sticky |
| G7 | important | actor `status` badge: `lock` / `waiting` / `busy` (Unit I locks) |
| G8 | important | Path grammar incl. `[id]` and `@ts/@node/@tags/@tomb` so highlights can point at sidecar |
| G9 | important | `Meta` needs `addTs`/`removeTs` (LWW-Element-Set) — or a generic `extra` bag |
| G10 | important | No-op visibility: reducer auto-marks `unchanged` when a `crdt.*` command changes nothing |
| G11 | important | `send`/`crdt.send` carry `size` (bytes) for the cost-of-state topic; envelope drawn proportionally |
| G12 | important | multi-recipient `send` needs per-recipient message ids (`m1:bob`, `m1:carol`) |
| G13 | nice | actor `icon` (phone/laptop/tablet/cloud) independent of `kind`; `owner` for "Alice's phone" |
| G14 | nice | scene clock config `{now, visible, format:'int'|'ms'|'hh:mm'}` |
| G15 | nice | `deliver … outcome:'reject'` (bounce) so a server can refuse a write |
| G16 | nice | marks need ids; `unmark id` (remove one sticky callout without `clearMarks`) |
| G17 | nice | `highlight` should accept an `ActorId` like `callout` does |
| G18 | nice | stable item order in `toValue()` for sets/counters (no reshuffle on merge) — a reducer contract |
| G19 | nice | `tryIt` declaration per scene (which ops the sandbox exposes) — open question 4 |
| P1 | pedagogy | add a tiny `max-register` CRDT to `src/crdt/` for II.1 (three laws with one number) |

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
in any order. The name stands for Conflict-free Replicated Data Type. *Eventual consistency* —
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

### II.1 `the-shape-of-a-state-crdt`

**Goal.** Learn the shape every state-based CRDT has: a local state, local updates, and a `merge`
that is commutative, associative, and idempotent — shown with one number.

**When to use (state-based in general)**
- the network may duplicate, reorder, or delay messages and you want to stop caring;
- peers can exchange whole states cheaply (small data, or infrequent sync);
- you want the simplest possible protocol: "send me what you have".

**When not to use**
- the state is large and changes often (Unit II.11, then Unit III);
- you need the *history* of operations, not just the latest merged state.

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
- two people often edit the *same* field at once and both edits matter;
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
