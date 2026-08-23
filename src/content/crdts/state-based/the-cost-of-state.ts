/**
 * II.11 — The cost of state. Full-state sync ships the whole state on every round; deltas ship a
 * small state the same merge() accepts; and the sidecar grows on the inside. Scenes: `full-state`
 * (the whole list for one new word, twice), `delta` (only the change, incl. a remove that carries
 * one dead tag), `sidecar-grows` (one item, three tags).
 *
 * The byte counts in the narration are the `size` the reducer computes for each `crdt.send`
 * token (UTF-8 length of the canonical JSON of the carried state, DSL §5.1). They are read from
 * the real frames, not invented; if the serialization changes, re-read them from the timeline.
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
  clearMarks,
  same,
  tomb,
  crdt,
  orSet,
  seed,
  merge,
  expect,
} from '@/lesson/builders'

const PANTRY = ['apples', 'bread', 'butter', 'cheese', 'flour', 'rice', 'salt']

export default topic({
  id: 'the-cost-of-state',
  title: 'The cost of state',
  goal: 'Learn what state-based sync costs on the wire and in memory, and when deltas are worth it.',
  whenToUse: [
    'The state is small: a status, a counter, a short set.',
    'Syncs are rare: on reconnect, every few seconds, not per keystroke.',
    'Simplicity matters more than bandwidth.',
  ],
  whenNotToUse: [
    'The state is large and edits are small and frequent (a document, a long list).',
    'Many peers sync often: the cost is state size × peers × rounds.',
    'Sidecar (tags, tombstones, per-node rows) keeps growing and you cannot compact it.',
  ],
  realWorld:
    'Riak full-state replication vs delta-state CRDTs; the Automerge sync protocol sends only what the other side lacks.',
  scenes: [
    scene(
      'full-state',
      { layout: 'pair', actors: [alice({ icon: 'phone' }), bob({ icon: 'laptop' })] },
      [
        step(
          's01',
          'A shared list with seven items, already in sync on both sides.',
          crdt.init(['alice', 'bob'], 'list', 'or-set', {
            seed: PANTRY.map((item) => seed('add', item)),
          }),
          expect('alice.list', PANTRY),
          expect('bob.list', PANTRY),
        ),
        step(
          's02',
          'Alice adds one item: tea. One small change, one new tag.',
          orSet('list').add('alice', 'tea'),
          highlight('alice.list[tea]@tags'),
          expect('alice.list[tea]@tags', [{ tag: 'alice:1', alive: true }]),
        ),
        step(
          's03',
          'To sync, she sends her whole state: every item and every tag, for one new word. The token shows its size: 388 B.',
          crdt.send('alice', 'bob', 'list', { id: 'm1', mode: 'full' }),
          callout('alice', 'whole state, every time', { tone: 'warn' }),
        ),
        step(
          's04',
          'Bob merges. Seven of the eight items were already there; the whole state travelled for one.',
          clearMarks(),
          merge('m1'),
          same('alice.list', 'bob.list'),
          expect('bob.list', [...PANTRY, 'tea'].sort()),
        ),
        step(
          's05',
          'Bob removes salt and adds jam, then sends his whole state back: 441 B. The state grew, so the token grew.',
          clearMarks(),
          orSet('list').remove('bob', 'salt'),
          orSet('list').add('bob', 'jam'),
          crdt.send('bob', 'alice', 'list', { id: 'm2', mode: 'full' }),
          tomb('bob.list[salt]'),
        ),
        step(
          's06',
          'Alice merges. Every round costs the whole state, and the state only grows.',
          clearMarks(),
          merge('m2'),
          same('alice.list', 'bob.list'),
          note('cost', 'wire cost ≈ state size × peers × rounds'),
          expect('alice.list', [
            'apples',
            'bread',
            'butter',
            'cheese',
            'flour',
            'jam',
            'rice',
            'tea',
          ]),
        ),
        step.long(
          's07',
          'With a big document and many peers this adds up fast: size × peers × rounds. Deltas are the first fix.',
        ),
      ],
    ),
    scene(
      'delta',
      null,
      [
        step(
          's01',
          'Same list. Alice adds eggs: one more change.',
          orSet('list').add('alice', 'eggs'),
          highlight('alice.list[eggs]@tags'),
          expect('alice.list[eggs]@tags', [{ tag: 'alice:2', alive: true }]),
        ),
        step(
          's02',
          'This time she sends a **delta**: a small state that holds only eggs and its tag (simplified). The token reads 73 B; the last full state was 441 B.',
          crdt.send('alice', 'bob', 'list', { id: 'm3', mode: 'delta' }),
          callout('alice', 'only what changed', { tone: 'ok' }),
        ),
        step(
          's03',
          'Bob merges the delta with the same merge() as before. A delta is itself a small state, so the three laws still hold.',
          clearMarks(),
          merge('m3'),
          same('alice.list', 'bob.list'),
          expect('bob.list[eggs]@tags', [{ tag: 'alice:2', alive: true }]),
        ),
        step(
          's04',
          'Bob removes tea and sends a delta back: 44 B (simplified). It carries only the dead tag, alice:1.',
          clearMarks(),
          orSet('list').remove('bob', 'tea'),
          tomb('bob.list[tea]'),
          crdt.send('bob', 'alice', 'list', { id: 'm4', mode: 'delta' }),
          expect('bob.list[tea]@tags', [{ tag: 'alice:1', alive: false }]),
        ),
        step(
          's05',
          'Alice merges. Tea is gone: the union of tombstones killed alice:1, and the rest of her state stayed as it was.',
          clearMarks(),
          merge('m4'),
          tomb('alice.list[tea]'),
          same('alice.list', 'bob.list'),
          expect('alice.list[tea]@tags', [{ tag: 'alice:1', alive: false }]),
        ),
        step(
          's06',
          'The catch: the sender must know what the other side has not seen yet. Lose track, and you fall back to the full state.',
          clearMarks(),
          callout('alice', 'needs: what has Bob seen?', { tone: 'info' }),
        ),
        step.long(
          's07',
          'Deltas keep the three laws, so the same merge() works. Operations (Unit III) are the other answer: send what you did.',
        ),
      ],
      { startFrom: 'full-state' },
    ),
    scene('sidecar-grows', { layout: 'pair', actors: [alice(), bob()] }, [
      step(
        's01',
        'State also grows on the inside. Watch one item through a busy day.',
        crdt.init(['alice', 'bob'], 'cart', 'or-set'),
        orSet('cart').add('alice', 'milk'),
        crdt.sync('alice', 'bob', 'cart'),
        highlight('alice.cart[milk]@tags'),
        expect('alice.cart[milk]@tags', [{ tag: 'alice:1', alive: true }]),
      ),
      step(
        's02',
        'Bob removes milk, Alice adds it back, they sync. Each add is a new tag, and each removed tag stays as a tombstone.',
        orSet('cart').remove('bob', 'milk'),
        orSet('cart').add('alice', 'milk'),
        crdt.sync('alice', 'bob', 'cart'),
        highlight('alice.cart[milk]@tags'),
        expect('alice.cart[milk]@tags', [
          { tag: 'alice:1', alive: false },
          { tag: 'alice:2', alive: true },
        ]),
      ),
      step(
        's03',
        'Again: remove, add, sync. One milk in the cart, three tags in the sidecar, two of them dead.',
        orSet('cart').remove('bob', 'milk'),
        orSet('cart').add('alice', 'milk'),
        crdt.sync('alice', 'bob', 'cart'),
        highlight('alice.cart[milk]@tags'),
        same('alice.cart', 'bob.cart'),
        expect('alice.cart', ['milk']),
        expect('alice.cart[milk]@tags', [
          { tag: 'alice:1', alive: false },
          { tag: 'alice:2', alive: false },
          { tag: 'alice:3', alive: true },
        ]),
      ),
      step(
        's04',
        'The sidecar never shrinks by itself: a 2P-Set keeps every tombstone, an OR-Set keeps every tag it has seen.',
        callout('alice.cart', '1 item · 3 tags', { tone: 'warn' }),
      ),
      step(
        's05',
        'Real systems compact: they drop sidecar that everyone has seen. Knowing what everyone has seen is Unit IV.',
        clearMarks(),
        callout('bob.cart', 'compact = drop what all have seen', { tone: 'info' }),
      ),
      step.long(
        's06',
        'State-based sync is simple, and fine for small state. For big documents with small edits, use deltas or operations.',
      ),
    ]),
  ],
})
