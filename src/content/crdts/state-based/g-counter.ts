/**
 * II.4 — G-Counter. One row per node, merge = max per row, value = sum (`count-separately`); a
 * retried message shows why a table beats one number: max per row cannot double count
 * (`why-a-table`); a blog post composes a title (LWW register) with a view counter replicated
 * across two edge regions (`post-page`, in context). Every row and total is computed by
 * src/crdt/g-counter.ts (the composed document by src/crdt/doc.ts). Storyboard:
 * docs/curriculum/unit-1-2.md §II.4.
 */
import {
  topic,
  scene,
  step,
  alice,
  bob,
  carol,
  service,
  note,
  highlight,
  callout,
  check,
  compare,
  tick,
  crdt,
  gcounter,
  doc,
  S,
  seed,
  merge,
  duplicate,
  expect,
  broadcastState,
  allSame,
} from '@/lesson/builders'

const RULE = 'merge: per node, keep the max · value = sum of rows'

export default topic({
  id: 'g-counter',
  title: 'G-Counter',
  goal: 'Pick a G-Counter for a count that only goes up, and explain why max per node can never lose or double count an increment.',
  whenToUse: [
    'Counts that only go up (views, downloads, times opened).',
    'Many writers, each incrementing locally, often offline or far apart.',
    'A slightly stale total is fine.',
  ],
  whenNotToUse: [
    'The count must go down (II.5 PN-Counter).',
    'You need an exact, instantly consistent number (a transaction).',
    'The set of writers is huge and unbounded: the table grows one row per node, forever.',
  ],
  realWorld:
    'Page-view counters merged across edge servers; the counters in Riak and Redis Enterprise (simplified).',
  scenes: [
    scene('count-separately', { layout: 'triangle', actors: [alice(), bob(), carol()] }, [
      step(
        's01',
        'A **G-Counter** counts page views. It is a small table: one row per **node**, and the total is the sum of the rows.',
        crdt.init(['alice', 'bob', 'carol'], 'views', 'g-counter'),
        expect('alice.views', 0),
      ),
      step(
        's02',
        'Each node only ever writes its own row, and a row appears when a node first counts. The rule: merge = max, row by row.',
        note('rule', RULE),
      ),
      step(
        's03',
        'Alice counts two views. Only her row moves: alice 2, total 2.',
        gcounter('views').inc('alice', 2),
        expect('alice.views[alice]@inc', 2),
        expect('alice.views', 2),
      ),
      step(
        's04',
        'Bob counts one view on his copy.',
        gcounter('views').inc('bob'),
        expect('bob.views', 1),
      ),
      step(
        's05',
        'Alice sends her table to Bob.',
        crdt.send('alice', 'bob', 'views', { id: 'm1' }),
      ),
      step(
        's06',
        'Bob merges row by row: alice = max(0, 2) = 2, bob = max(1, 0) = 1. His total is now 3.',
        merge('m1'),
        highlight(['bob.views[alice]', 'bob.views[bob]']),
        expect('bob.views[alice]@inc', 2),
        expect('bob.views[bob]@inc', 1),
        expect('bob.views', 3),
      ),
      step(
        's07',
        'Alice still shows 2; she has not heard from Bob yet.',
        compare(['alice.views', 'bob.views'], { expect: 'less' }),
      ),
      step(
        's08',
        'Carol counts one view.',
        gcounter('views').inc('carol'),
        expect('carol.views', 1),
      ),
      step(
        's09',
        'Bob sends his table to Carol. She merges: 2 + 1 + 1 = 4.',
        crdt.send('bob', 'carol', 'views', { id: 'm2' }),
        merge('m2'),
        expect('carol.views', 4),
      ),
      step(
        's10',
        'Carol sends to both. Everyone merges, and all three tables agree on 4.',
        broadcastState('carol', ['alice', 'bob'], 'views', 'm3'),
        allSame('views', ['alice', 'bob', 'carol']),
        expect('alice.views', 4),
        expect('bob.views', 4),
      ),
      step.long(
        's11',
        "Max per row is safe because a node's own row only ever goes up. That is why the G stands for grow-only.",
      ),
    ]),
    scene('why-a-table', { layout: 'pair', actors: [alice(), bob()] }, [
      step(
        's01',
        'Why a table and not one number? Watch a retry: Alice has counted 2 views, Bob 1.',
        crdt.init(['alice', 'bob'], 'views', 'g-counter'),
        gcounter('views').inc('alice', 2),
        gcounter('views').inc('bob'),
        note('rule', RULE),
        expect('alice.views', 2),
        expect('bob.views', 1),
      ),
      step(
        's02',
        'Alice sends her table. The network retries, so two copies are in flight.',
        crdt.send('alice', 'bob', 'views', { id: 'm1' }),
        duplicate('m1', 'm1-retry'),
      ),
      step(
        's03',
        'Bob merges the first copy: alice 2, bob 1, total 3.',
        merge('m1'),
        expect('bob.views', 3),
      ),
      step(
        's04',
        'Bob merges the second copy: max per row, alice stays 2. No change, no double count.',
        merge('m1-retry'),
        check('bob.views'),
        expect('bob.views', 3),
      ),
      step(
        's05',
        'Had Bob added the numbers instead, he would show 5: the same two views counted twice.',
        callout('bob.views', 'sum would say 5', { tone: 'danger' }),
      ),
      step(
        's06',
        'And max of one number? Bob would take max(1, 2) = 2 and lose his own view, while the table keeps both.',
        callout('bob.views', 'max would say 2', { tone: 'danger' }),
      ),
      step.long(
        's07',
        'Sum is not idempotent, and max of one number loses data. Max per row, then sum, gives you both: safe and complete.',
        note('rule', 'one number: sum double counts, max loses · table: max per row, then sum'),
      ),
    ]),
    scene(
      'post-page',
      {
        layout: 'triangle',
        clock: { show: true },
        actors: [
          alice({ icon: 'laptop' }),
          service('edge-us', 'US edge', 'b'),
          service('edge-eu', 'EU edge', 'c'),
        ],
      },
      [
        step(
          's01',
          'A blog post as one document: a title (LWW register) and a view counter (G-Counter). Two parts, two merge rules.',
          crdt.doc(
            ['alice', 'edge-us', 'edge-eu'],
            'post',
            { title: S.lww(), views: S.g() },
            { seed: [seed.at('title', 'set', 'Hello world')] },
          ),
          expect('alice.post.title', 'Hello world'),
          expect('alice.post.views', 0),
        ),
        step(
          's02',
          'Readers hit the US edge 3 times and the EU edge 2 times. Each edge counts locally, with no cross-region call.',
          doc('post').at('views').inc('edge-us', 3),
          doc('post').at('views').inc('edge-eu', 2),
          expect('edge-us.post.views', 3),
          expect('edge-eu.post.views', 2),
        ),
        step(
          's03',
          'Time 1: Alice renames the post on her laptop. Only the title part changes, stamped t=1, alice.',
          tick(),
          doc('post').at('title').set('alice', 'Hello, world!'),
          expect('alice.post.title', 'Hello, world!'),
          expect('alice.post.title@ts', 1),
          expect('alice.post.title@node', 'alice'),
        ),
        step(
          's04',
          'The edges gossip: US and EU sync. Rows merge by max, and both totals read 5.',
          crdt.sync('edge-us', 'edge-eu', 'post'),
          expect('edge-us.post.views', 5),
          expect('edge-eu.post.views', 5),
        ),
        step(
          's05',
          'A retry sends the same US state to EU again. Max per row: nothing changes, and nothing is counted twice.',
          crdt.send('edge-us', 'edge-eu', 'post', { id: 'm1' }),
          merge('m1'), // "no change" pill on the EU edge
          expect('edge-eu.post.views', 5),
        ),
        step(
          's06',
          'Alice syncs with the US edge. The title merges by timestamp, the views by max per row: each part keeps its own rule.',
          crdt.sync('alice', 'edge-us', 'post'),
          expect('alice.post.views', 5),
          expect('edge-us.post.title', 'Hello, world!'),
        ),
        step(
          's07',
          'One more round, EU with US, and every copy shows the new title and 5 views.',
          crdt.sync('edge-eu', 'edge-us', 'post'),
          allSame('post', ['alice', 'edge-us', 'edge-eu']),
          expect('edge-eu.post.title', 'Hello, world!'),
        ),
        step.long(
          's08',
          'Fast local counts, one eventual total, and the title rides along under its own rule. This is how counters survive multi-region.',
        ),
      ],
      { inContext: true },
    ),
  ],
})
