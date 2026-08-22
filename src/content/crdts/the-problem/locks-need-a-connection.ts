/**
 * I.3 — Locks need a connection. What a lock costs: a live connection to one coordinator
 * (`offline`), a round trip per request (`latency`, clock in ms), and a queue when many people
 * edit one thing (`shared-doc`, in context). Plain values throughout.
 * Storyboard: docs/curriculum/unit-1-2.md §I.3.
 */
import {
  topic,
  scene,
  step,
  alice,
  bob,
  carol,
  server,
  rec,
  ref,
  send,
  deliver,
  drop,
  set,
  status,
  offline,
  online,
  tick,
  note,
  highlight,
  callout,
  cross,
  clearMarks,
  expect,
} from '@/lesson/builders'

const doc = () => rec({ title: 'Q3 plan' })

export default topic({
  id: 'locks-need-a-connection',
  title: 'Locks need a connection',
  goal: 'Name the three costs of a lock (a live connection, a round trip per request, a queue) and say when they are worth paying.',
  whenToUse: [
    'Writers are servers in one data center with fast, reliable links.',
    'Writes are rare and short, so nobody queues for long.',
    'A writer that cannot reach the lock server can simply wait or fail.',
  ],
  whenNotToUse: [
    'Devices go offline: tunnels, planes, flaky Wi-Fi.',
    'Writers are far from the lock server; every lock is a round trip.',
    'Many people edit one thing at once; they form a queue.',
    'The lock server itself can go down; it is one place to get stuck.',
  ],
  realWorld:
    'Editing a note on a plane; a global team on one database in one region; "someone else is editing this page" banners.',
  scenes: [
    scene(
      'offline',
      {
        layout: 'hub',
        actors: [
          server('Server', { holds: { doc: doc(), lock: 'free' } }),
          alice({ icon: 'phone', holds: { doc: doc() } }),
          bob({ icon: 'laptop', holds: { doc: doc() } }),
        ],
      },
      [
        step(
          's01',
          'Same lock as before. Alice is on a train, and the train enters a tunnel.',
          offline('alice'),
        ),
        step(
          's02',
          'She wants to edit. Her phone tries to ask for the lock.',
          send('alice', 'server', 'lock?', { id: 'm1', label: 'lock?' }),
        ),
        step(
          's03',
          'The request never arrives. No connection, no lock.',
          drop('m1'),
          status('alice', 'waiting'),
        ),
        step(
          's04',
          'Alice has two choices: wait for the tunnel to end, or edit without the lock.',
          callout('alice', 'wait, or edit without the lock?', { tone: 'warn' }),
        ),
        step.long(
          's05',
          'Whoops — she edits anyway, and we are back in topic 1. The lock did not help.',
          clearMarks(),
          set('alice.doc.title', 'Q3 plan v2'),
          cross('server.lock'),
        ),
        step(
          's06',
          'Rewind: Alice undoes her edit and leaves the tunnel. Now the other direction.',
          clearMarks(),
          set('alice.doc.title', 'Q3 plan'),
          online('alice'),
          status('alice', null),
        ),
        step(
          's07',
          'Bob takes the lock, then his laptop goes to sleep.',
          set('server.lock', 'bob'),
          status('bob', 'lock'),
          offline('bob'),
        ),
        step(
          's08',
          'Alice asks for the lock. The server says: wait.',
          send('alice', 'server', 'lock?', { id: 'm2', label: 'lock?' }),
          deliver('m2'),
          send('server', 'alice', 'wait', { id: 'm3', label: 'wait' }),
          deliver('m3'),
          status('alice', 'waiting'),
        ),
        step(
          's09',
          'And wait. Bob is gone, and he took the lock with him.',
          callout('server.lock', 'held by bob (offline)', { tone: 'warn' }),
        ),
        step.long(
          's10',
          'A lock needs one **coordinator** and a live connection to it. Real systems add a **lease**, a lock that expires; it works, but it adds rules and waiting.',
          note('lesson', 'A lock needs one coordinator and a live connection to it.'),
        ),
      ],
    ),
    scene(
      'latency',
      {
        layout: 'pair',
        clock: { show: true, format: 'ms' },
        actors: [
          alice({ subtitle: 'Tokyo', holds: { doc: doc() } }),
          server('Database', { subtitle: 'Virginia', holds: { doc: doc(), lock: 'free' } }),
        ],
      },
      [
        step(
          's01',
          'Alice is in Tokyo and the database is in Virginia. One message takes about 100 ms (simplified).',
          highlight('server.lock'),
        ),
        step(
          's02',
          'She asks for the lock: one trip out.',
          send('alice', 'server', 'lock?', { id: 'm1', label: 'lock?' }),
          tick(100),
          deliver('m1'),
          set('server.lock', 'alice'),
        ),
        step(
          's03',
          'The answer comes back: one trip home. Only now can Alice type.',
          send('server', 'alice', 'ok', { id: 'm2', label: 'ok' }),
          tick(100),
          deliver('m2'),
          status('alice', 'lock'),
        ),
        step(
          's04',
          'She types. The save goes out, and the confirmation comes back: one **round trip** more.',
          set('alice.doc.title', 'Q3 plan v2'),
          send('alice', 'server', ref('alice.doc'), {
            id: 'm3',
            label: 'save',
            into: 'server.doc',
          }),
          tick(100),
          deliver('m3'),
          send('server', 'alice', 'saved', { id: 'm4', label: 'saved' }),
          tick(100),
          deliver('m4'),
          expect('server.doc.title', 'Q3 plan v2'),
        ),
        step(
          's05',
          'Then the unlock and its answer. Three round trips, 600 ms, for one title change.',
          send('alice', 'server', 'unlock', { id: 'm5', label: 'unlock' }),
          tick(100),
          deliver('m5'),
          set('server.lock', 'free'),
          send('server', 'alice', 'ok', { id: 'm6', label: 'ok' }),
          tick(100),
          deliver('m6'),
          status('alice', null),
        ),
        step.long(
          's06',
          'Every editor far from the coordinator pays this on every edit. The further away, the slower the lock.',
          callout('alice', '~600 ms per edit', { tone: 'warn' }),
        ),
      ],
    ),
    scene(
      'shared-doc',
      {
        layout: 'hub',
        actors: [
          server('Server', { holds: { doc: doc(), lock: 'free' } }),
          alice({ holds: { doc: doc() } }),
          bob({ holds: { doc: doc() } }),
          carol({ holds: { doc: doc() } }),
        ],
      },
      [
        step(
          's01',
          'Three people open the same document. Each wants to type.',
          highlight(['alice.doc', 'bob.doc', 'carol.doc']),
        ),
        step(
          's02',
          'Alice gets the lock. Bob and Carol must wait.',
          set('server.lock', 'alice'),
          status('alice', 'lock'),
          status('bob', 'waiting'),
          status('carol', 'waiting'),
        ),
        step(
          's03',
          'Alice types one line and saves.',
          set('alice.doc.body', 'Goals: ship v2'),
          send('alice', 'server', ref('alice.doc'), {
            id: 'm1',
            label: 'save',
            into: 'server.doc',
          }),
          deliver('m1'),
          expect('server.doc.body', 'Goals: ship v2'),
        ),
        step(
          's04',
          "Now Bob's turn, and he gets Alice's line with the lock. Carol still waits for her turn.",
          set('server.lock', 'bob'),
          status('alice', null),
          status('bob', 'lock'),
          send('server', 'bob', ref('server.doc'), {
            id: 'm2',
            label: 'ok + doc',
            into: 'bob.doc',
          }),
          deliver('m2'),
          expect('bob.doc.body', 'Goals: ship v2'),
        ),
        step.long(
          's05',
          'This is why collaborative editors do not lock the document. Every edit would be a turn in a queue.',
          callout('carol', 'still waiting', { tone: 'warn' }),
        ),
        step(
          's06',
          'Next: which data really needs the lock, and which data does not.',
          clearMarks(),
        ),
      ],
      { inContext: true },
    ),
  ],
})
