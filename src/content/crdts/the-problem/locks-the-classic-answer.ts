/**
 * I.2 — Locks: the classic answer. Plain values again; the lock is a scalar slot on the server
 * (`free` / holder) plus `status` badges on the writers. `take-turns` replays topic I.1 with a
 * lock; `bank-transfer` is the in-context scene (why money must take turns).
 * Storyboard: docs/curriculum/unit-1-2.md §I.2.
 */
import {
  topic,
  scene,
  step,
  alice,
  bob,
  server,
  rec,
  ref,
  send,
  deliver,
  set,
  status,
  note,
  highlight,
  callout,
  check,
  cross,
  expect,
} from '@/lesson/builders'

const doc = () => rec({ title: 'Q3 plan' })

export default topic({
  id: 'locks-the-classic-answer',
  title: 'Locks: the classic answer',
  goal: 'Learn how a lock makes writers take turns, so the second writer always sees the first change before writing.',
  rules: [
    'One writer holds the lock at a time.',
    'Everyone else waits.',
    'The lock holder writes, then releases the lock.',
    'The next writer gets the latest document with the lock, so it sees the first change before it writes.',
  ],
  shape: {
    name: 'Lock',
    fields: [
      { key: 'held by', example: 'alice', role: 'value', note: 'free when nobody holds it' },
      { key: 'waiting', example: 'bob' },
    ],
    note: 'The lock lives on the server, next to the document.',
  },
  whenToUse: [
    'The data must never be wrong, even for a moment (money, stock levels, unique usernames).',
    'All writers can reach the one server that holds the lock, and quickly.',
    'Writes are short and rare compared to reads.',
    'You need "all or nothing" across several fields or rows.',
  ],
  whenNotToUse: [
    'Writers are often offline or far away (next topic).',
    'Many people edit the same thing at once; a lock makes them queue.',
    'A short wrong period is cheap to fix (see Transactions vs merges).',
  ],
  realWorld:
    'A database row lock (SELECT ... FOR UPDATE), a wiki page lock, a file "checked out" in a design tool.',
  scenes: [
    scene(
      'take-turns',
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
          'Same setup as before, plus a **lock** on the server. Only the lock holder may write.',
          highlight('server.lock'),
        ),
        step(
          's02',
          'Alice wants to edit. First she asks for the lock.',
          send('alice', 'server', 'lock?', { id: 'm1', label: 'lock?' }),
          deliver('m1'),
        ),
        step(
          's03',
          'The lock is free, so the server gives it to Alice.',
          set('server.lock', 'alice'),
          send('server', 'alice', 'ok', { id: 'm2', label: 'ok' }),
          deliver('m2'),
          status('alice', 'lock'),
        ),
        step(
          's04',
          'Bob wants to edit too. He asks for the lock.',
          send('bob', 'server', 'lock?', { id: 'm3', label: 'lock?' }),
          deliver('m3'),
        ),
        step(
          's05',
          'The lock is taken. Bob must wait.',
          send('server', 'bob', 'wait', { id: 'm4', label: 'wait' }),
          deliver('m4'),
          status('bob', 'waiting'),
        ),
        step(
          's06',
          'Alice edits and saves. The server accepts the save, because she holds the lock.',
          set('alice.doc.title', 'Q3 plan v2'),
          send('alice', 'server', ref('alice.doc'), {
            id: 'm5',
            label: 'save',
            into: 'server.doc',
          }),
          deliver('m5'),
          expect('server.doc.title', 'Q3 plan v2'),
        ),
        step(
          's07',
          'Alice releases the lock.',
          send('alice', 'server', 'unlock', { id: 'm6', label: 'unlock' }),
          deliver('m6'),
          set('server.lock', 'free'),
          status('alice', null),
        ),
        step(
          's08',
          'Now Bob gets the lock. With it, he gets the latest document.',
          set('server.lock', 'bob'),
          send('server', 'bob', ref('server.doc'), {
            id: 'm7',
            label: 'ok + doc',
            into: 'bob.doc',
          }),
          deliver('m7'),
          status('bob', 'lock'),
          expect('bob.doc.title', 'Q3 plan v2'),
        ),
        step(
          's09',
          "Bob sees Alice's title before he types. He edits on top of it.",
          set('bob.doc.title', 'Q3 roadmap v2'),
        ),
        step(
          's10',
          "Bob saves and releases. Nothing was lost by surprise: Bob built on top of Alice's change.",
          send('bob', 'server', ref('bob.doc'), { id: 'm8', label: 'save', into: 'server.doc' }),
          deliver('m8'),
          set('server.lock', 'free'),
          status('bob', null),
          check('server.doc.title'),
          expect('server.doc.title', 'Q3 roadmap v2'),
        ),
        step.long(
          's11',
          'A lock turns two writes at the same time into one after the other. A database **transaction** locks the same way for writes to one row (simplified).',
          note('rule', 'Lock: writers take turns. The second writer sees the first.'),
        ),
      ],
    ),
    scene(
      'bank-transfer',
      {
        layout: 'hub',
        actors: [
          server('Bank', {
            icon: 'database',
            holds: { account: rec({ balance: 100 }), lock: 'free' },
          }),
          alice(),
          bob(),
        ],
      },
      [
        step(
          's01',
          'One account with 100 in it. Alice and Bob share it.',
          highlight('server.account.balance'),
        ),
        step(
          's02',
          'Both try to take 80 at the same time.',
          send('alice', 'server', 'take 80', { id: 'm1', label: 'take 80' }),
          send('bob', 'server', 'take 80', { id: 'm2', label: 'take 80' }),
        ),
        step(
          's03',
          "Alice's request arrives first. The bank locks the account for her.",
          deliver('m1'),
          set('server.lock', 'alice'),
          status('alice', 'lock'),
        ),
        step(
          's04',
          "Bob's request arrives next. It waits at the door until the lock is free.",
          deliver('m2', { park: true }),
          status('bob', 'waiting'),
        ),
        step(
          's05',
          'The bank checks: 100 is enough for 80. The balance becomes 20, and the lock is released.',
          set('server.account.balance', 20),
          set('server.lock', 'free'),
          status('alice', null),
          expect('server.account.balance', 20),
        ),
        step(
          's06',
          "Now Bob's turn, and the bank checks again: 20 is not enough for 80. Refused.",
          deliver('m2'),
          set('server.lock', 'bob'),
          status('bob', 'lock'),
          cross('server.account.balance'),
          send('server', 'bob', 'refused', { id: 'm3', label: 'refused' }),
          deliver('m3'),
        ),
        step.long(
          's07',
          'Without the lock, both checks could read 100, both could pass, and the balance would end at -60. Money must take turns.',
          set('server.lock', 'free'),
          status('bob', null),
          callout('server.account.balance', 'never below zero', { tone: 'ok' }),
        ),
      ],
      { inContext: true },
    ),
  ],
})
