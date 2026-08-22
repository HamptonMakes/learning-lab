/**
 * IV.2 — Lamport clocks. One counter per device (`lamport-clock` slots): +1 on a local event, a
 * send ticks and stamps the message (`send { stamp }`), a receive takes max(own, stamp) + 1
 * (`deliver { recv }`). `count-events` shows the rules on three devices; `what-lamport-cannot-say`
 * shows the limitation with `compare`: two independent events still get ordered numbers;
 * `chat-in-order` puts the stamps in context: a chat through a server sorted by stamp. Every
 * number is computed by src/crdt/lamport-clock.ts. Storyboard: docs/curriculum/unit-3-4.md §IV.2.
 */
import {
  topic,
  scene,
  step,
  alice,
  bob,
  carol,
  server,
  list,
  ref,
  note,
  highlight,
  callout,
  compare,
  check,
  clearMarks,
  send,
  deliver,
  sort,
  crdt,
  lamport,
  expect,
} from '@/lesson/builders'

const RULE = 'event: c = c + 1 · send: tick, stamp = c · receive: c = max(c, stamp) + 1'

export default topic({
  id: 'lamport-clocks',
  title: 'Lamport clocks',
  goal: 'Run the Lamport rules by hand, and say what a smaller number does and does not tell you about two events.',
  whenToUse: [
    'You need an order that respects cause and effect: op logs, RGA stamps, causal LWW.',
    'One integer per replica is all the space you can afford.',
    'Ties can be broken by node name.',
    'You only need to order events, not to detect concurrency.',
  ],
  whenNotToUse: [
    'You must know whether two events were concurrent; Lamport cannot say (use vector clocks).',
    'You need human-readable time (use an HLC).',
    'Unrelated events must not look ordered; Lamport orders them anyway.',
  ],
  realWorld:
    'Automerge orders ops by (Lamport counter, actor id); the RGA stamps of Unit III; Leslie Lamport, 1978.',
  scenes: [
    scene(
      'count-events',
      {
        layout: 'triangle',
        actors: [alice({ icon: 'phone' }), bob({ icon: 'laptop' }), carol({ icon: 'tablet' })],
      },
      [
        step(
          's01',
          'Every device keeps one counter: its **Lamport clock**. All start at 0.',
          crdt.init(['alice', 'bob', 'carol'], 'clock', 'lamport-clock'),
          expect('alice.clock', 0),
          expect('bob.clock', 0),
          expect('carol.clock', 0),
        ),
        step(
          's02',
          'Three rules: tick on a local event, tick and stamp on a send, jump past the stamp on a receive.',
          note('rule', RULE),
        ),
        step(
          's03',
          'Alice makes an edit. A local event: her clock ticks to 1.',
          lamport('clock').tick('alice'),
          expect('alice.clock', 1),
        ),
        step(
          's04',
          'She sends Bob a message. A send is an event too: her clock ticks to 2, and the message carries the stamp 2.',
          send('alice', 'bob', 'hello', { id: 'm1', stamp: 'clock' }),
          expect('alice.clock', 2),
        ),
        step(
          's05',
          'Bob receives it. His rule is the larger of his clock and the stamp, plus one: max(0, 2) + 1 = 3.',
          deliver('m1', { recv: 'clock' }),
          callout('bob.clock', 'max(0, 2) + 1 = 3', { tone: 'info' }),
          expect('bob.clock', 3),
        ),
        step(
          's06',
          'Carol has been busy on her own: three edits. Her clock is 3.',
          lamport('clock').tick('carol'),
          lamport('clock').tick('carol'),
          lamport('clock').tick('carol'),
          expect('carol.clock', 3),
        ),
        step(
          's07',
          'Bob and Carol both show 3. Two different events can share a number; a tie breaks by node name, as in RGA.',
          compare(['bob.clock', 'carol.clock'], { expect: 'equal' }),
        ),
        step(
          's08',
          'Bob sends Carol a message. Tick to 4; the stamp is 4.',
          clearMarks(),
          send('bob', 'carol', 'hello', { id: 'm2', stamp: 'clock' }),
          expect('bob.clock', 4),
        ),
        step(
          's09',
          'Carol receives: max(3, 4) + 1 = 5. Her clock jumps past the sender, even though she was already busy.',
          deliver('m2', { recv: 'clock' }),
          callout('carol.clock', 'max(3, 4) + 1 = 5', { tone: 'info' }),
          expect('carol.clock', 5),
        ),
        step.long(
          's10',
          'If one event led to another, the second has the bigger number: send 2, receive 3, send 4, receive 5. Cause before effect, always.',
          highlight(['alice.clock', 'bob.clock', 'carol.clock']),
        ),
      ],
    ),
    scene(
      'what-lamport-cannot-say',
      { layout: 'pair', actors: [alice({ icon: 'phone' }), bob({ icon: 'laptop' })] },
      [
        step(
          's01',
          'Alice makes two edits and Bob makes one, and they never talk. Her clock is 2; his is 1.',
          crdt.init(['alice', 'bob'], 'clock', 'lamport-clock'),
          note('rule', RULE),
          lamport('clock').tick('alice'),
          lamport('clock').tick('alice'),
          lamport('clock').tick('bob'),
          expect('alice.clock', 2),
          expect('bob.clock', 1),
        ),
        step(
          's02',
          "Compare the numbers: Bob's 1 is less than Alice's 2. But Bob's edit did not happen before Alice's; they were independent.",
          compare(['bob.clock', 'alice.clock'], { expect: 'less' }),
          callout('bob.clock', 'smaller ≠ earlier', { tone: 'warn' }),
        ),
        step(
          's03',
          'Now Alice sends Bob a message. Her send is 3; his receive is max(1, 3) + 1 = 4.',
          clearMarks(),
          send('alice', 'bob', 'hello', { id: 'm1', stamp: 'clock' }),
          deliver('m1', { recv: 'clock' }),
          expect('alice.clock', 3),
          expect('bob.clock', 4),
        ),
        step(
          's04',
          "Bob's 4 is greater than Alice's 3, and this time it really came after: the message carried the cause.",
          compare(['bob.clock', 'alice.clock'], { expect: 'greater' }),
        ),
        step(
          's05',
          'Two comparisons, the same kind of answer, two different stories. A Lamport number cannot tell caused from independent.',
          note('rule', 'a caused b ⇒ L(a) < L(b) · L(a) < L(b) does not mean a caused b'),
          callout('alice.clock', 'order, yes · cause, unknown', { tone: 'warn', sticky: true }),
        ),
        step.long(
          's06',
          'To ask whether two edits were independent, you need more than one number. Next: vector clocks.',
        ),
      ],
    ),
    scene(
      'chat-in-order',
      {
        layout: 'hub',
        actors: [
          server('Server', { holds: { chat: list([]) } }),
          alice({ icon: 'phone', holds: { chat: list([]) } }),
          bob({ icon: 'laptop', holds: { chat: list([]) } }),
        ],
      },
      [
        step(
          's01',
          'A chat through a server. Every node keeps a Lamport clock, every message carries its sender stamp, and the server sorts by stamp.',
          crdt.init(['server', 'alice', 'bob'], 'clock', 'lamport-clock'),
          note('rule', 'server: sort messages by stamp · reply stamp > question stamp'),
        ),
        step(
          's02',
          'Alice sends `Lunch?` to the server. Her clock ticks to 1, the message is stamped 1, and the server receives: max(0, 1) + 1 = 2.',
          send('alice', 'server', 'Lunch?', { id: 'c1', stamp: 'clock', into: 'server.chat[c1]' }),
          deliver('c1'),
          expect('alice.clock', 1),
          expect('server.clock', 2),
          expect('server.chat[c1]', 'Lunch?'),
          expect('server.chat[c1]@ts', 1),
        ),
        step(
          's03',
          'The server forwards it to Bob with the stamp 1 (simplified: the relay step itself is not counted). Bob receives: max(0, 1) + 1 = 2.',
          send('server', 'bob', ref('server.chat[c1]'), { id: 'c1b', into: 'bob.chat[c1]' }),
          deliver('c1b', { recv: 'clock' }),
          expect('bob.clock', 2),
          expect('bob.chat[c1]', 'Lunch?'),
        ),
        step(
          's04',
          'Bob replies `Yes!`. Tick to 3: the reply is stamped 3, bigger than the question he saw.',
          send('bob', 'server', 'Yes!', { id: 'c2', stamp: 'clock', into: 'server.chat[c2]' }),
          expect('bob.clock', 3),
        ),
        step(
          's05',
          'Meanwhile Alice, who has not seen the reply, sends `Or pizza?`. Her clock ticks to 2: stamp 2.',
          send('alice', 'server', 'Or pizza?', {
            id: 'c3',
            stamp: 'clock',
            into: 'server.chat[c3]',
          }),
          expect('alice.clock', 2),
        ),
        step(
          's06',
          'Both arrive. The server sorts by stamp: `Lunch?` (1), `Or pizza?` (2), `Yes!` (3).',
          deliver('c2'),
          deliver('c3'),
          sort('server.chat', ['@ts']),
          expect('server.chat', ['Lunch?', 'Or pizza?', 'Yes!']),
          expect('server.clock', 5),
        ),
        step(
          's07',
          'Every device that sorts by stamp shows this same order. The reply can never sort above its question: 3 is bigger than 1.',
          check('server.chat'),
          highlight(['server.chat[c1]@ts', 'server.chat[c2]@ts']),
        ),
        step.long(
          's08',
          '`Or pizza?` and `Yes!` were independent, but the stamps put pizza first anyway. Fine for a chat; not fine when you must know they were independent.',
          callout('server.chat[c3]', 'ordered, but "independent" is invisible', {
            tone: 'warn',
            sticky: true,
          }),
        ),
      ],
      { inContext: true },
    ),
  ],
})
