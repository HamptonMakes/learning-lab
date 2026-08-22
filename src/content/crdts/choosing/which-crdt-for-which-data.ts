/**
 * V.1 — Which CRDT for which data. The payoff of Units II–IV as one decision table (`board.t`),
 * built row by row. Each scene races two types on the same data and lets the real merge show
 * which one keeps what the user meant. Scenes re-declare the table with the rows so far, so every
 * stage starts clean. Storyboard: docs/curriculum/unit-5-prototypes.md §V.1.
 */
import {
  topic,
  scene,
  step,
  alice,
  bob,
  board,
  table,
  row,
  tick,
  offline,
  online,
  insert,
  highlight,
  conflict,
  check,
  cross,
  clearMarks,
  same,
  expect,
  bad,
  good,
  tomb,
  crdt,
  seed,
  lww,
  lwwMap,
  pncounter,
  orSet,
  rga,
} from '@/lesson/builders'
import type { TableRow } from '@/lesson/types'

const COLUMNS = [
  { key: 'data', label: 'Data' },
  { key: 'need', label: 'On merge' },
  { key: 'pick', label: 'Pick' },
  { key: 'watch', label: 'Watch out' },
]

/** The six rows of the decision table; each scene adds the ones it earns. */
const ROWS = {
  r1: row('r1', {
    data: 'title, status',
    need: 'newest wins',
    pick: 'LWW register',
    watch: 'loses one side of a race',
  }),
  r2: row('r2', {
    data: 'likes, stock count',
    need: 'adds up',
    pick: 'PN-Counter',
    watch: 'no floor: can go below 0',
  }),
  r3: row('r3', {
    data: 'card, profile',
    need: 'fields change alone',
    pick: 'LWW map',
    watch: 'tombstone per removal',
  }),
  r4: row('r4', {
    data: 'labels, members',
    need: 'come and go',
    pick: 'OR-Set',
    watch: 'tags grow with each add',
  }),
  r5: row('r5', {
    data: 'checklist, text',
    need: 'order matters',
    pick: 'RGA (sequence)',
    watch: 'tombstones, causal ops',
  }),
  r6: row('r6', {
    data: 'balance, username',
    need: 'a rule across copies',
    pick: 'transaction, not CRDT',
    watch: 'no merge keeps a rule',
  }),
}

const pickTable = (...rows: TableRow[]) =>
  board('t', table(COLUMNS, rows), { label: 'Pick a type' })

const cast = () => [alice({ icon: 'phone' }), bob({ icon: 'laptop' })]

export default topic({
  id: 'which-crdt-for-which-data',
  title: 'Which CRDT for which data',
  goal: 'Given one piece of data and how it changes, pick a register, counter, map, set or list (or say it needs a transaction instead) and explain why in one sentence.',
  whenToUse: [
    'A field is edited on more than one device, and merges must not wait for a server.',
    'You can say how the field changes: replaced, added up, members come and go, ordered.',
    'You are designing a schema and want a default type per field before you write code.',
    '"Briefly different, then the same everywhere" is acceptable for this field.',
  ],
  whenNotToUse: [
    'A rule must hold across all copies (balance >= 0, unique username): coordinate instead.',
    'Only one writer ever exists: a plain value is enough; a CRDT adds metadata for nothing.',
    'Opaque blobs (image, PDF): store by hash; the reference is the LWW register.',
    'You need "did my write win?" right now: that is a server question, not a merge question.',
  ],
  realWorld:
    'A task card in a kanban tool (Trello, Linear): title, owner, labels, votes and checklist each change in a different way, so each gets a different type.',
  scenes: [
    scene(
      'replace-or-add',
      { layout: 'pair', clock: { show: true }, actors: cast(), boards: [pickTable()] },
      [
        step(
          's01',
          'A likes count, kept two ways on each device: once as an LWW register, once as a PN-Counter.',
          crdt.init(['alice', 'bob'], 'likes', 'lww-register', { seed: [seed('set', 0)] }),
          crdt.init(['alice', 'bob'], 'count', 'pn-counter'),
          highlight(['alice.likes', 'alice.count']),
        ),
        step(
          's02',
          'Time 1: Alice taps like. Her code reads 0, adds 1 and writes 1, while the counter just adds 1.',
          tick(),
          lww('likes').set('alice', 1),
          pncounter('count').inc('alice'),
          expect('alice.likes', 1),
          expect('alice.count', 1),
        ),
        step(
          's03',
          'Time 2: Bob taps like too. He also reads 0 and writes 1.',
          tick(),
          lww('likes').set('bob', 1),
          pncounter('count').inc('bob'),
          conflict('alice.likes', 'bob.likes'),
          expect('bob.likes', 1),
        ),
        step(
          's04',
          'The copies merge.',
          clearMarks(),
          crdt.sync('alice', 'bob', 'likes'),
          crdt.sync('alice', 'bob', 'count'),
        ),
        step(
          's05',
          'Whoops — the register kept one 1 and dropped the other. One like is gone.',
          bad('alice.likes'),
          bad('bob.likes', 'one like lost'),
          expect('alice.likes', 1),
          expect('bob.likes', 1),
        ),
        step(
          's06',
          'The counter kept one tally per person: 1 + 1 = 2. Both likes count.',
          good('alice.count'),
          good('bob.count'),
          check('alice.count'),
          check('bob.count'),
          expect('alice.count', 2),
          expect('bob.count', 2),
        ),
        step(
          's07',
          'Ask: does a new write replace the old value, or add to it? Replace means a register: row one ([LWW Register](/crdts/state-based/lww-register)).',
          clearMarks(),
          insert('board.t', ROWS.r1),
          highlight('board.t.pick'),
        ),
        step(
          's08',
          'Add up means a counter: row two. Each row carries a watch-out; a counter has no floor ([PN-Counter](/crdts/state-based/pn-counter)).',
          insert('board.t', ROWS.r2),
          highlight('board.t.pick'),
        ),
      ],
    ),
    scene(
      'one-value-or-fields',
      {
        layout: 'pair',
        clock: { show: true },
        actors: cast(),
        boards: [pickTable(ROWS.r1, ROWS.r2)],
      },
      [
        step(
          's01',
          'A card with two fields, kept two ways: one register holds the whole card, and a map holds one register per field.',
          crdt.init(['alice', 'bob'], 'card', 'lww-register', {
            seed: [seed('set', { title: 'Fix login', owner: 'nobody' })],
          }),
          crdt.init(['alice', 'bob'], 'fields', 'lww-map', {
            seed: [seed('set', 'title', 'Fix login'), seed('set', 'owner', 'nobody')],
          }),
          highlight(['alice.card@ts', 'alice.fields.title@ts', 'alice.fields.owner@ts']),
        ),
        step(
          's02',
          'Time 1. Alice renames the card on her phone, in both copies.',
          tick(),
          lww('card').set('alice', { title: 'Fix login bug', owner: 'nobody' }),
          lwwMap('fields').set('alice', 'title', 'Fix login bug'),
          expect('alice.card.title', 'Fix login bug'),
          expect('alice.fields.title', 'Fix login bug'),
        ),
        step(
          's03',
          'Bob is offline on a train. Time 2: he assigns the card to Carol, in both copies.',
          offline('bob'),
          tick(),
          lww('card').set('bob', { title: 'Fix login', owner: 'Carol' }),
          lwwMap('fields').set('bob', 'owner', 'Carol'),
          expect('bob.card.owner', 'Carol'),
        ),
        step(
          's04',
          'Bob is back online. The copies merge.',
          online('bob'),
          crdt.sync('alice', 'bob', 'card'),
          crdt.sync('alice', 'bob', 'fields'),
        ),
        step(
          's05',
          "Whoops — the whole-card register took Bob's card, because his write is newer. Alice's new title is gone.",
          bad('alice.card.title'),
          cross('alice.card.title'),
          cross('bob.card.title'),
          expect('alice.card', { title: 'Fix login', owner: 'Carol' }),
          expect('bob.card', { title: 'Fix login', owner: 'Carol' }),
        ),
        step(
          's06',
          'The map merged field by field: the title from Alice, the owner from Bob. Both edits survive.',
          good('alice.fields'),
          good('bob.fields'),
          check('alice.fields'),
          check('bob.fields'),
          expect('alice.fields', { title: 'Fix login bug', owner: 'Carol' }),
          expect('bob.fields', { title: 'Fix login bug', owner: 'Carol' }),
        ),
        step(
          's07',
          'Ask: do people change the whole thing at once, or one field at a time? Fields that change alone get a map: row three ([LWW Map](/crdts/state-based/lww-map)).',
          clearMarks(),
          insert('board.t', ROWS.r3),
          highlight('board.t.pick'),
        ),
      ],
    ),
    scene(
      'members-or-order',
      { layout: 'pair', actors: cast(), boards: [pickTable(ROWS.r1, ROWS.r2, ROWS.r3)] },
      [
        step(
          's01',
          'Labels are a set: what matters is who is in. Checklist steps are a list: what matters is the order.',
          crdt.init(['alice', 'bob'], 'labels', 'or-set', { seed: [seed('add', 'bug')] }),
          crdt.init(['alice', 'bob'], 'steps', 'rga', {
            seed: [seed('insertAfter', 'HEAD', 'write test'), seed('insertAfter', 'seed:1', 'fix')],
          }),
          highlight(['alice.labels', 'alice.steps']),
        ),
        step(
          's02',
          "Alice adds the label 'urgent' while Bob adds 'backend'. Both at once.",
          orSet('labels').add('alice', 'urgent'),
          orSet('labels').add('bob', 'backend'),
        ),
        step(
          's03',
          'Merge: the set has all three. Order never mattered here.',
          crdt.sync('alice', 'bob', 'labels'),
          same('alice.labels', 'bob.labels'),
          expect('alice.labels', ['backend', 'bug', 'urgent']),
        ),
        step(
          's04',
          "Now the list, at the same moment: Alice inserts 'review' after 'fix' and Bob inserts 'deploy' after 'fix'.",
          clearMarks(),
          rga('steps').insertAfter('alice', 'seed:2', 'review'),
          rga('steps').insertAfter('bob', 'seed:2', 'deploy'),
        ),
        step(
          's05',
          'Merge: both items are there, in the same order on both copies. A fixed rule picked that order, not luck ([Sequences](/crdts/operation-based/sequences-rga)).',
          crdt.sync('alice', 'bob', 'steps'),
          same('alice.steps', 'bob.steps'),
          expect('alice.steps', ['write test', 'fix', 'deploy', 'review']),
        ),
        step(
          's06',
          "One more question: can a member leave and come back? Alice removes 'bug'.",
          clearMarks(),
          orSet('labels').remove('alice', 'bug'),
          tomb('alice.labels[bug]'),
          expect('alice.labels', ['backend', 'urgent']),
        ),
        step(
          's07',
          "Bob has not seen that, and adds 'bug' again at the same time. His add gets a fresh tag, bob:2.",
          orSet('labels').add('bob', 'bug'),
          highlight('bob.labels[bug]@tags'),
          expect('bob.labels[bug]@tags', [
            { tag: 'bob:2', alive: true },
            { tag: 'seed:1', alive: true },
          ]),
        ),
        step(
          's08',
          "Merge: 'bug' stays. Alice killed only the tag she had already seen, and Bob's fresh tag is still alive.",
          crdt.sync('alice', 'bob', 'labels'),
          good('alice.labels[bug]'),
          good('bob.labels[bug]'),
          expect('alice.labels', ['backend', 'bug', 'urgent']),
          expect('alice.labels[bug]@tags', [
            { tag: 'bob:2', alive: true },
            { tag: 'seed:1', alive: false },
          ]),
        ),
        step(
          's09',
          'Ask: does order matter? No, and members come and go: an OR-Set, row four ([OR-Set](/crdts/state-based/or-set)).',
          clearMarks(),
          insert('board.t', ROWS.r4),
          highlight('board.t.pick'),
        ),
        step(
          's10',
          'Yes, order matters: a sequence, row five. Its price is tombstones and causal delivery ([Sequences](/crdts/operation-based/sequences-rga)).',
          insert('board.t', ROWS.r5),
          highlight('board.t.pick'),
        ),
        step(
          's11',
          'Last row, and a different answer: a rule that must hold across copies needs a transaction, not a CRDT ([Not everything needs a transaction](/crdts/the-problem/not-everything-needs-a-transaction)).',
          insert('board.t', ROWS.r6),
          highlight('board.t[r6]', { tone: 'warn' }),
        ),
        step.long(
          's12',
          'Ask how the data changes, and the table names the type. Keep it: you will use it in every schema you design.',
          highlight('board.t', { tone: 'ok' }),
        ),
      ],
    ),
  ],
})
