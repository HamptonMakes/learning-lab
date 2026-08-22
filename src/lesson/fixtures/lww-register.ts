/**
 * docs/animation-dsl.md §15.1 — LWW register, `update-and-merge` (II.2), written verbatim with
 * the builders. A fixture for the reducer, stage and lint tests (the content module lives under
 * src/content/ once the topic is authored in full).
 */
import {
  topic,
  scene,
  step,
  alice,
  bob,
  note,
  highlight,
  conflict,
  clearMarks,
  check,
  same,
  tick,
  crdt,
  lww,
  seed,
  merge,
  expect,
} from '@/lesson/builders'

export const lwwRegisterTopic = topic({
  id: 'lww-register',
  title: 'LWW Register',
  goal: 'Pick an LWW register for a single field and explain which write wins and why.',
  whenToUse: [
    'Single-value fields where "the newest edit wins" is what users expect (title, status, colour).',
    'The field is set as a whole, not edited inside.',
    'You can give every write a timestamp that is good enough (logical or hybrid; Unit IV).',
  ],
  whenNotToUse: [
    'Two edits should both survive (use a set, a counter, or a sequence).',
    'Device clocks cannot be trusted and losing an edit is costly (Unit IV.1).',
    'The value is long text edited by several people at once (Unit III.5).',
  ],
  realWorld: 'A status line set from phone and laptop; a cell in Cassandra or DynamoDB.',
  scenes: [
    scene(
      'update-and-merge',
      {
        layout: 'pair',
        clock: { show: true },
        actors: [alice({ icon: 'phone' }), bob({ icon: 'laptop' })],
      },
      [
        step(
          's01',
          'An **LWW register** holds a value and a timestamp. The sidecar also remembers who wrote it.',
          crdt.init(['alice', 'bob'], 'status', 'lww-register', { seed: [seed('set', 'Offline')] }),
          highlight(['alice.status@ts', 'alice.status@node']),
        ),
        step(
          's02',
          'The rule: on merge, the newer timestamp wins.',
          note('rule', 'merge: newer ts wins · tie → higher node id'),
        ),
        step(
          's03',
          'Time moves to 1. Alice sets her status; her copy records the value, t=1, node alice.',
          tick(),
          lww('status').set('alice', 'In a meeting'),
          expect('alice.status@ts', 1),
          expect('alice.status@node', 'alice'),
        ),
        step(
          's04',
          'Time 2. Bob sets a different status on the laptop.',
          tick(),
          lww('status').set('bob', 'Lunch'),
          conflict('alice.status', 'bob.status'),
        ),
        step(
          's05',
          'Alice sends her state to Bob.',
          clearMarks(),
          crdt.send('alice', 'bob', 'status', { id: 'm1' }),
        ),
        step(
          's06',
          'Bob compares timestamps: 2 is newer than 1. He keeps Lunch.',
          merge('m1'), // = deliver('m1'); the reducer adds the "no change" pill
          highlight('bob.status@ts'),
          check('bob.status'),
          expect('bob.status', 'Lunch'),
        ),
        step(
          's07',
          'Bob sends his state to Alice. She compares: 2 beats 1, so she takes Lunch.',
          crdt.send('bob', 'alice', 'status', { id: 'm2' }),
          merge('m2'), // same step: a transient flight along the whole arc, then the via chip on Alice's value
          expect('alice.status', 'Lunch'),
        ),
        step(
          's08',
          'Both copies agree, and both carry the same sidecar: t=2, bob.',
          same('alice.status', 'bob.status'), // stamp rule: identical (ts, node) ⇒ equal
          expect('alice.status@node', 'bob'),
        ),
        step.long(
          's09',
          "Alice's status was lost. LWW always loses one side of a race; that is the deal you accept when you pick it.",
        ),
      ],
    ),
  ],
})
