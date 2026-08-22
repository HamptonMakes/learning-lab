/**
 * II.5 — PN-Counter. Two G-Counters side by side: likes go into P, unlikes into N, and a third
 * replica merges both tables (`likes-and-unlikes`); two shops sell the last item at the same time
 * and the counter goes below zero (`no-floor`); a cart line composes a name (LWW register) with a
 * quantity (PN-Counter) on a phone and a laptop (`cart-item`, in context). Every row and value is
 * computed by src/crdt/pn-counter.ts (the composed document by src/crdt/doc.ts). Storyboard:
 * docs/curriculum/unit-1-2.md §II.5.
 */
import {
  topic,
  scene,
  step,
  alice,
  bob,
  carol,
  service,
  device,
  note,
  highlight,
  callout,
  cross,
  conflict,
  same,
  clearMarks,
  tick,
  crdt,
  pncounter,
  doc,
  S,
  seed,
  merge,
  expect,
  broadcastState,
  allSame,
} from '@/lesson/builders'

const RULE = 'value = sum(P) − sum(N) · merge = max per row, in P and in N'

export default topic({
  id: 'pn-counter',
  title: 'PN-Counter',
  goal: 'Pick a PN-Counter for a count that goes up and down, and explain why it cannot hold a floor.',
  whenToUse: [
    'Counts that go up and down (likes and unlikes, cart quantities, unread badges).',
    'Many writers, each adjusting locally, often offline or far apart.',
    'A temporary stale value is fine.',
  ],
  whenNotToUse: [
    'The count must never cross a limit (stock below 0, seats oversold): no floor, no ceiling.',
    'You need to know who did what (Unit III keeps the operations).',
    'The writer set is unbounded: two tables grow one row per node, forever.',
  ],
  realWorld:
    'Like counts with unlike; a cart quantity edited from two devices; the counters in Redis Enterprise and Riak.',
  scenes: [
    scene('likes-and-unlikes', { layout: 'triangle', actors: [alice(), bob(), carol()] }, [
      step(
        's01',
        'A **PN-Counter** counts likes. It is two G-Counters side by side: P counts likes, N counts unlikes, one row per node in each.',
        crdt.init(['alice', 'bob', 'carol'], 'likes', 'pn-counter'),
        expect('alice.likes', 0),
      ),
      step(
        's02',
        'The value is the sum of P minus the sum of N. Merge is the same as before: max per row, in P and in N.',
        note('rule', RULE),
      ),
      step(
        's03',
        "Alice likes the post. Her row's P goes to 1, and her value is 1.",
        pncounter('likes').inc('alice'),
        expect('alice.likes[alice]@inc', 1),
        expect('alice.likes', 1),
      ),
      step(
        's04',
        'Bob likes it too, on his copy. His P goes to 1.',
        pncounter('likes').inc('bob'),
        expect('bob.likes[bob]@inc', 1),
        expect('bob.likes', 1),
      ),
      step(
        's05',
        'Alice changes her mind and unlikes. P does not go down; her N goes to 1, and her value is 1 − 1 = 0.',
        pncounter('likes').dec('alice'),
        highlight('alice.likes[alice]@dec', { tone: 'warn' }),
        expect('alice.likes[alice]@inc', 1),
        expect('alice.likes[alice]@dec', 1),
        expect('alice.likes', 0),
      ),
      step(
        's06',
        'Carol likes it as well. Three copies, three rows, and nobody has talked yet.',
        pncounter('likes').inc('carol'),
        expect('carol.likes', 1),
      ),
      step(
        's07',
        'Alice and Bob both send their tables to Carol.',
        crdt.send('alice', 'carol', 'likes', { id: 'm1' }),
        crdt.send('bob', 'carol', 'likes', { id: 'm2' }),
      ),
      step(
        's08',
        "Carol merges Alice's table: P 1 and N 1 land in Alice's row. Carol's value: 2 − 1 = 1.",
        merge('m1'),
        expect('carol.likes[alice]@inc', 1),
        expect('carol.likes[alice]@dec', 1),
        expect('carol.likes', 1),
      ),
      step(
        's09',
        "Then Bob's table: his row lands with P 1. Carol's value: 3 − 1 = 2.",
        merge('m2'),
        expect('carol.likes[bob]@inc', 1),
        expect('carol.likes', 2),
      ),
      step(
        's10',
        'Carol sends back to both. Every table agrees: 2 likes.',
        broadcastState('carol', ['alice', 'bob'], 'likes', 'm3'),
        allSame('likes', ['alice', 'bob', 'carol']),
        expect('alice.likes', 2),
        expect('bob.likes', 2),
      ),
      step.long(
        's11',
        'Why not subtract from P? A row could then go down, and max per row would lose the unlike; two grow-only tables keep the math safe.',
      ),
    ]),
    scene(
      'no-floor',
      { layout: 'pair', actors: [service('web', 'Web shop', 'a'), service('shop', 'Shop', 'b')] },
      [
        step(
          's01',
          'Can a counter stop at zero? Try it with stock: one item left, and both the web shop and the shop see 1.',
          crdt.init(['web', 'shop'], 'stock', 'pn-counter', { seed: [seed('inc', 1)] }),
          note('rule', RULE),
          expect('web.stock', 1),
          expect('shop.stock', 1),
        ),
        step(
          's02',
          'A customer buys it on the web. The web shop sees 1, says yes, and decrements to 0.',
          pncounter('stock').dec('web'),
          expect('web.stock', 0),
        ),
        step(
          's03',
          'At the same moment a customer buys it in the shop. The shop also sees 1, says yes, and goes to 0.',
          pncounter('stock').dec('shop'),
          conflict('web.stock', 'shop.stock'),
          expect('shop.stock', 0),
        ),
        step(
          's04',
          'Whoops — they sync, and the value is 1 − 2 = −1. Oversold.',
          crdt.sync('web', 'shop', 'stock'),
          cross('web.stock'),
          callout('shop.stock', 'oversold', { tone: 'danger' }),
          expect('web.stock', -1),
          expect('shop.stock', -1),
        ),
        step(
          's05',
          'The counter did exactly what it was told: two decrements from one. Refusing the second sale needs both copies to agree first, and a merge cannot do that.',
          clearMarks(),
          same('web.stock', 'shop.stock'),
        ),
        step.long(
          's06',
          'A counter cannot say no. If a floor or a ceiling matters, that decision needs a **transaction** or a lock, not a CRDT (topic I.4).',
        ),
      ],
    ),
    scene(
      'cart-item',
      {
        layout: 'pair',
        clock: { show: true },
        actors: [
          alice({ icon: 'phone' }),
          device('laptop', 'Laptop', { owner: 'alice', icon: 'laptop' }),
        ],
      },
      [
        step(
          's01',
          'A cart line has a name and a quantity, in one document: the name is an LWW register, the quantity a PN-Counter.',
          crdt.doc(
            ['alice', 'laptop'],
            'item',
            { name: S.lww(), qty: S.pn() },
            { seed: [seed.at('name', 'set', 'Oat milk'), seed.at('qty', 'inc', 1)] },
          ),
          expect('alice.item.name', 'Oat milk'),
          expect('alice.item.qty', 1),
        ),
        step(
          's02',
          'Time 1: on the phone, Alice adds two more. The quantity part takes inc 2; the name part is untouched.',
          tick(),
          doc('item').at('qty').inc('alice', 2),
          expect('alice.item.qty', 3),
          expect('alice.item.name', 'Oat milk'),
        ),
        step(
          's03',
          'Time 2: on the laptop, she removes one and fixes the name. Two parts change, each with its own sidecar.',
          tick(),
          doc('item').at('qty').dec('laptop', 1),
          doc('item').at('name').set('laptop', 'Oat milk 1L'),
          expect('laptop.item.qty', 0),
          expect('laptop.item.name', 'Oat milk 1L'),
          expect('laptop.item.name@ts', 2),
        ),
        step(
          's04',
          'They sync. Each part merges with its own rule: the name by timestamp, the quantity by max per row.',
          crdt.sync('alice', 'laptop', 'item'),
        ),
        step(
          's05',
          'Both show Oat milk 1L with quantity 2: 1 + 2 − 1. Neither device lost its change.',
          same('alice.item', 'laptop.item'),
          callout('alice.item.qty', '1 + 2 − 1 = 2', { tone: 'info' }),
          expect('alice.item.name', 'Oat milk 1L'),
          expect('alice.item.qty', 2),
          expect('laptop.item.qty', 2),
        ),
        step.long(
          's06',
          'Composing CRDTs is nesting them: each field brings its own merge rule. Topic II.10 builds a whole shopping list this way.',
        ),
      ],
      { inContext: true },
    ),
  ],
})
