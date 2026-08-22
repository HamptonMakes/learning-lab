/**
 * II.9 — OR-Set. Every add gets a unique tag; a remove drops only the tags it has seen; a
 * concurrent add always wins, with no clock. Scenes: `tags` (the spec's worked example,
 * docs/animation-dsl.md §15.2, reused verbatim from the fixture), `race` (the same add/remove race
 * as the LWW-Element-Set, decided by tags instead of timestamps), `group-cart` (in context: three
 * people, one offline, state parked at her door).
 */
import {
  topic,
  scene,
  step,
  alice,
  bob,
  carol,
  highlight,
  conflict,
  clearMarks,
  same,
  tomb,
  offline,
  online,
  crdt,
  orSet,
  merge,
  expect,
} from '@/lesson/builders'
import { orSetTagsTopic } from '@/lesson/fixtures/or-set-tags'

export default topic({
  id: 'or-set',
  title: 'OR-Set',
  goal: 'Pick an OR-Set when a re-add must win a race, and explain why a tag, not a clock, decides.',
  whenToUse: [
    'Sets with frequent add and remove where add-wins on a race is right: cart items, tags.',
    'You do not want to depend on timestamps.',
    'Re-adding must always work, even right after a concurrent remove.',
  ],
  whenNotToUse: [
    'Remove should beat a concurrent add (a remove-wins LWW-Element-Set, or a transaction).',
    'Metadata growth matters and you cannot compact: each add leaves a tag (Unit III.7).',
    'Elements are huge: the tags per element add up.',
  ],
  realWorld:
    'Riak sets; the set structures inside Automerge and Yjs maps; shared cart or playlist items.',
  scenes: [
    ...orSetTagsTopic.scenes,
    scene('race', { layout: 'pair', actors: [alice(), bob()] }, [
      step(
        's01',
        'Both carts hold eggs, added by Bob with the tag bob:1.',
        crdt.init(['alice', 'bob'], 'cart', 'or-set'),
        orSet('cart').add('bob', 'eggs'),
        crdt.sync('alice', 'bob', 'cart'),
        highlight('alice.cart[eggs]@tags'),
        expect('alice.cart[eggs]@tags', [{ tag: 'bob:1', alive: true }]),
      ),
      step(
        's02',
        'Bob removes eggs: he drops bob:1. At the same time Alice adds eggs again, with the new tag alice:1.',
        clearMarks(),
        orSet('cart').remove('bob', 'eggs'),
        orSet('cart').add('alice', 'eggs'),
        tomb('bob.cart[eggs]'),
        conflict('alice.cart[eggs]', 'bob.cart[eggs]'),
        expect('bob.cart', []),
        expect('alice.cart[eggs]@tags', [
          { tag: 'alice:1', alive: true },
          { tag: 'bob:1', alive: true },
        ]),
      ),
      step(
        's03',
        'With timestamps we would compare clocks and hope they agree. Here we compare tags: Bob dropped bob:1, and alice:1 is new to him.',
        clearMarks(),
        highlight('alice.cart[eggs]@tags'),
      ),
      step(
        's04',
        'Bob sends his whole state to Alice: the dead tag travels with it.',
        crdt.send('bob', 'alice', 'cart', { id: 'm1' }),
      ),
      step(
        's05',
        "Alice merges. Bob's remove killed bob:1 only; he never saw alice:1, so it survives and eggs stay in.",
        merge('m1'),
        highlight('alice.cart[eggs]@tags'),
        expect('alice.cart', ['eggs']),
        expect('alice.cart[eggs]@tags', [
          { tag: 'alice:1', alive: true },
          { tag: 'bob:1', alive: false },
        ]),
      ),
      step(
        's06',
        'Alice sends back and Bob merges. Both carts hold eggs with the one live tag alice:1: the same answer, every time.',
        crdt.send('alice', 'bob', 'cart', { id: 'm2' }),
        merge('m2'),
        same('alice.cart', 'bob.cart'),
        expect('bob.cart', ['eggs']),
        expect('bob.cart[eggs]@tags', [
          { tag: 'alice:1', alive: true },
          { tag: 'bob:1', alive: false },
        ]),
      ),
      step.long(
        's07',
        'An OR-Set is add-wins by construction, and it needs no clock. If remove must win a race, the OR-Set is the wrong tool.',
      ),
    ]),
    scene(
      'group-cart',
      {
        layout: 'triangle',
        actors: [alice({ icon: 'phone' }), bob({ icon: 'laptop' }), carol({ icon: 'phone' })],
      },
      [
        step(
          's01',
          'In context: a shared cart for three people. Alice adds bread (tag alice:1) and everyone syncs.',
          crdt.init(['alice', 'bob', 'carol'], 'cart', 'or-set'),
          orSet('cart').add('alice', 'bread'),
          crdt.sync('alice', 'bob', 'cart'),
          crdt.sync('alice', 'carol', 'cart'),
          expect('carol.cart[bread]@tags', [{ tag: 'alice:1', alive: true }]),
        ),
        step(
          's02',
          'Carol walks into the shop and loses signal. She buys the bread and removes it: she drops alice:1.',
          offline('carol'),
          orSet('cart').remove('carol', 'bread'),
          tomb('carol.cart[bread]'),
          expect('carol.cart', []),
        ),
        step(
          's03',
          'Bob, online, adds bread again for the party: tag bob:1. Alice syncs with Bob.',
          orSet('cart').add('bob', 'bread'),
          crdt.sync('alice', 'bob', 'cart'),
          highlight('alice.cart[bread]@tags'),
          expect('alice.cart[bread]@tags', [
            { tag: 'alice:1', alive: true },
            { tag: 'bob:1', alive: true },
          ]),
        ),
        step(
          's04',
          'Alice sends her state to Carol. Carol is offline, so the message waits at her door.',
          clearMarks(),
          crdt.send('alice', 'carol', 'cart', { id: 'm1' }),
        ),
        step(
          's05',
          'Carol comes back online and merges. Her remove of alice:1 holds; she never saw bob:1, so bread stays: one loaf, for the party.',
          online('carol'),
          merge('m1'),
          highlight('carol.cart[bread]@tags'),
          expect('carol.cart', ['bread']),
          expect('carol.cart[bread]@tags', [
            { tag: 'alice:1', alive: false },
            { tag: 'bob:1', alive: true },
          ]),
        ),
        step(
          's06',
          'Carol sends her state back to Alice, and Alice syncs with Bob. All three agree: bread, with the one live tag bob:1.',
          crdt.send('carol', 'alice', 'cart', { id: 'm2' }),
          merge('m2'),
          crdt.sync('alice', 'bob', 'cart'),
          same('alice.cart', 'bob.cart', 'carol.cart'),
          expect('bob.cart[bread]@tags', [
            { tag: 'alice:1', alive: false },
            { tag: 'bob:1', alive: true },
          ]),
        ),
        step.long(
          's07',
          'Tags make what you saw explicit, even offline. The cost is one small tag per add; that is the topic after next.',
        ),
      ],
      { inContext: true },
    ),
  ],
})
