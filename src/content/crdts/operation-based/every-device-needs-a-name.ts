/**
 * III.2 — Every device needs a name. `same-name` is plain on purpose: two phones with one name
 * mint the same op id and a naive server drops a real tap — a failure no real CRDT can compute.
 * `node-and-counter` is the real OR-Set driven by ops: ids `alice:1…3` / `bob:1` are minted by the
 * reducer, and a gap in one node's counter parks an op. `where-names-come-from` contrasts a
 * server-assigned name with a self-chosen UUID v4. Storyboard: docs/curriculum/unit-3-4.md §III.2.
 */
import {
  topic,
  scene,
  step,
  alice,
  bob,
  server,
  device,
  sset,
  scalar,
  uuid,
  send,
  deliver,
  set,
  insert,
  offline,
  online,
  note,
  highlight,
  callout,
  cross,
  check,
  clearMarks,
  same,
  crdt,
  orSet,
  apply,
  expect,
} from '@/lesson/builders'

export default topic({
  id: 'every-device-needs-a-name',
  title: 'Every device needs a name',
  goal: 'Give every replica a unique, stable node id, read an op id as (node, counter), and choose where the name comes from.',
  whenToUse: [
    '(node, counter) op ids when one node makes ops in sequence: cheap, sortable, gaps show.',
    'Random 128-bit node ids (UUID v4) when devices must start offline with no server.',
    'Server-assigned short ids when every device registers first and metadata must stay small.',
    'A new id for every fresh install; never the same id on two devices.',
  ],
  whenNotToUse: [
    'Not the user id: one user has many devices.',
    'Not hostnames, IPs or phone numbers: they change and they repeat.',
    'Not small random numbers: 53 random bits (Yjs) is the floor, 122 (UUID v4) is comfortable.',
    'Never restart the counter at 1 after a reinstall unless the node id changes too.',
  ],
  realWorld:
    'Automerge actor ids are 128 random bits; a Yjs clientID is a random 53-bit integer; Cassandra gives every host a UUID.',
  scenes: [
    scene(
      'same-name',
      {
        layout: 'hub',
        actors: [
          server('Server', { holds: { likes: 0, applied: sset([]) } }),
          device('alice', 'Phone', { icon: 'phone', holds: { node: 'phone' } }),
          device('bob', 'Phone', { icon: 'phone', holds: { node: 'phone' } }),
        ],
      },
      [
        step(
          's01',
          'Two phones count likes on one post through a server. Both phones call themselves phone.',
          highlight(['alice.node', 'bob.node'], { tone: 'warn' }),
        ),
        step(
          's02',
          'Alice taps like. Her op id is her name plus a counter: phone:1.',
          send('alice', 'server', scalar('+1', { tag: 'phone:1' }), { id: 'a1', label: '+1' }),
        ),
        step(
          's03',
          'Bob taps like too. His op id is also phone:1.',
          send('bob', 'server', scalar('+1', { tag: 'phone:1' }), { id: 'b1', label: '+1' }),
        ),
        step(
          's04',
          "The server applies Alice's op: 1 like. It writes phone:1 in its applied list.",
          deliver('a1'),
          set('server.likes', 1),
          insert('server.applied', 'phone:1'),
          expect('server.likes', 1),
        ),
        step(
          's05',
          "Bob's op arrives with the same id. The server finds phone:1 in its list and ignores the op as a repeat.",
          deliver('b1'),
          highlight('server.applied[phone:1]', { tone: 'warn' }),
          callout('server', 'looks like a repeat', { tone: 'warn' }),
        ),
        step.long(
          's06',
          'Whoops — two taps became one like. A real tap was thrown away.',
          cross('server.likes'),
        ),
        step(
          's07',
          'The fix: every device gets its own name. This phone is alice, that one is bob.',
          clearMarks(),
          set('alice.node', 'alice'),
          set('bob.node', 'bob'),
        ),
        step(
          's08',
          'Rewind the server, and both tap again. The op ids now differ: alice:1 and bob:1.',
          set('server.likes', 0),
          set('server.applied', sset([])),
          send('alice', 'server', scalar('+1', { tag: 'alice:1' }), { id: 'a2', label: '+1' }),
          send('bob', 'server', scalar('+1', { tag: 'bob:1' }), { id: 'b2', label: '+1' }),
        ),
        step(
          's09',
          "Alice's op has a new id, so it is applied; Bob's op has another new id, so it is applied too. Two taps, two likes.",
          deliver('a2'),
          set('server.likes', 1),
          insert('server.applied', 'alice:1'),
          deliver('b2'),
          set('server.likes', 2),
          insert('server.applied', 'bob:1'),
          check('server.likes'),
          expect('server.likes', 2),
        ),
        step.long(
          's10',
          'A **node id** must be unique and must never change. Every op id in this unit starts with one.',
          note('rule', 'node id: unique · never changes'),
        ),
      ],
    ),
    scene(
      'node-and-counter',
      { layout: 'pair', actors: [alice({ icon: 'phone' }), bob({ icon: 'laptop' })] },
      [
        step(
          's01',
          'A shared OR-Set, driven by ops. Each device keeps its own counter, and every new op takes the next number.',
          crdt.init(['alice', 'bob'], 'list', 'or-set', { wire: 'ops' }),
          note('rule', 'op id = node:counter · a gap in the counter = a missing op'),
        ),
        step(
          's02',
          'Alice makes three ops: add milk, add eggs, remove milk. Their ids are alice:1, alice:2, alice:3.',
          orSet('list').add('alice', 'milk'),
          orSet('list').add('alice', 'eggs'),
          orSet('list').remove('alice', 'milk'),
          highlight('alice@outbox'),
          expect('alice.list', ['eggs']),
          expect('alice@outbox', ['alice:1', 'alice:2', 'alice:3']),
        ),
        step(
          's03',
          'Bob makes one: add tea, id bob:1. His name is different, so his ids can never collide with hers.',
          orSet('list').add('bob', 'tea'),
          highlight('bob@outbox'),
          expect('bob@outbox', ['bob:1']),
        ),
        step(
          's04',
          'Both broadcast. Four ops are in the air.',
          crdt.broadcast('alice', 'list'),
          crdt.broadcast('bob', 'list'),
        ),
        step(
          's05',
          'Alice applies bob:1: tea joins eggs.',
          apply('bob:1@alice'),
          expect('alice.list', ['eggs', 'tea']),
        ),
        step(
          's06',
          'Bob applies alice:1: milk. Then alice:3 arrives, but alice:2 has not.',
          apply('alice:1@bob'),
          apply('alice:3@bob', { park: true }),
          expect('bob.list', ['milk', 'tea']),
        ),
        step(
          's07',
          'The counter does a second job: after alice:1, Bob expects alice:2. He sees the gap, parks alice:3 and waits.',
          callout('msg:alice:3@bob', 'alice:2 is missing', { tone: 'warn' }),
          highlight('bob@inbox'),
        ),
        step(
          's08',
          'alice:2 arrives: eggs. Now the run is complete, 1 2 3, and the parked op can go.',
          apply('alice:2@bob'),
          expect('bob.list', ['eggs', 'milk', 'tea']),
        ),
        step(
          's09',
          'Bob applies alice:3: milk is removed. Both copies agree: eggs and tea.',
          clearMarks(),
          apply('alice:3@bob'),
          same('alice.list', 'bob.list'),
          expect('bob.list', ['eggs', 'tea']),
        ),
        step.long(
          's10',
          'Node id plus counter is the op id of every type in this unit. Some papers call it a **dot**.',
        ),
      ],
    ),
    scene(
      'where-names-come-from',
      {
        layout: 'hub',
        actors: [
          server('Server'),
          device('laptop', 'Laptop', { icon: 'laptop' }),
          device('phone', 'Phone', { icon: 'phone' }),
        ],
      },
      [
        step(
          's01',
          'Option 1: a server hands out names. The laptop connects and asks for one.',
          send('laptop', 'server', 'name?', { id: 'ask', label: 'name?' }),
        ),
        step(
          's02',
          'The server replies: you are node 7. Short and unique, but the laptop needed a connection first.',
          deliver('ask'),
          send('server', 'laptop', 7, { id: 'reply', label: 'your name', into: 'laptop.node' }),
          deliver('reply'),
          expect('laptop.node', 7),
        ),
        step(
          's03',
          'Option 2: the device picks a random name by itself. The phone is offline, and that is fine.',
          offline('phone'),
        ),
        step(
          's04',
          'It rolls 122 random bits: a **UUID** version 4. Two devices rolling the same one is so unlikely that we call it impossible.',
          set('phone.node', {
            ...uuid.v4('9f3a116c2b8e4d71a50c7e19d2449b03'),
            display: 'canonical',
          }),
          highlight('phone.node'),
        ),
        step(
          's05',
          'Automerge uses 128 random bits; Yjs uses a random 53-bit number. Both are option 2.',
          callout('phone', 'Automerge: 128 bits · Yjs: 53 bits', { tone: 'info' }),
        ),
        step(
          's06',
          'Pick a name once, store it, never change it. The [UUIDs](/uuids/anatomy/uuid-v4) module explains the bits.',
          online('phone'),
          check('phone.node'),
          check('laptop.node'),
        ),
        step.long(
          's07',
          'A fresh install gets a fresh name. The old name with a counter restarted at 1 would mint ids that already exist.',
          note('rule', 'new install → new name (or keep the counter)'),
        ),
      ],
    ),
  ],
})
