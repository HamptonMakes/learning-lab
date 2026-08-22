/**
 * IV.6 — In context: a notes app that syncs. A note is a composed document (LWW title, MV-register
 * body, OR-Set tags) and every copy exposes its version vector (`expose: ['vc']`). The vector
 * decides whether a push is a fast-forward or a merge; the CRDT parts decide how each field merges;
 * siblings in the body are the one case the app must show to the user. Three scenes, each starting
 * from the last: `fast-forward`, `concurrent-different-fields`, `concurrent-same-field`. Every
 * vector, verdict and sibling is computed by src/crdt/doc.ts and the delivery layer.
 * Storyboard: docs/curriculum/unit-3-4.md §IV.6.
 */
import {
  topic,
  scene,
  step,
  alice,
  bob,
  server,
  note,
  highlight,
  callout,
  compare,
  conflict,
  check,
  same,
  clearMarks,
  offline,
  online,
  crdt,
  doc,
  S,
  expect,
} from '@/lesson/builders'

const RULE =
  'push: compare vectors · before → fast-forward · concurrent → merge part by part · result = join'

export default topic({
  id: 'in-context-notes-sync',
  title: 'In context: a notes app',
  goal: 'Walk a note through a sync and say, at each push, what the vector clock decided, what the CRDT merged, and what the app must show.',
  whenToUse: [
    'Personal data across devices: notes, todos, settings, bookmarks.',
    'Most syncs are fast-forwards and you want them to cost nothing.',
    'A conflict must be visible to the user, never silently resolved.',
  ],
  whenNotToUse: [
    'Shared long-form text with heavy simultaneous editing (use an RGA body, Unit III).',
    'Data with invariants such as money or seats; use a transaction.',
    'Thousands of devices per note; vectors grow per device.',
  ],
  realWorld:
    'Evernote "conflicting modification" notes and Dropbox "conflicted copy" files are siblings shown to the user; Apple Notes merges instead (Unit V, Real systems).',
  scenes: [
    scene(
      'fast-forward',
      {
        layout: 'hub',
        clock: { autoTick: true }, // the LWW title is wall-stamped; each write must advance its stamp
        actors: [server('Server'), alice({ icon: 'phone' }), bob({ icon: 'laptop' })],
      },
      [
        step(
          's01',
          'A note on phone, laptop and server: title, body, tags. Each copy carries a version vector: how many changes it holds from each device, {alice 2}.',
          crdt.doc(
            ['server', 'alice', 'bob'],
            'note',
            { title: S.lww(), body: S.mvr(), tags: S.orSet() },
            {
              expose: ['vc'],
              seed: [
                { by: 'alice', path: 'title', op: 'set', args: ['Groceries'] },
                { by: 'alice', path: 'body', op: 'set', args: ['Buy milk'] },
              ],
            },
          ),
          highlight(['server.note@vc', 'alice.note@vc', 'bob.note@vc']),
          expect('server.note.title', 'Groceries'),
          expect('server.note@vc', { alice: 2 }),
        ),
        step(
          's02',
          'The sync rule: compare vectors first; fast-forward when one is before the other, merge when they are concurrent.',
          note('rule', RULE),
        ),
        step(
          's03',
          'The phone edits the title. Its vector becomes {alice 3}.',
          doc('note').at('title').set('alice', 'Groceries (Sat)'),
          expect('alice.note.title', 'Groceries (Sat)'),
          expect('alice.note@vc', { alice: 3 }),
        ),
        step(
          's04',
          "Push to the server. Compare: the server's {alice 2} is before the phone's {alice 3}, so there is nothing to resolve.",
          compare(['server.note@vc', 'alice.note@vc'], { expect: 'before' }),
        ),
        step(
          's05',
          "Fast-forward: the server just takes the phone's copy, vector and all.",
          clearMarks(),
          crdt.merge('server', 'alice', 'note'),
          expect('server.note.title', 'Groceries (Sat)'),
          expect('server.note@vc', { alice: 3 }),
        ),
        step(
          's06',
          "The laptop pulls. Same story: its {alice 2} is before the server's {alice 3}.",
          compare(['bob.note@vc', 'server.note@vc'], { expect: 'before' }),
        ),
        step(
          's07',
          'Fast-forward again. No merge work, no banner; all three copies agree.',
          clearMarks(),
          crdt.merge('bob', 'server', 'note'),
          same('alice.note', 'bob.note', 'server.note'),
        ),
        step.long(
          's08',
          'Most syncs look like this. The vector clock says nothing to resolve, and the app skips the work.',
          callout('server', 'fast-forward = no conflict', { tone: 'info', sticky: true }),
        ),
      ],
    ),
    scene(
      'concurrent-different-fields',
      null,
      [
        step(
          's01',
          'The phone goes offline and edits the body. Its vector: {alice 4}.',
          note('rule', RULE),
          offline('alice'),
          doc('note').at('body').set('alice', 'Buy milk and eggs'),
          expect('alice.note.body', 'Buy milk and eggs'),
          expect('alice.note@vc', { alice: 4 }),
        ),
        step(
          's02',
          'The laptop adds the tag home and pushes. The server fast-forwards again: {alice 3, bob 1}.',
          doc('note').at('tags').add('bob', 'home'),
          crdt.merge('server', 'bob', 'note'),
          expect('server.note.tags', ['home']),
          expect('server.note@vc', { alice: 3, bob: 1 }),
        ),
        step(
          's03',
          'The phone comes back and pushes. Compare: {alice 3, bob 1} and {alice 4} are concurrent.',
          online('alice'),
          compare(['server.note@vc', 'alice.note@vc'], { expect: 'concurrent' }),
        ),
        step(
          's04',
          'Concurrent means merge, part by part: the body by its own rule, the tags by union. The vector becomes the join, {alice 4, bob 1}.',
          clearMarks(),
          crdt.merge('server', 'alice', 'note'),
          highlight(['server.note.body', 'server.note.tags']),
          expect('server.note.body', 'Buy milk and eggs'),
          expect('server.note.tags', ['home']),
          expect('server.note@vc', { alice: 4, bob: 1 }),
        ),
        step(
          's05',
          'Both devices pull. Everyone agrees, and nothing was lost: the two edits touched different fields.',
          crdt.merge('alice', 'server', 'note'),
          crdt.merge('bob', 'server', 'note'),
          same('alice.note', 'bob.note', 'server.note'),
        ),
        step.long(
          's06',
          'The app shows a small merged badge, nothing more. Concurrent is not the same as conflict.',
          callout('bob.note', 'merged · 2 devices', { tone: 'info', sticky: true }),
        ),
      ],
      { startFrom: 'fast-forward' },
    ),
    scene(
      'concurrent-same-field',
      null,
      [
        step(
          's01',
          'Both go offline and edit the body. The phone writes Buy oat milk; the laptop writes Buy milk, eggs, bread.',
          note('rule', RULE),
          offline('alice'),
          offline('bob'),
          doc('note').at('body').set('alice', 'Buy oat milk'),
          doc('note').at('body').set('bob', 'Buy milk, eggs, bread'),
          expect('alice.note@vc', { alice: 5, bob: 1 }),
          expect('bob.note@vc', { alice: 4, bob: 2 }),
        ),
        step(
          's02',
          'Both come back and push. The phone lands first; then the laptop: {alice 5, bob 1} and {alice 4, bob 2} are concurrent again.',
          online('alice'),
          online('bob'),
          crdt.merge('server', 'alice', 'note'),
          compare(['server.note@vc', 'bob.note@vc'], { expect: 'concurrent' }),
        ),
        step.long(
          's03',
          'Whoops — this time the same field. The body is an **MV register**, so the server keeps both texts as siblings instead of guessing.',
          clearMarks(),
          crdt.merge('server', 'bob', 'note'),
          conflict('server.note.body[s1]', 'server.note.body[s2]'),
          expect('server.note.body', ['Buy milk, eggs, bread', 'Buy oat milk']),
          expect('server.note@vc', { alice: 5, bob: 2 }),
        ),
        step(
          's04',
          'Title and tags merged on their own; only the body needs a human. The app shows both texts and lets the user pick.',
          callout('server.note.body', 'conflict: 2 versions', { tone: 'warn' }),
        ),
        step(
          's05',
          'Alice pulls, sees both, and writes the text she wants. Her write has seen both siblings, so it collapses them.',
          clearMarks(),
          crdt.merge('alice', 'server', 'note'),
          doc('note').at('body').set('alice', 'Buy oat milk and eggs'),
          expect('alice.note.body', 'Buy oat milk and eggs'),
          expect('alice.note@vc', { alice: 6, bob: 2 }),
        ),
        step(
          's06',
          'She pushes; the laptop pulls. One body again, on every copy, and nothing silently disappeared.',
          crdt.merge('server', 'alice', 'note'),
          crdt.merge('bob', 'server', 'note'),
          check('server.note.body'),
          same('alice.note', 'bob.note', 'server.note'),
        ),
        step.long(
          's07',
          'The vector clock finds it, the CRDT merges it, the app decides what the user sees. Three layers, three jobs.',
          callout('server', 'detect · merge · present', { tone: 'info', sticky: true }),
        ),
      ],
      { startFrom: 'concurrent-different-fields', inContext: true },
    ),
  ],
})
