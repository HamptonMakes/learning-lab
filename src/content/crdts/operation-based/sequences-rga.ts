/**
 * III.5 — Sequences (RGA). `positions-break` is plain on purpose: two position-based ops cross
 * and the copies diverge, a failure no real sequence CRDT can compute. The other scenes drive
 * src/crdt/rga.ts through the delivery layer: element ids (`alice:1`…) and Lamport stamps are
 * minted by the reducer, a delete leaves a tombstone that a concurrent insert still anchors on,
 * and two inserts at one anchor are ordered by (stamp, node id). Storyboard: docs/curriculum/unit-3-4.md §III.5.
 */
import {
  topic,
  scene,
  step,
  alice,
  bob,
  text,
  send,
  deliver,
  set,
  note,
  highlight,
  callout,
  conflict,
  compare,
  check,
  clearMarks,
  same,
  tomb,
  crdt,
  seed,
  rga,
  apply,
  expect,
} from '@/lesson/builders'

const RULE =
  'insert after an id · delete = tombstone · same anchor: higher stamp first, then higher node id'

export default topic({
  id: 'sequences-rga',
  title: 'Sequences (RGA)',
  goal: 'Explain why a sequence CRDT names every element, inserts after a name, keeps deleted names as tombstones, and how two inserts at one spot are ordered.',
  whenToUse: [
    'Ordered data edited at the same time: text, block lists, bullet lists, layer order.',
    'Inserts anywhere plus deletes, and everyone must agree on the order.',
    'Many tiny ops (typing): each op is one element.',
    'You can live with tombstones, or you have a plan to collect them (III.7).',
  ],
  whenNotToUse: [
    'Order does not matter: an OR-Set carries less metadata.',
    'Big blobs: RGA is per element; do not put a 10 MB string in one.',
    'Frequent moves that must not duplicate: plain RGA has no move (III.6).',
    'Rich text (bold spans, comments): RGA is the base; you need structure on top.',
  ],
  realWorld:
    'Google-Docs-style editing; Yjs (YATA, an RGA relative); Automerge Text (RGA); collaboration in Apple Notes.',
  scenes: [
    scene(
      'positions-break',
      {
        layout: 'pair',
        actors: [
          alice({ icon: 'phone', holds: { text: text('cat') } }),
          bob({ icon: 'laptop', holds: { text: text('cat') } }),
        ],
      },
      [
        step(
          's01',
          'Alice and Bob both see "cat". The naive plan: send ops like insert h at position 1.',
          highlight(['alice.text', 'bob.text']),
        ),
        step(
          's02',
          'Alice inserts h at position 1: "chat". She sends the op.',
          set('alice.text', text('chat')),
          send('alice', 'bob', 'insert h @1', { id: 'a1', label: 'insert h @1' }),
        ),
        step(
          's03',
          'At the same time Bob deletes position 0: "at". He sends his op.',
          set('bob.text', text('at')),
          send('bob', 'alice', 'delete @0', { id: 'b1', label: 'delete @0' }),
        ),
        step(
          's04',
          'Alice applies delete position 0. Her chat becomes "hat".',
          deliver('b1'),
          set('alice.text', text('hat')),
        ),
        step(
          's05',
          'Bob applies insert h at position 1 to "at": "aht".',
          deliver('a1'),
          set('bob.text', text('aht')),
        ),
        step.long(
          's06',
          'Whoops — "hat" and "aht". The positions moved under the ops, and the copies will never agree.',
          conflict('alice.text', 'bob.text'),
        ),
        step(
          's07',
          'The fix: positions are not stable, but names can be. Give every character a name that never moves.',
          clearMarks(),
          note('rule', 'positions move · names do not'),
        ),
      ],
    ),
    scene(
      'names-not-positions',
      { layout: 'pair', actors: [alice({ icon: 'phone' }), bob({ icon: 'laptop' })] },
      [
        step(
          's01',
          'Same text, as an **RGA**: every character has a name, alice:1, alice:2, alice:3. Names never change.',
          crdt.init(['alice', 'bob'], 'text', 'rga', {
            wire: 'ops',
            display: 'text',
            seed: [seed.text('alice', 'cat')],
          }),
          note('rule', RULE),
          expect('alice.text', 'cat'),
        ),
        step(
          's02',
          'Bob inserts h after alice:1. The op says after alice:1, not at position 1; it is op bob:1.',
          rga('text').insertAfter('bob', 'alice:1', 'h'),
          highlight('bob@outbox'),
          expect('bob.text', 'chat'),
          expect('bob@outbox', ['bob:1']),
        ),
        step(
          's03',
          'He broadcasts. Alice finds alice:1 and puts h right after it: chat on both.',
          crdt.broadcast('bob', 'text'),
          apply('bob:1@alice'),
          same('alice.text', 'bob.text'),
          expect('alice.text', 'chat'),
        ),
        step(
          's04',
          'Alice deletes the c, alice:1, with op alice:4. It is not removed; it is marked dead: a **tombstone**.',
          clearMarks(),
          rga('text').delete('alice', 'alice:1'),
          tomb('alice.text[alice:1]'),
          expect('alice.text', 'hat'),
          expect('alice.text[alice:1]@tomb', true),
        ),
        step(
          's05',
          'At the same moment Bob inserts w after alice:1. For him the c is still alive: cwhat.',
          rga('text').insertAfter('bob', 'alice:1', 'w'),
          highlight('bob.text[bob:2]'),
          expect('bob.text', 'cwhat'),
        ),
        step(
          's06',
          'Both broadcast. A delete and an insert that points at the deleted name cross in the air.',
          crdt.broadcast('alice', 'text'),
          crdt.broadcast('bob', 'text'),
        ),
        step(
          's07',
          'Bob applies the delete: c becomes a tombstone. Bob reads what.',
          apply('alice:4@bob'),
          tomb('bob.text[alice:1]'),
          expect('bob.text', 'what'),
        ),
        step(
          's08',
          'Alice applies the insert. The name alice:1 is dead but still there, so w slots in after it: what on both.',
          apply('bob:2@alice'),
          highlight('alice.text[bob:2]'),
          same('alice.text', 'bob.text'),
          expect('alice.text', 'what'),
        ),
        step(
          's09',
          'Had Alice really removed the c, the insert would have had no anchor. A tombstone is a forwarding address for ops still on their way.',
          clearMarks(),
          callout('alice.text[alice:1]', 'dead, but still a name', { tone: 'info', sticky: true }),
        ),
        step.long(
          's10',
          'Names, insert-after and tombstones: that is the whole RGA. One question is left: two inserts after the same name.',
        ),
      ],
    ),
    scene(
      'same-anchor-tie',
      { layout: 'pair', actors: [alice({ icon: 'phone' }), bob({ icon: 'laptop' })] },
      [
        step(
          's01',
          'Both see ab, names alice:1 and alice:2. Each character also carries a **timestamp**: a counter one bigger than any stamp the writer has seen.',
          crdt.init(['alice', 'bob'], 'text', 'rga', {
            wire: 'ops',
            display: 'text',
            seed: [seed.text('alice', 'ab')],
          }),
          note('rule', RULE),
          expect('alice.text', 'ab'),
        ),
        step(
          's02',
          'Alice inserts X after alice:1: op alice:3, stamp 1.',
          rga('text').insertAfter('alice', 'alice:1', 'X'),
          highlight('alice.text[alice:3]@ts'),
          expect('alice.text', 'aXb'),
          expect('alice.text[alice:3]@ts', 1),
        ),
        step(
          's03',
          'At the same moment Bob inserts Y after alice:1: op bob:1, also stamp 1.',
          rga('text').insertAfter('bob', 'alice:1', 'Y'),
          highlight('bob.text[bob:1]@ts'),
          expect('bob.text', 'aYb'),
          expect('bob.text[bob:1]@ts', 1),
        ),
        step(
          's04',
          'Alice has aXb, Bob has aYb. Both broadcast, and the ops cross.',
          crdt.broadcast('alice', 'text'),
          crdt.broadcast('bob', 'text'),
        ),
        step(
          's05',
          'Both ops say after alice:1, so who goes first? Higher stamp first, then higher node id: bob sorts after alice, so Y goes first.',
          compare(['alice.text[alice:3]', 'bob.text[bob:1]'], { expect: 'less' }),
        ),
        step(
          's06',
          "Alice applies Bob's op. Y lands right after a, in front of X: aYXb.",
          clearMarks(),
          apply('bob:1@alice'),
          highlight('alice.text[bob:1]'),
          expect('alice.text', 'aYXb'),
        ),
        step(
          's07',
          "Bob applies Alice's op. X also wants the spot after a, but Y outranks it, so X goes second: aYXb.",
          apply('alice:3@bob'),
          highlight('bob.text[alice:3]'),
          same('alice.text', 'bob.text'),
          expect('bob.text', 'aYXb'),
        ),
        step(
          's08',
          'Later, Bob inserts Z after alice:1 again. His stamp is now 2, bigger than any he has seen, so Z lands first: right after a.',
          clearMarks(),
          rga('text').insertAfter('bob', 'alice:1', 'Z'),
          crdt.broadcast('bob', 'text'),
          apply('bob:2@alice'),
          highlight(['alice.text[bob:2]@ts', 'bob.text[bob:2]@ts']),
          expect('bob.text[bob:2]@ts', 2),
          expect('alice.text', 'aZYXb'),
          expect('bob.text', 'aZYXb'),
        ),
        step(
          's09',
          'Both copies agree, and the newest insert at a spot sits first, as typing expects. The stamp carries intent; the node id only breaks ties.',
          same('alice.text', 'bob.text'),
          check('alice.text'),
          check('bob.text'),
        ),
        step.long(
          's10',
          'The rule is arbitrary but the same on every copy. That is all a CRDT needs; nobody wins, and nobody has to ask.',
        ),
      ],
    ),
  ],
})
