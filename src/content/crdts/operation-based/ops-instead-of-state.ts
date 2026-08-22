/**
 * III.1 — Ops instead of state. The first scene uses plain values on purpose: it teaches the wire
 * (what travels, and what a naive retry does), not a data type — no real CRDT could compute the
 * double add. The other two scenes drive the real op-counter and OR-Set through the delivery
 * layer: op ids, the applied list (dedupe) and parking until causal order holds.
 * Storyboard: docs/curriculum/unit-3-4.md §III.1.
 */
import {
  topic,
  scene,
  step,
  alice,
  bob,
  carol,
  list,
  scalar,
  ref,
  send,
  deliver,
  duplicate,
  insert,
  note,
  highlight,
  callout,
  conflict,
  cross,
  check,
  clearMarks,
  same,
  crdt,
  opcounter,
  orSet,
  apply,
  tomb,
  expect,
} from '@/lesson/builders'

const ITEMS = ['milk', 'eggs', 'bread', 'apples', 'rice', 'tea']
const groceries = () => list(ITEMS)

export default topic({
  id: 'ops-instead-of-state',
  title: 'Ops instead of state',
  goal: 'Explain what an op-based CRDT puts on the wire, and name the two delivery rules it needs: every op once, and in causal order.',
  whenToUse: [
    'Ops are small and the state is big (long documents, long lists).',
    'You have a reliable channel: a sync server, a log, a queue that can drop repeats.',
    'Edits are frequent and tiny (typing, dragging).',
    'You want "who did what" for free: the op log is an audit trail.',
  ],
  whenNotToUse: [
    'The network repeats or reorders and you cannot add op ids and buffering: send state.',
    'Replicas can be offline for a very long time: op logs grow, a state blob is one message.',
    'New replicas must join cheaply: a state snapshot is simpler (real systems do both).',
    'The ops do not commute and you cannot add causal metadata.',
  ],
  realWorld:
    'Figma multiplayer sends property-change ops through a server; Yjs and Automerge sync by exchanging ops, plus a state snapshot for a new peer.',
  scenes: [
    scene(
      'on-the-wire',
      {
        layout: 'triangle',
        actors: [
          alice({ icon: 'phone', holds: { list: groceries() } }),
          bob({ icon: 'laptop', holds: { list: groceries() } }),
          carol({ icon: 'tablet', holds: { list: groceries() } }),
        ],
      },
      [
        step(
          's01',
          'Alice, Bob and Carol each hold a copy of one shopping list: six items.',
          highlight(['alice.list', 'bob.list', 'carol.list']),
        ),
        step(
          's02',
          'Alice adds butter. Now she has to tell the others.',
          insert('alice.list', 'butter'),
          expect('alice.list', [...ITEMS, 'butter']),
        ),
        step(
          's03',
          'The Unit II way: send the whole state. Seven items travel to Bob for one change.',
          send('alice', 'bob', ref('alice.list'), {
            id: 'm1',
            label: 'whole list',
            into: 'bob.list',
          }),
        ),
        step(
          's04',
          'Bob merges; his list was equal to hers, so the merge is a copy (simplified). It works, but the message was big.',
          deliver('m1'),
          callout('bob.list', '7 items for 1 change', { tone: 'warn' }),
          expect('bob.list', [...ITEMS, 'butter']),
        ),
        step(
          's05',
          'The op-based way: send only what you did. Alice sends Carol one line: add butter.',
          clearMarks(),
          send('alice', 'carol', 'add butter', { id: 'op1', label: 'op' }),
        ),
        step(
          's06',
          "Carol's connection is slow. Alice's app retries: the same op takes off a second time.",
          duplicate('op1', 'op1-retry'),
        ),
        step(
          's07',
          'The first copy lands, and Carol applies it to her own list: butter. Same result as Bob, tiny message.',
          deliver('op1'),
          insert('carol.list', 'butter'),
          check('carol.list[butter]'),
          same('bob.list', 'carol.list'),
        ),
        step(
          's08',
          'The retry lands. Carol applies it again: add butter.',
          clearMarks(),
          deliver('op1-retry'),
          insert('carol.list', { id: 'butter-2', value: scalar('butter') }),
        ),
        step.long(
          's09',
          'Whoops — Carol has butter twice, Alice once. One add became two.',
          conflict('alice.list', 'carol.list'),
          cross('carol.list[butter-2]'),
        ),
        step(
          's10',
          'The fix: give every op an id, and let each copy remember the ids it has applied. A repeat is then ignored.',
          clearMarks(),
          note('rule', '1. every op is applied once'),
        ),
        step.long(
          's11',
          'Send what you did, not what you have. It works only under two rules: every op once, and in **causal order**.',
          note('rule', '1. every op is applied once · 2. ops are applied in causal order'),
        ),
      ],
    ),
    scene(
      'every-op-once',
      { layout: 'pair', actors: [alice({ icon: 'phone' }), bob({ icon: 'laptop' })] },
      [
        step(
          's01',
          'A like counter, the real thing this time. Every op gets an id, and each copy keeps a list of the ids it has applied.',
          crdt.init(['alice', 'bob'], 'likes', 'op-counter', { wire: 'ops', expose: ['applied'] }),
          note('rule', 'op id = node:counter · a copy skips an id it has applied'),
          expect('alice.likes', 0),
        ),
        step(
          's02',
          'Alice taps like. Her copy says 1, and her outbox holds one op, alice:1: inc 1.',
          opcounter('likes').inc('alice'),
          highlight('alice@outbox'),
          expect('alice.likes', 1),
          expect('alice@outbox', ['alice:1']),
        ),
        step(
          's03',
          'She broadcasts. The op flies to Bob with its id on the envelope.',
          crdt.broadcast('alice', 'likes'),
        ),
        step(
          's04',
          "The network is slow. Alice's app retries, and a second copy of alice:1 takes off.",
          duplicate('alice:1@bob', 'retry'),
        ),
        step(
          's05',
          'The first copy lands. Bob has not seen alice:1, so he applies it and writes alice:1 in his applied list: 1.',
          apply('alice:1@bob'),
          highlight('bob.likes@applied'),
          expect('bob.likes', 1),
          expect('bob.likes@applied', ['alice:1']),
        ),
        step(
          's06',
          'The retry lands. Bob finds alice:1 in his list and ignores it: no change.',
          apply('retry'),
          check('bob.likes'),
          expect('bob.likes', 1),
        ),
        step(
          's07',
          'Without that list, Bob would have added 1 again and shown 2. The id makes a repeat visible; the list makes it harmless.',
          callout('bob.likes@applied', 'ids already applied', { tone: 'info', sticky: true }),
        ),
        step(
          's08',
          'Alice likes again: a new op with a new id, alice:2. Bob has not seen alice:2, so it counts: 2.',
          opcounter('likes').inc('alice'),
          crdt.broadcast('alice', 'likes'),
          apply('alice:2@bob'),
          expect('bob.likes', 2),
          expect('bob.likes@applied', ['alice:1', 'alice:2']),
        ),
        step(
          's09',
          'Both say 2. Exactly once really means: at least once, and ignore what you have already applied.',
          same('alice.likes', 'bob.likes'),
        ),
        step.long(
          's10',
          'This check lives in the code that moves ops, not in the data type. Some types shrug off a repeat (a tagged add); a counter cannot.',
        ),
      ],
    ),
    scene(
      'in-causal-order',
      { layout: 'pair', actors: [alice({ icon: 'phone' }), bob({ icon: 'laptop' })] },
      [
        step(
          's01',
          'A shared list, the real thing: an **OR-Set** driven by ops. Both copies are empty.',
          crdt.init(['alice', 'bob'], 'list', 'or-set', { wire: 'ops' }),
          note('rule', 'an op waits until the ops it depends on have been applied'),
          expect('alice.list', []),
        ),
        step(
          's02',
          'Alice adds milk: op alice:1. Then she changes her mind and removes it: op alice:2.',
          orSet('list').add('alice', 'milk'),
          orSet('list').remove('alice', 'milk'),
          highlight('alice@outbox'),
          expect('alice.list', []),
          expect('alice@outbox', ['alice:1', 'alice:2']),
        ),
        step(
          's03',
          'She broadcasts. Two ops fly to Bob, and the network does not promise to keep them in order.',
          crdt.broadcast('alice', 'list'),
        ),
        step.long(
          's04',
          'Whoops — alice:2 overtakes alice:1. The remove reaches Bob first, and he has nothing to remove yet.',
          apply('alice:2@bob', { park: true }),
          cross('msg:alice:2@bob'),
        ),
        step(
          's05',
          'Bob does not apply it. The op says it comes after alice:1, which he has not seen, so it waits in his inbox.',
          callout('msg:alice:2@bob', 'waits for alice:1', { tone: 'info' }),
          highlight('bob@inbox'),
        ),
        step(
          's06',
          'alice:1 arrives: add milk, tag alice:1. Bob applies it.',
          apply('alice:1@bob'),
          expect('bob.list', ['milk']),
          expect('bob.list[milk]@tags', [{ tag: 'alice:1', alive: true }]),
        ),
        step(
          's07',
          'Now the parked op is ready. Bob applies alice:2: it kills tag alice:1, and milk is gone.',
          clearMarks(),
          apply('alice:2@bob'),
          tomb('bob.list[milk]'),
          expect('bob.list', []),
        ),
        step(
          's08',
          'Both lists are empty, and both agree. An op runs only after the ops it depends on.',
          same('alice.list', 'bob.list'),
        ),
        step.long(
          's09',
          'Op ids, the applied list, and waiting for causal order are the price of sending ops. Real systems pay it with a server log or a sync protocol.',
          note('rule', 'ids · ignore repeats · wait for causal order'),
        ),
      ],
    ),
  ],
})
