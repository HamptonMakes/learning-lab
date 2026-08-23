/**
 * IV.3 — Vector clocks. One counter per node (`vector-clock` slots): tick your own entry, a send
 * ticks and carries the whole clock (`send { stamp }`), a receive takes the per-entry max and
 * ticks your own entry (`deliver { recv }`). `one-counter-per-node` runs the rules on three
 * devices; `before-after-concurrent` compares real clocks with the verdict chips (before / after /
 * concurrent / equal); `what-do-i-send-you` puts version vectors in context: an RGA note synced
 * Yjs-style, each side sending only the ops the other lacks. Every entry and verdict is computed
 * by src/crdt/vector-clock.ts and the delivery layer. Storyboard: docs/curriculum/unit-3-4.md §IV.3.
 */
import {
  topic,
  scene,
  step,
  alice,
  bob,
  carol,
  server,
  note,
  highlight,
  callout,
  compare,
  same,
  clearMarks,
  send,
  deliver,
  offline,
  online,
  crdt,
  vclock,
  rga,
  seed,
  applyAll,
  expect,
} from '@/lesson/builders'

const RULE =
  'event: my entry + 1 · send: tick, carry the clock · receive: max per entry, then my entry + 1'
const COMPARE =
  'entry by entry: all ≤ → before · all ≥ → after · some bigger on each side → concurrent'

export default topic({
  id: 'vector-clocks',
  title: 'Vector clocks',
  goal: 'Learn how to keep a vector clock by hand and compare two of them to say before, after, or concurrent.',
  rules: [
    'Every device keeps one counter per device. On a local event, add 1 to your own entry.',
    'On a send, add 1 to your entry and put the whole clock on the message.',
    'On a receive, take the max of each entry, then add 1 to your own: {alice 2, bob 1, carol 0}.',
    'Compare entry by entry: all ≤ is before, all ≥ is after, bigger on both sides is concurrent.',
  ],
  shape: {
    name: 'Vector clock',
    fields: [
      { key: 'alice', example: '2', role: 'value', note: 'events heard of from Alice' },
      {
        key: 'bob',
        example: '1',
        role: 'value',
        note: 'his own entry: events, sends and receives',
      },
      { key: 'carol', example: '0', role: 'value', note: 'nothing heard from Carol yet' },
    ],
    note: "One counter per device. This is Bob's clock after he receives Alice's message.",
  },
  whenToUse: [
    'You must detect concurrent writes: siblings, conflict flags, "someone else edited this".',
    'Few nodes (tens), or you can prune old entries.',
    'You need "has everyone seen X" (tombstone stability, Unit III).',
    'Sync: "send me everything after {alice 4, bob 2}" (Yjs calls this a state vector).',
  ],
  whenNotToUse: [
    'Thousands of writers per object; the clock grows one entry per node.',
    'You only need an order, not concurrency; a Lamport clock is one integer.',
    'You need human-readable time; use an HLC.',
    'Anonymous clients that come and go; their entries never die.',
  ],
  realWorld:
    'Amazon Dynamo and Riak version vectors; Yjs state vectors for sync; Voldemort and Bayou before them.',
  scenes: [
    scene(
      'one-counter-per-node',
      {
        layout: 'triangle',
        actors: [alice({ icon: 'phone' }), bob({ icon: 'laptop' }), carol({ icon: 'tablet' })],
      },
      [
        step(
          's01',
          'Three devices. Each keeps a **vector clock**: one counter per device, all zero to start.',
          crdt.init(['alice', 'bob', 'carol'], 'vc', 'vector-clock'),
          expect('alice.vc', { alice: 0, bob: 0, carol: 0 }),
          expect('carol.vc', { alice: 0, bob: 0, carol: 0 }),
        ),
        step('s02', 'Three rules, like Lamport, but applied per entry.', note('rule', RULE)),
        step(
          's03',
          'Alice edits: only her own entry ticks. {alice 1, bob 0, carol 0}.',
          vclock('vc').tick('alice'),
          expect('alice.vc', { alice: 1, bob: 0, carol: 0 }),
        ),
        step(
          's04',
          'Alice sends Bob a message. A send ticks her entry too, {alice 2, bob 0, carol 0}, and the message carries the whole clock.',
          send('alice', 'bob', 'hello', { id: 'm1', stamp: 'vc' }),
          expect('alice.vc', { alice: 2, bob: 0, carol: 0 }),
        ),
        step(
          's05',
          'Bob receives. Max per entry, then his own entry + 1: {alice 2, bob 1, carol 0}.',
          deliver('m1', { recv: 'vc' }),
          callout('bob.vc', 'max per entry, then bob + 1', { tone: 'info' }),
          expect('bob.vc', { alice: 2, bob: 1, carol: 0 }),
        ),
        step(
          's06',
          'Carol edits twice on her own: {alice 0, bob 0, carol 2}. She has heard nothing from anyone.',
          vclock('vc').tick('carol'),
          vclock('vc').tick('carol'),
          expect('carol.vc', { alice: 0, bob: 0, carol: 2 }),
        ),
        step(
          's07',
          'Bob sends Carol a message. His clock ticks to {alice 2, bob 2, carol 0} and travels with it.',
          send('bob', 'carol', 'hello', { id: 'm2', stamp: 'vc' }),
          expect('bob.vc', { alice: 2, bob: 2, carol: 0 }),
        ),
        step(
          's08',
          'Carol receives: max per entry, plus her own tick. {alice 2, bob 2, carol 3}.',
          deliver('m2', { recv: 'vc' }),
          expect('carol.vc', { alice: 2, bob: 2, carol: 3 }),
        ),
        step(
          's09',
          "Carol's clock says exactly what she has heard of: 2 events from Alice, 2 from Bob, 3 of her own.",
          highlight('carol.vc', { sticky: true }),
        ),
        step.long(
          's10',
          'A vector clock is a summary of everything you have heard. That is what makes comparing two of them meaningful.',
          callout('carol.vc', 'everything I have heard', { tone: 'info', sticky: true }),
        ),
      ],
    ),
    scene(
      'before-after-concurrent',
      { layout: 'pair', actors: [alice({ icon: 'phone' }), bob({ icon: 'laptop' })] },
      [
        step(
          's01',
          'Two fresh clocks, {alice 0, bob 0} on both sides. Compare them entry by entry: equal.',
          crdt.init(['alice', 'bob'], 'vc', 'vector-clock'),
          note('rule', COMPARE),
          compare(['alice.vc', 'bob.vc'], { expect: 'equal' }),
        ),
        step(
          's02',
          'Alice edits twice: {alice 2, bob 0}. Bob does nothing: still {alice 0, bob 0}.',
          clearMarks(),
          vclock('vc').tick('alice'),
          vclock('vc').tick('alice'),
          expect('alice.vc', { alice: 2, bob: 0 }),
          expect('bob.vc', { alice: 0, bob: 0 }),
        ),
        step(
          's03',
          "Every entry of Bob's clock is ≤ the same entry of Alice's, and one is smaller. Bob's clock is before Alice's.",
          compare(['bob.vc', 'alice.vc'], { expect: 'before' }),
        ),
        step(
          's04',
          'Alice sends Bob her clock. Her send makes it {alice 3, bob 0}; his receive makes his {alice 3, bob 1}.',
          clearMarks(),
          send('alice', 'bob', 'hello', { id: 'm1', stamp: 'vc' }),
          deliver('m1', { recv: 'vc' }),
          expect('alice.vc', { alice: 3, bob: 0 }),
          expect('bob.vc', { alice: 3, bob: 1 }),
        ),
        step(
          's05',
          "Now Bob's clock is after Alice's. It holds everything she sent, plus his own receive.",
          compare(['bob.vc', 'alice.vc'], { expect: 'after' }),
        ),
        step(
          's06',
          'Both edit on their own. Alice is at {alice 4, bob 0}, Bob at {alice 3, bob 2}.',
          clearMarks(),
          vclock('vc').tick('alice'),
          vclock('vc').tick('bob'),
          expect('alice.vc', { alice: 4, bob: 0 }),
          expect('bob.vc', { alice: 3, bob: 2 }),
        ),
        step(
          's07',
          "Alice's entry is bigger on her side; Bob's entry is bigger on his. Neither has seen the other: concurrent.",
          compare(['alice.vc', 'bob.vc'], { expect: 'concurrent' }),
        ),
        step(
          's08',
          'This is the answer a Lamport clock could not give. Two numbers would have said less or greater; two vectors say independent.',
          callout('bob.vc', 'concurrent = independent', { tone: 'info', sticky: true }),
        ),
        step.long(
          's09',
          'Before, after, concurrent, equal. Four answers, one loop over the entries: all ≤ means before; bigger on both sides means concurrent.',
        ),
      ],
    ),
    scene(
      'what-do-i-send-you',
      {
        layout: 'hub',
        actors: [server('Server'), alice({ icon: 'phone' }), bob({ icon: 'laptop' })],
      },
      [
        step(
          's01',
          'Phone, laptop and server share a note, an **RGA**. Each copy keeps a **version vector**: how many ops it holds from each device, {alice 3}.',
          crdt.init(['server', 'alice', 'bob'], 'note', 'rga', {
            display: 'text',
            expose: ['vc'],
            wire: 'ops',
            seed: [seed.text('alice', 'Tea')],
          }),
          note('rule', 'sync: compare vectors first · then send only the ops the other side lacks'),
          highlight(['server.note@vc', 'alice.note@vc', 'bob.note@vc']),
          expect('server.note@vc', { alice: 3 }),
          expect('alice.note', 'Tea'),
        ),
        step(
          's02',
          'The phone goes offline and types the word time after Tea: ops alice:4 to alice:8. Its vector: {alice 8}.',
          offline('alice'),
          rga('note').type('alice', 'alice:3', ' time'),
          expect('alice.note', 'Tea time'),
          expect('alice.note@vc', { alice: 8 }),
        ),
        step(
          's03',
          'The laptop lowercases the T: delete alice:1, insert t at the start, two ops. It pushes them to the server, whose vector becomes {alice 3, bob 2}.',
          rga('note').delete('bob', 'alice:1'),
          rga('note').insertAfter('bob', 'HEAD', 't'),
          crdt.broadcast('bob', 'note', { to: ['server'] }),
          applyAll(['bob:1@server', 'bob:2@server']),
          expect('server.note', 'tea'),
          expect('server.note@vc', { alice: 3, bob: 2 }),
        ),
        step(
          's04',
          'The phone comes back, but it does not send everything: first the vectors are compared. {alice 3, bob 2} and {alice 8} are concurrent.',
          online('alice'),
          compare(['server.note@vc', 'alice.note@vc'], { expect: 'concurrent' }),
        ),
        step(
          's05',
          'Concurrent means each side has ops the other lacks. The server needs alice:4 to alice:8, the phone needs bob:1 and bob:2, and only those travel.',
          clearMarks(),
          crdt.sync('alice', 'server', 'note', { mode: 'ops' }),
        ),
        step(
          's06',
          'Each side applies what it was missing. Both read tea time, and both vectors are {alice 8, bob 2}.',
          applyAll([
            'alice:4@server',
            'alice:5@server',
            'alice:6@server',
            'alice:7@server',
            'alice:8@server',
            'bob:1@alice',
            'bob:2@alice',
          ]),
          expect('alice.note', 'tea time'),
          expect('server.note', 'tea time'),
          same('alice.note@vc', 'server.note@vc'),
          expect('server.note@vc', { alice: 8, bob: 2 }),
        ),
        step(
          's07',
          "The laptop pulls the same way. Its vector {alice 3, bob 2} is before the server's {alice 8, bob 2}: it only needs the five phone ops.",
          compare(['bob.note@vc', 'server.note@vc'], { expect: 'before' }),
        ),
        step(
          's08',
          'Five ops come down, nothing goes up. All three copies read tea time with the same vector.',
          clearMarks(),
          crdt.sync('bob', 'server', 'note', { mode: 'ops' }),
          applyAll(['alice:4@bob', 'alice:5@bob', 'alice:6@bob', 'alice:7@bob', 'alice:8@bob']),
          expect('bob.note', 'tea time'),
          same('alice.note', 'bob.note', 'server.note'),
        ),
        step.long(
          's09',
          'Yjs calls this vector a state vector. Every sync starts with: here is what I have seen, send me the rest.',
          callout('server.note@vc', 'state vector = vector clock', { tone: 'info', sticky: true }),
        ),
      ],
      { inContext: true },
    ),
  ],
})
