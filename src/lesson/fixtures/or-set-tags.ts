/**
 * docs/animation-dsl.md §15.2 — OR-Set, `tags` (II.9: re-add after a concurrent remove), written
 * verbatim with the builders. Topic metadata is the minimum from docs/curriculum/unit-1-2.md II.9.
 */
import {
  topic,
  scene,
  step,
  alice,
  bob,
  note,
  highlight,
  clearMarks,
  same,
  tomb,
  crdt,
  orSet,
  expect,
} from '@/lesson/builders'

export const orSetTagsTopic = topic({
  id: 'or-set',
  title: 'OR-Set',
  goal: 'Pick an OR-Set when a re-add must win a race, and explain why a tag, not a clock, decides.',
  whenToUse: [
    'Sets with frequent add and remove where "add wins" on a race is right (cart items, tags, members).',
    'You do not want to depend on timestamps.',
    'Re-adding must always work.',
  ],
  whenNotToUse: [
    'Remove should beat a concurrent add (use a remove-wins LWW-Element-Set, or a transaction).',
    'Metadata growth is a concern and you cannot compact (each add leaves a tag; Unit III.7).',
    'Elements are huge (tags per element add up).',
  ],
  realWorld:
    'Riak sets; the set structures inside Automerge and Yjs maps; shared cart or playlist items.',
  scenes: [
    scene('tags', { layout: 'pair', actors: [alice(), bob()] }, [
      step(
        's01',
        'An **OR-Set** remembers, for each element, the tags of the adds that put it there.',
        crdt.init(['alice', 'bob'], 'cart', 'or-set'),
        note(
          'rule',
          'add → new tag · remove → drop the tags you have seen · in set = has a live tag',
        ),
      ),
      step(
        's02',
        'Alice adds milk. The add gets the tag alice:1.',
        orSet('cart').add('alice', 'milk'),
        highlight('alice.cart[milk]@tags'),
        expect('alice.cart[milk]@tags', [{ tag: 'alice:1', alive: true }]),
      ),
      step(
        's03',
        'They sync. Bob has milk with tag alice:1.',
        crdt.sync('alice', 'bob', 'cart'), // flow arrow between the two carts; "no change" pill on Alice's side
        same('alice.cart', 'bob.cart'),
      ),
      step(
        's04',
        'Bob removes milk. He has seen alice:1, so he drops alice:1, and milk has no live tag left.',
        clearMarks(),
        orSet('cart').remove('bob', 'milk'),
        tomb('bob.cart[milk]'),
        expect('bob.cart', []),
      ),
      step(
        's05',
        'At the same time, Alice adds milk again. New add, new tag: alice:2.',
        orSet('cart').add('alice', 'milk'),
        highlight('alice.cart[milk]@tags'),
        expect('alice.cart[milk]@tags', [
          { tag: 'alice:1', alive: true },
          { tag: 'alice:2', alive: true },
        ]),
      ),
      step(
        's06',
        "They sync. Bob's remove only covered alice:1, so alice:2 survives and milk is in.",
        clearMarks(),
        crdt.sync('alice', 'bob', 'cart'),
        same('alice.cart', 'bob.cart'),
        highlight('bob.cart[milk]@tags'),
        expect('bob.cart', ['milk']),
        expect('bob.cart[milk]@tags', [
          { tag: 'alice:1', alive: false },
          { tag: 'alice:2', alive: true },
        ]),
      ),
      step.long(
        's07',
        'This is observed remove: you can only remove what you observed. A concurrent add always wins, and no clock was needed.',
      ),
    ]),
  ],
})
