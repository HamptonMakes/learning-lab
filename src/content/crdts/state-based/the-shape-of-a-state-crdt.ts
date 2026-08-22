/**
 * II.1 — The shape of a state CRDT. A max register (one number, merge = max) makes the three
 * parts (state, update, merge) and the three laws (commutative, associative, idempotent) visible
 * with plain arithmetic; the in-context scene lets a bad network lose, delay and duplicate
 * messages and shows the laws absorbing all of it. Every number on the stage is computed by
 * src/crdt/max-register.ts. Storyboard: docs/curriculum/unit-1-2.md §II.1.
 */
import {
  topic,
  scene,
  step,
  alice,
  bob,
  carol,
  note,
  callout,
  check,
  compare,
  same,
  clearMarks,
  crdt,
  maxReg,
  seed,
  merge,
  drop,
  duplicate,
  expect,
} from '@/lesson/builders'

const RULE = 'merge(a, b) = max(a, b)'

export default topic({
  id: 'the-shape-of-a-state-crdt',
  title: 'The shape of a state CRDT',
  goal: 'Name the three parts of a state-based CRDT and the three laws its merge must obey, and say why a bad network cannot break them.',
  whenToUse: [
    'The network may lose, delay, reorder or duplicate messages and you want to stop caring.',
    'Copies can exchange their whole state cheaply (small data, or rare syncs).',
    'You want the simplest protocol there is: "send me what you have".',
  ],
  whenNotToUse: [
    'The state is large and changes often (The cost of state, then Unit III).',
    'You need the history of operations, not only the latest merged state.',
    'Two copies must agree right now, not eventually (a lock or a transaction).',
  ],
  realWorld:
    "A game's best score synced between a phone, a console and the cloud, with offline play.",
  scenes: [
    scene(
      'state-and-merge',
      { layout: 'pair', actors: [alice({ icon: 'phone' }), bob({ icon: 'laptop' })] },
      [
        step(
          's01',
          'Alice and Bob play the same game on two devices. Each device keeps a best score, and both start at 0.',
          crdt.init(['alice', 'bob'], 'best', 'max-register', { seed: [seed('set', 0)] }),
          expect('alice.best', 0),
          expect('bob.best', 0),
        ),
        step(
          's02',
          'A **state-based** CRDT has three parts: a **state**, local updates, and a **merge** rule. Here the state is one number and the rule is max.',
          note('rule', RULE),
        ),
        step(
          's03',
          'Alice plays and scores 3. Only her copy changes; nobody else knows yet.',
          maxReg('best').set('alice', 3),
          expect('alice.best', 3),
        ),
        step(
          's04',
          'Bob plays on the laptop and scores 5. Two copies, two different numbers.',
          maxReg('best').set('bob', 5),
          compare(['alice.best', 'bob.best'], { expect: 'less' }),
          expect('bob.best', 5),
        ),
        step(
          's05',
          'Alice sends her whole state to Bob. That is what state-based means: the message is the state itself.',
          clearMarks(),
          crdt.send('alice', 'bob', 'best', { id: 'm1' }),
        ),
        step(
          's06',
          'Bob merges: max(5, 3) = 5. His copy does not change.',
          merge('m1'), // the reducer adds the "no change" pill
          expect('bob.best', 5),
        ),
        step(
          's07',
          'Bob sends his state to Alice. She merges: max(3, 5) = 5.',
          crdt.send('bob', 'alice', 'best', { id: 'm2' }),
          merge('m2'),
          expect('alice.best', 5),
        ),
        step(
          's08',
          'Both copies say 5. No lock, no coordinator, no waiting.',
          same('alice.best', 'bob.best'),
        ),
        step.long(
          's09',
          'The trick is to design a state, often with a **sidecar** of timestamps or ids, so that a merge like this exists. This unit is a catalog of such states.',
        ),
      ],
    ),
    scene('three-laws', { layout: 'triangle', actors: [alice(), bob(), carol()] }, [
      step(
        's01',
        'Three copies: Alice 3, Bob 5, Carol 4. Three laws make the merge safe.',
        crdt.init(['alice', 'bob', 'carol'], 'best', 'max-register', { seed: [seed('set', 0)] }),
        maxReg('best').set('alice', 3),
        maxReg('best').set('bob', 5),
        maxReg('best').set('carol', 4),
        note('rule', RULE),
        expect('alice.best', 3),
        expect('bob.best', 5),
        expect('carol.best', 4),
      ),
      step(
        's02',
        'Law 1, **commutative**: merge(a, b) = merge(b, a). Alice and Bob send each other their states at the same time.',
        note('rule', '1 · commutative: merge(a, b) = merge(b, a)'),
        crdt.send('bob', 'alice', 'best', { id: 'm1' }),
        crdt.send('alice', 'bob', 'best', { id: 'm2' }),
      ),
      step('s03', "Alice merges Bob's 5: max(3, 5) = 5.", merge('m1'), expect('alice.best', 5)),
      step(
        's04',
        'Bob merges the 3 Alice sent: max(5, 3) = 5. Opposite order, same answer.',
        merge('m2'),
        expect('bob.best', 5),
        same('alice.best', 'bob.best'),
      ),
      step(
        's05',
        "Law 2, **associative**: merge(merge(a, b), c) = merge(a, merge(b, c)). Carol merges Alice's copy, which already holds Bob's 5.",
        clearMarks(),
        note('rule', '2 · associative: merge(merge(a, b), c) = merge(a, merge(b, c))'),
        crdt.send('alice', 'carol', 'best', { id: 'm3' }),
        merge('m3'),
        expect('carol.best', 5),
      ),
      step(
        's06',
        'max(max(3, 5), 4) = 5, and max(3, max(5, 4)) = 5 too. How you group the merges does not matter.',
        same('alice.best', 'bob.best', 'carol.best'),
      ),
      step(
        's07',
        'Law 3, **idempotent**: merge(a, a) = a. Bob sends his 5 to Carol, who already holds it: the merge changes nothing.',
        clearMarks(),
        note('rule', '3 · idempotent: merge(a, a) = a'),
        crdt.send('bob', 'carol', 'best', { id: 'm4' }),
        merge('m4'), // "no change" pill: the idempotent law, visibly
        expect('carol.best', 5),
      ),
      step(
        's08',
        'A duplicate message is harmless. That is why state-based CRDTs never need exactly-once delivery.',
        check('carol.best'),
      ),
      step.long(
        's09',
        'Three laws, one result: any copy can merge anything, in any order, any number of times.',
        note('rule', 'commutative · associative · idempotent'),
      ),
    ]),
    scene(
      'bad-network',
      { layout: 'triangle', actors: [alice(), bob(), carol()] },
      [
        step(
          's01',
          'Now a bad network: late, lost and duplicated messages. Same three copies, 3, 5 and 4; watch the three laws do the work.',
          crdt.init(['alice', 'bob', 'carol'], 'best', 'max-register', {
            seed: [seed('set', 0)],
          }),
          maxReg('best').set('alice', 3),
          maxReg('best').set('bob', 5),
          maxReg('best').set('carol', 4),
          note('rule', RULE),
          expect('alice.best', 3),
          expect('bob.best', 5),
          expect('carol.best', 4),
        ),
        step(
          's02',
          'Everyone sends to everyone: six messages in flight.',
          crdt.send('alice', ['bob', 'carol'], 'best', { id: 'a' }),
          crdt.send('bob', ['alice', 'carol'], 'best', { id: 'b' }),
          crdt.send('carol', ['alice', 'bob'], 'best', { id: 'c' }),
        ),
        step(
          's03',
          "Bob's message to Carol is lost on the way. The network also retries his message to Alice, so two copies of it are in flight.",
          drop('b@carol'),
          duplicate('b@alice', 'b2'),
        ),
        step(
          's04',
          "Alice merges Bob's 5: max(3, 5) = 5.",
          merge('b@alice'),
          expect('alice.best', 5),
        ),
        step(
          's05',
          'The retried copy lands. Same state a second time: no change.',
          merge('b2'),
          expect('alice.best', 5),
        ),
        step(
          's06',
          "Carol's 4 arrives at Alice and at Bob. Nothing beats 5: no change on either side.",
          merge('c@alice'),
          merge('c@bob'),
          same('alice.best', 'bob.best'),
        ),
        step(
          's07',
          "Alice's old 3 arrives last, at Bob and at Carol. Bob keeps 5; Carol keeps 4, since max(4, 3) = 4.",
          merge('a@bob'),
          merge('a@carol'),
          expect('bob.best', 5),
          expect('carol.best', 4),
        ),
        step(
          's08',
          'Whoops — Carol is behind: the lost message carried the 5. Alice and Bob agree, Carol does not.',
          callout('carol.best', 'never got the 5', { tone: 'danger' }),
          same('alice.best', 'bob.best'),
        ),
        step(
          's09',
          'The fix is free: any copy that has 5 can send it again, at any time. Alice does, and all three agree.',
          clearMarks(),
          crdt.send('alice', 'carol', 'best', { id: 'a2' }),
          merge('a2'),
          same('alice.best', 'bob.best', 'carol.best'),
          expect('carol.best', 5),
        ),
        step.long(
          's10',
          'Lost, late, duplicated: the laws absorbed all of it. Each copy only needs to hear the newest state eventually, by any route.',
        ),
      ],
      { inContext: true },
    ),
  ],
})
