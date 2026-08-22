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

| Thing | Format | Example |
| --- | --- | --- |
| Op id (op-based types, RGA element ids) | `<node>:<counter>` — counter is the replica's own Lamport counter inside the type | `alice:3` |
| Message from `crdt.broadcast` | `<opId>@<recipient>` (one message per recipient). With exactly two actors the `@…` suffix may be omitted. Author may override with `id`. | `alice:3@bob` |
| Message from `send` | author-given `id` | `m1` |
| Path | `actor.slot[.field…]`, list/set items by id in brackets | `bob.doc.items[alice:2]` |
| Vector clock in narration | `{alice 2, bob 1}` (plain words; the stage draws the real thing) | |

### A.3 Where time comes from (proposed rule — the v0 draft leaves it implicit)

- `crdt.update` on a timestamped type (LWW, HLC) reads **wall time = `world.clock` + actor skew**
  (skew defaults to 0; see `skew` NEW in §C). `tick` advances `world.clock`.
- Op-based types and RGA keep their own per-replica Lamport counter; authors never pass it.
- Clocks (Lamport / vector / HLC) are real implementations in `src/crdt/clocks/` and are driven by
  the same `crdt.*` commands: `crdt.update … op:'tick'`, `crdt.broadcast` stamps, `crdt.apply`
  runs the receive rule.

### A.4 Sidecar metadata the renderer must draw (all through `Value.meta`, via each type's `toValue()`)

| Type | Sidecar shown |
| --- | --- |
| op-counter | per-actor list of **applied op ids** (dedupe set) |
| op-or-set | per item: the set of **tags** (`alice:1`), each tag is an op id |
| rga | per item: **id**, **tombstone** flag; the per-replica Lamport counter |
| lamport / vector / hlc | the clock value itself (`clock` Value kind, or `record {wall, c}` for HLC) |
| mv-register (Unit IV) | per sibling: its **version vector** (`Meta.vc` NEW) |
| lww-register (reused) | `ts`, `node` |

### A.5 Topic list for this slice (changes vs. `outline.md` are marked)

| Id | Title | Change |
| --- | --- | --- |
| III.1 `ops-instead-of-state` | Ops instead of state | 3 scenes (wire, exactly-once, causal order). If runtime is too long, split scene C into a topic `causal-delivery`. |
| III.2 `every-device-needs-a-name` | Every device needs a name | In-context scene covers III.1 + III.2 ("the op envelope"). |
| III.3 `op-counter` | Op-based counter | — |
| III.4 `op-or-set` | Op-based OR-Set | — |
| III.5 `sequences-rga` | Sequences (RGA) | — |
| III.6 `in-context-collab-text` | In context: collaborative text + todo list | 2 scenes; adds the "concurrent move duplicates an item" moment. |
| III.7 `tombstones-and-garbage` | Tombstones and garbage | Ends with a forward link to Unit IV (stability needs clocks). |
| IV.1 `wall-clocks-lie` | Wall clocks lie | — |
| IV.2 `lamport-clocks` | Lamport clocks | — |
| IV.3 `vector-clocks` | Vector clocks | — |
| IV.4 `detecting-conflicts` | Detecting conflicts: siblings and the MV-Register | **Adds** the Multi-Value Register as a named data type (it is the data type that *holds* siblings). Needs a real `mv-register` in `src/crdt/`. |
| IV.5 `hybrid-logical-clocks` | Hybrid logical clocks (brief) | 2 short scenes. |
| IV.6 `in-context-notes-sync` | In context: a notes app that syncs | Module-level synthesis: LWW-map (II) + OR-Set (III) + vector clock & HLC (IV). |

---

## B. Lesson scripts

## Unit III — Operation-based CRDTs (send what you did)

Unit-level note: from III.3 on, every data type is driven by `crdt.*` and the real implementation
computes state. III.1 and III.2 deliberately use plain values and `set`/`insert`, because they teach
*the wire*, not a type; they also show a **broken** naive approach, which no real CRDT could compute.

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

