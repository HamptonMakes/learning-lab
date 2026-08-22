# Units III & IV — lesson scripts + DSL stress test (v0)

Scope: **Unit III — Operation-based CRDTs** and **Unit IV — Vector clocks & causality**.
This document is (a) a complete draft of every step's narration and commands, and (b) a list of
what the v0 DSL (`docs/animation-dsl.md`) cannot express yet. Content authors take the scripts;
the stage/lesson engineers take §C (gaps) and §D (ergonomics).

Everything here obeys `CLAUDE.md` §4–§5: lessons are data, no timings/pixels, 1–2 sentences of
narration per step, every step is a legible static frame, CRDT state is computed by the real
implementation, stable step ids.

---

## A. Conventions used in this document

### A.1 Step notation

Each scene is one code block. Each step is:

```
s01  say: "Narration. One or two short sentences."
     { t:'command', … }
     { t:'command', … }            // NEW  ← command or field not in the v0 DSL; see §C
```

Commands are written in the v0 TypeScript-literal syntax. Lines marked `// NEW` use a proposed
command or field. `hold:'long'` is noted on "Whoops" steps. Everything else uses the default hold.

### A.2 Ids and paths (proposed rules; the implementation must follow them so authors can predict ids)

| Thing                                   | Format                                                                                                                                                                                          | Example                  |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| Op id (op-based types, RGA element ids) | `<node>:<seq>` — `seq` is a dense per-node sequence (1, 2, 3 …, one per op from that node). RGA elements additionally carry `meta.ts`, a Lamport time stamp used only for the insert tie-break. | `alice:3`                |
| Message from `crdt.broadcast`           | `<opId>@<recipient>` (one message per recipient). With exactly two actors the `@…` suffix may be omitted. Author may override with `id`.                                                        | `alice:3@bob`            |
| Message from `send`                     | author-given `id`                                                                                                                                                                               | `m1`                     |
| Path                                    | `actor.slot[.field…]`, list/set items by id in brackets                                                                                                                                         | `bob.doc.items[alice:2]` |
| Vector clock in narration               | `{alice 2, bob 1}` (plain words; the stage draws the real thing)                                                                                                                                |                          |

### A.3 Where time comes from (proposed rule — the v0 draft leaves it implicit)

- `crdt.update` on a timestamped type (LWW, HLC) reads **wall time = `world.clock` + actor skew**
  (skew defaults to 0; see `skew` NEW in §C). `tick` advances `world.clock`.
- Op-based types keep a per-replica sequence counter for op ids; RGA additionally keeps a Lamport counter for `meta.ts`. Authors never pass either.
- Clocks (Lamport / vector / HLC) are real implementations in `src/crdt/clocks/` and are driven by
  the same `crdt.*` commands: `crdt.update … op:'tick'`, `crdt.broadcast` stamps, `crdt.apply`
  runs the receive rule.

### A.4 Sidecar metadata the renderer must draw (all through `Value.meta`, via each type's `toValue()`)

| Type                   | Sidecar shown                                                                                                  |
| ---------------------- | -------------------------------------------------------------------------------------------------------------- |
| op-counter             | per-actor list of **applied op ids** (dedupe set)                                                              |
| op-or-set              | per item: the set of **tags** (`alice:1`), each tag is an op id                                                |
| rga                    | per item: **id** (`node:seq`), **ts** (Lamport time stamp), **tombstone**; list-level `live` / `dead` / `seen` |
| lamport / vector / hlc | the clock value itself (`clock` Value kind, or `record {wall, c}` for HLC)                                     |
| mv-register (Unit IV)  | per sibling: its **version vector** (`Meta.vc` NEW)                                                            |
| lww-register (reused)  | `ts`, `node`                                                                                                   |

### A.5 Topic list for this slice (changes vs. `outline.md` are marked)

| Id                                | Title                                             | Change                                                                                                                                         |
| --------------------------------- | ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| III.1 `ops-instead-of-state`      | Ops instead of state                              | 3 scenes (wire, exactly-once, causal order). If runtime is too long, split scene C into a topic `causal-delivery`.                             |
| III.2 `every-device-needs-a-name` | Every device needs a name                         | In-context scene covers III.1 + III.2 ("the op envelope").                                                                                     |
| III.3 `op-counter`                | Op-based counter                                  | —                                                                                                                                              |
| III.4 `op-or-set`                 | Op-based OR-Set                                   | —                                                                                                                                              |
| III.5 `sequences-rga`             | Sequences (RGA)                                   | —                                                                                                                                              |
| III.6 `in-context-collab-text`    | In context: collaborative text + todo list        | 2 scenes; adds the "concurrent move duplicates an item" moment.                                                                                |
| III.7 `tombstones-and-garbage`    | Tombstones and garbage                            | Ends with a forward link to Unit IV (stability needs clocks).                                                                                  |
| IV.1 `wall-clocks-lie`            | Wall clocks lie                                   | —                                                                                                                                              |
| IV.2 `lamport-clocks`             | Lamport clocks                                    | —                                                                                                                                              |
| IV.3 `vector-clocks`              | Vector clocks                                     | —                                                                                                                                              |
| IV.4 `detecting-conflicts`        | Detecting conflicts: siblings and the MV-Register | **Adds** the Multi-Value Register as a named data type (it is the data type that _holds_ siblings). Needs a real `mv-register` in `src/crdt/`. |
| IV.5 `hybrid-logical-clocks`      | Hybrid logical clocks (brief)                     | 2 short scenes.                                                                                                                                |
| IV.6 `in-context-notes-sync`      | In context: a notes app that syncs                | Module-level synthesis: LWW-map (II) + OR-Set (III) + vector clock & HLC (IV).                                                                 |

---

## B. Lesson scripts

## Unit III — Operation-based CRDTs (send what you did)

Unit-level note: from III.3 on, every data type is driven by `crdt.*` and the real implementation
computes state. III.1 and III.2 deliberately use plain values and `set`/`insert`, because they teach
_the wire_, not a type; they also show a **broken** naive approach, which no real CRDT could compute.

---

### III.1 `ops-instead-of-state` — Ops instead of state

**Goal.** An op-based CRDT sends the operation, not the state; this only works if every op arrives
exactly once and in causal order.

**When to use**

- Ops are small and the state is big (long documents, long lists).
- You have, or can build, a reliable channel: a sync server, a log, a queue with dedupe.
- Edits are frequent and tiny (typing, dragging).
- You want "who did what" for free — the op log is an audit trail.

**When not to use**

- The network can duplicate or reorder and you cannot add op ids and buffering — send state instead; merge is idempotent.
- Replicas can be offline for a very long time — op logs grow; a state blob is one message.
- New replicas must join cheaply — a state snapshot is simpler (real systems do snapshot + ops).
- The type's ops do not commute and you cannot add causal metadata.

**Real-world anchor.** Figma multiplayer sends property-change ops through a server; Yjs and
Automerge sync by exchanging ops (plus a state snapshot for a new peer).

#### Scene A — What goes on the wire (`layout:'pair'`)

World: `alice` (person, a), `bob` (person, b). Both hold `doc` = record
`{ title: 'Groceries', items: list[milk, eggs, bread, apples, rice, tea] }` (plain values).

```
s01  say: "Alice and Bob each hold a copy of the same list. Six items and a title."
     { t:'highlight', path:['alice.doc','bob.doc'] }
s02  say: "Alice adds one item: butter."
     { t:'insert', path:'alice.doc.items', index:6, item:{ id:'butter', value:{ kind:'scalar', value:'butter' } } }
s03  say: "State-based (Unit II): Alice sends her whole list. Seven items travel for one change."
     { t:'send', from:'alice', to:'bob', payload:{ ref:'alice.doc' }, id:'state1', label:'whole state' }
s04  say: "Bob merges. It works, but the message was big. (Simplified: his list was equal, so merge = copy.)"
     { t:'deliver', message:'state1', into:'bob.doc' }
     { t:'callout', at:'bob.doc', text:'7 items on the wire for 1 change' }
s05  say: "Rewind Bob to before the change. Now the same edit, operation-based."
     { t:'clearMarks' }
     { t:'delete', path:'bob.doc.items', id:'butter' }
s06  say: "Alice sends only what she did: add butter."
     { t:'send', from:'alice', to:'bob', payload:{ kind:'scalar', value:'add(butter)' }, id:'op1', label:'op' }
s07  say: "Bob applies the op. Same result, tiny message."
     { t:'deliver', message:'op1' }
     { t:'insert', path:'bob.doc.items', index:6, item:{ id:'butter', value:{ kind:'scalar', value:'butter' } } }
     { t:'check', path:'bob.doc.items[butter]' }
s08  say: "That is the whole idea: send what you did, not what you have. Now the catch."
     { t:'callout', at:'alice', text:'send ops, not state', sticky:true }
s09  say: "Two things must be true. Every op must arrive exactly once, and in the right order."
     { t:'callout', at:'bob', text:'1. exactly once   2. causal order', sticky:true }
```

#### Scene B — Exactly once (`layout:'pair'`)

World: `alice`, `bob`; both hold `likes` = scalar `0`. This is a **naive** op counter (the op is "+1").

```
s01  say: "A naive op-based counter. The op is just 'add 1'."
     { t:'highlight', path:['alice.likes','bob.likes'] }
s02  say: "Alice taps like. Her count is 1."
     { t:'set', path:'alice.likes', value:1 }
s03  say: "She sends the op to Bob."
     { t:'send', from:'alice', to:'bob', payload:{ kind:'scalar', value:'+1' }, id:'op1', label:'+1' }
s04  say: "The network is slow. Alice's app retries and sends the same op again."
     { t:'send', from:'alice', to:'bob', payload:{ kind:'scalar', value:'+1' }, id:'op1-retry', label:'+1 (retry)' }
     // better: { t:'duplicate', message:'op1', id:'op1-retry', label:'retry' }   // NEW — draws a copy of an in-flight message
s05  say: "Both copies arrive. Bob applies both."
     { t:'deliver', message:'op1' }
     { t:'set', path:'bob.likes', value:1 }
     { t:'deliver', message:'op1-retry' }
     { t:'set', path:'bob.likes', value:2 }
s06  say: "Whoops — Bob says 2, Alice says 1. One tap became two."    hold:'long'
     { t:'conflict', a:'alice.likes', b:'bob.likes' }
s07  say: "The fix: give every op an id. Bob writes down the ids he has applied."
     { t:'clearMarks' }
     { t:'set', path:'bob.likes', value:0 }
     { t:'set', path:'bob.seen', value:{ kind:'set', items:[] } }
     { t:'callout', at:'bob.seen', text:'applied op ids' }
s08  say: "Same op, same id alice:1, sent twice."
     { t:'send', from:'alice', to:'bob', payload:{ kind:'scalar', value:'+1', meta:{ tag:'alice:1' } }, id:'op2', label:'alice:1' }
     { t:'duplicate', message:'op2', id:'op2-retry', label:'retry' }   // NEW (v0 fallback: a second identical send)
s09  say: "The first copy arrives. Bob has not seen alice:1, so he applies it and records the id."
     { t:'deliver', message:'op2' }
     { t:'set', path:'bob.likes', value:1 }
     { t:'insert', path:'bob.seen', index:0, item:{ id:'alice:1', value:{ kind:'scalar', value:'alice:1' } } }
s10  say: "The second copy arrives. Bob has seen alice:1. He ignores it."
     { t:'deliver', message:'op2-retry' }
     { t:'highlight', path:'bob.seen[alice:1]', tone:'warn' }
     { t:'callout', at:'bob', text:'duplicate — ignored' }
s11  say: "Both say 1. 'Exactly once' is really 'at least once, and ignore duplicates'."
     { t:'check', path:'alice.likes' }
     { t:'check', path:'bob.likes' }
s12  say: "Every op-based CRDT needs this. The op id is the ticket."
     { t:'callout', at:'bob.seen', text:'op id = the ticket', sticky:true }
```

#### Scene C — In the right order (`layout:'pair'`)

World: `alice`, `bob`; both hold `list` = set `[]` (plain).

```
s01  say: "Both lists are empty. Two ops are about to travel."
s02  say: "Alice adds milk. That is op 1."
     { t:'insert', path:'alice.list', index:0, item:{ id:'milk', value:{ kind:'scalar', value:'milk' } } }
     { t:'send', from:'alice', to:'bob', payload:{ kind:'scalar', value:'add(milk)' }, id:'op1', label:'1: add milk' }
s03  say: "Alice changes her mind and removes milk. That is op 2."
     { t:'delete', path:'alice.list', id:'milk' }
     { t:'send', from:'alice', to:'bob', payload:{ kind:'scalar', value:'remove(milk)' }, id:'op2', label:'2: remove milk' }
s04  say: "The network does not promise order. Op 2 overtakes op 1."
     { t:'deliver', message:'op2' }
     { t:'callout', at:'bob', text:'nothing to remove' }
s05  say: "Now op 1 arrives. Bob adds milk."
     { t:'deliver', message:'op1' }
     { t:'insert', path:'bob.list', index:0, item:{ id:'milk', value:{ kind:'scalar', value:'milk' } } }
s06  say: "Whoops — Alice has no milk, Bob has milk. They will never agree."    hold:'long'
     { t:'conflict', a:'alice.list', b:'bob.list' }
s07  say: "The fix: Bob waits. He parks an op until the ops it depends on have arrived."
     { t:'clearMarks' }
     { t:'delete', path:'bob.list', id:'milk' }
     { t:'callout', at:'bob', text:'causal delivery', sticky:true }
s08  say: "Same two ops, same bad order. This time each op says what it comes after."
     { t:'send', from:'alice', to:'bob', payload:{ kind:'scalar', value:'add(milk)', meta:{ tag:'alice:1' } }, id:'op3', label:'alice:1' }
     { t:'send', from:'alice', to:'bob', payload:{ kind:'scalar', value:'remove(milk)', meta:{ tag:'alice:2', note:'after alice:1' } }, id:'op4', label:'alice:2 (after alice:1)' }
s09  say: "Op alice:2 arrives first. Bob has not seen alice:1, so he parks it."
     { t:'deliver', message:'op4', park:true }   // NEW — lands in Bob's inbox tray, not applied
s10  say: "Op alice:1 arrives. Bob applies it: milk is added."
     { t:'deliver', message:'op3' }
     { t:'insert', path:'bob.list', index:0, item:{ id:'milk', value:{ kind:'scalar', value:'milk' } } }
s11  say: "Now the parked op can run. Milk is removed."
     { t:'deliver', message:'op4' }   // NEW semantics — second deliver of a parked message applies it
     { t:'delete', path:'bob.list', id:'milk' }
s12  say: "Both lists are empty. Both agree. An op runs only after the ops it depends on."
     { t:'check', path:'alice.list' }
     { t:'check', path:'bob.list' }
s13  say: "Op ids, dedupe, and causal delivery are the price of sending ops. Real systems pay it with a server log or a sync protocol."
     { t:'callout', at:'bob', text:'ids + dedupe + causal order', sticky:true }
```

---

### III.2 `every-device-needs-a-name` — Every device needs a name

**Goal.** Each replica needs a unique, stable node id; each op gets an id `(node, counter)`; node ids
come from a coordinator or from random bits (UUID).

**When to use (which id strategy)**

- `(node, counter)` op ids when one node's ops are sequential: cheap, sortable, and a gap reveals a missing op.
- Random 128-bit node ids (UUID v4) when devices must start offline with no server.
- Server-assigned short ids when every device registers first and you want small metadata.
- A new id for every fresh install. Never the same id on two devices.

**When not to use**

- Not the user id — one user has many devices.
- Not hostnames, IPs, or phone numbers — they change and they repeat.
- Not small random numbers — 53 random bits (Yjs) is the floor; 122 (UUID v4) is comfortable.
- Do not restart the counter at 1 after a reinstall unless the node id also changes.

**Real-world anchor.** Automerge actor ids are 128 random bits; Yjs `clientID` is a random 53-bit
integer; Cassandra gives every host a UUID.

#### Scene A — Same name, big trouble (`layout:'hub'`)

World: `alice` (device, a, label "Phone"), `bob` (device, b, label "Phone"), `server` (server).
`alice`/`bob` hold `node` = scalar `'phone'`, `counter` = scalar `0`. `server` holds `likes` = scalar `0`,
`seen` = set `[]`.

```
s01  say: "Two phones. Both call themselves 'phone'. Both count likes on the same post."
     { t:'highlight', path:['alice.node','bob.node'], tone:'warn' }
s02  say: "Alice taps like. Her op id is phone:1."
     { t:'set', path:'alice.counter', value:1 }
     { t:'send', from:'alice', to:'server', payload:{ kind:'scalar', value:'+1', meta:{ tag:'phone:1' } }, id:'a1', label:'phone:1' }
s03  say: "Bob taps like too. His op id is also phone:1."
     { t:'set', path:'bob.counter', value:1 }
     { t:'send', from:'bob', to:'server', payload:{ kind:'scalar', value:'+1', meta:{ tag:'phone:1' } }, id:'b1', label:'phone:1' }
s04  say: "The server applies Alice's op and remembers phone:1."
     { t:'deliver', message:'a1' }
     { t:'set', path:'server.likes', value:1 }
     { t:'insert', path:'server.seen', index:0, item:{ id:'phone:1', value:{ kind:'scalar', value:'phone:1' } } }
s05  say: "Bob's op arrives with the same id. The server thinks it is a duplicate and drops it."
     { t:'deliver', message:'b1' }
     { t:'highlight', path:'server.seen[phone:1]', tone:'warn' }
     { t:'callout', at:'server', text:'"duplicate" — ignored', tone:'bad' }
s06  say: "Whoops — two taps became one like. A real tap was thrown away."    hold:'long'
     { t:'cross', path:'server.likes' }
s07  say: "The fix: every device gets its own name. This phone is alice, that one is bob."
     { t:'clearMarks' }
     { t:'set', path:'alice.node', value:'alice' }
     { t:'set', path:'bob.node', value:'bob' }
s08  say: "Rewind the server. Now the op ids differ: alice:1 and bob:1."
     { t:'set', path:'server.likes', value:0 }
     { t:'set', path:'server.seen', value:{ kind:'set', items:[] } }
     { t:'send', from:'alice', to:'server', payload:{ kind:'scalar', value:'+1', meta:{ tag:'alice:1' } }, id:'a2', label:'alice:1' }
     { t:'send', from:'bob',   to:'server', payload:{ kind:'scalar', value:'+1', meta:{ tag:'bob:1' } },   id:'b2', label:'bob:1' }
s09  say: "Alice's op: new id, applied."
     { t:'deliver', message:'a2' }
     { t:'set', path:'server.likes', value:1 }
     { t:'insert', path:'server.seen', index:0, item:{ id:'alice:1', value:{ kind:'scalar', value:'alice:1' } } }
s10  say: "Bob's op: also a new id, applied. Two taps, two likes."
     { t:'deliver', message:'b2' }
     { t:'set', path:'server.likes', value:2 }
     { t:'insert', path:'server.seen', index:1, item:{ id:'bob:1', value:{ kind:'scalar', value:'bob:1' } } }
     { t:'check', path:'server.likes' }
s11  say: "A node id must be unique and must never change. Everything else in this unit leans on it."
     { t:'callout', at:'server', text:'unique + stable node id', sticky:true }
```

#### Scene B — Op id = (node, counter) (`layout:'pair'`)

World: `alice`, `bob`; each holds `counter` = scalar `0` and `log` = list `[]`. `bob` also holds `inbox` = list `[]`.

```
s01  say: "Each device keeps its own counter. Every new op takes the next number."
     { t:'highlight', path:['alice.counter','bob.counter'] }
s02  say: "Alice makes three ops: alice:1, alice:2, alice:3."
     { t:'set', path:'alice.counter', value:3 }
     { t:'insert', path:'alice.log', index:0, item:{ id:'alice:1', value:{ kind:'scalar', value:'alice:1' } } }
     { t:'insert', path:'alice.log', index:1, item:{ id:'alice:2', value:{ kind:'scalar', value:'alice:2' } } }
     { t:'insert', path:'alice.log', index:2, item:{ id:'alice:3', value:{ kind:'scalar', value:'alice:3' } } }
s03  say: "Bob makes two ops: bob:1, bob:2."
     { t:'set', path:'bob.counter', value:2 }
     { t:'insert', path:'bob.log', index:0, item:{ id:'bob:1', value:{ kind:'scalar', value:'bob:1' } } }
     { t:'insert', path:'bob.log', index:1, item:{ id:'bob:2', value:{ kind:'scalar', value:'bob:2' } } }
s04  say: "Five ops, five different ids. Two devices can never collide, because the node part differs."
     { t:'highlight', path:['alice.log','bob.log'] }
s05  say: "The counter does a second job. Bob receives alice:1 and alice:3."
     { t:'send', from:'alice', to:'bob', payload:{ ref:'alice.log[alice:1]' }, id:'m1', label:'alice:1' }
     { t:'send', from:'alice', to:'bob', payload:{ ref:'alice.log[alice:3]' }, id:'m3', label:'alice:3' }
     { t:'deliver', message:'m1', into:'bob.inbox' }
     { t:'deliver', message:'m3', into:'bob.inbox' }
s06  say: "Bob sees a gap: alice:2 is missing. He knows to wait, or to ask for it."
     { t:'callout', at:'bob.inbox', text:'alice:2 missing', tone:'warn' }
s07  say: "alice:2 arrives. Now Bob has a full run, 1 2 3, and can apply them in order."
     { t:'send', from:'alice', to:'bob', payload:{ ref:'alice.log[alice:2]' }, id:'m2', label:'alice:2' }
     { t:'deliver', message:'m2', into:'bob.inbox' }
     { t:'move', path:'bob.inbox', id:'alice:2', to:1 }
     { t:'check', path:'bob.inbox' }
s08  say: "Node id plus counter is the op id used by every type in this unit. Some papers call it a dot."
     { t:'callout', at:'bob.inbox', text:'op id = (node, counter) — a "dot"', sticky:true }
```

#### Scene C — Where do names come from? (`layout:'hub'`)

World: `server` (server), `laptop` (device, a, label "Laptop"), `phone` (device, b, label "Phone").
`laptop` and `phone` hold `node` = scalar `null`.

```
s01  say: "Option 1: a server hands out names. The laptop connects and asks."
     { t:'send', from:'laptop', to:'server', payload:{ kind:'scalar', value:'name?' }, id:'ask' }
s02  say: "The server replies: you are node 7. Short and unique — but you needed a connection first."
     { t:'deliver', message:'ask' }
     { t:'send', from:'server', to:'laptop', payload:{ kind:'scalar', value:7 }, id:'reply', label:'node 7' }
     { t:'deliver', message:'reply', into:'laptop.node' }
s03  say: "Option 2: the device picks a random name by itself. No server needed."
     { t:'offline', actor:'phone' }
s04  say: "This phone rolls 122 random bits. That is a UUID version 4."
     { t:'set', path:'phone.node', value:{ kind:'bytes', bytes:[0x9f,0x3a,0x11,0x6c,0x2b,0x8e,0x4d,0x71,0xa5,0x0c,0x7e,0x19,0xd2,0x44,0x9b,0x03],
         annotations:[{ from:6, to:7, label:'version 4', tone:'accent' }, { from:8, to:9, label:'variant', tone:'accent' }] } }
s05  say: "Two devices rolling the same UUID is so unlikely that we treat it as impossible."
     { t:'callout', at:'phone.node', text:'2^122 possible names' }
s06  say: "Automerge uses 128 random bits. Yjs uses a random 53-bit number. Both are option 2."
     { t:'callout', at:'phone', text:'Automerge: 128 bits · Yjs: 53 bits' }
s07  say: "Pick a name once, store it, never change it. The UUID module explains the bits."
     { t:'online', actor:'phone' }
     { t:'check', path:'phone.node' }
     // narration link to /uuids/v4 — NEW: inline link syntax in `say` (see §C)
```

#### Scene D — In context: the op envelope (`layout:'hub'`)

Uses III.1 + III.2 together. World: `alice` (device, a, "Phone"), `bob` (device, b, "Laptop"),
`server`. `alice`/`bob` hold `list` = set `[eggs]`. `server` holds `log` = list `[alice:1, alice:2, alice:3]`
(earlier envelopes, collapsed as ids).

```
s01  say: "A notes app. Phone and laptop sync through a relay server. Every change travels in an envelope."
     { t:'highlight', path:'server.log' }
s02  say: "Alice adds milk. The envelope says: id alice:4, after alice:3, op add(milk)."
     { t:'insert', path:'alice.list', index:1, item:{ id:'milk', value:{ kind:'scalar', value:'milk' } } }
     { t:'send', from:'alice', to:'server', id:'e4', label:'alice:4',
       payload:{ kind:'record', fields:[ { key:'id', value:{ kind:'scalar', value:'alice:4' } }, { key:'after', value:{ kind:'scalar', value:'alice:3' } }, { key:'op', value:{ kind:'scalar', value:'add(milk)' } } ] } }
s03  say: "The server logs it. It already has alice:1 to alice:3, so alice:4 is next — no gap."
     { t:'deliver', message:'e4', into:'server.log' }
s04  say: "The server forwards the envelope to the laptop."
     { t:'send', from:'server', to:'bob', payload:{ ref:'server.log[alice:4]' }, id:'e4b', label:'alice:4' }
s05  say: "The phone lost signal and retries. The server gets alice:4 again: a duplicate, ignored."
     { t:'send', from:'alice', to:'server', payload:{ ref:'server.log[alice:4]' }, id:'e4r', label:'alice:4 (retry)' }
     { t:'deliver', message:'e4r' }
     { t:'callout', at:'server', text:'seen alice:4 — ignored' }
s06  say: "The laptop applies alice:4 and adds milk."
     { t:'deliver', message:'e4b' }
     { t:'insert', path:'bob.list', index:1, item:{ id:'milk', value:{ kind:'scalar', value:'milk' } } }
s07  say: "Bob removes milk on the laptop. Envelope bob:2, after alice:4."
     { t:'delete', path:'bob.list', id:'milk' }
     { t:'send', from:'bob', to:'server', id:'e5', label:'bob:2',
       payload:{ kind:'record', fields:[ { key:'id', value:{ kind:'scalar', value:'bob:2' } }, { key:'after', value:{ kind:'scalar', value:'alice:4' } }, { key:'op', value:{ kind:'scalar', value:'remove(milk)' } } ] } }
s08  say: "The server has alice:4, so bob:2 is safe to log and forward."
     { t:'deliver', message:'e5', into:'server.log' }
     { t:'send', from:'server', to:'alice', payload:{ ref:'server.log[bob:2]' }, id:'e5a', label:'bob:2' }
s09  say: "The phone applies it. Milk is gone on both."
     { t:'deliver', message:'e5a' }
     { t:'delete', path:'alice.list', id:'milk' }
     { t:'check', path:'alice.list' }
     { t:'check', path:'bob.list' }
s10  say: "Id, dependency, op. That envelope is the heart of every op-based system."
     { t:'highlight', path:'server.log', sticky:true }
     { t:'callout', at:'server.log', text:'{ id, after, op }', sticky:true }
```

---

### III.3 `op-counter` — Op-based counter

**Goal.** An op-based counter broadcasts `+1`/`−1` ops; increments commute, so any delivery order gives
the same total; only duplicates must be stopped.

**When to use**

- Likes, votes, view counts, tallies — anything that is a stream of `+n` / `−n` events.
- Many writers, no need for an instantly exact global number.
- You already have op ids + dedupe (III.1).
- Ops are tiny and you do not want to ship a per-node map each time.

**When not to use**

- Limits and quotas (stock ≥ 0, a balance) — a counter cannot refuse; two `−1`s can cross zero.
- "The count as of right now, everywhere" — there is no global now.
- Duplicates cannot be detected (no op ids) — use a state-based G/PN-Counter instead.
- Reset to zero — `reset` does not commute with `+1`; it needs a special design.

**Real-world anchor.** Emoji reaction counts on a chat message (Slack, Discord); Redis Enterprise
active-active counters; YouTube view counts (eventually consistent).

**Sidecar / `toValue()`.** `op-counter` renders as
`record { count: scalar, applied: set[op ids] }`, so the dedupe set is addressable
(`carol.likes.applied[bob:1]`). The actor's **outbox** (ops updated but not yet broadcast) is drawn as
small chips next to the actor (NEW renderer behavior; see §C).

#### Scene A — Increments commute (`layout:'triangle'`)

World: `alice`, `bob`, `carol` (persons a/b/c).

```
s01  say: "Three devices share a like counter. Each holds its own copy."
     { t:'crdt.init', actors:['alice','bob','carol'], slot:'likes', type:'op-counter' }
s02  say: "Alice taps like twice. Her copy says 2. Two ops wait to be sent: alice:1 and alice:2."
     { t:'crdt.update', actor:'alice', slot:'likes', op:'inc', args:[] }
     { t:'crdt.update', actor:'alice', slot:'likes', op:'inc', args:[] }
s03  say: "Bob taps like once: bob:1."
     { t:'crdt.update', actor:'bob', slot:'likes', op:'inc', args:[] }
s04  say: "Everyone broadcasts. Six small messages are in flight."
     { t:'crdt.broadcast', from:'alice', slot:'likes' }     // → alice:1@bob, alice:1@carol, alice:2@bob, alice:2@carol
     { t:'crdt.broadcast', from:'bob',   slot:'likes' }     // → bob:1@alice, bob:1@carol
s05  say: "Carol gets Bob's op first, then Alice's two. Carol: 3."
     { t:'crdt.apply', message:'bob:1@carol' }
     { t:'crdt.apply', message:'alice:1@carol' }
     { t:'crdt.apply', message:'alice:2@carol' }
s06  say: "Bob gets Alice's ops in the opposite order: alice:2, then alice:1. Bob: 3."
     { t:'crdt.apply', message:'alice:2@bob' }
     { t:'crdt.apply', message:'alice:1@bob' }
s07  say: "Alice gets Bob's op. Alice: 3."
     { t:'crdt.apply', message:'bob:1@alice' }
s08  say: "Everyone says 3. Order did not matter: 1 + 1 + 1 is the same in any order."
     { t:'check', path:'alice.likes.count' }
     { t:'check', path:'bob.likes.count' }
     { t:'check', path:'carol.likes.count' }
s09  say: "Each copy remembers the op ids it applied. That set is the sidecar for this type."
     { t:'highlight', path:['alice.likes.applied','bob.likes.applied','carol.likes.applied'], sticky:true }
```

#### Scene B — Minus works too (`layout:'pair'`)

World: `alice`, `bob`.

```
s01  say: "A like can be undone. The op is −1, and it commutes too."
     { t:'crdt.init', actors:['alice','bob'], slot:'likes', type:'op-counter' }
s02  say: "Alice likes, Bob likes. Both broadcast."
     { t:'crdt.update', actor:'alice', slot:'likes', op:'inc', args:[] }
     { t:'crdt.update', actor:'bob',   slot:'likes', op:'inc', args:[] }
     { t:'crdt.broadcast', from:'alice', slot:'likes' }     // alice:1
     { t:'crdt.broadcast', from:'bob',   slot:'likes' }     // bob:1
s03  say: "Alice changes her mind: −1. That is op alice:2. She broadcasts it."
     { t:'crdt.update', actor:'alice', slot:'likes', op:'dec', args:[] }
     { t:'crdt.broadcast', from:'alice', slot:'likes' }     // alice:2
s04  say: "Bob receives alice:2 (−1) before alice:1 (+1). His count dips to 0 for a moment."
     { t:'crdt.apply', message:'alice:2' }
     { t:'highlight', path:'bob.likes.count', tone:'warn' }
s05  say: "Then alice:1 arrives. Bob is back at 1."
     { t:'crdt.apply', message:'alice:1' }
s06  say: "Alice receives bob:1. Alice: 1."
     { t:'crdt.apply', message:'bob:1' }
s07  say: "Both end at 1. The dip on Bob's screen was real. Counters can wobble before they settle."
     { t:'check', path:'alice.likes.count' }
     { t:'check', path:'bob.likes.count' }
s08  say: "Careful: a −1 can push one screen below zero. A counter cannot enforce a limit."
     { t:'callout', at:'bob.likes', text:'no limits — counters only add', tone:'warn', sticky:true }
```

#### Scene C — The sidecar shrinks (`layout:'pair'`)

World: `alice`, `bob`. Shows that the dedupe set compacts to per-node high-water marks — the same
metadata as a G-Counter (Unit II). Needs a real `compact()` on the implementation.

```
s01  say: "Alice taps five times and broadcasts. Bob applies five ops: alice:1 to alice:5."
     { t:'crdt.init', actors:['alice','bob'], slot:'likes', type:'op-counter' }
     { t:'crdt.update', actor:'alice', slot:'likes', op:'inc', args:[] }
     { t:'crdt.update', actor:'alice', slot:'likes', op:'inc', args:[] }
     { t:'crdt.update', actor:'alice', slot:'likes', op:'inc', args:[] }
     { t:'crdt.update', actor:'alice', slot:'likes', op:'inc', args:[] }
     { t:'crdt.update', actor:'alice', slot:'likes', op:'inc', args:[] }
     { t:'crdt.broadcast', from:'alice', slot:'likes' }
     { t:'crdt.apply', message:'alice:1' }
     { t:'crdt.apply', message:'alice:2' }
     { t:'crdt.apply', message:'alice:3' }
     { t:'crdt.apply', message:'alice:4' }
     { t:'crdt.apply', message:'alice:5' }
s02  say: "Five ids in Bob's applied set. That set grows with every op, forever."
     { t:'highlight', path:'bob.likes.applied', tone:'warn' }
s03  say: "Ops from one node arrive in counter order. So 'alice up to 5' says the same thing as five ids."
     { t:'callout', at:'bob.likes.applied', text:'alice:1…5  ⇒  alice ≤ 5' }
s04  say: "Bob compacts: one number per node instead of one id per op."
     { t:'crdt.update', actor:'bob', slot:'likes', op:'compact', args:[] }    // NEW op: applied set → per-node high-water marks
s05  say: "Look familiar? One number per node is exactly the G-Counter from Unit II."
     { t:'callout', at:'bob.likes.applied', text:'= G-Counter metadata', sticky:true }
s06  say: "Op-based and state-based are two views of one idea. The sidecar tells you which one you are looking at."
     { t:'check', path:'bob.likes' }
```

#### Scene D — In context: a team poll (`layout:'triangle'`)

Composed document (needs the `schema` form of `crdt.init` — NEW, §C). World: `alice` (Phone),
`bob` (Laptop), `carol` (Tablet).

```
s01  say: "A team poll on three devices: two options, two counters."
     { t:'crdt.init', actors:['alice','bob','carol'], slot:'poll', type:'doc',            // NEW
       schema:{ question:{ type:'const', value:'Lunch?' }, pizza:'op-counter', sushi:'op-counter' } }
s02  say: "Alice votes pizza. Bob votes sushi. Carol votes pizza."
     { t:'crdt.update', actor:'alice', slot:'poll', path:'pizza', op:'inc', args:[] }     // NEW field: path into the doc
     { t:'crdt.update', actor:'bob',   slot:'poll', path:'sushi', op:'inc', args:[] }
     { t:'crdt.update', actor:'carol', slot:'poll', path:'pizza', op:'inc', args:[] }
s03  say: "Carol boards a plane. She goes offline before anything is sent."
     { t:'offline', actor:'carol' }
s04  say: "Alice and Bob broadcast and apply each other's ops. Carol's copies wait at her door."
     { t:'crdt.broadcast', from:'alice', slot:'poll' }     // alice:1@bob, alice:1@carol (queued — carol offline)
     { t:'crdt.broadcast', from:'bob',   slot:'poll' }     // bob:1@alice, bob:1@carol (queued)
     { t:'crdt.apply', message:'alice:1@bob' }
     { t:'crdt.apply', message:'bob:1@alice' }
s05  say: "Alice and Bob see pizza 1, sushi 1. Carol still sees pizza 1, sushi 0."
     { t:'highlight', path:['alice.poll','bob.poll','carol.poll'] }
s06  say: "Bob votes pizza too, and broadcasts. Alice applies."
     { t:'crdt.update', actor:'bob', slot:'poll', path:'pizza', op:'inc', args:[] }
     { t:'crdt.broadcast', from:'bob', slot:'poll' }       // bob:2@alice, bob:2@carol (queued)
     { t:'crdt.apply', message:'bob:2@alice' }
s07  say: "Carol lands and comes online. The queued ops arrive — in a jumbled order."
     { t:'online', actor:'carol' }
     { t:'crdt.apply', message:'bob:2@carol' }
     { t:'crdt.apply', message:'alice:1@carol' }
     { t:'crdt.apply', message:'bob:1@carol' }
s08  say: "Carol broadcasts her own vote. Alice and Bob apply it."
     { t:'crdt.broadcast', from:'carol', slot:'poll' }     // carol:1@alice, carol:1@bob
     { t:'crdt.apply', message:'carol:1@alice' }
     { t:'crdt.apply', message:'carol:1@bob' }
s09  say: "Everyone: pizza 3, sushi 1. Bob's ops even arrived out of order at Carol, and it did not matter."
     { t:'check', path:'alice.poll' }
     { t:'check', path:'bob.poll' }
     { t:'check', path:'carol.poll' }
s10  say: "A counter needs exactly-once but not causal order: every op commutes with every other. That is why counters are the easiest op-based type."
     { t:'callout', at:'carol', text:'exactly-once: yes · causal order: not needed', sticky:true }
```

---

### III.4 `op-or-set` — Op-based OR-Set

**Goal.** `add(e)` creates a unique tag; `remove(e)` removes only the tags the remover has seen. Under
causal delivery a concurrent add and remove end with the element present (add wins), and re-adding
after a remove works.

**When to use**

- Membership people add and remove freely: labels, attendees, collaborators, unordered list items.
- Re-add after remove must work (a 2P-Set cannot).
- "Add wins" is the right answer when two people disagree at the same moment.
- Ops are small: one tag per add, a few tags per remove.

**When not to use**

- Remove must win (bans, revoked permissions) — an OR-Set lets a concurrent add win. Use a remove-wins set or a different design.
- You need order — use RGA (next topic).
- Items have editable fields — compose: OR-Set of ids + a record per id (Scene E).
- You cannot guarantee causal delivery — a remove can arrive before its add and replicas diverge (Scene D).

**Real-world anchor.** Labels on an issue (Linear, GitHub); people in a shared photo album; Riak
sets; Redis active-active sets.

**Sidecar / `toValue()`.** `set` Value; each item `{ id: element, value, tags:[op ids] }`. The
remove op's payload shows the tag list it carries.

#### Scene A — Add makes a tag (`layout:'pair'`)

World: `alice`, `bob`.

```
s01  say: "Alice and Bob share the labels on one task. Both copies are empty."
     { t:'crdt.init', actors:['alice','bob'], slot:'labels', type:'op-or-set' }
s02  say: "Alice adds 'urgent'. The add op carries a fresh tag: alice:1."
     { t:'crdt.update', actor:'alice', slot:'labels', op:'add', args:['urgent'] }
s03  say: "She broadcasts. Bob applies: 'urgent', tag alice:1."
     { t:'crdt.broadcast', from:'alice', slot:'labels' }
     { t:'crdt.apply', message:'alice:1' }
s04  say: "Bob adds 'bug' (tag bob:1). Broadcast; Alice applies."
     { t:'crdt.update', actor:'bob', slot:'labels', op:'add', args:['bug'] }
     { t:'crdt.broadcast', from:'bob', slot:'labels' }
     { t:'crdt.apply', message:'bob:1' }
s05  say: "Every add is unique, even for the same word. Alice adds 'urgent' again: tag alice:2."
     { t:'crdt.update', actor:'alice', slot:'labels', op:'add', args:['urgent'] }
s06  say: "Broadcast. Bob's 'urgent' now has two tags too. One word, two adds, two tags."
     { t:'crdt.broadcast', from:'alice', slot:'labels' }
     { t:'crdt.apply', message:'alice:2' }
s07  say: "The tags are the sidecar. They record which adds this copy has seen."
     { t:'highlight', path:['alice.labels[urgent]','bob.labels[urgent]'], sticky:true }
```

#### Scene B — Remove what you saw (`layout:'pair'`)

World: `alice`, `bob`. Seeded so both hold `urgent{alice:1, alice:2}`, `bug{bob:1}`.

```
s01  say: "Both hold 'urgent' with tags alice:1 and alice:2, and 'bug' with bob:1."
     { t:'crdt.init', actors:['alice','bob'], slot:'labels', type:'op-or-set',
       args:{ seed:[ { by:'alice', op:'add', args:['urgent'] }, { by:'alice', op:'add', args:['urgent'] }, { by:'bob', op:'add', args:['bug'] } ] } }   // proposed `seed` shape
s02  say: "Bob removes 'urgent'. The remove op lists the tags Bob can see: alice:1, alice:2."
     { t:'crdt.update', actor:'bob', slot:'labels', op:'remove', args:['urgent'] }
s03  say: "Broadcast. Alice applies: she removes exactly those two tags. 'urgent' is gone on both."
     { t:'crdt.broadcast', from:'bob', slot:'labels' }     // bob:2
     { t:'crdt.apply', message:'bob:2' }
     { t:'check', path:'alice.labels' }
s04  say: "Alice adds 'urgent' back. Fresh tag alice:3."
     { t:'crdt.update', actor:'alice', slot:'labels', op:'add', args:['urgent'] }
s05  say: "Broadcast; Bob applies. 'urgent' is back with a new tag. Re-add works — unlike the 2P-Set in Unit II."
     { t:'crdt.broadcast', from:'alice', slot:'labels' }   // alice:3
     { t:'crdt.apply', message:'alice:3' }
     { t:'check', path:'bob.labels[urgent]' }
s06  say: "A remove never says 'delete the word'. It says 'delete these tags'. That detail is the whole trick."
     { t:'callout', at:'bob.labels', text:'remove = "delete these tags"', sticky:true }
```

#### Scene C — Add and remove at the same moment (`layout:'pair'`)

World: `alice`, `bob`. Seeded: both hold `eggs{bob:1}`.

```
s01  say: "Both hold 'eggs' with tag bob:1. Now two people act at the same time."
     { t:'crdt.init', actors:['alice','bob'], slot:'list', type:'op-or-set', args:{ seed:[ { by:'bob', op:'add', args:['eggs'] } ] } }
s02  say: "Alice removes eggs. Her op: remove tags {bob:1}."
     { t:'crdt.update', actor:'alice', slot:'list', op:'remove', args:['eggs'] }
s03  say: "At the same moment Bob adds eggs again. His op: add eggs, tag bob:2."
     { t:'crdt.update', actor:'bob', slot:'list', op:'add', args:['eggs'] }
s04  say: "Both broadcast. The two ops cross in the air."
     { t:'crdt.broadcast', from:'alice', slot:'list' }     // alice:1
     { t:'crdt.broadcast', from:'bob',   slot:'list' }     // bob:2
s05  say: "Bob applies Alice's remove: tag bob:1 goes away. Tag bob:2 stays, so eggs stays."
     { t:'crdt.apply', message:'alice:1' }
s06  say: "Alice applies Bob's add: eggs comes back with tag bob:2."
     { t:'crdt.apply', message:'bob:2' }
s07  say: "Both: eggs with tag bob:2. Add wins, and both agree."
     { t:'check', path:'alice.list[eggs]' }
     { t:'check', path:'bob.list[eggs]' }
s08  say: "Alice's remove could only remove what Alice had seen. She never saw bob:2."
     { t:'callout', at:'alice', text:'remove only what you saw' }
s09  say: "This is the add-wins rule. Good for labels and lists. Bad for bans — remember that."
     { t:'callout', at:'bob', text:'add wins ≠ remove wins', tone:'warn', sticky:true }
```

#### Scene D — Why causal delivery matters here (`layout:'triangle'`)

World: `alice`, `bob`, `carol`; empty set.

```
s01  say: "Three copies, all empty. Alice adds milk (alice:1), then removes it (alice:2, tags {alice:1})."
     { t:'crdt.init', actors:['alice','bob','carol'], slot:'list', type:'op-or-set' }
     { t:'crdt.update', actor:'alice', slot:'list', op:'add', args:['milk'] }
     { t:'crdt.update', actor:'alice', slot:'list', op:'remove', args:['milk'] }
s02  say: "She broadcasts both ops."
     { t:'crdt.broadcast', from:'alice', slot:'list' }     // alice:1@bob, alice:1@carol, alice:2@bob, alice:2@carol
s03  say: "Bob gets them in order: add, then remove. Milk comes and goes. Bob: empty."
     { t:'crdt.apply', message:'alice:1@bob' }
     { t:'crdt.apply', message:'alice:2@bob' }
s04  say: "Carol's network is slower on one path. The remove arrives first. She has not seen alice:1, so she parks it."
     { t:'deliver', message:'alice:2@carol', park:true }   // NEW
s05  say: "The add arrives. Carol applies it: milk, tag alice:1."
     { t:'crdt.apply', message:'alice:1@carol' }
s06  say: "Now the parked remove can run. Tag alice:1 is removed. Carol: empty."
     { t:'crdt.apply', message:'alice:2@carol' }
s07  say: "All three agree. Without parking, Carol would have kept milk forever: a remove for a tag you have not seen does nothing."
     { t:'check', path:'alice.list' }
     { t:'check', path:'bob.list' }
     { t:'check', path:'carol.list' }
s08  say: "Rule: an OR-Set needs causal delivery. Tags only make sense if adds arrive before their removes."
     { t:'callout', at:'carol', text:'OR-Set needs causal order', sticky:true }
```

#### Scene E — In context: a shared playlist (`layout:'triangle'`)

Composed: OR-Set of tracks, each track a record with an op-counter. World: `alice`, `bob`, `carol`.
Element id of a set item = the tag of the add that created it (`alice:1`), so paths read
`tracks[alice:1].plays`.

```
s01  say: "A shared playlist on three phones. Tracks are an OR-Set. Each track has a play counter."
     { t:'crdt.init', actors:['alice','bob','carol'], slot:'playlist', type:'doc',   // NEW schema form
       schema:{ tracks:{ type:'op-or-set', of:{ name:'const', plays:'op-counter' } } } }
s02  say: "Alice adds 'Blue Train' (tag alice:1). Broadcast; all apply."
     { t:'crdt.update', actor:'alice', slot:'playlist', path:'tracks', op:'add', args:[{ name:'Blue Train' }] }
     { t:'crdt.broadcast', from:'alice', slot:'playlist' }
     { t:'crdt.apply', message:'alice:1@bob' }
     { t:'crdt.apply', message:'alice:1@carol' }
s03  say: "Bob plays it twice, Carol once. Each play is a +1 op on that track's counter."
     { t:'crdt.update', actor:'bob',   slot:'playlist', path:'tracks[alice:1].plays', op:'inc', args:[] }
     { t:'crdt.update', actor:'bob',   slot:'playlist', path:'tracks[alice:1].plays', op:'inc', args:[] }
     { t:'crdt.update', actor:'carol', slot:'playlist', path:'tracks[alice:1].plays', op:'inc', args:[] }
s04  say: "Broadcast and apply. Everyone: 3 plays."
     { t:'crdt.broadcast', from:'bob',   slot:'playlist' }
     { t:'crdt.broadcast', from:'carol', slot:'playlist' }
     { t:'crdt.apply', message:'bob:1@alice' }   { t:'crdt.apply', message:'bob:2@alice' }   { t:'crdt.apply', message:'carol:1@alice' }
     { t:'crdt.apply', message:'bob:1@carol' }   { t:'crdt.apply', message:'bob:2@carol' }
     { t:'crdt.apply', message:'carol:1@bob' }
s05  say: "Bob goes offline and plays it once more (bob:3). Meanwhile Alice removes the track (tags {alice:1})."
     { t:'offline', actor:'bob' }
     { t:'crdt.update', actor:'bob',   slot:'playlist', path:'tracks[alice:1].plays', op:'inc', args:[] }
     { t:'crdt.update', actor:'alice', slot:'playlist', path:'tracks', op:'remove', args:['alice:1'] }
s06  say: "Alice's remove reaches Carol. The track is gone on both."
     { t:'crdt.broadcast', from:'alice', slot:'playlist' }   // alice:2@bob (queued), alice:2@carol
     { t:'crdt.apply', message:'alice:2@carol' }
s07  say: "Bob comes online. His +1 arrives at a track nobody shows anymore. The hidden counter takes it; the screen does not change."
     { t:'online', actor:'bob' }
     { t:'crdt.broadcast', from:'bob', slot:'playlist' }     // bob:3@alice, bob:3@carol
     { t:'crdt.apply', message:'bob:3@alice' }
     { t:'crdt.apply', message:'bob:3@carol' }
s08  say: "Bob applies Alice's remove. Gone for Bob too. All agree."
     { t:'crdt.apply', message:'alice:2@bob' }
     { t:'check', path:'alice.playlist.tracks' }
     { t:'check', path:'bob.playlist.tracks' }
     { t:'check', path:'carol.playlist.tracks' }
s09  say: "Carol adds 'Blue Train' again (carol:2). It is a new element with a new counter: 0 plays."
     { t:'crdt.update', actor:'carol', slot:'playlist', path:'tracks', op:'add', args:[{ name:'Blue Train' }] }
     { t:'crdt.broadcast', from:'carol', slot:'playlist' }
     { t:'crdt.apply', message:'carol:2@alice' }
     { t:'crdt.apply', message:'carol:2@bob' }
s10  say: "Re-add is a fresh start. If the old count must survive, keep a stable track id and use a 'hidden' flag instead. That is a design choice."
     { t:'callout', at:'carol.playlist.tracks[carol:2]', text:'new element, new counter', sticky:true }
```

---

### III.5 `sequences-rga` — Sequences (RGA)

**Goal.** RGA gives every element a unique id; an insert says "after this id"; a delete leaves a
tombstone; concurrent inserts after the same id are ordered by id — so every replica ends with the
same sequence.

**When to use**

- Ordered data edited concurrently: text, lists of blocks, bullet lists, layer order.
- Inserts anywhere plus deletes, and everyone must agree on the order.
- Many tiny ops (typing) — each op is one element.
- You can live with tombstones, or you have a compaction plan (III.7).

**When not to use**

- Order does not matter — an OR-Set has less metadata.
- Big blobs — RGA is per element; do not RGA a 10 MB string.
- Frequent moves that must not duplicate — plain RGA has no move (III.6 B); use a type with a real move op.
- Rich text (bold spans, comments) — RGA is the base; you need structure on top (e.g. Peritext).

**Real-world anchor.** Google-Docs-style editing; Yjs (YATA, an RGA relative), Automerge `Text`
(RGA), Apple Notes collaboration.

**Sidecar / `toValue()`.** `list` with `display:'text'` (NEW field, §C); item
`{ id:'alice:1', value: scalar 'c', tombstone?, meta:{ node, ts } }`. Element ids are op ids
`node:seq`. Each element also carries `meta.ts`, a Lamport time stamp (always bigger than any stamp the
replica has seen — Unit IV explains why); the tie-break compares `ts`, then node. The head anchor is
the reserved id `head`.

#### Scene A — Positions break (`layout:'pair'`)

World: `alice`, `bob` hold `text` = text `'cat'` (plain). Deliberately naive.

```
s01  say: "Alice and Bob both see 'cat'. The naive plan: send 'insert h at position 1'."
     { t:'highlight', path:['alice.text','bob.text'] }
s02  say: "Alice inserts 'h' at position 1: 'chat'."
     { t:'set', path:'alice.text', value:{ kind:'text', text:'chat', cursor:2 } }
     { t:'send', from:'alice', to:'bob', payload:{ kind:'scalar', value:'insert h @1' }, id:'a1', label:'insert h @1' }
s03  say: "At the same time Bob deletes position 0: 'at'."
     { t:'set', path:'bob.text', value:{ kind:'text', text:'at', cursor:0 } }
     { t:'send', from:'bob', to:'alice', payload:{ kind:'scalar', value:'delete @0' }, id:'b1', label:'delete @0' }
s04  say: "Alice applies 'delete position 0' to 'chat': 'hat'."
     { t:'deliver', message:'b1' }
     { t:'set', path:'alice.text', value:{ kind:'text', text:'hat' } }
s05  say: "Bob applies 'insert h at position 1' to 'at': 'aht'."
     { t:'deliver', message:'a1' }
     { t:'set', path:'bob.text', value:{ kind:'text', text:'aht' } }
s06  say: "Whoops — 'hat' and 'aht'. The positions moved under the ops."    hold:'long'
     { t:'conflict', a:'alice.text', b:'bob.text' }
s07  say: "Positions are not stable. We need names for characters that never move."
     { t:'callout', at:'bob.text', text:'positions move · names do not', sticky:true }
```

#### Scene B — Give every character a name (`layout:'pair'`)

World: `alice`, `bob`.

```
s01  say: "Same text, but now every character has an id: alice:1, alice:2, alice:3. Ids never change."
     { t:'crdt.init', actors:['alice','bob'], slot:'text', type:'rga', args:{ seed:{ by:'alice', text:'cat' } } }
s02  say: "Bob inserts 'h' after alice:1. The op says 'after alice:1', not 'at position 1'. It is op bob:1, with time stamp 4 — bigger than any stamp Bob has seen."
     { t:'crdt.update', actor:'bob', slot:'text', op:'insertAfter', args:['alice:1','h'] }
s03  say: "Broadcast. Alice finds alice:1 and puts 'h' right after it. 'chat' on both."
     { t:'crdt.broadcast', from:'bob', slot:'text' }       // bob:1
     { t:'crdt.apply', message:'bob:1' }
     { t:'check', path:'alice.text' }
s04  say: "Alice deletes 'c' (alice:1). The character is not removed. It is marked dead: a tombstone."
     { t:'crdt.update', actor:'alice', slot:'text', op:'delete', args:['alice:1'] }    // op id alice:4
s05  say: "Broadcast; Bob applies. Both read 'hat'. The tombstone still sits there, invisible to readers."
     { t:'crdt.broadcast', from:'alice', slot:'text' }
     { t:'crdt.apply', message:'alice:4' }
     { t:'highlight', path:['alice.text[alice:1]','bob.text[alice:1]'] }
s06  say: "Why keep it? An op that says 'after alice:1' may still be in flight. The name must stay."
     { t:'callout', at:'bob.text[alice:1]', text:'dead, but still a name' }
s07  say: "Bob inserts 'w' after the dead 'c'. The name is still there, so the op works."
     { t:'crdt.update', actor:'bob', slot:'text', op:'insertAfter', args:['alice:1','w'] }  // bob:2, ts 6
     { t:'crdt.broadcast', from:'bob', slot:'text' }
s08  say: "Alice applies. Both read 'what'. A tombstone is a forwarding address."
     { t:'crdt.apply', message:'bob:2' }
     { t:'check', path:'alice.text' }
     { t:'check', path:'bob.text' }
```

#### Scene C — Two inserts after the same name (`layout:'pair'`)

World: `alice`, `bob`; seed `alice` types `'ab'` → `alice:1`, `alice:2`.

```
s01  say: "Both see 'ab'. Both want to insert after 'a' at the same time."
     { t:'crdt.init', actors:['alice','bob'], slot:'text', type:'rga', args:{ seed:{ by:'alice', text:'ab' } } }
s02  say: "Alice inserts 'X' after alice:1. Op alice:3, time stamp 3."
     { t:'crdt.update', actor:'alice', slot:'text', op:'insertAfter', args:['alice:1','X'] }
s03  say: "Bob inserts 'Y' after alice:1. Op bob:1, time stamp 3."
     { t:'crdt.update', actor:'bob', slot:'text', op:'insertAfter', args:['alice:1','Y'] }
s04  say: "Alice has 'aXb'. Bob has 'aYb'. Now the ops cross."
     { t:'crdt.broadcast', from:'alice', slot:'text' }     // alice:3 (ts 3)
     { t:'crdt.broadcast', from:'bob',   slot:'text' }     // bob:1 (ts 3)
s05  say: "Both ops say 'after alice:1'. Who goes first? RGA compares the time stamps. The bigger stamp goes first."
     { t:'callout', at:'alice.text[alice:1]', text:'stamp 3 vs stamp 3 — who goes first?' }
s06  say: "Same stamp, 3 and 3. Tie-break on node name: bob > alice. So Y goes before X."
     { t:'compare', a:'op:alice:3', b:'op:bob:1' }    // NEW — computed: compares (ts, node) → 'less'
s07  say: "Alice applies Bob's op: Y lands right after 'a', before X. 'aYXb'."
     { t:'crdt.apply', message:'bob:1' }
s08  say: "Bob applies Alice's op: X wants to sit after 'a', but skips past Y, which has the bigger stamp. 'aYXb'."
     { t:'crdt.apply', message:'alice:3' }
s09  say: "Both read 'aYXb'. Nobody won. They agreed on an order, and the order is deterministic."
     { t:'check', path:'alice.text' }
     { t:'check', path:'bob.text' }
s10  say: "The rule is arbitrary but consistent. That is all a CRDT needs."
     { t:'callout', at:'bob.text', text:'bigger stamp first — always', sticky:true }
```

---

### III.6 `in-context-collab-text` — In context: collaborative text and a todo list

**Goal.** Put RGA, op ids and causal delivery together: two people type in one sentence at once;
a todo list is reordered; and "move" turns out to be hard.

**When to use / not** — inherits III.5. Extra: a todo list or block list is a sequence too; if users
reorder a lot, choose a type with a real move op.

**Real-world anchor.** Google Docs; Notion block lists; Figma layer order; Automerge's `move`.

Convenience ops (NEW, expand to one real op per character): `type` = `insertAfter` chain,
`deleteRange` = one `delete` per id. Each expanded op has its own id.

#### Scene A — Two people typing (`layout:'pair'`)

World: `alice`, `bob`; seed `alice` types `'Hello'` → `alice:1..5`.

```
s01  say: "A shared line. Both see 'Hello'."
     { t:'crdt.init', actors:['alice','bob'], slot:'line', type:'rga', args:{ seed:{ by:'alice', text:'Hello' } } }
s02  say: "Alice types ' world' after the 'o' (alice:5). Six characters, six ops: alice:6 to alice:11."
     { t:'crdt.update', actor:'alice', slot:'line', op:'type', args:['alice:5',' world'] }    // NEW convenience op
s03  say: "At the same time Bob adds '!' after the 'o'. One op: bob:1, time stamp 6."
     { t:'crdt.update', actor:'bob', slot:'line', op:'insertAfter', args:['alice:5','!'] }
s04  say: "Alice: 'Hello world'. Bob: 'Hello!'. Both broadcast."
     { t:'crdt.broadcast', from:'alice', slot:'line' }
     { t:'crdt.broadcast', from:'bob',   slot:'line' }
s05  say: "Bob applies Alice's ops in order. Her first space also says 'after alice:5' — just like his '!'."
     { t:'crdt.apply', message:'alice:6' }
     { t:'callout', at:'bob.line[alice:5]', text:'stamp 6 vs stamp 6' }
s06  say: "Same stamp, so the node name decides: bob > alice, and '!' stays first. The rest follows the space: 'Hello! world'."
     { t:'crdt.apply', message:'alice:7' }
     { t:'crdt.apply', message:'alice:8' }
     { t:'crdt.apply', message:'alice:9' }
     { t:'crdt.apply', message:'alice:10' }
     { t:'crdt.apply', message:'alice:11' }
s07  say: "Alice applies Bob's '!'. It lands after 'o' and before her space. Also 'Hello! world'."
     { t:'crdt.apply', message:'bob:1' }
     { t:'check', path:'alice.line' }
     { t:'check', path:'bob.line' }
s08  say: "Same text on both. Not the prettiest sentence, but they agree — and one more edit fixes it."
s09  say: "Bob deletes '!' and types it at the end: delete bob:1, insert after alice:11."
     { t:'crdt.update', actor:'bob', slot:'line', op:'delete', args:['bob:1'] }              // bob:2
     { t:'crdt.update', actor:'bob', slot:'line', op:'insertAfter', args:['alice:11','!'] }  // bob:3
     { t:'crdt.broadcast', from:'bob', slot:'line' }
s10  say: "Alice applies both. 'Hello world!' on both. The tombstone of the old '!' stays behind."
     { t:'crdt.apply', message:'bob:2' }
     { t:'crdt.apply', message:'bob:3' }
     { t:'check', path:'alice.line' }
     { t:'highlight', path:'alice.line[bob:1]' }
s11  say: "This is how collaborative editors work underneath: named characters, insert-after, tombstones."
     { t:'callout', at:'bob.line', text:'names + insert-after + tombstones', sticky:true }
```

#### Scene B — A todo list with reorder (`layout:'pair'`)

World: `alice`, `bob`; RGA of items (`display:'column'`), seed by `alice`:
`['Buy milk','Call mom','Pay rent']` → `alice:1..3`.

```
s01  say: "A todo list is also a sequence. Each item has an id."
     { t:'crdt.init', actors:['alice','bob'], slot:'todos', type:'rga', args:{ seed:{ by:'alice', items:['Buy milk','Call mom','Pay rent'] } } }
s02  say: "Alice moves 'Pay rent' to the top. Plain RGA has no move, so it is delete + insert: delete alice:3, insert after head."
     { t:'crdt.update', actor:'alice', slot:'todos', op:'delete', args:['alice:3'] }              // alice:4
     { t:'crdt.update', actor:'alice', slot:'todos', op:'insertAfter', args:['head','Pay rent'] }  // alice:5
s03  say: "Broadcast; Bob applies. Pay rent, Buy milk, Call mom — plus one tombstone."
     { t:'crdt.broadcast', from:'alice', slot:'todos' }
     { t:'crdt.apply', message:'alice:4' }
     { t:'crdt.apply', message:'alice:5' }
     { t:'check', path:'bob.todos' }
s04  say: "Now the trap. Both move 'Buy milk' to the top at the same time."
     { t:'crdt.update', actor:'alice', slot:'todos', op:'delete', args:['alice:1'] }              // alice:6
     { t:'crdt.update', actor:'alice', slot:'todos', op:'insertAfter', args:['head','Buy milk'] }  // alice:7
     { t:'crdt.update', actor:'bob',   slot:'todos', op:'delete', args:['alice:1'] }              // bob:1
     { t:'crdt.update', actor:'bob',   slot:'todos', op:'insertAfter', args:['head','Buy milk'] }  // bob:2
s05  say: "Both broadcast. Each applies the other's delete (already dead — fine) and the other's insert."
     { t:'crdt.broadcast', from:'alice', slot:'todos' }
     { t:'crdt.broadcast', from:'bob',   slot:'todos' }
     { t:'crdt.apply', message:'bob:1' }
     { t:'crdt.apply', message:'bob:2' }
     { t:'crdt.apply', message:'alice:6' }
     { t:'crdt.apply', message:'alice:7' }
s06  say: "Whoops — 'Buy milk' is there twice, on both screens. Two moves made two copies."    hold:'long'
     { t:'highlight', path:['alice.todos[alice:7]','alice.todos[bob:2]','bob.todos[alice:7]','bob.todos[bob:2]'], tone:'bad' }
s07  say: "RGA converged — both agree — but the meaning is wrong. A move is not a delete plus an insert."
     { t:'callout', at:'bob.todos', text:'converged ≠ correct', tone:'warn' }
s08  say: "Fixes: a real move op (Automerge has one), or store each item's position as a number between its neighbours and sort. Both are beyond this course."
     { t:'callout', at:'alice.todos', text:'move op · or position field', sticky:true }
```

---

### III.7 `tombstones-and-garbage` — Tombstones and garbage

**Goal.** Deletes leave tombstones so late ops keep their anchors; tombstones pile up; one can be
dropped only when every replica has seen the delete and nothing can still refer to it — which needs
knowledge of what everyone has seen (Unit IV).

**When to use (keep tombstones / compact)**

- Keep tombstones while any replica may still send an op that refers to the dead element.
- Compact when every replica has acknowledged the delete (a stability point).
- Give new joiners a snapshot without history instead of the full op log.
- Show users a "recently deleted" bin if the product wants undo — that is a tombstone with a face.

**When not to use**

- Do not compact on a timer alone — a replica offline longer than the timer resurrects deleted data (Cassandra's `gc_grace_seconds` problem).
- Do not compact without knowing every replica's progress.
- Do not render tombstones in the UI or count them as items.
- Do not assume every type needs them — an OR-Set remove deletes tags; RGA and 2P-Set need tombstones.

**Real-world anchor.** Cassandra tombstones and "zombie" rows; Yjs/Automerge compaction; Apple
Notes "Recently Deleted" (30 days).

#### Scene A — Why not just delete? (`layout:'pair'`)

World: `alice`, `bob` hold `text` = list (`display:'text'`) `[alice:1 c, alice:2 a, alice:3 t]` (plain,
naive, no tombstones). Switches to the real RGA at s07.

```
s01  say: "Plain deletes, no tombstones. Both see c·a·t with names alice:1, alice:2, alice:3."
     { t:'highlight', path:['alice.text','bob.text'] }
s02  say: "Alice deletes 'c'. Gone, no trace."
     { t:'delete', path:'alice.text', id:'alice:1', tombstone:false }
     { t:'send', from:'alice', to:'bob', payload:{ kind:'scalar', value:'delete alice:1' }, id:'del', label:'delete alice:1' }
s03  say: "At the same time Bob inserts 'h' after alice:1 and sends the op."
     { t:'insert', path:'bob.text', index:1, item:{ id:'bob:1', value:{ kind:'scalar', value:'h' } } }
     { t:'send', from:'bob', to:'alice', payload:{ kind:'scalar', value:'insert h after alice:1' }, id:'ins', label:'after alice:1' }
s04  say: "Alice's delete reaches Bob: 'c' is gone. Bob: 'hat'."
     { t:'deliver', message:'del' }
     { t:'delete', path:'bob.text', id:'alice:1', tombstone:false }
s05  say: "Bob's insert reaches Alice: 'after alice:1' — but alice:1 no longer exists. No anchor."
     { t:'deliver', message:'ins' }
     { t:'callout', at:'alice.text', text:'no anchor!', tone:'bad' }
s06  say: "Whoops — Alice cannot apply it. Bob has 'hat', Alice has 'at'. Stuck forever."    hold:'long'
     { t:'conflict', a:'alice.text', b:'bob.text' }
s07  say: "Rewind, with the real RGA. Same 'cat', same two ops."
     { t:'clearMarks' }
     { t:'crdt.init', actors:['alice','bob'], slot:'text', type:'rga', args:{ seed:{ by:'alice', text:'cat' } } }
     { t:'crdt.update', actor:'alice', slot:'text', op:'delete', args:['alice:1'] }            // alice:4
     { t:'crdt.update', actor:'bob',   slot:'text', op:'insertAfter', args:['alice:1','h'] }   // bob:1
     { t:'crdt.broadcast', from:'alice', slot:'text' }
     { t:'crdt.broadcast', from:'bob',   slot:'text' }
s08  say: "Bob applies the delete: 'c' becomes a tombstone. Bob: 'hat'."
     { t:'crdt.apply', message:'alice:4' }
s09  say: "Alice applies the insert: the dead 'c' is still a name, so 'h' slots in after it. Alice: 'hat'."
     { t:'crdt.apply', message:'bob:1' }
     { t:'check', path:'alice.text' }
     { t:'check', path:'bob.text' }
s10  say: "A tombstone is a forwarding address for ops that are still on their way."
     { t:'callout', at:'alice.text[alice:1]', text:'forwarding address', sticky:true }
```

#### Scene B — Tombstones pile up (`layout:'pair'`)

World: `alice`, `bob`; RGA seed `alice` `'Hello'`. `rga.toValue()` meta carries `{ live, dead }` counts
(NEW meta fields; rendered as a small badge).

```
s01  say: "A short doc: 'Hello'. Five live characters, zero dead."
     { t:'crdt.init', actors:['alice','bob'], slot:'doc', type:'rga', args:{ seed:{ by:'alice', text:'Hello' } } }
     { t:'highlight', path:'alice.doc' }
s02  say: "Alice rewrites it: delete all five, type 'Hi'. Two live, five dead."
     { t:'crdt.update', actor:'alice', slot:'doc', op:'deleteRange', args:['alice:1','alice:5'] }   // NEW convenience op
     { t:'crdt.update', actor:'alice', slot:'doc', op:'type', args:['head','Hi'] }
     { t:'crdt.broadcast', from:'alice', slot:'doc' }
     { t:'crdt.apply', message:'alice:6' }  { t:'crdt.apply', message:'alice:7' }  { t:'crdt.apply', message:'alice:8' }
     { t:'crdt.apply', message:'alice:9' }  { t:'crdt.apply', message:'alice:10' } { t:'crdt.apply', message:'alice:11' } { t:'crdt.apply', message:'alice:12' }
s03  say: "Bob replaces 'Hi' with 'Hey'. Three live, seven dead."
     { t:'crdt.update', actor:'bob', slot:'doc', op:'deleteRange', args:['alice:11','alice:12'] }
     { t:'crdt.update', actor:'bob', slot:'doc', op:'type', args:['head','Hey'] }
     { t:'crdt.broadcast', from:'bob', slot:'doc' }
     { t:'crdt.apply', message:'bob:1' } { t:'crdt.apply', message:'bob:2' } { t:'crdt.apply', message:'bob:3' } { t:'crdt.apply', message:'bob:4' } { t:'crdt.apply', message:'bob:5' }
s04  say: "Every delete adds to the pile. Readers never see it, but every replica stores it and ships it."
     { t:'highlight', path:['alice.doc','bob.doc'], tone:'warn' }
     { t:'callout', at:'bob.doc', text:'3 live · 7 dead' }
s05  say: "After a week of edits, most of the document is dead characters. Memory, bandwidth, and slower inserts."
     { t:'callout', at:'alice.doc', text:'tombstones are not free', tone:'warn', sticky:true }
s06  say: "So we want to throw tombstones away. The question is: when is that safe?"
```

#### Scene C — When is it safe to throw one away? (`layout:'triangle'`)

World: `alice`, `bob`, `carol`; RGA seed `alice` `'cat'`. Each actor also holds `seen` = clock
`{alice:3, bob:0, carol:0}` (how far it has read each node's ops).

```
s01  say: "Three replicas, 'cat'. Alice deletes 'c'. Op alice:4. Tombstone on her copy."
     { t:'crdt.init', actors:['alice','bob','carol'], slot:'text', type:'rga', args:{ seed:{ by:'alice', text:'cat' } } }
     { t:'crdt.update', actor:'alice', slot:'text', op:'delete', args:['alice:1'] }
     { t:'set', path:'alice.seen', value:{ kind:'clock', entries:{ alice:4, bob:0, carol:0 } } }
s02  say: "Can Alice drop the tombstone now? No. Bob or Carol may still send 'insert after alice:1'."
     { t:'callout', at:'alice.text[alice:1]', text:'someone may still point here', tone:'warn' }
s03  say: "Alice broadcasts. Bob applies. Carol is offline; her copy waits at the door."
     { t:'offline', actor:'carol' }
     { t:'crdt.broadcast', from:'alice', slot:'text' }     // alice:4@bob, alice:4@carol (queued)
     { t:'crdt.apply', message:'alice:4@bob' }
     { t:'set', path:'bob.seen', value:{ kind:'clock', entries:{ alice:4, bob:0, carol:0 } } }
s04  say: "Bob has the tombstone too. Can Alice and Bob drop it? Still no. Carol has not seen the delete and could anchor an op on 'c'."
     { t:'highlight', path:'carol.text[alice:1]', tone:'warn' }
s05  say: "Carol comes online and applies. Now every replica knows 'c' is dead."
     { t:'online', actor:'carol' }
     { t:'crdt.apply', message:'alice:4@carol' }
     { t:'set', path:'carol.seen', value:{ kind:'clock', entries:{ alice:4, bob:0, carol:0 } } }
s06  say: "But Alice does not know that Carol knows. She needs proof: 'everyone has seen alice:4'."
     { t:'callout', at:'alice', text:'has everyone seen alice:4?' }
s07  say: "Each replica tells the others how far it has read: Carol says 'alice up to 4'."
     { t:'send', from:'carol', to:['alice','bob'], payload:{ ref:'carol.seen' }, id:'ack', label:'seen' }
     { t:'deliver', message:'ack@alice' }
     { t:'deliver', message:'ack@bob' }
s08  say: "Every 'seen' now covers alice:4. The tombstone is stable. Alice compacts."
     { t:'crdt.gc', actor:'alice', slot:'text', upTo:{ alice:4, bob:0, carol:0 } }   // NEW — removes tombstones older than the stable point
     { t:'check', path:'alice.text' }
s09  say: "That table of 'how far has everyone read' is a vector clock. Unit IV is about it."
     { t:'highlight', path:['alice.seen','bob.seen','carol.seen'], sticky:true }
s10  say: "Real systems compact when they can prove stability. Yjs and Automerge do this."
s11  say: "Cassandra instead waits a fixed grace period. A node down longer than that can bring deleted data back from the dead. Whoops."
     { t:'callout', at:'carol', text:'timer-based GC → zombies', tone:'warn', sticky:true }
```

#### Scene D — In context: a notes doc behind a sync server (`layout:'hub'`)

World: `alice` (Phone), `bob` (Laptop), `server`. `alice`/`bob` hold RGA `note` seeded by alice
`'Milk, eggs'`. `server` holds `note` (same RGA) and `progress` = record `{ phone: clock, laptop: clock }`.

```
s01  say: "A notes app. Phone and laptop sync through a server. The server also keeps how far each device has read."
     { t:'crdt.init', actors:['alice','bob','server'], slot:'note', type:'rga', args:{ seed:{ by:'alice', text:'Milk, eggs' } } }
     { t:'set', path:'server.progress', value:{ kind:'record', fields:[ { key:'phone', value:{ kind:'clock', entries:{ alice:10, bob:0 } } }, { key:'laptop', value:{ kind:'clock', entries:{ alice:10, bob:0 } } } ] } }
s02  say: "Alice deletes 'Milk, ' on the phone. Six tombstones. She sends the ops to the server."
     { t:'crdt.update', actor:'alice', slot:'note', op:'deleteRange', args:['alice:1','alice:6'] }   // alice:11..16
     { t:'crdt.broadcast', from:'alice', slot:'note', to:['server'] }     // NEW field `to`
     { t:'crdt.apply', message:'alice:11@server' } { t:'crdt.apply', message:'alice:12@server' } { t:'crdt.apply', message:'alice:13@server' }
     { t:'crdt.apply', message:'alice:14@server' } { t:'crdt.apply', message:'alice:15@server' } { t:'crdt.apply', message:'alice:16@server' }
     { t:'set', path:'server.progress.phone', value:{ kind:'clock', entries:{ alice:16, bob:0 } } }
s03  say: "The laptop is asleep. The server holds the ops and remembers: laptop has read alice up to 10."
     { t:'offline', actor:'bob' }
     { t:'highlight', path:'server.progress.laptop', tone:'warn' }
s04  say: "Can the server drop the six tombstones? No — the laptop may still insert after one of them."
     { t:'callout', at:'server.note', text:'laptop has not seen the delete' }
s05  say: "The laptop wakes up and pulls. It applies the six deletes and tells the server: read up to alice:16."
     { t:'online', actor:'bob' }
     { t:'crdt.broadcast', from:'server', slot:'note', to:['bob'] }
     { t:'crdt.apply', message:'alice:11@bob' } { t:'crdt.apply', message:'alice:12@bob' } { t:'crdt.apply', message:'alice:13@bob' }
     { t:'crdt.apply', message:'alice:14@bob' } { t:'crdt.apply', message:'alice:15@bob' } { t:'crdt.apply', message:'alice:16@bob' }
     { t:'set', path:'server.progress.laptop', value:{ kind:'clock', entries:{ alice:16, bob:0 } } }
s06  say: "Both devices have read past alice:16. The server compacts and tells the devices they may too."
     { t:'crdt.gc', actor:'server', slot:'note', upTo:{ alice:16, bob:0 } }   // NEW
     { t:'send', from:'server', to:['alice','bob'], payload:{ kind:'scalar', value:'stable: alice:16' }, id:'stable', label:'stable ≤ alice:16' }
s07  say: "The devices compact. 'eggs' with zero dead characters, on all three."
     { t:'deliver', message:'stable@alice' }
     { t:'deliver', message:'stable@bob' }
     { t:'crdt.gc', actor:'alice', slot:'note', upTo:{ alice:16, bob:0 } }
     { t:'crdt.gc', actor:'bob',   slot:'note', upTo:{ alice:16, bob:0 } }
     { t:'check', path:'alice.note' }
     { t:'check', path:'bob.note' }
     { t:'check', path:'server.note' }
s08  say: "A server that tracks progress can prove stability. Without one, the devices must exchange their 'seen' tables directly — vector clocks, next unit."
     { t:'callout', at:'server.progress', text:'progress table = vector clocks', sticky:true }
```

---

## Unit IV — Vector clocks & causality

Unit-level note: clocks are real implementations in `src/crdt/clocks/` (`lamport`, `vector`, `hlc`)
and are driven with the same `crdt.*` commands: `op:'tick'` is a local event, `crdt.broadcast`
stamps a message, `crdt.apply` runs the receive rule. Scenes that need wall time declare
`clock:{ format:'time', start:'10:00' }` on the scene (NEW) so `tick` means "one minute" and every
actor shows a wall-clock badge (`world.clock` + that actor's `skew`, NEW).

---

### IV.1 `wall-clocks-lie` — Wall clocks lie

**Goal.** Physical clocks on different devices disagree; LWW by wall-clock timestamp can pick the wrong
value; "newer timestamp" is not "happened later".

**When to use (wall-clock LWW)**

- Low-stakes fields where a wrong pick costs little (a display name, a note title) on devices that sync their clocks.
- In practice one writer per field.
- You add a node-id tie-break and accept a few seconds of slop.
- You stamp with an HLC (IV.5) so causal chains cannot go backwards.

**When not to use**

- Two devices may edit the same field inside the clock-error window.
- Devices can be offline or unsynced for long (airplane mode, IoT, a phone with a dead battery).
- Correctness matters: money, permissions, inventory.
- You need "happened before", not "was stamped later".

**Real-world anchor.** Cassandra LWW with skewed clocks (silently lost writes); Google Spanner's
TrueTime — atomic clocks in the data center to _bound_ the error.

#### Scene A — Two clocks, one title (`layout:'pair'`, scene `clock:{ format:'time', start:'10:00' }`)

World: `alice` (device, a, "Phone"), `bob` (device, b, "Laptop"). Slot `title` = `lww-register` (Unit II).

```
s01  say: "Phone and laptop share a note title. Each device has its own clock. Look closely: they disagree."
     { t:'crdt.init', actors:['alice','bob'], slot:'title', type:'lww-register', args:{ seed:[{ by:'alice', op:'set', args:['Untitled'] }] } }
     { t:'skew', actor:'alice', by:5 }                      // NEW — alice's wall clock reads world.clock + 5
     { t:'highlight', path:['alice.@clock','bob.@clock'] }   // NEW path: an actor's wall-clock badge
s02  say: "The phone's clock runs five minutes fast. Nobody notices. Clocks drift all the time."
     { t:'callout', at:'alice.@clock', text:'+5 min', tone:'warn' }
s03  say: "At real time 10:00, Alice renames the note to 'Draft'. Her clock says 10:05, so the timestamp is 10:05."
     { t:'crdt.update', actor:'alice', slot:'title', op:'set', args:['Draft'] }     // ts = 10:05 (from alice's clock)
s04  say: "Two minutes later, at 10:02, Bob renames it to 'Final'. His clock says 10:02."
     { t:'tick', by:2 }
     { t:'crdt.update', actor:'bob', slot:'title', op:'set', args:['Final'] }       // ts = 10:02
s05  say: "Bob wrote last. Now they sync."
     { t:'crdt.sync', a:'alice', b:'bob', slot:'title' }
s06  say: "Whoops — 'Draft' wins on both. 10:05 beats 10:02, so the older write won."    hold:'long'
     { t:'highlight', path:['alice.title','bob.title'], tone:'bad' }
     { t:'cross', path:'bob.title' }
s07  say: "LWW did exactly what it was told: compare the numbers. The numbers lied."
     { t:'callout', at:'bob.title', text:'10:05 > 10:02 — but it happened first' }
s08  say: "Skew is normal. Phones drift by seconds, a device without network by minutes, a dead battery by hours."
     { t:'callout', at:'alice.@clock', text:'skew is normal', sticky:true }
```

#### Scene B — Clocks also jump (`layout:'pair'`, scene `clock:{ format:'time', start:'10:01' }`)

World: `alice` (Phone, skew +5), `bob` (Laptop). Slot `title` = `lww-register`, seeded `'v1'`.

```
s01  say: "Alice's phone, still five minutes fast. She types 'v2' at 10:06 by her clock and syncs with Bob."
     { t:'crdt.init', actors:['alice','bob'], slot:'title', type:'lww-register', args:{ seed:[{ by:'alice', op:'set', args:['v1'] }] } }
     { t:'skew', actor:'alice', by:5 }
     { t:'crdt.update', actor:'alice', slot:'title', op:'set', args:['v2'] }        // ts = 10:01 + 5 = 10:06
     { t:'crdt.sync', a:'alice', b:'bob', slot:'title' }
s02  say: "Her phone syncs its clock with the network. It jumps back five minutes."
     { t:'skew', actor:'alice', by:0 }
     { t:'highlight', path:'alice.@clock', tone:'warn' }
s03  say: "She types 'v3' — her newest edit. Its timestamp is now smaller than the one on 'v2'."
     { t:'tick', by:1 }
     { t:'crdt.update', actor:'alice', slot:'title', op:'set', args:['v3'] }        // ts = 10:02 + 0 = 10:02 < 10:06
s04  say: "Sync. 'v2' beats 'v3' by timestamp. Her newest edit is gone — on her own phone, too."    hold:'long'
     { t:'crdt.sync', a:'alice', b:'bob', slot:'title' }
     { t:'cross', path:'alice.title' }
s05  say: "A clock that moves backwards makes a newer write look older. Databases guard against this; most apps do not."
     { t:'callout', at:'alice.@clock', text:'time went backwards', tone:'bad' }
s06  say: "A node-id tie-break does not help here. The problem is the timestamp itself."
     { t:'callout', at:'alice.title', text:'we need a clock that cannot lie about cause and effect', sticky:true }
```

#### Scene C — In context: the setting that keeps reverting (`layout:'pair'`, scene clock `09:58`)

World: `alice` (Phone, skew +5), `bob` (Laptop). Slot `settings` = `lww-map` `{ theme, fontSize }`
(Unit II).

```
s01  say: "Settings sync between phone and laptop: theme and font size. Per-field LWW, stamped with wall clocks."
     { t:'crdt.init', actors:['alice','bob'], slot:'settings', type:'lww-map', args:{ seed:[{ by:'bob', op:'set', args:['theme','light'] }, { by:'bob', op:'set', args:['fontSize',14] }] } }
     { t:'skew', actor:'alice', by:5 }
s02  say: "At 9:58 real time, Alice sets the theme to light on the phone. Her stamp says 10:03."
     { t:'crdt.update', actor:'alice', slot:'settings', op:'set', args:['theme','light'] }
s03  say: "At 10:00 Bob sets dark on the laptop. Stamp 10:00. They sync."
     { t:'tick', by:2 }
     { t:'crdt.update', actor:'bob', slot:'settings', op:'set', args:['theme','dark'] }
     { t:'crdt.sync', a:'alice', b:'bob', slot:'settings' }
s04  say: "Light wins: 10:03 beats 10:00. Bob's laptop flips back to light. He frowns and sets dark again at 10:01."
     { t:'tick', by:1 }
     { t:'crdt.update', actor:'bob', slot:'settings', op:'set', args:['theme','dark'] }
     { t:'crdt.sync', a:'alice', b:'bob', slot:'settings' }
s05  say: "Light again! 10:03 still beats 10:01. Bob cannot win until his clock passes the phone's stamp."    hold:'long'
     { t:'highlight', path:'bob.settings.theme', tone:'bad' }
     { t:'callout', at:'bob', text:'"why does it keep reverting?"' }
s06  say: "Font size is fine: only Alice touches it. The bug only bites when two devices race on one field."
     { t:'crdt.update', actor:'alice', slot:'settings', op:'set', args:['fontSize',16] }
     { t:'crdt.sync', a:'alice', b:'bob', slot:'settings' }
     { t:'check', path:'bob.settings.fontSize' }
s07  say: "This is the most common LWW bug in real apps. The cure is a clock built from cause and effect, not from the wall. Next."
     { t:'callout', at:'alice.@clock', text:'logical clocks →', sticky:true }
```

---

### IV.2 `lamport-clocks` — Lamport clocks

**Goal.** A Lamport clock is one counter per device: +1 on every local event; on receive, take
max(own, stamp) + 1. If one event led to another, the second has a bigger number. The reverse is not
guaranteed.

**When to use**

- You need an order that respects cause and effect: op logs, RGA time stamps, LWW that cannot go backwards along a causal chain.
- One integer per replica is all the space you can afford.
- Ties can be broken by node name.
- You only need to _order_ events, not to _detect_ concurrency.

**When not to use**

- You must know whether two events were concurrent — Lamport cannot say (use vector clocks).
- You need human-readable time (use an HLC).
- Unrelated events must not look ordered — Lamport orders them anyway.
- Ordering across many nodes must also bound real-time skew — see HLC.

**Real-world anchor.** Automerge orders ops by (Lamport counter, actor id); the RGA time stamps in
III.5; Leslie Lamport's 1978 paper.

**Sidecar / `toValue()`.** `lamport` → `scalar` number. A stamped message shows its stamp on the
packet (`Message.stamp`, NEW).

#### Scene A — Count events (`layout:'triangle'`)

World: `alice`, `bob`, `carol`.

```
s01  say: "Every device keeps one counter: its Lamport clock. All start at 0."
     { t:'crdt.init', actors:['alice','bob','carol'], slot:'clock', type:'lamport' }
s02  say: "Alice does something — an edit. Her clock ticks: 1."
     { t:'crdt.update', actor:'alice', slot:'clock', op:'tick', args:[] }
s03  say: "She sends Bob a message. Sending is an event: tick to 2, and the message carries the stamp 2."
     { t:'crdt.broadcast', from:'alice', slot:'clock', to:['bob'], id:'m1' }    // NEW fields `to`, `id`; stamps the message
s04  say: "Bob receives it. Rule: take the larger of your clock and the stamp, then add 1. max(0, 2) + 1 = 3."
     { t:'crdt.apply', message:'m1' }
     { t:'callout', at:'bob.clock', text:'max(0, 2) + 1 = 3' }
s05  say: "Carol has been busy on her own: five edits. Her clock is 5."
     { t:'crdt.update', actor:'carol', slot:'clock', op:'tick', args:[5] }
s06  say: "Bob sends Carol a message. His clock ticks to 4; the stamp is 4."
     { t:'crdt.broadcast', from:'bob', slot:'clock', to:['carol'], id:'m2' }
s07  say: "Carol receives. max(5, 4) + 1 = 6. Her clock was already ahead, so it just ticks."
     { t:'crdt.apply', message:'m2' }
     { t:'callout', at:'carol.clock', text:'max(5, 4) + 1 = 6' }
s08  say: "The rule guarantees: if one event led to another, the second has a bigger number. Cause is always smaller than effect."
     { t:'callout', at:'bob', text:'cause < effect, always', sticky:true }
s09  say: "Two devices can reach the same number. Break ties with the node name, as RGA did in Unit III. Now every event has one place in line."
     { t:'callout', at:'carol', text:'(6, carol) — counter, then name' }
```

#### Scene B — What Lamport cannot tell you (`layout:'pair'`)

World: `alice`, `bob`.

```
s01  say: "Alice makes two edits: her clock is 2. Bob makes one: his clock is 1. They never talked."
     { t:'crdt.init', actors:['alice','bob'], slot:'clock', type:'lamport' }
     { t:'crdt.update', actor:'alice', slot:'clock', op:'tick', args:[2] }
     { t:'crdt.update', actor:'bob',   slot:'clock', op:'tick', args:[1] }
s02  say: "Bob's 1 is smaller than Alice's 2. Did Bob's edit happen before Alice's? We cannot know. They are independent."
     { t:'compare', a:'bob.clock', b:'alice.clock', result:'less' }     // NEW
     { t:'callout', at:'bob.clock', text:'smaller ≠ earlier' }
s03  say: "Lamport gives a safe order: cause before effect. But 'smaller' does not mean 'caused'."
     { t:'callout', at:'alice', text:'a < b  ⇐  a caused b   (not ⇒)', sticky:true }
s04  say: "To ask 'were these two edits independent?' we need more than one number. Next: vector clocks."
```

#### Scene C — In context: a chat in order (`layout:'hub'`)

World: `alice`, `bob`, `server`. Each holds `clock` (lamport) and `chat` = list `[]`. Messages carry a
text payload **and** a Lamport stamp (`send … stamp:{ slot:'clock' }`, `deliver … recv:{ slot:'clock' }`, NEW).
A chat item keeps its _origin_ stamp in `meta { ts, node }`; the relay's own envelope stamp only drives the clocks.

```
s01  say: "A chat through a server. Every message carries the sender's Lamport stamp. The server sorts by (stamp, sender)."
     { t:'crdt.init', actors:['alice','bob','server'], slot:'clock', type:'lamport' }
s02  say: "Alice sends 'Lunch?'. Stamp 1."
     { t:'send', from:'alice', to:'server', payload:{ kind:'scalar', value:'Lunch?' }, id:'c1', stamp:{ slot:'clock' } }   // NEW stamp
     { t:'deliver', message:'c1', into:'server.chat', recv:{ slot:'clock' } }                                               // NEW recv
s03  say: "The server forwards it to Bob. The packet carries the original stamp (1, alice); Bob's clock becomes 4."
     { t:'send', from:'server', to:'bob', payload:{ ref:'server.chat[c1]' }, id:'c1b', stamp:{ slot:'clock' } }
     { t:'deliver', message:'c1b', into:'bob.chat', recv:{ slot:'clock' } }
s04  say: "Bob replies 'Yes!'. Stamp 5 — bigger than the question he saw."
     { t:'send', from:'bob', to:'server', payload:{ kind:'scalar', value:'Yes!' }, id:'c2', stamp:{ slot:'clock' } }
s05  say: "Meanwhile Alice, who has not seen the reply, sends 'Or pizza?'. Stamp 2."
     { t:'send', from:'alice', to:'server', payload:{ kind:'scalar', value:'Or pizza?' }, id:'c3', stamp:{ slot:'clock' } }
s06  say: "Both arrive. The server sorts: (1, alice) Lunch?  (2, alice) Or pizza?  (5, bob) Yes!"
     { t:'deliver', message:'c2', into:'server.chat', recv:{ slot:'clock' } }
     { t:'deliver', message:'c3', into:'server.chat', recv:{ slot:'clock' } }
     { t:'sort', path:'server.chat', by:['meta.ts','meta.node'] }    // NEW
s07  say: "Every device will show the same order. The reply can never appear above its question."
     { t:'check', path:'server.chat' }
s08  say: "'Or pizza?' and 'Yes!' were independent. Lamport put one first anyway. Fine for a chat; not fine if you need to know they were independent."
     { t:'callout', at:'server.chat', text:'ordered, but "independent" is invisible', sticky:true }
```

---

### IV.3 `vector-clocks` — Vector clocks

**Goal.** A vector clock keeps one counter per node. Compare entry by entry: all ≤ means before; some
bigger on each side means concurrent.

**When to use**

- You must detect concurrent writes: siblings, conflict flags, "someone else edited this".
- Few nodes (tens), or you can prune entries.
- You need "has everyone seen X" (tombstone stability, III.7).
- Sync: "send me everything after {alice 4, bob 2}" (Yjs calls this a state vector).

**When not to use**

- Thousands of writers per object — the clock grows per node (dotted version vectors and per-object vectors help, but it is work).
- You only need an order, not concurrency — Lamport is one integer.
- You need human-readable time — HLC.
- Anonymous clients that come and go — their entries never die.

**Real-world anchor.** Amazon Dynamo and Riak (version vectors); Yjs state vectors for sync; git's
commit graph is the same idea in spirit.

**Sidecar / `toValue()`.** `vector-clock` → `clock` Value (entries per node). Changed entries are
auto-highlighted. `compare` (NEW) draws two clocks side by side with per-entry ≤ / > marks and the verdict.

#### Scene A — One counter per node (`layout:'triangle'`)

World: `alice`, `bob`, `carol`.

```
s01  say: "Three devices. Each keeps a clock with one counter per device. All zero."
     { t:'crdt.init', actors:['alice','bob','carol'], slot:'vc', type:'vector-clock' }
s02  say: "Alice edits: her own entry ticks. {alice 1}."
     { t:'crdt.update', actor:'alice', slot:'vc', op:'tick', args:[] }
s03  say: "Alice sends Bob a message. Sending ticks her entry too: {alice 2}. The message carries the whole clock."
     { t:'crdt.broadcast', from:'alice', slot:'vc', to:['bob'], id:'m1' }
s04  say: "Bob receives. Rule: take the larger of each entry, then tick your own. {alice 2, bob 1}."
     { t:'crdt.apply', message:'m1' }
     { t:'callout', at:'bob.vc', text:'max per entry, then +1 on bob' }
s05  say: "Carol edits twice on her own: {carol 2}."
     { t:'crdt.update', actor:'carol', slot:'vc', op:'tick', args:[2] }
s06  say: "Bob sends Carol a message: {alice 2, bob 2}."
     { t:'crdt.broadcast', from:'bob', slot:'vc', to:['carol'], id:'m2' }
s07  say: "Carol receives: max per entry, plus her own tick. {alice 2, bob 2, carol 3}."
     { t:'crdt.apply', message:'m2' }
s08  say: "Carol's clock says exactly what she has seen: 2 events from Alice, 2 from Bob, 3 of her own."
     { t:'highlight', path:'carol.vc', sticky:true }
s09  say: "That is the power of it. A vector clock is a summary of everything you have heard."
     { t:'callout', at:'carol.vc', text:'"everything I have heard"', sticky:true }
```

#### Scene B — Before, after, or at the same time (`layout:'pair'`)

World: `alice` holds `A` (clock), `bob` holds `B` (clock); values set directly — this scene is about
the comparison, not about events.

```
s01  say: "Two clocks from two edits. Compare them entry by entry."
     { t:'set', path:'alice.A', value:{ kind:'clock', entries:{ alice:2, bob:1 } } }
     { t:'set', path:'bob.B',   value:{ kind:'clock', entries:{ alice:2, bob:3 } } }
s02  say: "A is {alice 2, bob 1}. B is {alice 2, bob 3}. Every entry of A is ≤ the same entry of B."
     { t:'compare', a:'alice.A', b:'bob.B' }                 // NEW — result computed: 'before'
s03  say: "So A happened before B. Whoever made B had already seen A."
     { t:'callout', at:'bob.B', text:'A → B' }
s04  say: "Now A is {alice 3, bob 1} and B is {alice 2, bob 3}."
     { t:'clearMarks' }
     { t:'set', path:'alice.A', value:{ kind:'clock', entries:{ alice:3, bob:1 } } }
s05  say: "Alice's entry is bigger in A. Bob's entry is bigger in B. Neither saw the other."
     { t:'compare', a:'alice.A', b:'bob.B' }                 // result: 'concurrent'
s06  say: "They are concurrent. This is the answer Lamport could not give."
     { t:'callout', at:'bob.B', text:'A ∥ B — concurrent', sticky:true }
s07  say: "Equal clocks mean the same event. That happens only when A ≤ B and B ≤ A."
     { t:'set', path:'alice.A', value:{ kind:'clock', entries:{ alice:2, bob:3 } } }
     { t:'compare', a:'alice.A', b:'bob.B' }                 // result: 'equal'
s08  say: "Before, after, concurrent, equal. Four answers, one loop over the entries."
     { t:'callout', at:'alice.A', text:'≤ everywhere → before · mixed → concurrent', sticky:true }
```

#### Scene C — In context: "what do I send you?" (`layout:'hub'`)

Sync with state vectors (Yjs style). World: `alice` (Phone), `bob` (Laptop), `server`; RGA `note`
seeded by `alice` `'Milk'` (`alice:1..4`). `rga.toValue()` exposes `meta.seen` (a `clock` of how many
ops it holds from each node; NEW meta field), drawn as a badge; paths may address it as `alice.note.meta.seen` (NEW).

```
s01  say: "Phone, laptop and server share a note. Each copy's vector clock counts the ops it has from each device: {phone 4, laptop 0}."
     { t:'crdt.init', actors:['alice','bob','server'], slot:'note', type:'rga', args:{ seed:{ by:'alice', text:'Milk' } } }
     { t:'highlight', path:['alice.note.meta.seen','bob.note.meta.seen','server.note.meta.seen'] }
s02  say: "The phone goes offline and types ' and eggs': ops phone:5 to phone:13. Its clock: {phone 13, laptop 0}."
     { t:'offline', actor:'alice' }
     { t:'crdt.update', actor:'alice', slot:'note', op:'type', args:['alice:4',' and eggs'] }
s03  say: "The laptop lowercases the M: delete alice:1, insert 'm' at the start. Ops laptop:1 and laptop:2. It pushes to the server."
     { t:'crdt.update', actor:'bob', slot:'note', op:'delete', args:['alice:1'] }
     { t:'crdt.update', actor:'bob', slot:'note', op:'insertAfter', args:['head','m'] }
     { t:'crdt.broadcast', from:'bob', slot:'note', to:['server'] }
     { t:'crdt.apply', message:'bob:1@server' }
     { t:'crdt.apply', message:'bob:2@server' }
s04  say: "The phone comes back. It does not send everything. It sends its clock: 'I have {phone 13, laptop 0}'."
     { t:'online', actor:'alice' }
     { t:'send', from:'alice', to:'server', payload:{ ref:'alice.note.meta.seen' }, id:'sv', label:'my clock' }
     { t:'deliver', message:'sv' }
s05  say: "The server compares: {phone 4, laptop 2} vs {phone 13, laptop 0}. Concurrent — each side has ops the other lacks."
     { t:'compare', a:'server.note.meta.seen', b:'alice.note.meta.seen' }    // 'concurrent'
s06  say: "Each side sends only what the other lacks: two ops one way, nine the other."
     { t:'crdt.sync', a:'alice', b:'server', slot:'note' }    // op-based sync: emits the delta ops as messages (NEW semantics for op-based types)
     { t:'crdt.apply', message:'bob:1@alice' }   { t:'crdt.apply', message:'bob:2@alice' }
     { t:'crdt.apply', message:'alice:5@server' } { t:'crdt.apply', message:'alice:6@server' } { t:'crdt.apply', message:'alice:7@server' }
     { t:'crdt.apply', message:'alice:8@server' } { t:'crdt.apply', message:'alice:9@server' } { t:'crdt.apply', message:'alice:10@server' }
     { t:'crdt.apply', message:'alice:11@server' } { t:'crdt.apply', message:'alice:12@server' } { t:'crdt.apply', message:'alice:13@server' }
s07  say: "The laptop pulls the nine phone ops the same way. All three read 'milk and eggs', clock {phone 13, laptop 2}."
     { t:'crdt.sync', a:'bob', b:'server', slot:'note' }
     { t:'crdt.apply', message:'alice:5@bob' }  { t:'crdt.apply', message:'alice:6@bob' }  { t:'crdt.apply', message:'alice:7@bob' }
     { t:'crdt.apply', message:'alice:8@bob' }  { t:'crdt.apply', message:'alice:9@bob' }  { t:'crdt.apply', message:'alice:10@bob' }
     { t:'crdt.apply', message:'alice:11@bob' } { t:'crdt.apply', message:'alice:12@bob' } { t:'crdt.apply', message:'alice:13@bob' }
     { t:'check', path:'alice.note' }  { t:'check', path:'bob.note' }  { t:'check', path:'server.note' }
s08  say: "Yjs calls this clock a state vector. Every sync starts with 'here is what I have seen'."
     { t:'callout', at:'server.note.meta.seen', text:'state vector = vector clock', sticky:true }
```

---

### IV.4 `detecting-conflicts` — Detecting conflicts: siblings and the MV-Register

**Goal.** Dynamo style: a write carries the version vector it was based on; a store that receives a
concurrent version keeps both as **siblings** instead of guessing; a later write that descends from
all siblings collapses them. The data type that holds this is the **Multi-Value Register**.

**When to use**

- The store must never silently drop a concurrent write (carts, inventory notes, medical records).
- The app — not the database — knows how to merge two versions (union, ask the user, domain rule).
- Few writers per key, so version vectors stay small.
- You want "someone else changed this" surfaced to a human.

**When not to use**

- Nobody will ever resolve siblings — they pile up (Riak's "sibling explosion").
- A proper CRDT already encodes the merge (counter, set, map): use it; MV-Register is a fallback for opaque values.
- High write rate on one key from many clients.
- The merge rule "union" is wrong for your data (Scene B).

**Real-world anchor.** The Amazon Dynamo shopping cart (2007 paper); Riak `allow_mult` siblings;
Voldemort.

**Sidecar / `toValue()`.** `mv-register` → one sibling: its `Value` with `meta.vc` (NEW meta field);
several: `{ kind:'siblings', items:[{ id, value, vc }] }` (NEW Value kind). `compare` works on
`meta.vc` paths.

#### Scene A — Siblings (`layout:'hub'`)

World: `alice` (Phone), `bob` (Laptop), `server` (the store). Slot `cart` = `mv-register` whose value is
a plain `set` of item names. Seeded: Alice added milk earlier → everyone `[milk]` with `{alice 1}`.

```
s01  say: "A shopping cart, Dynamo style. The store keeps the cart with a version vector. Phone and laptop each read a copy."
     { t:'crdt.init', actors:['alice','bob','server'], slot:'cart', type:'mv-register', args:{ seed:[{ by:'alice', op:'set', args:[['milk']] }] } }
     { t:'highlight', path:['alice.cart','bob.cart','server.cart'] }
s02  say: "Alice adds eggs on the phone. New version: {alice 2}."
     { t:'crdt.update', actor:'alice', slot:'cart', op:'set', args:[['milk','eggs']] }
s03  say: "Bob is offline. He adds bread on the laptop. His version: {alice 1, bob 1}."
     { t:'offline', actor:'bob' }
     { t:'crdt.update', actor:'bob', slot:'cart', op:'set', args:[['milk','bread']] }
s04  say: "Alice pushes. The store compares {alice 1} with {alice 2}: before. Fast-forward, the store takes it."
     { t:'compare', a:'server.cart.meta.vc', b:'alice.cart.meta.vc' }     // 'before'
     { t:'crdt.merge', into:'server', from:'alice', slot:'cart' }
s05  say: "Bob comes online and pushes {alice 1, bob 1}. Compare with {alice 2}: concurrent."
     { t:'online', actor:'bob' }
     { t:'compare', a:'server.cart.meta.vc', b:'bob.cart.meta.vc' }       // 'concurrent'
     { t:'crdt.merge', into:'server', from:'bob', slot:'cart' }
s06  say: "The store keeps both. Two siblings, two version vectors. It does not guess."
     { t:'highlight', path:'server.cart', tone:'warn' }
     { t:'callout', at:'server.cart', text:'2 siblings' }
s07  say: "Alice opens the cart. She gets both siblings, and the app must resolve them."
     { t:'crdt.merge', into:'alice', from:'server', slot:'cart' }
s08  say: "The app merges with a union: milk, eggs, bread. It writes back with a version that covers both: {alice 3, bob 1}."
     { t:'crdt.update', actor:'alice', slot:'cart', op:'set', args:[['milk','eggs','bread']] }   // vc = join(siblings) + alice tick
s09  say: "Push. {alice 3, bob 1} is after both siblings. The store collapses to one value."
     { t:'crdt.merge', into:'server', from:'alice', slot:'cart' }
     { t:'check', path:'server.cart' }
s10  say: "Bob pulls: one cart, three items."
     { t:'crdt.merge', into:'bob', from:'server', slot:'cart' }
     { t:'check', path:'bob.cart' }
s11  say: "Vector clocks found the conflict. The app decided what to do about it. Two different jobs."
     { t:'callout', at:'server', text:'detect (clock) ≠ resolve (app)', sticky:true }
```

#### Scene B — In context: the item that came back (`layout:'hub'`)

Same world; seeded so everyone has `[milk, eggs]` with `{alice 2}`.

```
s01  say: "Everyone starts with milk and eggs."
     { t:'crdt.init', actors:['alice','bob','server'], slot:'cart', type:'mv-register', args:{ seed:[{ by:'alice', op:'set', args:[['milk']] }, { by:'alice', op:'set', args:[['milk','eggs']] }] } }
s02  say: "Alice removes eggs: [milk], version {alice 3}."
     { t:'crdt.update', actor:'alice', slot:'cart', op:'set', args:[['milk']] }
s03  say: "Bob, offline, adds bread: [milk, eggs, bread], version {alice 2, bob 1}."
     { t:'offline', actor:'bob' }
     { t:'crdt.update', actor:'bob', slot:'cart', op:'set', args:[['milk','eggs','bread']] }
s04  say: "Both push. Concurrent. Siblings."
     { t:'online', actor:'bob' }
     { t:'crdt.merge', into:'server', from:'alice', slot:'cart' }
     { t:'crdt.merge', into:'server', from:'bob',   slot:'cart' }
     { t:'compare', a:'server.cart[0].meta.vc', b:'server.cart[1].meta.vc' }   // siblings addressed by index — 'concurrent'
s05  say: "The app's rule is union: milk, eggs, bread. Eggs came back — Alice had removed it!"    hold:'long'
     { t:'crdt.merge', into:'alice', from:'server', slot:'cart' }
     { t:'crdt.update', actor:'alice', slot:'cart', op:'set', args:[['milk','eggs','bread']] }
     { t:'highlight', path:'alice.cart', tone:'bad' }
     { t:'callout', at:'alice.cart', text:'eggs is back', tone:'bad' }
s06  say: "Union cannot tell 'removed' from 'never added'. Amazon's real cart had this exact bug."
     { t:'callout', at:'server', text:'Dynamo paper, §4.4', tone:'warn' }
s07  say: "The fix is a data type that records removes: the OR-Set. Vector clocks say 'conflict'; the CRDT says how to merge."
     { t:'callout', at:'alice', text:'clock: detect · CRDT: merge', sticky:true }
```

---

### IV.5 `hybrid-logical-clocks` — Hybrid logical clocks (brief)

**Goal.** An HLC is a wall time plus a small counter. It stays close to real time, never goes
backwards, and keeps cause before effect — so it is a safe LWW timestamp along a causal chain.

**When to use**

- LWW stamps where humans also want "when" (notes, settings, CRMs).
- Replacing raw wall-clock stamps in an existing LWW design — same size, fewer surprises.
- Ordering across a cluster with bounded skew (CockroachDB).
- You want one stamp for both "sort by time" and "cause before effect".

**When not to use**

- You must _detect_ concurrency — an HLC is a total order; it hides independence (use vector clocks).
- Skew is unbounded (hours) — the counter part absorbs small skew, not wild clocks.
- A pure logical order is enough — Lamport is simpler.
- Stamps must be exactly wall time — an HLC can run ahead of the wall.

**Real-world anchor.** CockroachDB; many offline-first sync engines stamp LWW fields with HLCs.

**Sidecar / `toValue()`.** `hlc` → `record { wall: scalar time, c: scalar }`. Messages show the stamp.

#### Scene A — Wall time plus a counter (`layout:'pair'`, scene `clock:{ format:'time', start:'10:00' }`)

World: `alice` (Phone, skew +5), `bob` (Laptop). Slot `hlc` = `hlc`.

```
s01  say: "An HLC has two parts: a wall time and a counter. Each device starts at its own clock reading, counter 0."
     { t:'crdt.init', actors:['alice','bob'], slot:'hlc', type:'hlc' }
     { t:'skew', actor:'alice', by:5 }
s02  say: "Alice edits and sends it to Bob. One event: her HLC ticks to (10:05, 1). The message carries that stamp."
     { t:'crdt.broadcast', from:'alice', slot:'hlc', to:['bob'], id:'m1' }
s03  say: "Bob's wall clock says 10:00. He receives (10:05, 1). Rule: take the biggest wall time of the three — his clock, his HLC, the message."
     { t:'crdt.apply', message:'m1' }
     { t:'callout', at:'bob.hlc', text:'max(10:00, 10:00, 10:05) = 10:05' }
s04  say: "The biggest is the message's 10:05. So Bob's HLC becomes (10:05, 2): same wall part, counter one more than the message."
     { t:'highlight', path:'bob.hlc' }
s05  say: "Bob's HLC is now ahead of his own wall clock. That is allowed. It waits there until real time catches up."
     { t:'callout', at:'bob.@clock', text:'wall 10:00 · HLC 10:05', tone:'warn' }
s06  say: "Bob edits: (10:05, 3). Seven minutes later his clock reads 10:07, and the next edit is (10:07, 0). The counter resets when the wall part moves."
     { t:'crdt.update', actor:'bob', slot:'hlc', op:'tick', args:[] }
     { t:'tick', by:7 }
     { t:'crdt.update', actor:'bob', slot:'hlc', op:'tick', args:[] }
s07  say: "Never backwards, cause before effect, and close to real time. Two rules, three properties."
     { t:'callout', at:'bob.hlc', text:'monotonic · causal · ≈ wall time', sticky:true }
```

#### Scene B — In context: the title, fixed (`layout:'pair'`, scene clock `10:00`)

Re-runs IV.1 Scene A with HLC stamps. The LWW register reads its timestamps from the actor's `hlc`
slot (`args:{ clock:{ slot:'hlc' } }`, NEW).

```
s01  say: "Same phone, five minutes fast. Same laptop. But now the LWW stamps come from an HLC."
     { t:'crdt.init', actors:['alice','bob'], slot:'hlc',   type:'hlc' }
     { t:'skew', actor:'alice', by:5 }
     { t:'crdt.init', actors:['alice','bob'], slot:'title', type:'lww-register', args:{ clock:{ slot:'hlc' }, seed:[{ by:'alice', op:'set', args:['Untitled'] }] } }
s02  say: "Alice renames to 'Draft' at her 10:05: stamp (10:05, 1). She syncs to Bob."
     { t:'crdt.update', actor:'alice', slot:'title', op:'set', args:['Draft'] }
     { t:'crdt.sync', a:'alice', b:'bob', slot:'title' }        // carries the HLC stamp; bob.hlc runs the receive rule (NEW: sync of a clocked type updates the clock)
s03  say: "Bob's HLC jumped to (10:05, 2) when the edit arrived, even though his wall clock says 10:00."
     { t:'highlight', path:'bob.hlc' }
s04  say: "Bob renames to 'Final'. Stamp (10:05, 3) — bigger than Draft's, because Bob saw Draft first."
     { t:'tick', by:2 }
     { t:'crdt.update', actor:'bob', slot:'title', op:'set', args:['Final'] }
s05  say: "Sync. 'Final' wins on both. The write that knew about the other one won."
     { t:'crdt.sync', a:'alice', b:'bob', slot:'title' }
     { t:'check', path:'alice.title' }
     { t:'check', path:'bob.title' }
s06  say: "HLC fixes 'I saw it, but my clock is behind'. It does not fix two people editing at the same moment with no contact. No clock can."
     { t:'callout', at:'bob', text:'causal: fixed · concurrent: still a tie-break', tone:'warn', sticky:true }
```

---

### IV.6 `in-context-notes-sync` — In context: a notes app that syncs

**Goal.** A note is a composed document: LWW title and body stamped with HLCs (II + IV), an OR-Set of
tags (II/III), and a version vector per note (IV). The vector clock decides _whether_ there is anything
to resolve; the CRDT parts decide _how_; the app decides what the user sees.

**When to use** — this shape fits most "personal data across devices" apps: notes, todos, settings, bookmarks.
**When not to use** — shared long-form text with heavy simultaneous editing (use RGA for the body, III.6);
data with invariants (money, seats) — use a transaction.

**Real-world anchor.** Apple Notes, Evernote "conflicting modification", Dropbox "conflicted copy".

World for all scenes: `alice` (Phone, skew +5), `bob` (Laptop), `server`; scene `clock` `10:00`.
Slot `note` = composed doc (NEW `crdt.init` schema form):

```
{ t:'crdt.init', actors:['alice','bob','server'], slot:'note', type:'doc',
  schema:{ title:{ type:'lww-register', clock:'hlc' }, body:{ type:'lww-register', clock:'hlc' }, tags:'or-set' },
  version:'vector-clock',                                   // the doc ticks its own entry on every local update, joins on merge
  args:{ seed:[{ by:'alice', path:'title', op:'set', args:['Groceries'] }, { by:'alice', path:'body', op:'set', args:['Buy milk'] }] } }
```

Seeded state is the baseline: seeds do not tick `version`, so every copy starts at `{}`. The `clock`
renderer labels entries by actor label (Phone/Laptop), which is what the narration uses.

#### Scene A — Fast-forward (`layout:'hub'`)

```
s01  say: "A note on phone, laptop and server: title, body, tags. Each copy carries a version vector and an HLC."
     // crdt.init (above)
     { t:'highlight', path:['alice.note.meta.vc','bob.note.meta.vc','server.note.meta.vc'] }
s02  say: "The phone edits the title. Version {phone 1}. The title gets an HLC stamp."
     { t:'crdt.update', actor:'alice', slot:'note', path:'title', op:'set', args:['Groceries (Sat)'] }
s03  say: "Push to the server. Compare versions: {} before {phone 1}. Fast-forward: the server just takes it."
     { t:'compare', a:'server.note.meta.vc', b:'alice.note.meta.vc' }     // 'before'
     { t:'crdt.merge', into:'server', from:'alice', slot:'note' }
s04  say: "The laptop pulls. Same story: fast-forward. No merge work, no banner."
     { t:'compare', a:'bob.note.meta.vc', b:'server.note.meta.vc' }       // 'before'
     { t:'crdt.merge', into:'bob', from:'server', slot:'note' }
     { t:'check', path:'bob.note' }
s05  say: "Most syncs look like this. The vector clock says 'nothing to resolve' and the app skips the work."
     { t:'callout', at:'server', text:'fast-forward = no conflict', sticky:true }
```

#### Scene B — Concurrent, different fields (`layout:'hub'`)

Continues from A's end state (seed accordingly).

```
s01  say: "The phone goes offline and edits the body: 'Buy milk and eggs'. Version {phone 2}."
     { t:'offline', actor:'alice' }
     { t:'crdt.update', actor:'alice', slot:'note', path:'body', op:'set', args:['Buy milk and eggs'] }
s02  say: "The laptop adds the tag 'home'. Version {phone 1, laptop 1}. Push; the server fast-forwards."
     { t:'crdt.update', actor:'bob', slot:'note', path:'tags', op:'add', args:['home'] }
     { t:'crdt.merge', into:'server', from:'bob', slot:'note' }
s03  say: "The phone comes online and pushes. Compare: {phone 1, laptop 1} vs {phone 2}. Concurrent."
     { t:'online', actor:'alice' }
     { t:'compare', a:'server.note.meta.vc', b:'alice.note.meta.vc' }     // 'concurrent'
s04  say: "The server merges field by field with the CRDT rules: body by LWW (only the phone changed it), tags by union."
     { t:'crdt.merge', into:'server', from:'alice', slot:'note' }
     { t:'highlight', path:['server.note.body','server.note.tags'] }
s05  say: "Version after merge: the join, {phone 2, laptop 1}. Both devices pull. Everyone agrees."
     { t:'crdt.merge', into:'alice', from:'server', slot:'note' }
     { t:'crdt.merge', into:'bob',   from:'server', slot:'note' }
     { t:'check', path:'alice.note' } { t:'check', path:'bob.note' } { t:'check', path:'server.note' }
s06  say: "The app shows a small 'merged' badge. Nothing was lost: the two edits touched different fields."
     { t:'callout', at:'bob.note', text:'merged — 2 devices', sticky:true }
```

#### Scene C — Concurrent, same field (`layout:'hub'`)

```
s01  say: "Both edit the body offline. Phone: 'Buy oat milk'. Laptop: 'Buy milk, eggs, bread'."
     { t:'offline', actor:'alice' }
     { t:'offline', actor:'bob' }
     { t:'crdt.update', actor:'alice', slot:'note', path:'body', op:'set', args:['Buy oat milk'] }
     { t:'crdt.update', actor:'bob',   slot:'note', path:'body', op:'set', args:['Buy milk, eggs, bread'] }
s02  say: "Both push. Concurrent again — and this time the same field."
     { t:'online', actor:'alice' }
     { t:'online', actor:'bob' }
     { t:'crdt.merge', into:'server', from:'alice', slot:'note' }
     { t:'compare', a:'server.note.meta.vc', b:'bob.note.meta.vc' }       // 'concurrent'
     { t:'conflict', a:'server.note.body', b:'bob.note.body' }
s03  say: "LWW on the body keeps one: the bigger HLC stamp. The phone's clock is fast, so the phone wins. The laptop's text would vanish."
     { t:'crdt.merge', into:'server', from:'bob', slot:'note' }
     { t:'highlight', path:'server.note.body', tone:'warn' }
s04  say: "The app has a choice: trust LWW, or keep a conflict copy. This app keeps a copy: a second note, 'Groceries (conflict, Laptop)'."
     { t:'set', path:'server.conflictCopy', value:{ kind:'record', fields:[ { key:'title', value:{ kind:'scalar', value:'Groceries (conflict, Laptop)' } }, { key:'body', value:{ kind:'scalar', value:'Buy milk, eggs, bread' } } ] } }   // app logic, simplified — not a merge result
     { t:'callout', at:'server.conflictCopy', text:'app-level choice' }
s05  say: "The user sees both and decides. Nothing silently disappeared."
     { t:'crdt.merge', into:'alice', from:'server', slot:'note' }
     { t:'crdt.merge', into:'bob',   from:'server', slot:'note' }
s06  say: "Another choice: make the body an RGA (Unit III) and merge the characters. Then both edits survive in one text."
     { t:'callout', at:'server.note.body', text:'or: body = RGA → character merge' }
s07  say: "Vector clock: finds it. CRDT: merges it. App: decides what the user sees. Three layers, three jobs."
     { t:'callout', at:'server', text:'detect · merge · present', sticky:true }
```

---

## C. DSL gaps found (v0 → proposals)

Ordered by severity. "Used in" lists the scenes that need it. Shapes are TypeScript-literal sketches.

### Blockers

| #   | Gap                                      | What was needed                                                                                                                                                         | Proposal                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Used in                |
| --- | ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- |
| C1  | **Composed documents** (open question 3) | A doc with several CRDT parts (counters in a record, OR-Set of records with counters, LWW fields + OR-Set + a version vector) driven by real code, with per-part paths. | `{ t:'crdt.init', actors, slot, type:'doc', schema: Schema, version?: 'vector-clock', args? }` where `Schema = Record<string, CrdtType \| { type: CrdtType; of?: Schema; clock?: 'hlc'; value?: unknown }>`; `'const'` for immutable fields. `crdt.update` gains `path?: string` into the doc (`'tracks[alice:1].plays'`). OR-Set elements that are records are keyed by the tag of the add that created them. `toValue()` composes part values into a `record`.                                                                                            | III.3 D, III.4 E, IV.6 |
| C2  | **Op-based plumbing is under-specified** | Authors must be able to predict message ids, target a subset of recipients, reference a held message later, and know where time/ids come from.                          | (a) message id from `crdt.broadcast` = `<opId>@<recipient>`, `@…` optional with 2 actors, author override via `id`; (b) `crdt.broadcast { to?: ActorId[] }`; (c) `crdt.update` applies locally **and** queues the op in the actor's outbox (drawn as chips); `crdt.broadcast` flushes; (d) op id = `<node>:<seq>` with a dense per-node sequence; RGA elements additionally carry `meta.ts` (Lamport) for the tie-break; (e) reducer **throws** if `crdt.apply` is called before the op's causal deps are applied (keeps impossible states out of lessons). | every op-based scene   |

### Important

| #   | Gap                                         | What was needed                                                                                                                                                        | Proposal                                                                                                                                                                                                                                                                                                                                                                                                                                                          | Used in                               |
| --- | ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| C3  | **Parked messages** (causal buffering)      | Show a message that has _arrived_ but cannot be applied yet, then apply it later.                                                                                      | `{ t:'deliver', message, park:true }` → lands in the recipient's inbox tray (drawn docked at the actor). A later `deliver` (plain values) or `crdt.apply` (CRDT) of the same id applies it. Messages sent to an **offline** actor park automatically at its door.                                                                                                                                                                                                 | III.1 C, III.4 D, III.3 D, III.7 C    |
| C4  | **`compare` command**                       | Named in CLAUDE.md §4, missing from v0. Needed for vector clocks (before/after/concurrent/equal), Lamport numbers, op-id tie-breaks.                                   | `{ t:'compare', a: Path \| 'op:<id>', b: Path \| 'op:<id>', result?: 'before'\|'after'\|'concurrent'\|'equal'\|'less'\|'greater' }` — result is **computed** by `src/crdt/clocks` when both sides are clocks or op ids; the author may pass `result` only for plain values. Renderer: side-by-side with per-entry marks and a verdict chip.                                                                                                                       | III.5 C, IV.2 B, IV.3 B/C, IV.4, IV.6 |
| C5  | **Per-actor wall clock + skew**             | Wall-clock LWW scenes need each actor's clock to read differently, drift, and jump.                                                                                    | Scene option `clock?: { format:'counter'\|'time'; start?: string }`; `{ t:'skew', actor, by: number }` (minutes when `format:'time'`); actor badge addressable as `<actor>.@clock`; `crdt.update` on timestamped types reads `world.clock + skew`. Scenes start at the earliest time they need; no negative ticks.                                                                                                                                                | IV.1, IV.5, IV.6                      |
| C6  | **Message envelope / stamp**                | Messages must _visibly_ carry an op id, a Lamport/vector/HLC stamp, or deps.                                                                                           | `Message.envelope?: { opId?: string; stamp?: number \| Record<ActorId,number> \| { wall, c }; deps?: string[]; label?: string }` drawn as a small badge on the packet. `crdt.broadcast` fills it. For plain `send`: `stamp?: { slot }` (runs the clock's send rule and attaches the stamp) and `deliver … recv?: { slot }` (runs the receive rule). `crdt.sync`/`crdt.merge` of a type whose `args.clock` names a clock slot also runs that clock's receive rule. | IV.2 C, IV.3 C, IV.5 B, all op-based  |
| C7  | **Siblings + version vectors on values**    | MV-Register must show several values, each with its own version vector; plain values in sync scenes need a vc.                                                         | `Meta.vc?: Record<ActorId, number>`; new Value kind `{ kind:'siblings'; items: Array<{ id: string; value: Value; vc: Record<ActorId,number> }>; meta? }`; path `server.cart[0]` addresses a sibling by index.                                                                                                                                                                                                                                                     | IV.4, IV.6                            |
| C8  | **Text rendering of RGA**                   | A `list` of one-char scalars with ids and tombstones should read as a line of text with ids beneath and struck-through tombstones; a todo RGA should read as a column. | `list.display?: 'row' \| 'column' \| 'text'` (set by `rga.toValue()` from `args.seed.text` vs `items`). `rga.toValue()` meta: `{ live, dead, seen: clock }` (badge). Alternatively extend `text` with `items`; `list.display` is the smaller change.                                                                                                                                                                                                              | III.5, III.6, III.7, IV.3 C           |
| C9  | **Meta addressing in paths**                | Highlight/compare/send the _sidecar_ itself (a value's `vc`, an RGA's `seen` clock, an item's tags).                                                                   | Allow `.meta.<key>` as a terminal path segment: `alice.note.meta.seen`, `server.cart.meta.vc`; `{ ref: 'alice.note.meta.seen' }` as a payload.                                                                                                                                                                                                                                                                                                                    | III.7 C/D, IV.3 C, IV.4, IV.6         |
| C10 | **Seed / initial CRDT state**               | Most scenes start from a shared non-empty state. `args` is unspecified in v0.                                                                                          | `args.seed`: for op-based/state-based types an array of `{ by, op, args, path? }` applied at _every_ replica as already-delivered ops (they consume ids `by:1…`); for RGA the shorthand `{ by, text }` or `{ by, items }`. Seeds never tick a doc's `version` vector.                                                                                                                                                                                             | nearly every scene                    |
| C11 | **Convenience ops that expand to real ops** | Typing a word or deleting a range as one authoring line, while each character is still its own op with its own id.                                                     | `rga` ops `type(afterId, string)` and `deleteRange(fromId, toId)`; implementation expands to N ops, each broadcast as its own message.                                                                                                                                                                                                                                                                                                                            | III.6, III.7, IV.3 C                  |
| C12 | **Garbage collection command**              | Show tombstones being removed only when stable.                                                                                                                        | `{ t:'crdt.gc', actor, slot, upTo: Record<ActorId,number> }` → implementation drops tombstones whose delete op is ≤ `upTo` in every entry; reducer validates `upTo` against what the actor can know (or trusts the author and `verify` flags it).                                                                                                                                                                                                                 | III.7 C/D                             |
| C13 | **`sort` command**                          | Server orders a log by (stamp, node); also needed by regex/columnar prototypes per overview.                                                                           | `{ t:'sort', path: Path, by: Array<'value' \| 'meta.ts' \| 'meta.node' \| 'id'> }` — animates reorder with `layoutId`.                                                                                                                                                                                                                                                                                                                                            | IV.2 C                                |
| C14 | **Op-based `crdt.sync`**                    | Vector-clock-driven delta sync ("send what the other lacks") for op-based types.                                                                                       | `crdt.sync` on an op-based type computes the delta from both replicas' `seen` clocks and emits messages named by op id (`<opId>@<recipient>`), to be applied with `crdt.apply`.                                                                                                                                                                                                                                                                                   | IV.3 C                                |
| C15 | **Outbox / applied-ops visibility**         | Op-based lessons talk about "ops waiting to be sent" and "ops applied".                                                                                                | Reducer keeps `actor.outbox: Array<{ opId, label }>`; renderer draws chips beside the actor; `op-counter.toValue()` = `record { count, applied: set }`. No new Value kind needed.                                                                                                                                                                                                                                                                                 | III.3, III.4                          |
| C16 | **Duplicate message**                       | "Retry" sends the _same_ op again; v0 needs a second `send` with a different id, which is visually a different packet.                                                 | `{ t:'duplicate', message: string, id: string, label?: string }` — draws a copy splitting off the original (v0 fallback: a second `send`).                                                                                                                                                                                                                                                                                                                        | III.1 B                               |
| C17 | **Callout / highlight on a message**        | Point at a packet in flight ("this one overtook that one").                                                                                                            | `callout.at` and `highlight.path` accept `'msg:<id>'`.                                                                                                                                                                                                                                                                                                                                                                                                            | III.1 C, III.4 C                      |
| C18 | **i18n of texts inside commands**           | `callout.text` lives in `do`, not in `say`; overlays key on step ids only.                                                                                             | Overlay schema addresses `steps.<stepId>.callouts[<n>]` (ordinal within the step) or `callout` gets an optional `key`. Decide before authoring ar/zh.                                                                                                                                                                                                                                                                                                             | every callout                         |

### Nice to have

| #   | Gap                                            | Proposal                                                                                                                                      | Used in       |
| --- | ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ------------- |
| C19 | Inline links in narration                      | `say` accepts a tiny markdown subset: `[UUIDs](/uuids/v4)` rendered as an in-app `Link`.                                                      | III.2 C       |
| C20 | `lww-register` / `lww-map` with a clock source | `args.clock: { slot }` so stamps come from an HLC instead of the wall.                                                                        | IV.5 B, IV.6  |
| C21 | Focus / zoom (open question 2)                 | Not needed in this slice; layout + highlight + `compare` sufficed. Possible later: `{ t:'inspect', at: 'msg:<id>' }` to enlarge one envelope. | —             |
| C22 | Multi-op per message                           | v0 emits one message per op; fine for legibility. A `batch:true` on `crdt.broadcast` (one packet, N ops) could shorten III.7 B/D and IV.3 C.  | III.7, IV.3 C |
| C23 | Actor `kind:'device'` labels                   | Scenes use "Phone"/"Laptop"/"Tablet" for the same semantic colors a/b/c — confirm the palette maps by `color`, not by `id`.                   | III.2, IV.*   |

### Things v0 handles fine (no change)

`offline`/`online`, `conflict`, `check`/`cross`, `callout` with `sticky`, `layout` presets (`pair`,
`triangle`, `hub` covered everything), `bytes` for the UUID cameo, `clock` Value kind for vector clocks,
`hold:'long'` for "Whoops" steps, per-step determinism (every step here is a legible static frame).

---

## D. Authoring ergonomics

The scripts above are long mostly because of repeated literal shapes. A small builder layer makes them
short without hiding anything from the Zod schema.

### D.1 Builders that would have cut these scripts by ~60%

```ts
// actors
const { alice, bob, carol, server } = actors({
  alice: 'person',
  bob: 'person',
  carol: 'person',
  server: 'server',
})
const phone = device('alice', 'Phone'),
  laptop = device('bob', 'Laptop')

// scene + steps
scene('exactly-once', { layout: 'pair', actors: [alice, bob], holds: { likes: 0 } }, [
  step(
    's01',
    'A naive op-based counter. The op is just "add 1".',
    highlight(['alice.likes', 'bob.likes']),
  ),
  step('s06', 'Whoops — Bob says 2, Alice says 1.', conflict('alice.likes', 'bob.likes')).hold(
    'long',
  ),
])

// values
scalar(0)
record({ title: 'Groceries', items: list(['milk', 'eggs']) })
setOf([])
clock({ alice: 2, bob: 1 })
uuidBytes('9f3a116c-2b8e-4d71-a50c-7e19d2449b03') // bytes + version/variant annotations

// plain commands
set('alice.likes', 1)
insert('bob.list', 'milk')
del('bob.list', 'milk')
send(alice, bob, '+1', { id: 'op1', tag: 'alice:1' })
deliver('op1')
park('op4')
dup('op1', 'op1-retry')
callout(bob, 'duplicate — ignored')
check('bob.likes')

// crdt
const likes = crdt('likes', 'op-counter', [alice, bob, carol])
likes.init()
likes.inc(alice)
likes.dec(alice)
likes.broadcast(alice)
likes.apply('alice:1@bob')
likes.sync(alice, bob)
likes.merge(server, alice)
const text = crdt('text', 'rga', [alice, bob], { seed: typed(alice, 'cat') })
text.insertAfter(bob, 'alice:1', 'h')
text.type(alice, 'alice:5', ' world')
text.delete(alice, 'alice:1')
applyAll(text, ['alice:6', 'alice:7', 'alice:8']) // N applies in one step
const note = doc(
  'note',
  [alice, bob, server],
  { title: lww({ clock: 'hlc' }), body: lww({ clock: 'hlc' }), tags: orset() },
  { version: 'vc' },
)
note.set(alice, 'title', 'Groceries')
note.add(bob, 'tags', 'home')
note.merge(server, alice)

// clocks
const vc = clock('vc', 'vector', [alice, bob, carol])
vc.tick(alice)
vc.send(alice, bob, 'm1')
vc.recv('m1')
compare('alice.A', 'bob.B') // result computed
skew(alice, +5)
tick(2)

// ids
op(alice, 3) // 'alice:3'      msg(op(alice,3), bob) // 'alice:3@bob'
```

### D.2 Rules the builders should enforce (cheap lints, fail `pnpm test`)

- Step ids unique per scene, `s\d\d`, append-only (a snapshot file of ids per scene; removing or renumbering fails).
- Narration ≤ 2 sentences, ≤ ~160 characters; flag a third sentence.
- Every message id referenced by `deliver`/`apply`/`drop` was created earlier in the same scene.
- Every `crdt.apply` target is causally ready (C2e); every `crdt.gc.upTo` is provable from delivered acks (or the step is flagged `simplified:true`).
- Paths resolve against the world at that step (typo detection); `'msg:<id>'` and `'op:<id>'` resolve too.
- A scene with `hold:'long'` steps must also contain a `conflict`/`cross`/`bad` mark (the "Whoops" convention).
- Max 5 actors; max ~7 visible items per list (tombstones excluded) — warn above.

### D.3 Repetition that wants a helper, not a DSL change

- "broadcast, then apply at everyone" → `syncAll(likes, { from: alice })` expands to broadcast + N applies **in the same step**; when the lesson wants to show order mattering, authors write the applies by hand (as above).
- "rewind" (reset a slot to an earlier state) → `rewind(bob, 'likes')`; today it is a `set` back to the seed.
- Seeding shared state → `seed:` arg (C10) or `scene.holds` for plain values.

### D.4 Content-style notes learned while writing

- Narration must state the _computed_ numbers (ts, clock entries, op ids). Keep the seeds tiny so the numbers in `say` are easy to re-check against the implementation; the verify walker should assert `say` numbers against stage text where possible.
- Every "Whoops" gets `hold:'long'` and a `conflict`/`cross`/`bad` mark, then a "The fix:" step.
- Use `(simplified)` when the stage does something a real system would not (plain values in III.1/III.2, the app-level conflict copy in IV.6 C).
- Op ids read best as `alice:3`; vector clocks as `{alice 2, bob 1}`; HLCs as `(10:05, 2)`.

---

## E. What `src/crdt/` must provide for this slice

| Type                                 | Ops                                                  | Notes                                                                                                                                |
| ------------------------------------ | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `op-counter`                         | `inc`, `dec`, `compact`                              | dedupe set of op ids; `toValue` = `record { count, applied }`                                                                        |
| `op-or-set`                          | `add`, `remove`                                      | tags = op ids; `remove` carries observed tags; `toValue` = `set` with `tags`                                                         |
| `rga`                                | `insertAfter`, `delete`, `type`, `deleteRange`, `gc` | ids `node:seq`; `meta.ts` Lamport per element; `head` anchor; tie-break (ts, node) bigger first; `toValue` = `list` (`display:'text' | 'column'`) with `meta { live, dead, seen }` |
| `doc`                                | schema-driven composition                            | parts above + Unit II types; optional `version:'vector-clock'`                                                                       |
| `lamport`                            | `tick(n?)`, `send`, `recv`                           | `toValue` = scalar                                                                                                                   |
| `vector-clock`                       | `tick(n?)`, `send`, `recv`, `compare`, `join`        | `toValue` = `clock`                                                                                                                  |
| `hlc`                                | `tick`, `send`, `recv`, `compare`                    | `toValue` = `record { wall, c }`; reads `world.clock + skew`                                                                         |
| `mv-register`                        | `set`, `merge`                                       | version vectors per sibling; `toValue` = value with `meta.vc` or `siblings`                                                          |
| `lww-register` / `lww-map` (Unit II) | `set`                                                | gain `args.clock` (C20) and skew-aware wall time (C5)                                                                                |

Property tests to add: RGA convergence under any delivery order respecting causality (fast-check with
random op interleavings); OR-Set add-wins under concurrent add/remove; MV-Register sibling maximality;
vector-clock compare laws (antisymmetry, transitivity); HLC monotonicity and "recv ≥ stamp".
