/**
 * III.6 — In context: typing together. Two RGA scenes driven by ops through the real delivery
 * layer: `two-people-typing` runs the `type` macro (one real op per character) against a
 * concurrent insert at the same anchor, and `todo-list-move` shows that delete + insert is not a
 * move: two concurrent moves converge on a list with the item twice. Every id, stamp and order
 * is computed by src/crdt/rga.ts. Storyboard: docs/curriculum/unit-3-4.md §III.6.
 */
import {
  topic,
  scene,
  step,
  alice,
  bob,
  note,
  highlight,
  callout,
  check,
  clearMarks,
  same,
  applyAll,
  tomb,
  crdt,
  seed,
  rga,
  apply,
  expect,
} from '@/lesson/builders'

export default topic({
  id: 'in-context-collab-text',
  title: 'In context: typing together',
  goal: 'Follow two people typing in one line and moving items in one list, and say what RGA guarantees (one order) and what it does not (meaning).',
  whenToUse: [
    'Collaborative text and block lists: typing is many tiny inserts and deletes.',
    'Two people edit the same spot and both edits must survive in one agreed order.',
    'A todo or block list that is rarely reordered.',
  ],
  whenNotToUse: [
    'Users reorder a lot: a delete plus insert "move" can duplicate; use a type with a move op.',
    'The same cursor spot is hit by both sides every second: converged text may read oddly.',
    'Rich text: bold, comments and links need structure on top of the sequence.',
  ],
  realWorld:
    'Google Docs; Notion block lists; Figma layer order; Automerge lists with a move operation.',
  scenes: [
    scene(
      'two-people-typing',
      { layout: 'pair', actors: [alice({ icon: 'phone' }), bob({ icon: 'laptop' })] },
      [
        step(
          's01',
          'A shared line: Hi. Two named characters, alice:1 and alice:2, and two people about to type at the same spot.',
          crdt.init(['alice', 'bob'], 'line', 'rga', {
            wire: 'ops',
            display: 'text',
            seed: [seed.text('alice', 'Hi')],
          }),
          note(
            'rule',
            'insert after a name · same anchor: higher stamp first, then higher node id',
          ),
          expect('alice.line', 'Hi'),
        ),
        step(
          's02',
          'Alice types a space and the word Bob after the i. Four characters, four ops: alice:3 to alice:6, each anchored on the one before.',
          rga('line').type('alice', 'alice:2', ' Bob'),
          highlight('alice@outbox'),
          expect('alice.line', 'Hi Bob'),
          expect('alice@outbox', ['alice:3', 'alice:4', 'alice:5', 'alice:6']),
        ),
        step(
          's03',
          'At the same time Bob adds an exclamation mark after the i: one op, bob:1, stamp 1.',
          rga('line').insertAfter('bob', 'alice:2', '!'),
          highlight('bob.line[bob:1]@ts'),
          expect('bob.line', 'Hi!'),
          expect('bob.line[bob:1]@ts', 1),
        ),
        step(
          's04',
          'Alice reads Hi Bob; Bob reads Hi with a mark. Both broadcast.',
          crdt.broadcast('alice', 'line'),
          crdt.broadcast('bob', 'line'),
        ),
        step(
          's05',
          "Bob applies Alice's first op, the space. It also says after alice:2 with stamp 1, just like his mark.",
          apply('alice:3@bob'),
          highlight(['bob.line[alice:3]@ts', 'bob.line[bob:1]@ts']),
          expect('bob.line[alice:3]@ts', 1),
          expect('bob.line', 'Hi! '),
        ),
        step(
          's06',
          'Same stamp, so the node id decides: bob sorts after alice, and the mark stays first. The rest of her word follows her space.',
          applyAll(['alice:4@bob', 'alice:5@bob', 'alice:6@bob']),
          expect('bob.line', 'Hi! Bob'),
        ),
        step(
          's07',
          "Alice applies Bob's mark. It lands after the i and in front of her space: the same text on both.",
          apply('bob:1@alice'),
          highlight('alice.line[bob:1]'),
          same('alice.line', 'bob.line'),
          expect('alice.line', 'Hi! Bob'),
        ),
        step(
          's08',
          'They agree on one line, with the mark in the middle. Not what anyone wanted, but they agree, and one more edit fixes it.',
          clearMarks(),
          check('alice.line'),
          check('bob.line'),
        ),
        step(
          's09',
          'Bob deletes his mark and types it at the end: delete bob:1, insert after alice:6. Two ops, bob:2 and bob:3.',
          rga('line').delete('bob', 'bob:1'),
          rga('line').insertAfter('bob', 'alice:6', '!'),
          highlight('bob@outbox'),
          expect('bob.line', 'Hi Bob!'),
          expect('bob@outbox', ['bob:2', 'bob:3']),
        ),
        step(
          's10',
          'He broadcasts and Alice applies both. Both copies now end with the mark, and the tombstone of the old mark stays behind.',
          crdt.broadcast('bob', 'line'),
          applyAll(['bob:2@alice', 'bob:3@alice']),
          tomb('alice.line[bob:1]'),
          same('alice.line', 'bob.line'),
          expect('alice.line', 'Hi Bob!'),
        ),
        step.long(
          's11',
          'This is how collaborative editors work underneath: named characters, insert-after, tombstones, and a tie rule nobody argues with.',
        ),
      ],
      { inContext: true },
    ),
    scene(
      'todo-list-move',
      { layout: 'pair', actors: [alice({ icon: 'phone' }), bob({ icon: 'laptop' })] },
      [
        step(
          's01',
          'A todo list is a sequence too. Each item has a name: alice:1, alice:2, alice:3.',
          crdt.init(['alice', 'bob'], 'todos', 'rga', {
            wire: 'ops',
            display: 'column',
            seed: [
              seed.by('alice', 'insertAfter', 'HEAD', 'Buy milk'),
              seed.by('alice', 'insertAfter', 'alice:1', 'Call mom'),
              seed.by('alice', 'insertAfter', 'alice:2', 'Pay rent'),
            ],
          }),
          note('rule', 'RGA has insert and delete · it has no move'),
          expect('alice.todos', ['Buy milk', 'Call mom', 'Pay rent']),
        ),
        step(
          's02',
          'Alice moves Pay rent to the top. Plain RGA has no move, so it is a delete plus an insert: delete alice:3, insert a copy after HEAD.',
          rga('todos').delete('alice', 'alice:3'),
          rga('todos').insertAfter('alice', 'HEAD', 'Pay rent'),
          highlight('alice@outbox'),
          expect('alice.todos', ['Pay rent', 'Buy milk', 'Call mom']),
          expect('alice@outbox', ['alice:4', 'alice:5']),
        ),
        step(
          's03',
          'She broadcasts; Bob applies both. Pay rent, Buy milk, Call mom, plus one tombstone.',
          crdt.broadcast('alice', 'todos'),
          applyAll(['alice:4@bob', 'alice:5@bob']),
          tomb('bob.todos[alice:3]'),
          same('alice.todos', 'bob.todos'),
          expect('bob.todos', ['Pay rent', 'Buy milk', 'Call mom']),
        ),
        step(
          's04',
          'Now the trap. Both move Buy milk to the top at the same time: each deletes alice:1 and inserts a copy after HEAD.',
          clearMarks(),
          rga('todos').delete('alice', 'alice:1'),
          rga('todos').insertAfter('alice', 'HEAD', 'Buy milk'),
          rga('todos').delete('bob', 'alice:1'),
          rga('todos').insertAfter('bob', 'HEAD', 'Buy milk'),
          expect('alice.todos', ['Buy milk', 'Pay rent', 'Call mom']),
          expect('bob.todos', ['Buy milk', 'Pay rent', 'Call mom']),
        ),
        step(
          's05',
          "Both broadcast. Each applies the other's delete, which hits an item that is already dead, and the other's insert.",
          crdt.broadcast('alice', 'todos'),
          crdt.broadcast('bob', 'todos'),
          applyAll(['bob:1@alice', 'bob:2@alice', 'alice:6@bob', 'alice:7@bob']),
          expect('alice.todos', ['Buy milk', 'Buy milk', 'Pay rent', 'Call mom']),
        ),
        step.long(
          's06',
          'Whoops — Buy milk is there twice, on both screens. Two moves made two copies.',
          highlight(
            [
              'alice.todos[alice:7]',
              'alice.todos[bob:2]',
              'bob.todos[alice:7]',
              'bob.todos[bob:2]',
            ],
            {
              tone: 'danger',
            },
          ),
          same('alice.todos', 'bob.todos'),
        ),
        step(
          's07',
          'The **RGA** converged: both copies agree. But the meaning is wrong, because a move is not a delete plus an insert.',
          callout('bob.todos', 'converged ≠ correct', { tone: 'warn' }),
        ),
        step.long(
          's08',
          'Fixes exist: a real move op (Automerge has one), or a position number per item that you sort by. Both are beyond this course; the trap is not.',
          clearMarks(),
          note('rule', 'move needs its own op, or a position field'),
        ),
      ],
      { inContext: true },
    ),
  ],
})
