/**
 * I.6 — CRDTs in real products. A gallery of five kinds of product that share one shape (many
 * copies, one merge rule, nobody waits for a lock), then a notes app with a relay that only forwards
 * (`notes-sync`, in context). The notes scene uses plain values and per-field messages; the
 * narration says "(simplified)". Storyboard: docs/curriculum/unit-1-2.md §I.6.
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
  offline,
  online,
  note,
  highlight,
  same,
  expect,
} from '@/lesson/builders'

const noteDoc = () => rec({ title: 'Trip', body: 'pack socks' })

export default topic({
  id: 'where-they-are-used',
  title: 'CRDTs in real products',
  goal: 'Learn what shape every CRDT product shares (many copies, one merge rule, nobody waits for a lock) and which products use it.',
  rules: [
    'Many copies: every device and every region holds its own.',
    'One merge rule, agreed up front, that every copy applies the same way.',
    'Nobody waits for a lock. Offline edits merge when the connection is back.',
    'Docs, design tools, notes apps, multi-region databases and counters all share this shape.',
  ],
  whenToUse: [
    'Collaborative documents and whiteboards: many cursors, no lock.',
    'Apps that must work offline: notes, to-dos, field work.',
    'Multi-region databases and caches where every region writes locally.',
    'Presence, counters, and settings that sync between devices.',
  ],
  whenNotToUse: [
    'Money movement, inventory with hard limits, unique names.',
    'Anything where users expect "the server said no" right away.',
    'Data whose merge rule would surprise the people using it.',
  ],
  realWorld:
    'Figma (multiplayer design, CRDT-inspired), Apple Notes and Automerge/Yjs-based apps (offline editing), Riak and Redis Enterprise (multi-region data). Names are examples; details simplified.',
  scenes: [
    scene('gallery', { layout: 'grid', actors: [] }, [
      step(
        's01',
        'CRDTs are best known from collaborative editors. Many people type, nobody locks.',
        spawn(service('docs', 'Docs editor', 'a', { subtitle: 'shares: text' })),
      ),
      step(
        's02',
        'Design tools: every shape on the canvas is shared data. Two people move shapes at once.',
        spawn(service('design', 'Design tool', 'b', { subtitle: 'shares: shapes' })),
      ),
      step(
        's03',
        'Notes apps: you edit on the plane, your laptop edits at home, and both edits survive.',
        spawn(service('notes', 'Notes app', 'c', { icon: 'phone', subtitle: 'shares: notes' })),
      ),
      step(
        's04',
        'Databases: several regions accept writes and merge later.',
        spawn(
          service('db', 'Regional DB', 'server', { icon: 'database', subtitle: 'shares: rows' }),
        ),
      ),
      step(
        's05',
        'Counters and presence: likes, views, who is online.',
        spawn(service('counts', 'Counters', 'neutral', { subtitle: 'shares: numbers' })),
      ),
      step.long(
        's06',
        'Different products, one shape: many copies, one merge rule, and nobody waits for a lock.',
        note('shape', 'Many copies · one merge rule · no waiting for a lock'),
      ),
      step('s07', 'Next unit: the rules, one data type at a time.'),
    ]),
    scene(
      'notes-sync',
      {
        layout: 'hub',
        actors: [
          server('Relay', { holds: { note: noteDoc() } }),
          alice({ icon: 'phone', holds: { note: noteDoc() } }),
          bob({ icon: 'laptop', holds: { note: noteDoc() } }),
        ],
      },
      [
        step(
          's01',
          'A notes app with a relay that only forwards and holds no lock. Each field merges on its own: newest write wins (simplified).',
          highlight('server.note'),
        ),
        step(
          's02',
          "Alice's phone goes offline. She keeps editing the body.",
          offline('alice'),
          set('alice.note.body', 'pack socks, charger'),
        ),
        step(
          's03',
          'Bob renames the note from his laptop.',
          set('bob.note.title', 'Trip to Lisbon'),
        ),
        step(
          's04',
          "Bob's new title reaches the relay. The relay keeps it.",
          send('bob', 'server', ref('bob.note.title'), {
            id: 'm1',
            label: 'title',
            into: 'server.note.title',
          }),
          deliver('m1'),
          expect('server.note.title', 'Trip to Lisbon'),
        ),
        step(
          's05',
          "Alice is back online. She sends her new body to the relay, and the relay sends her Bob's new title.",
          online('alice'),
          send('alice', 'server', ref('alice.note.body'), {
            id: 'm2',
            label: 'body',
            into: 'server.note.body',
          }),
          deliver('m2'),
          send('server', 'alice', ref('server.note.title'), {
            id: 'm3',
            label: 'title',
            into: 'alice.note.title',
          }),
          deliver('m3'),
          expect('alice.note.title', 'Trip to Lisbon'),
          expect('server.note.body', 'pack socks, charger'),
        ),
        step(
          's06',
          'The relay forwards the new body to Bob. All three copies agree: new title, new body.',
          send('server', 'bob', ref('server.note.body'), {
            id: 'm4',
            label: 'body',
            into: 'bob.note.body',
          }),
          deliver('m4'),
          same('alice.note', 'bob.note', 'server.note'),
        ),
        step.long(
          's07',
          'No lock, no waiting, no lost edit. That is the goal; Unit II shows how each piece works.',
        ),
      ],
      { inContext: true },
    ),
  ],
})
