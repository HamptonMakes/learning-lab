/**
 * V.5 — Course complete. Three scenes: a checklist built one item at a time (each step is the
 * one-line recap of a topic, with the link back), the two cases where a CRDT is the wrong tool
 * (an invariant and a unique name), and one last round trip through a composed note that uses
 * every type in the course. Storyboard: docs/curriculum/unit-5-prototypes.md §V.5.
 */
import {
  topic,
  scene,
  step,
  alice,
  bob,
  server,
  device,
  board,
  list,
  scalar,
  tick,
  offline,
  online,
  insert,
  highlight,
  callout,
  check,
  cross,
  clearMarks,
  same,
  expect,
  bad,
  crdt,
  seed,
  doc,
  lwwMap,
  pncounter,
  S,
} from '@/lesson/builders'
import type { Item } from '@/lesson/types'

const item = (id: string, text: string): Item => ({ id, value: scalar(text) })

const NOTE = {
  title: S.lww(),
  body: S.rga({ display: 'text' }),
  tags: S.orSet(),
  pinned: S.lww(),
  views: S.g(),
}

export default topic({
  id: 'course-complete',
  title: 'Course complete',
  goal: 'Name every type, law, clock and choice rule from this course, and say out loud when a CRDT is the wrong tool.',
  whenToUse: [
    'More than one writer, sometimes disconnected, and the data must come back together.',
    '"Briefly different, then the same everywhere" is acceptable for this data.',
    'The resolution rule can be fixed up front: newest wins, add wins, sum.',
    'You want no coordinator in the write path, for latency, offline or scale.',
  ],
  whenNotToUse: [
    'A rule must hold across copies: balance >= 0, unique name, one booking per seat.',
    'Someone needs "did my write win?" before moving on; that is a coordination question.',
    'One server already orders every write and clients are always online.',
    'An audit or a regulator needs one true order of events.',
  ],
  realWorld:
    'A bank balance and a unique username need a transaction; the notes app from Unit IV is a CRDT document. Nearly every real product has both.',
  scenes: [
    scene(
      'the-checklist',
      {
        layout: 'row',
        actors: [],
        boards: [board('done', list([]), { label: 'You can now' })],
      },
      [
        step(
          's01',
          'Eight things you can now do. We tick one off per step, each with the topic it came from.',
          highlight('board.done'),
        ),
        step(
          's02',
          'Say what a CRDT is: a data type whose merge rule is fixed up front, so copies change alone and still end up equal ([Meet CRDTs](/crdts/the-problem/meet-crdts)).',
          insert('board.done', item('k1', 'What a CRDT is')),
          check('board.done[k1]', { sticky: true, id: 'c1' }),
        ),
        step(
          's03',
          'State the three merge laws: order does not matter, grouping does not matter, merging twice is harmless ([The shape of a state CRDT](/crdts/state-based/the-shape-of-a-state-crdt)).',
          insert('board.done', item('k2', 'The three merge laws')),
          check('board.done[k2]', { sticky: true, id: 'c2' }),
        ),
        step(
          's04',
          'Tell the two styles apart: send the whole state and merge, or send what you did, once and in causal order ([Ops instead of state](/crdts/operation-based/ops-instead-of-state)).',
          insert('board.done', item('k3', 'State-based vs ops')),
          check('board.done[k3]', { sticky: true, id: 'c3' }),
        ),
        step(
          's05',
          'Use registers and counters: a register replaces and needs a stamp, a counter adds up with one tally per node ([LWW Register](/crdts/state-based/lww-register)).',
          insert('board.done', item('k4', 'Registers and counters')),
          check('board.done[k4]', { sticky: true, id: 'c4' }),
        ),
        step(
          's06',
          'Pick a set: G only grows, 2P never re-adds, LWW-element decides by time, OR-Set tags every add ([OR-Set](/crdts/state-based/or-set)).',
          insert('board.done', item('k5', 'Sets (G, 2P, LWW, OR)')),
          check('board.done[k5]', { sticky: true, id: 'c5' }),
        ),
        step(
          's07',
          'Keep an order: a sequence inserts after an id and keeps tombstones, so every copy reads the same list ([Sequences](/crdts/operation-based/sequences-rga)).',
          insert('board.done', item('k6', 'Sequences (RGA)')),
          check('board.done[k6]', { sticky: true, id: 'c6' }),
        ),
        step(
          's08',
          'Read a clock: wall clocks lie, Lamport gives an order, vector clocks tell before, after or concurrent ([Vector clocks](/crdts/vector-clocks/vector-clocks)).',
          insert('board.done', item('k7', 'Clocks and causality')),
          check('board.done[k7]', { sticky: true, id: 'c7' }),
        ),
        step(
          's09',
          'And this unit: choose by how the data changes, compose a document from parts, and pay for metadata on purpose.',
          insert('board.done', item('k8', 'Choose, compose, pay')),
          check('board.done[k8]', { sticky: true, id: 'c8' }),
        ),
        step.long(
          's10',
          'That is the whole course. One thing is left, and it is the one that keeps people out of trouble: knowing when not to use any of it.',
          highlight('board.done', { tone: 'ok' }),
        ),
      ],
    ),
    scene(
      'when-not-to-use-one',
      {
        layout: 'pair',
        clock: { show: true },
        actors: [alice({ label: 'Branch A' }), bob({ label: 'Branch B' })],
      },
      [
        step(
          's01',
          'A bank balance of 100, with a copy at each branch, kept as a PN-Counter. Every merge here will be correct; watch anyway.',
          crdt.init(['alice', 'bob'], 'balance', 'pn-counter', {
            seed: [seed('inc', 100)],
          }),
          highlight(['alice.balance', 'bob.balance']),
          expect('alice.balance', 100),
        ),
        step(
          's02',
          'A customer takes 80 out at Branch A. The copy there checks 100, says yes, and reads 20.',
          pncounter('balance').dec('alice', 80),
          expect('alice.balance', 20),
        ),
        step(
          's03',
          'At the same moment Branch B pays out 80 as well. Its copy also checked 100 and also reads 20.',
          pncounter('balance').dec('bob', 80),
          expect('bob.balance', 20),
        ),
        step(
          's04',
          'Whoops — merge, and the counter is honest: 100 - 80 - 80 = -60.',
          crdt.sync('alice', 'bob', 'balance'),
          bad('alice.balance'),
          bad('bob.balance', 'below zero'),
          expect('alice.balance', -60),
          expect('bob.balance', -60),
        ),
        step(
          's05',
          'The maths merged perfectly. What broke is the rule that a balance must never go below zero, and no merge can hold that across copies.',
          clearMarks(),
          callout('alice.balance', 'invariant broken', { tone: 'danger', sticky: true, id: 'c1' }),
        ),
        step(
          's06',
          'An **invariant** like that needs coordination: a lock, a transaction, or one owner of the value ([Locks: the classic answer](/crdts/the-problem/locks-the-classic-answer)).',
          highlight('bob.balance', { tone: 'warn' }),
        ),
        step(
          's07',
          'The second case is uniqueness. Time 1 and 2: both branches hand out the same username, each sure it is free.',
          clearMarks(),
          crdt.init(['alice', 'bob'], 'names', 'lww-map'),
          tick(),
          lwwMap('names').set('alice', 'hampton', 'user A'),
          tick(),
          lwwMap('names').set('bob', 'hampton', 'user B'),
        ),
        step(
          's08',
          'Merge: the newer write wins, so one of the two loses the name after their screen already said it was theirs.',
          crdt.sync('alice', 'bob', 'names'),
          cross('alice.names.hampton'),
          expect('alice.names.hampton', 'user B'),
          expect('bob.names.hampton', 'user B'),
        ),
        step(
          's09',
          'Uniqueness needs one place to ask first. A merge rule can only decide what to keep, never stop the second write from happening.',
          clearMarks(),
          callout('alice.names', 'ask one place first', { tone: 'warn', sticky: true, id: 'c2' }),
        ),
        step.long(
          's10',
          'So: CRDTs for facts that merge, coordination for rules that must hold. Most real apps need both, and that is design, not failure.',
        ),
      ],
    ),
    scene(
      'one-last-round-trip',
      {
        layout: 'hub',
        clock: { show: true },
        actors: [
          server('iCloud', { icon: 'cloud' }),
          device('phone', 'Phone', { color: 'a', icon: 'phone' }),
          device('laptop', 'Laptop', { color: 'b', icon: 'laptop' }),
        ],
      },
      [
        step(
          's01',
          'The notes app from Unit IV, built out of everything in this course. Five parts, five rules.',
          crdt.doc(['phone', 'laptop', 'server'], 'note', NOTE, {
            seed: [
              seed.at('title', 'set', 'Trip'),
              seed.at('body', 'type', 'HEAD', 'Pack'),
              seed.at('tags', 'add', 'travel'),
              seed.at('pinned', 'set', false),
            ],
          }),
          highlight('phone.note'),
          expect('phone.note.title', 'Trip'),
          expect('phone.note.body', 'Pack'),
        ),
        step(
          's02',
          'The phone goes offline on the plane. Time 1: you rename the note there and type at the end of the body.',
          offline('phone'),
          tick(),
          doc('note').at('title').set('phone', 'Trip to Lisbon'),
          doc('note').at('body').type('phone', 'seed:5', ' bags'),
          doc('note').at('views').inc('phone', 1),
        ),
        step(
          's03',
          'Meanwhile the laptop types at the start, adds a tag, and pins the note at time 2.',
          doc('note').at('body').type('laptop', 'HEAD', 'To do: '),
          doc('note').at('tags').add('laptop', 'lisbon'),
          tick(),
          doc('note').at('pinned').set('laptop', true),
          doc('note').at('views').inc('laptop', 2),
        ),
        step('s04', 'The laptop syncs with iCloud.', crdt.sync('laptop', 'server', 'note')),
        step(
          's05',
          'The plane lands. The phone comes back and syncs, then iCloud brings the laptop up to date.',
          online('phone'),
          crdt.sync('phone', 'server', 'note'),
          crdt.sync('server', 'laptop', 'note'),
        ),
        step(
          's06',
          'Title and pinned took the newer write. The body kept both runs of typing in one fixed order, with no interleaving.',
          highlight(['phone.note.title', 'phone.note.body', 'phone.note.pinned']),
          expect('phone.note.title', 'Trip to Lisbon'),
          expect('phone.note.body', 'To do: Pack bags'),
          expect('phone.note.pinned', true),
        ),
        step(
          's07',
          'Tags are the union of both sides, and views is the sum: 1 from the phone plus 2 from the laptop.',
          clearMarks(),
          highlight(['phone.note.tags', 'phone.note.views'], { tone: 'ok' }),
          expect('phone.note.tags', ['lisbon', 'travel']),
          expect('phone.note.views', 3),
        ),
        step(
          's08',
          'Three copies, one state, and nobody waited for a lock.',
          clearMarks(),
          same('phone.note', 'laptop.note', 'server.note'),
          check('phone.note'),
          check('laptop.note'),
        ),
        step.long(
          's09',
          'You picked every one of those rules yourself. Next door: UUIDs, and how a device names a new thing without asking anyone.',
        ),
      ],
      { inContext: true },
    ),
  ],
})
