/**
 * I.1 — Copies that disagree. Unit I has no CRDTs: copies are plain values changed with `set`, and
 * the "save" is a message whose payload overwrites the server's copy. The point of the topic is
 * the silent loss in the `copies` scene; `copies-everywhere` shows where copies hide in a normal
 * app. Storyboard: docs/curriculum/unit-1-2.md §I.1.
 */
import {
  topic,
  scene,
  step,
  alice,
  bob,
  server,
  service,
  rec,
  ref,
  send,
  deliver,
  set,
  spawn,
  highlight,
  callout,
  conflict,
  cross,
  clearMarks,
  same,
  expect,
} from '@/lesson/builders'

const doc = () => rec({ title: 'Q3 plan' })

export default topic({
  id: 'more-than-one-copy',
  title: 'Copies that disagree',
  goal: 'Learn how two edits at the same time can silently lose one, and where your data already has more than one copy.',
  whenToUse: [
    'Reads must be fast and close to the user (a cache, a phone).',
    'Devices must keep working without a connection.',
    'One server cannot hold all the load, so data is replicated.',
    'Many people edit the same thing and you do not want them to wait.',
  ],
  whenNotToUse: [
    'One writer and one place are enough; then keep one copy.',
    'A wrong value, even for a moment, is expensive and every writer can reach one place.',
    'You have no rule yet for what happens when two copies disagree.',
  ],
  realWorld:
    'Renaming a shared document from your phone while a teammate renames it from a laptop (Google Docs, Notion, Apple Notes).',
  scenes: [
    scene(
      'copies',
      {
        layout: 'hub',
        actors: [
          server('Server', { holds: { doc: doc() } }),
          alice({ icon: 'phone' }),
          bob({ icon: 'laptop' }),
        ],
      },
      [
        step(
          's01',
          'One document lives on the server. It has one field: a title.',
          highlight('server.doc.title'),
        ),
        step(
          's02',
          'Alice opens it on her phone. The phone now holds its own copy, a **replica**.',
          send('server', 'alice', ref('server.doc'), {
            id: 'm1',
            label: 'open',
            into: 'alice.doc',
          }),
          deliver('m1'),
        ),
        step(
          's03',
          'Bob opens it on his laptop. That is a third copy.',
          send('server', 'bob', ref('server.doc'), { id: 'm2', label: 'open', into: 'bob.doc' }),
          deliver('m2'),
        ),
        step(
          's04',
          'Three copies. Right now they all agree.',
          same('server.doc.title', 'alice.doc.title', 'bob.doc.title'),
        ),
        step(
          's05',
          'Alice changes the title on her phone.',
          clearMarks(),
          set('alice.doc.title', 'Q3 plan v2'),
        ),
        step(
          's06',
          "At the same moment, Bob changes it too. He has not seen Alice's change.",
          set('bob.doc.title', 'Q3 roadmap'),
        ),
        step.long(
          's07',
          'Whoops — now we have a problem. Two copies disagree, and neither one is a mistake.',
          conflict('alice.doc.title', 'bob.doc.title'),
        ),
        step(
          's08',
          'Alice saves first. The server takes her title.',
          clearMarks(),
          send('alice', 'server', ref('alice.doc'), {
            id: 'm3',
            label: 'save',
            into: 'server.doc',
          }),
          deliver('m3'),
          expect('server.doc.title', 'Q3 plan v2'),
        ),
        step(
          's09',
          'Bob saves a moment later. The server takes his title.',
          send('bob', 'server', ref('bob.doc'), { id: 'm4', label: 'save', into: 'server.doc' }),
          deliver('m4'),
          expect('server.doc.title', 'Q3 roadmap'),
        ),
        step(
          's10',
          "On the server, Alice's change is gone. Nobody was told.",
          cross('alice.doc.title'),
          callout('server.doc.title', 'last write silently won', { tone: 'warn' }),
        ),
        step.long(
          's11',
          'More than one copy, two writes at the same time, and no rule for what should happen. That is the whole course in one picture.',
          clearMarks(),
          highlight(['alice.doc.title', 'bob.doc.title', 'server.doc.title'], { tone: 'warn' }),
        ),
      ],
    ),
    scene(
      'copies-everywhere',
      {
        layout: 'row',
        actors: [server('API', { icon: 'cloud', holds: { doc: doc() } })],
      },
      [
        step(
          's01',
          'You may think you have one copy. A normal web app has many.',
          highlight('server.doc'),
        ),
        step(
          's02',
          'A database replica holds one.',
          spawn(
            server('DB replica', {
              id: 'replica',
              icon: 'database',
              color: 'neutral',
              holds: { doc: doc() },
            }),
          ),
        ),
        step(
          's03',
          'A **cache** in front of the API holds one, so reads are fast.',
          spawn(service('cache', 'Cache', 'neutral', { holds: { doc: doc() } })),
        ),
        step(
          's04',
          'The browser tab holds one. The phone app holds one.',
          spawn(alice({ icon: 'laptop', subtitle: 'browser tab', holds: { doc: doc() } })),
          spawn(bob({ icon: 'phone', subtitle: 'phone app', holds: { doc: doc() } })),
        ),
        step(
          's05',
          'Five copies, and we only drew the obvious ones.',
          same(
            'server.doc.title',
            'replica.doc.title',
            'cache.doc.title',
            'alice.doc.title',
            'bob.doc.title',
          ),
        ),
        step(
          's06',
          'Any two of them can disagree: a cache goes stale, a replica lags, two people edit at once. The last scene can happen here too.',
          clearMarks(),
          set('alice.doc.title', 'Q3 plan v2'),
          set('bob.doc.title', 'Q3 roadmap'),
          conflict('alice.doc.title', 'bob.doc.title'),
        ),
        step.long(
          's07',
          'Every system with more than one copy needs an answer to this. Next: the classic answer, a lock.',
        ),
      ],
      { inContext: true },
    ),
  ],
})
