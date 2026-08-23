/**
 * IV.4 — Detecting conflicts: siblings and the MV register. Dynamo style: every write carries the
 * version vector it was based on; a store that receives a concurrent version keeps both as
 * siblings (`s1`, `s2`, each with `@vc`) instead of guessing, and a later write that has seen both
 * collapses them. `siblings` is the atomic story on a cart; `the-item-that-came-back` is the
 * in-context twist: resolving by union brings a removed item back (the Dynamo paper's own
 * example), which is why the merge rule must come from a data type (OR-Set), not from the app.
 * Every version, verdict and collapse is computed by src/crdt/mv-register.ts.
 * Storyboard: docs/curriculum/unit-3-4.md §IV.4.
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
  bad,
  clearMarks,
  offline,
  online,
  crdt,
  mvReg,
  seed,
  expect,
} from '@/lesson/builders'

const RULE =
  'write: vc = join of what I hold, my entry + 1 · merge: keep every version nothing dominates'
const world = () => ({
  layout: 'hub' as const,
  actors: [server('Store'), alice({ icon: 'phone' }), bob({ icon: 'laptop' })],
})

export default topic({
  id: 'detecting-conflicts',
  title: 'Detecting conflicts',
  goal: 'Learn how a version vector turns a concurrent write into siblings, and who is responsible for resolving them.',
  whenToUse: [
    'The store must never silently drop a concurrent write (carts, inventory, medical records).',
    'The app, not the database, knows how to merge two versions (union, ask the user, a rule).',
    'Few writers per key, so version vectors stay small.',
    'You want "someone else changed this" surfaced to a human.',
  ],
  whenNotToUse: [
    'Nobody will ever resolve siblings; they pile up (Riak\'s "sibling explosion").',
    'A real CRDT already encodes the merge (counter, set, map); MV is only for opaque values.',
    'High write rate on one key from many clients.',
    'Your merge rule would be "union" and your data has removes (scene 2).',
  ],
  realWorld:
    'The Amazon Dynamo shopping cart (2007 paper); Riak siblings with allow_mult; Voldemort.',
  scenes: [
    scene('siblings', world(), [
      step(
        's01',
        'A shopping cart, Dynamo style. Store, phone and laptop hold it as an **MV register**: a value plus the version vector of the write that made it.',
        crdt.init(['server', 'alice', 'bob'], 'cart', 'mv-register', {
          seed: [seed.by('alice', 'set', 'milk')],
        }),
        highlight(['server.cart@vc', 'alice.cart@vc', 'bob.cart@vc']),
        expect('server.cart', 'milk'),
        expect('server.cart@vc', { alice: 1 }),
      ),
      step(
        's02',
        'Two rules: a write builds on everything it has seen; a merge keeps every version nothing else dominates.',
        note('rule', RULE),
      ),
      step(
        's03',
        'Alice adds eggs on the phone. Her write builds on {alice 1}, so the new version is {alice 2}.',
        mvReg('cart').set('alice', 'milk, eggs'),
        expect('alice.cart', 'milk, eggs'),
        expect('alice.cart@vc', { alice: 2 }),
      ),
      step(
        's04',
        'Bob is offline. He adds bread on the laptop, also building on {alice 1}: version {alice 1, bob 1}.',
        offline('bob'),
        mvReg('cart').set('bob', 'milk, bread'),
        expect('bob.cart', 'milk, bread'),
        expect('bob.cart@vc', { alice: 1, bob: 1 }),
      ),
      step(
        's05',
        'Alice pushes. The store compares its {alice 1} with her {alice 2}: before, because hers has seen everything the store has.',
        compare(['server.cart@vc', 'alice.cart@vc'], { expect: 'before' }),
      ),
      step(
        's06',
        'A fast-forward: the store just takes her version.',
        clearMarks(),
        crdt.merge('server', 'alice', 'cart'),
        expect('server.cart', 'milk, eggs'),
        expect('server.cart@vc', { alice: 2 }),
      ),
      step(
        's07',
        'Bob comes online and pushes {alice 1, bob 1}. Compared with {alice 2} it is concurrent: neither write saw the other.',
        online('bob'),
        compare(['server.cart@vc', 'bob.cart@vc'], { expect: 'concurrent' }),
      ),
      step.long(
        's08',
        'Whoops — a conflict. The store does not guess: it keeps both versions as **siblings**, each with its own vector.',
        clearMarks(),
        crdt.merge('server', 'bob', 'cart'),
        conflict('server.cart[s1]', 'server.cart[s2]'),
        expect('server.cart', ['milk, bread', 'milk, eggs']),
        expect('server.cart[s1]@vc', { alice: 1, bob: 1 }),
        expect('server.cart[s2]@vc', { alice: 2 }),
      ),
      step(
        's09',
        'Alice opens the cart and pulls. She gets both siblings, and now the app must resolve them.',
        clearMarks(),
        crdt.merge('alice', 'server', 'cart'),
        compare(['alice.cart[s1]@vc', 'alice.cart[s2]@vc'], { expect: 'concurrent' }),
      ),
      step(
        's10',
        'The app merges them with a union: milk, eggs, bread. Its write has seen both siblings, so its vector covers both: {alice 3, bob 1}.',
        clearMarks(),
        mvReg('cart').set('alice', 'milk, eggs, bread'),
        expect('alice.cart', 'milk, eggs, bread'),
        expect('alice.cart@vc', { alice: 3, bob: 1 }),
      ),
      step(
        's11',
        'Push. {alice 3, bob 1} is after both siblings, so the store collapses them into one value.',
        crdt.merge('server', 'alice', 'cart'),
        check('server.cart'),
        expect('server.cart', 'milk, eggs, bread'),
        expect('server.cart@vc', { alice: 3, bob: 1 }),
      ),
      step(
        's12',
        'Bob pulls: one cart, three items. Both devices and the store agree.',
        crdt.merge('bob', 'server', 'cart'),
        same('alice.cart', 'bob.cart', 'server.cart'),
      ),
      step.long(
        's13',
        'The vector clock found the conflict, and the app decided what to do about it. Two different jobs: detect, then resolve.',
        callout('server', 'detect (clock) ≠ resolve (app)', { tone: 'info', sticky: true }),
      ),
    ]),
    scene(
      'the-item-that-came-back',
      world(),
      [
        step(
          's01',
          'Same cart, a day later. Everyone holds milk, eggs with version {alice 2}, and the app still resolves siblings by union.',
          crdt.init(['server', 'alice', 'bob'], 'cart', 'mv-register', {
            seed: [seed.by('alice', 'set', 'milk'), seed.by('alice', 'set', 'milk, eggs')],
          }),
          note('rule', 'app rule for siblings: union of the items'),
          expect('server.cart', 'milk, eggs'),
          expect('server.cart@vc', { alice: 2 }),
        ),
        step(
          's02',
          'Alice removes eggs on the phone: milk, version {alice 3}.',
          mvReg('cart').set('alice', 'milk'),
          expect('alice.cart', 'milk'),
          expect('alice.cart@vc', { alice: 3 }),
        ),
        step(
          's03',
          'Bob, offline, adds bread on the laptop: milk, eggs, bread, version {alice 2, bob 1}.',
          offline('bob'),
          mvReg('cart').set('bob', 'milk, eggs, bread'),
          expect('bob.cart@vc', { alice: 2, bob: 1 }),
        ),
        step(
          's04',
          'Both push. {alice 3} and {alice 2, bob 1} are concurrent, so the store keeps two siblings again.',
          online('bob'),
          crdt.merge('server', 'alice', 'cart'),
          crdt.merge('server', 'bob', 'cart'),
          compare(['server.cart[s1]@vc', 'server.cart[s2]@vc'], { expect: 'concurrent' }),
          expect('server.cart', ['milk', 'milk, eggs, bread']),
        ),
        step(
          's05',
          'Alice pulls, and the app applies its rule: the union is milk, eggs, bread. Its vector covers both siblings: {alice 4, bob 1}.',
          clearMarks(),
          crdt.merge('alice', 'server', 'cart'),
          mvReg('cart').set('alice', 'milk, eggs, bread'),
          expect('alice.cart', 'milk, eggs, bread'),
          expect('alice.cart@vc', { alice: 4, bob: 1 }),
        ),
        step.long(
          's06',
          'Whoops — eggs is back. Alice had removed it, and a union cannot tell removed from never added.',
          bad('alice.cart', 'eggs came back'),
        ),
        step(
          's07',
          'The Dynamo paper describes this exact effect: deleted items can resurface. The fix is a data type that records removes, the **OR-Set**.',
          clearMarks(),
          callout('server', 'Dynamo paper, §4.4', { tone: 'warn' }),
        ),
        step.long(
          's08',
          'Vector clocks say there is a conflict. Only a data type with the right merge rule says how to resolve it.',
          callout('alice', 'clock: detect · CRDT: merge', { tone: 'info', sticky: true }),
        ),
      ],
      { inContext: true },
    ),
  ],
})
