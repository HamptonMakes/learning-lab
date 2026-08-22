/**
 * I.5 — Meet CRDTs. The one topic in Unit I that drives real CRDTs (a preview): a G-Set of tags
 * merged by union in any order (`rule-up-front`, `any-order`), then the title race from topic
 * I.1 replayed with an LWW register and a relay (`title-again`, in context). Every merge result
 * on the stage is computed by src/crdt/. Storyboard: docs/curriculum/unit-1-2.md §I.5.
 */
import {
  topic,
  scene,
  step,
  alice,
  bob,
  carol,
  server,
  board,
  text,
  note,
  tick,
  highlight,
  callout,
  check,
  conflict,
  clearMarks,
  same,
  crdt,
  gset,
  lww,
  seed,
  merge,
  expect,
} from '@/lesson/builders'

const UNION_RULE = 'Rule: merge = union (keep every tag anyone added)'

export default topic({
  id: 'meet-crdts',
  title: 'Meet CRDTs',
  goal: 'Explain the CRDT idea in one breath: agree on the merge rule first, update every copy on its own, merge in any order, end up the same.',
  whenToUse: [
    'The data fits a merge rule everyone accepts (Unit II gives you a catalog).',
    'Writers may be offline or far apart.',
    'You would rather keep everyone working than make them wait.',
  ],
  whenNotToUse: [
    'A wrong value, even for a moment, is expensive (topic I.4).',
    'You need exactly one winner decided right now (a seat, a username).',
    'The merge rule would surprise users (two edits to one paragraph must not both survive).',
  ],
  realWorld:
    'Tags on a shared task: two people add tags while offline; later both see both tags (a G-Set, Unit II.6).',
  scenes: [
    scene('rule-up-front', { layout: 'triangle', actors: [alice(), bob(), carol()] }, [
      step(
        's01',
        'Three people, one set of tags. Before anyone types, we agree on one rule.',
        note('rule', UNION_RULE),
      ),
      step(
        's02',
        'Each person gets an empty copy. This is a real **G-Set**, a preview of Unit II.',
        crdt.init(['alice', 'bob', 'carol'], 'tags', 'g-set'),
      ),
      step(
        's03',
        'Alice adds "urgent", Bob adds "bug", Carol adds "ui". Nobody waits for anybody.',
        gset('tags').add('alice', 'urgent'),
        gset('tags').add('bob', 'bug'),
        gset('tags').add('carol', 'ui'),
      ),
      step(
        's04',
        'Three copies, three different states. In topic 1 this was the problem.',
        highlight(['alice.tags', 'bob.tags', 'carol.tags']),
      ),
      step(
        's05',
        'Alice sends her copy to Bob. Bob **merges** it with the rule: union.',
        crdt.send('alice', 'bob', 'tags', { id: 'm1' }),
        merge('m1'),
        expect('bob.tags', ['bug', 'urgent']),
      ),
      step(
        's06',
        'Carol sends hers to Bob. Union again.',
        crdt.send('carol', 'bob', 'tags', { id: 'm2' }),
        merge('m2'),
        expect('bob.tags', ['bug', 'ui', 'urgent']),
      ),
      step(
        's07',
        'Bob sends his copy to Alice and to Carol. Both merge.',
        crdt.send('bob', ['alice', 'carol'], 'tags', { id: 'm3' }),
        merge('m3@alice'),
        merge('m3@carol'),
      ),
      step(
        's08',
        'All three copies are the same. Nothing was lost, and nobody waited.',
        same('alice.tags', 'bob.tags', 'carol.tags'),
      ),
      step.long(
        's09',
        'This is a **CRDT** (Conflict-free Replicated Data Type): copies change on their own, merge in any order, and always end up equal. The rule is the whole trick.',
      ),
    ]),
    scene(
      'any-order',
      {
        layout: 'triangle',
        actors: [alice(), bob(), carol()],
        boards: [board('rule', text(UNION_RULE))],
      },
      [
        step(
          's01',
          'Same three tags, fresh copies. This time the messages arrive in a different order.',
          crdt.init(['alice', 'bob', 'carol'], 'tags', 'g-set'),
          gset('tags').add('alice', 'urgent'),
          gset('tags').add('bob', 'bug'),
          gset('tags').add('carol', 'ui'),
        ),
        step(
          's02',
          'Everyone sends to everyone. Six messages are in flight.',
          crdt.send('alice', ['bob', 'carol'], 'tags', { id: 'ma' }),
          crdt.send('bob', ['alice', 'carol'], 'tags', { id: 'mb' }),
          crdt.send('carol', ['alice', 'bob'], 'tags', { id: 'mc' }),
        ),
        step(
          's03',
          "Alice gets Carol's copy first, then Bob's.",
          merge('mc@alice'),
          merge('mb@alice'),
          expect('alice.tags', ['bug', 'ui', 'urgent']),
        ),
        step(
          's04',
          "Bob gets Alice's first, then Carol's.",
          merge('ma@bob'),
          merge('mc@bob'),
          expect('bob.tags', ['bug', 'ui', 'urgent']),
        ),
        step(
          's05',
          "Carol's copy of Bob's message is slow. For now she only has Alice's.",
          merge('ma@carol'),
          callout('carol', 'one message still in flight', { tone: 'info' }),
          expect('carol.tags', ['ui', 'urgent']),
        ),
        step(
          's06',
          'Alice and Bob already agree, even though they merged in different orders.',
          same('alice.tags', 'bob.tags'),
        ),
        step(
          's07',
          "Bob's message finally lands. Now all three agree: this is **eventual consistency**.",
          clearMarks(),
          merge('mb@carol'),
          same('alice.tags', 'bob.tags', 'carol.tags'),
        ),
        step.long(
          's08',
          'Eventual means: once every message has arrived. Not always right now, but always the same in the end.',
        ),
      ],
    ),
    scene(
      'title-again',
      {
        layout: 'hub',
        clock: { show: true },
        actors: [server('Relay'), alice({ icon: 'phone' }), bob({ icon: 'laptop' })],
      },
      [
        step(
          's01',
          'Back to the title from topic 1. This time we pick a rule first: the newest write wins (a preview of Unit II).',
          note('rule', 'Rule: newest timestamp wins'),
          crdt.init(['server', 'alice', 'bob'], 'title', 'lww-register', {
            seed: [seed('set', 'Q3 plan')],
          }),
        ),
        step(
          's02',
          'Alice edits at t=1. Her copy remembers the value and the time.',
          tick(),
          lww('title').set('alice', 'Q3 plan v2'),
          expect('alice.title@ts', 1),
        ),
        step(
          's03',
          "Bob edits at t=2. He has not seen Alice's edit.",
          tick(),
          lww('title').set('bob', 'Q3 roadmap'),
          expect('bob.title@ts', 2),
          conflict('alice.title', 'bob.title'),
        ),
        step(
          's04',
          'Both save. The relay merges each one with the rule, and the order does not matter.',
          clearMarks(),
          crdt.send('bob', 'server', 'title', { id: 'm1' }),
          merge('m1'),
          crdt.send('alice', 'server', 'title', { id: 'm2' }),
          merge('m2'),
          expect('server.title', 'Q3 roadmap'),
        ),
        step(
          's05',
          "Alice's save arrived last, but Bob's has the newer time, t=2. The relay keeps Bob's.",
          highlight('server.title@ts'),
          check('server.title'),
          expect('server.title@ts', 2),
        ),
        step(
          's06',
          'The relay sends the result back. Every copy agrees, and everyone can see why.',
          crdt.send('server', ['alice', 'bob'], 'title', { id: 'm3' }),
          merge('m3@alice'),
          merge('m3@bob'),
          same('server.title', 'alice.title', 'bob.title'),
        ),
        step.long(
          's07',
          "Alice's edit still lost, but it lost by a rule everyone knows, not by luck. Unit II shows rules that lose less.",
        ),
      ],
      { inContext: true },
    ),
  ],
})
