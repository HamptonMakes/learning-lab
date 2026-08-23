/**
 * V.2 — Composing a document. Design a real card: the schema first (a `rec.tree` board, no
 * actors), then the same schema as a `crdt.doc` on two devices, edited at once and merged part by
 * part. The in-context scene is the classic "duplicate card on move" bug and the schema that fixes
 * it. Storyboard: docs/curriculum/unit-5-prototypes.md §V.2.
 */
import {
  topic,
  scene,
  step,
  alice,
  bob,
  board,
  rec,
  tick,
  offline,
  online,
  set,
  highlight,
  callout,
  conflict,
  check,
  clearMarks,
  same,
  expect,
  bad,
  good,
  crdt,
  seed,
  doc,
  S,
} from '@/lesson/builders'

const cast = () => [alice({ icon: 'phone' }), bob({ icon: 'laptop' })]

/** The card schema of scene 2, in DSL form. */
const CARD = {
  title: S.lww(),
  labels: S.orSet(),
  votes: S.pn(),
  checklist: S.list(S.map({ text: S.lww(), done: S.lww() })),
}

/** Two checklist items, seeded: ids seed:3 and seed:4 (seed:1 = title, seed:2 = the label). */
const CARD_SEED = [
  seed.at('title', 'set', 'Fix login'),
  seed.at('labels', 'add', 'bug'),
  seed.at('checklist', 'insertAfter', 'HEAD', { text: 'write test', done: false }),
  seed.at('checklist', 'insertAfter', 'seed:3', { text: 'fix', done: false }),
]

export default topic({
  id: 'composing-a-document',
  title: 'Composing a document',
  goal: 'Learn how to design a document out of CRDT parts (one type per field, ids on every item) and what one merge of the whole does.',
  rules: [
    'Pick one CRDT type per part before you write code: the title replaces, votes add up, labels come and go, the checklist keeps an order.',
    'Give every item a stable id, node + counter, so an edit and a delete point at the same thing. Never use the position as the id.',
    'One merge of the whole document merges every part by its own rule, then puts the parts back together.',
    'A move is one change to the user, so make it one write: a column field on the card, not a delete plus an insert.',
  ],
  shape: {
    name: 'Card',
    fields: [
      { key: 'title', example: 'Fix login', role: 'value', note: 'LWW register: replaces' },
      {
        key: 'description',
        example: '(long text)',
        role: 'value',
        note: 'RGA of characters: order matters',
      },
      { key: 'labels', example: 'bug', role: 'value', note: 'OR-Set: add wins' },
      { key: 'votes', example: '0', role: 'value', note: 'PN-Counter: adds up' },
      {
        key: 'checklist',
        example: 'write test · fix',
        role: 'value',
        note: 'RGA of {text, done} items, each with its own id',
      },
    ],
  },
  whenToUse: [
    'A JSON-like document (card, note, profile) is edited on several devices, offline included.',
    'Different fields change in different ways and you control the schema.',
    'Delete, edit and move need a rule decided up front, not in a support ticket.',
    'You will use a document library (Automerge, Yjs) or a database map type (Riak).',
  ],
  whenNotToUse: [
    'The document is an opaque file: version the reference, not the contents.',
    'One server orders every write and clients are always online: server LWW is simpler.',
    'A rule spans parts (a total must equal its rows): derive it, or coordinate.',
    'Nobody can name the merge rule a field should have; decide that first.',
  ],
  realWorld:
    'A Trello-style card: title, labels, votes and a checklist. Automerge and Yjs nest maps and lists like this; a Riak map nests registers, counters, flags and sets.',
  scenes: [
    scene(
      'pick-a-type-per-field',
      {
        layout: 'row',
        actors: [],
        boards: [board('schema', rec.tree({}), { label: 'Card schema' })],
      },
      [
        step(
          's01',
          'A card is a document made of parts. We pick one CRDT type per part before we write any code.',
          highlight('board.schema'),
        ),
        step(
          's02',
          'Title: one short value that people replace. An LWW register.',
          set('board.schema.title', 'LWW register'),
          callout('board.schema.title', 'replaces'),
        ),
        step(
          's03',
          'Description: long text that two people may type in at once. A sequence of characters.',
          set('board.schema.description', 'RGA of chars'),
          callout('board.schema.description', 'order matters'),
        ),
        step(
          's04',
          'Labels: members come and go, and their order means nothing. An OR-Set, so a re-add survives.',
          set('board.schema.labels', 'OR-Set'),
          callout('board.schema.labels', 'add wins'),
        ),
        step(
          's05',
          'Votes: they add up, and they can be taken back. A PN-Counter.',
          set('board.schema.votes', 'PN-Counter'),
          callout('board.schema.votes', 'adds up'),
        ),
        step(
          's06',
          'Checklist: ordered items, and each item is a small document of its own.',
          clearMarks(),
          set(
            'board.schema.checklist',
            rec({ item: rec({ text: 'LWW register', done: 'LWW register' }) }),
          ),
          callout('board.schema.checklist', 'RGA of documents'),
        ),
        step(
          's07',
          'Every item needs a stable id, so an edit and a delete can point at the same thing. Never use the position as the id.',
          highlight('board.schema.checklist'),
          callout('board.schema.checklist', 'id = node:counter', { sticky: true }),
        ),
        step.long(
          's08',
          'That is the whole **schema**: five parts, five rules, decided up front. Now we run real edits through it.',
          check('board.schema'),
        ),
      ],
    ),
    scene('one-merge-many-rules', { layout: 'pair', clock: { show: true }, actors: cast() }, [
      step(
        's01',
        'Alice and Bob hold the same card (description left out for space). The checklist has two items, each with a text and a done flag.',
        crdt.doc(['alice', 'bob'], 'card', CARD, { seed: CARD_SEED }),
        highlight('alice.card.checklist'),
        expect('alice.card.title', 'Fix login'),
        expect('alice.card.labels', ['bug']),
      ),
      step(
        's02',
        'Each part keeps its own type. The chip on a part tells you which rule it will merge with.',
        highlight(['alice.card.title@type', 'alice.card.labels@type', 'alice.card.votes@type']),
        expect('alice.card.title@type', 'lww-register'),
        expect('alice.card.labels@type', 'or-set'),
        expect('alice.card.checklist@type', 'rga'),
      ),
      step(
        's03',
        "Time 1. Alice ticks the first item: 'write test' is done.",
        clearMarks(),
        tick(),
        doc('card').at('checklist[seed:3].done').set('alice', true),
        expect('alice.card.checklist[seed:3].done', true),
      ),
      step(
        's04',
        "Time 2. At the same moment Bob fixes a typo in that same item: 'write tests'.",
        tick(),
        doc('card').at('checklist[seed:3].text').set('bob', 'write tests'),
        expect('bob.card.checklist[seed:3].text', 'write tests'),
      ),
      step(
        's05',
        "Bob also adds a step after 'fix'. His new item gets its own id, bob:2.",
        doc('card').at('checklist').insertAfter('bob', 'seed:4', { text: 'deploy', done: false }),
        highlight('bob.card.checklist[bob:2]'),
      ),
      step(
        's06',
        "Both vote for the card, and Bob adds the label 'backend'.",
        doc('card').at('votes').inc('alice', 1),
        doc('card').at('votes').inc('bob', 1),
        doc('card').at('labels').add('bob', 'backend'),
      ),
      step('s07', 'One merge, in one direction and back.', crdt.sync('alice', 'bob', 'card')),
      step(
        's08',
        "Inside the first item: 'done' took Alice's write and 'text' took Bob's. Different fields, no conflict.",
        good('alice.card.checklist[seed:3]'),
        expect('alice.card.checklist[seed:3].done', true),
        expect('alice.card.checklist[seed:3].text', 'write tests'),
      ),
      step(
        's09',
        "Bob's new step sits after 'fix' on both copies, in the same place, with the same id.",
        clearMarks(),
        highlight(['alice.card.checklist[bob:2]', 'bob.card.checklist[bob:2]']),
        expect('alice.card.checklist', [
          { done: true, text: 'write tests' },
          { done: false, text: 'fix' },
          { done: false, text: 'deploy' },
        ]),
      ),
      step(
        's10',
        'Votes added up to 2, and the labels are the union of both sides.',
        clearMarks(),
        good('alice.card.votes'),
        good('alice.card.labels'),
        expect('alice.card.votes', 2),
        expect('alice.card.labels', ['backend', 'bug']),
      ),
      step(
        's11',
        'Both copies are equal again. That is the rule of a **composed document**: merge every part with its own rule, then put the parts back together.',
        clearMarks(),
        same('alice.card', 'bob.card'),
        check('alice.card'),
        check('bob.card'),
      ),
      step.long(
        's12',
        'No field had to wait for another, and no server picked a winner. You chose each rule when you wrote the schema.',
      ),
    ]),
    scene(
      'moving-a-card',
      { layout: 'pair', clock: { show: true }, actors: cast() },
      [
        step(
          's01',
          'A board with three columns. Each column is a sequence of cards, and one card sits in To do.',
          crdt.doc(
            ['alice', 'bob'],
            'cols',
            {
              todo: S.list(S.map({ title: S.lww() })),
              doing: S.list(S.map({ title: S.lww() })),
              done: S.list(S.map({ title: S.lww() })),
            },
            { seed: [seed.at('todo', 'insertAfter', 'HEAD', { title: 'Fix login' })] },
          ),
          highlight('alice.cols.todo'),
          expect('alice.cols.todo', [{ title: 'Fix login' }]),
        ),
        step(
          's02',
          'Alice moves the card from To do to Doing. In this schema a move is a delete plus an insert.',
          doc('cols').at('todo').delete('alice', 'seed:1'),
          doc('cols').at('doing').insertAfter('alice', 'HEAD', { title: 'Fix login' }),
          expect('alice.cols.doing', [{ title: 'Fix login' }]),
        ),
        step(
          's03',
          'Bob is offline. He moves the same card to Done: another delete, another insert.',
          offline('bob'),
          doc('cols').at('todo').delete('bob', 'seed:1'),
          doc('cols').at('done').insertAfter('bob', 'HEAD', { title: 'Fix login' }),
          expect('bob.cols.done', [{ title: 'Fix login' }]),
        ),
        step(
          's04',
          'Bob comes back, and the copies merge.',
          online('bob'),
          crdt.sync('alice', 'bob', 'cols'),
        ),
        step(
          's05',
          'Whoops — the card is now in Doing and in Done. Two inserts, both kept; each sequence did exactly its job.',
          bad('alice.cols.doing'),
          bad('alice.cols.done'),
          conflict('alice.cols.doing', 'alice.cols.done'),
          expect('alice.cols.doing', [{ title: 'Fix login' }]),
          expect('alice.cols.done', [{ title: 'Fix login' }]),
        ),
        step(
          's06',
          'The schema caused this, not the CRDT. A move is one change to the user, so it must be one change in the data.',
          clearMarks(),
          callout('alice.cols', 'delete + insert = 2 cards', { tone: 'warn' }),
        ),
        step(
          's07',
          'The fix: keep one list of cards, and give each card a column field. A register, so it holds one column at a time.',
          crdt.doc(
            ['alice', 'bob'],
            'cards',
            { cards: S.list(S.map({ title: S.lww(), column: S.lww() })) },
            {
              seed: [
                seed.at('cards', 'insertAfter', 'HEAD', { title: 'Fix login', column: 'todo' }),
              ],
            },
          ),
          callout('alice.cards.cards[seed:1].column', 'where it lives'),
        ),
        step(
          's08',
          'Time 1: Alice sets column = doing. Time 2: Bob, offline again, sets column = done.',
          clearMarks(),
          tick(),
          doc('cards').at('cards[seed:1].column').set('alice', 'doing'),
          offline('bob'),
          tick(),
          doc('cards').at('cards[seed:1].column').set('bob', 'done'),
          conflict('alice.cards.cards[seed:1].column', 'bob.cards.cards[seed:1].column'),
        ),
        step(
          's09',
          'Merge: the card is in exactly one column, the later write. One card, one place — a conflict, but a clean one.',
          clearMarks(),
          online('bob'),
          crdt.sync('alice', 'bob', 'cards'),
          good('alice.cards.cards[seed:1].column'),
          expect('alice.cards.cards[seed:1].column', 'done'),
          expect('bob.cards.cards[seed:1].column', 'done'),
        ),
        step(
          's10',
          'Position inside a column is a field too: a sortable number between its neighbours, so reordering is also one write.',
          clearMarks(),
          callout('alice.cards.cards[seed:1]', 'add an order field: 0.5', { sticky: true }),
        ),
        step.long(
          's11',
          'Real tools do this: Figma stores a parent and a position on every object instead of moving it between lists ([Real systems](/crdts/choosing/real-systems)).',
          check('alice.cards'),
          check('bob.cards'),
        ),
      ],
      { inContext: true },
    ),
  ],
})
