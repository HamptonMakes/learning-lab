/**
 * II.3 — LWW Map. A task card whose fields are each an LWW register: edits to different fields
 * both survive a merge (`different-fields`), the same field still races and the newer stamp wins
 * (`same-field`, continuing from the first scene), and a team card goes through a relay with
 * three editors and one real race (`team-board`, in context). Every field, stamp and winner is
 * computed by src/crdt/lww-map.ts. Storyboard: docs/curriculum/unit-1-2.md §II.3.
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
  good,
  check,
  cross,
  conflict,
  compare,
  same,
  clearMarks,
  tick,
  crdt,
  lwwMap,
  seed,
  merge,
  expect,
  broadcastState,
  allSame,
  syncAll,
} from '@/lesson/builders'

const RULE = 'merge: for each field, newer ts wins · tie → higher node id'

export default topic({
  id: 'lww-map',
  title: 'LWW Map',
  goal: 'Learn when an LWW map fits a record of independent fields, which edits survive a merge, and which one loses.',
  rules: [
    'Each field is its own LWW register: a value, a time, and who wrote it.',
    'On every update, write down a new time for that field only.',
    'On merge, go field by field: the larger time wins each field. Tie: the higher node id.',
    'Edits to different fields never conflict. Only a field both sides changed can lose a write.',
  ],
  shape: {
    name: 'LWW map',
    fields: [
      { key: 'owner', example: 'Bob', role: 'value', note: 'time 1, by alice' },
      { key: 'status', example: 'Doing', role: 'value', note: 'time 2, by bob' },
      { key: 'due', example: 'Fri', role: 'value', note: 'not changed yet' },
    ],
    note: 'One LWW register per field: each keeps its own time and node, so each merges on its own.',
  },
  whenToUse: [
    'Records of independent fields edited by different people (task cards, profiles, settings).',
    'Each field is small and set as a whole.',
    '"Newest wins per field" matches what users expect.',
    'You already accept the LWW register; this is the same deal per field.',
  ],
  whenNotToUse: [
    'Two people often edit the same field at once and both edits matter.',
    'Fields depend on each other (start before end): per-field LWW can break the pair.',
    'A field is long text (use a sequence CRDT, Unit III).',
    'Keys come and go all the time (every removed key leaves a tombstone; The cost of state).',
  ],
  realWorld:
    'A task card in a tracker (owner, status, due date) edited by two teammates; Riak maps; the maps of registers inside Automerge and Yjs.',
  scenes: [
    scene('different-fields', { layout: 'pair', clock: { show: true }, actors: [alice(), bob()] }, [
      step(
        's01',
        'A task card with three fields. In an **LWW map**, each field is its own LWW register, with its own timestamp and node.',
        crdt.init(['alice', 'bob'], 'task', 'lww-map', {
          seed: [
            seed('set', 'owner', 'none'),
            seed('set', 'status', 'Todo'),
            seed('set', 'due', 'Fri'),
          ],
        }),
        highlight(['alice.task.owner@ts', 'alice.task.status@ts', 'alice.task.due@ts']),
        expect('alice.task.status', 'Todo'),
      ),
      step(
        's02',
        'The rule is the same as before, but applied field by field.',
        note('rule', RULE),
      ),
      step(
        's03',
        'Time 1: Alice assigns the task to Bob. Only the owner field changes.',
        tick(),
        lwwMap('task').set('alice', 'owner', 'Bob'),
        expect('alice.task.owner', 'Bob'),
        expect('alice.task.owner@ts', 1),
      ),
      step(
        's04',
        'Time 2: Bob has not seen that yet. He moves the status to Doing.',
        tick(),
        lwwMap('task').set('bob', 'status', 'Doing'),
        expect('bob.task.status', 'Doing'),
        expect('bob.task.status@ts', 2),
      ),
      step(
        's05',
        'Two edits, two different fields. No conflict at all.',
        good('alice.task.owner'),
        good('bob.task.status'),
      ),
      step(
        's06',
        'They sync. Each field merges on its own: owner takes t=1 from Alice, status takes t=2 from Bob.',
        clearMarks(),
        crdt.sync('alice', 'bob', 'task'),
        expect('bob.task.owner', 'Bob'),
        expect('alice.task.status', 'Doing'),
      ),
      step('s07', 'Both copies hold both edits. Nothing was lost.', same('alice.task', 'bob.task')),
      step.long(
        's08',
        'This is why a map of registers beats one big register: the race is per field, not per document.',
      ),
    ]),
    scene(
      'same-field',
      null,
      [
        step(
          's01',
          'Now both change the due date. Time 3: Alice moves it to Thu.',
          tick(),
          lwwMap('task').set('alice', 'due', 'Thu'),
          expect('alice.task.due', 'Thu'),
          expect('alice.task.due@ts', 3),
        ),
        step(
          's02',
          'Time 4: Bob has not seen that, and moves it to Mon.',
          tick(),
          lwwMap('task').set('bob', 'due', 'Mon'),
          conflict('alice.task.due', 'bob.task.due'),
          expect('bob.task.due@ts', 4),
        ),
        step(
          's03',
          'Whoops — one field, two writes: t=3 against t=4. Only one can survive the merge.',
          conflict('alice.task.due', 'bob.task.due'),
          compare(['alice.task.due', 'bob.task.due'], { expect: 'less' }), // stamp rule: ts 3 < 4
        ),
        step(
          's04',
          'They sync. The newer stamp wins this field: Mon, t=4, on both copies.',
          clearMarks(),
          crdt.sync('alice', 'bob', 'task'),
          highlight('alice.task.due@ts'),
          expect('alice.task.due', 'Mon'),
          expect('bob.task.due', 'Mon'),
        ),
        step(
          's05',
          "Alice's Thu is gone. Same deal as the single register, only smaller.",
          cross('alice.task.due'),
          same('alice.task', 'bob.task'),
        ),
        step(
          's06',
          'Owner and status were untouched by this race. Only the field that raced paid.',
          clearMarks(),
          check('alice.task.owner'),
          check('alice.task.status'),
        ),
        step.long(
          's07',
          'Per field, LWW still loses one side of a race. The map only makes the race smaller: one field, not the whole card.',
        ),
      ],
      { startFrom: 'different-fields' },
    ),
    scene(
      'team-board',
      {
        layout: 'hub',
        clock: { show: true },
        actors: [server('Relay'), alice(), bob(), carol()],
      },
      [
        step(
          's01',
          'A task card shared by a team. The relay keeps a copy, forwards states and merges like any other copy.',
          crdt.init(['server', 'alice', 'bob', 'carol'], 'card', 'lww-map', {
            seed: [
              seed('set', 'title', 'Fix login'),
              seed('set', 'owner', 'none'),
              seed('set', 'status', 'Todo'),
              seed('set', 'priority', 'P2'),
            ],
          }),
          note('rule', RULE),
        ),
        step(
          's02',
          'Time 1: Carol raises the priority to P1. Time 2: Bob takes the task.',
          tick(),
          lwwMap('card').set('carol', 'priority', 'P1'),
          tick(),
          lwwMap('card').set('bob', 'owner', 'Bob'),
          expect('carol.card.priority@ts', 1),
          expect('bob.card.owner@ts', 2),
        ),
        step(
          's03',
          'Time 3: Alice renames it to Fix SSO login. Three people, three fields, and nobody waited for anybody.',
          tick(),
          lwwMap('card').set('alice', 'title', 'Fix SSO login'),
          expect('alice.card.title@ts', 3),
        ),
        step(
          's04',
          'All three send their cards to the relay. Each message carries the whole card.',
          crdt.send('alice', 'server', 'card', { id: 'm1' }),
          crdt.send('bob', 'server', 'card', { id: 'm2' }),
          crdt.send('carol', 'server', 'card', { id: 'm3' }),
        ),
        step(
          's05',
          'The relay merges them as they land, field by field. No two edits touched the same field, so all three survive.',
          merge('m2'),
          merge('m3'),
          merge('m1'),
          expect('server.card.title', 'Fix SSO login'),
          expect('server.card.owner', 'Bob'),
          expect('server.card.priority', 'P1'),
          expect('server.card.status', 'Todo'),
        ),
        step(
          's06',
          'The relay fans the merged card back out. Every copy now agrees.',
          broadcastState('server', ['alice', 'bob', 'carol'], 'card', 'm4'),
          allSame('card', ['server', 'alice', 'bob', 'carol']),
        ),
        step(
          's07',
          'Now a real race. Time 4: Bob sets the status to Doing; time 5: Carol sets it to Blocked.',
          clearMarks(),
          tick(),
          lwwMap('card').set('bob', 'status', 'Doing'),
          tick(),
          lwwMap('card').set('carol', 'status', 'Blocked'),
          conflict('bob.card.status', 'carol.card.status'),
          expect('bob.card.status@ts', 4),
          expect('carol.card.status@ts', 5),
        ),
        step(
          's08',
          'Bob syncs with the relay, then Carol does. For the status field, t=5 beats t=4: the relay ends with Blocked.',
          clearMarks(),
          syncAll('card', ['bob', 'server'], ['carol', 'server']),
          expect('server.card.status', 'Blocked'),
        ),
        step(
          's09',
          'One more round for Bob and Alice. Blocked wins everywhere; Bob sees his change replaced, and sees by whom.',
          syncAll('card', ['bob', 'server'], ['alice', 'server']),
          highlight('bob.card.status@node'),
          expect('bob.card.status', 'Blocked'),
          expect('bob.card.status@node', 'carol'),
          allSame('card', ['server', 'alice', 'bob', 'carol']),
        ),
        step.long(
          's10',
          'A map of registers: independent fields merge freely, and a racing field picks a winner you can explain.',
        ),
      ],
      { inContext: true },
    ),
  ],
})
