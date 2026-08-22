/**
 * II.2 — LWW Register. The first scene is the spec's worked example (docs/animation-dsl.md §15.1),
 * reused from the fixture so the spec, the tests and the lesson stay one text; `tie-break` continues
 * from its end (same t=3 on both sides, the node id decides) and `status-sync` puts the register
 * in context: one person, two devices, a relay, and an old write that arrives late. Every stamp
 * and winner is computed by src/crdt/lww-register.ts. Storyboard: docs/curriculum/unit-1-2.md §II.2.
 */
import {
  topic,
  scene,
  step,
  alice,
  server,
  device,
  note,
  highlight,
  callout,
  conflict,
  compare,
  same,
  clearMarks,
  tick,
  offline,
  online,
  crdt,
  lww,
  seed,
  merge,
  expect,
} from '@/lesson/builders'
import { lwwRegisterTopic } from '@/lesson/fixtures/lww-register'

const RULE = 'merge: newer ts wins · tie → higher node id'

export default topic({
  ...lwwRegisterTopic,
  goal: 'Pick an LWW register for a single field and explain which write wins, why, and what you lose.',
  whenToUse: [
    'Single-value fields where "newest edit wins" is what users expect (title, status, colour).',
    'The field is set as a whole, not edited inside.',
    'Every write can carry a timestamp that is good enough (logical or hybrid; Unit IV).',
    'Losing one side of a rare race is acceptable.',
  ],
  whenNotToUse: [
    'Two edits should both survive (use a set, a counter, or a sequence).',
    'Device clocks cannot be trusted and a lost edit is costly (Unit IV.1).',
    'The value is long text edited by several people at once (Unit III.5).',
    'Writers often tie and users would notice an arbitrary winner.',
  ],
  realWorld:
    'A status line set from phone and laptop; a cell in Cassandra or DynamoDB (last write wins per cell).',
  scenes: [
    ...lwwRegisterTopic.scenes,
    scene(
      'tie-break',
      null,
      [
        step(
          's01',
          'Timestamps can tie. Time 3: Alice sets Away and Bob sets Busy, with no message in between.',
          tick(),
          lww('status').set('alice', 'Away'),
          lww('status').set('bob', 'Busy'),
          conflict('alice.status', 'bob.status'),
          expect('alice.status@ts', 3),
          expect('bob.status@ts', 3),
        ),
        step(
          's02',
          'Whoops — both writes say t=3. The timestamp alone cannot pick a winner.',
          conflict('alice.status', 'bob.status'),
          highlight(['alice.status@ts', 'bob.status@ts'], { tone: 'warn' }),
        ),
        step(
          's03',
          'The fix: the rule has a second part. Compare **node ids**: bob sorts after alice, so Bob wins the tie.',
          clearMarks(),
          highlight(['alice.status@node', 'bob.status@node']),
          compare(['alice.status', 'bob.status'], { expect: 'less' }), // stamp rule: equal ts, then node
        ),
        step(
          's04',
          'They sync. Both copies pick Busy, stamped t=3, bob.',
          clearMarks(),
          crdt.sync('alice', 'bob', 'status'),
          expect('alice.status', 'Busy'),
          expect('alice.status@node', 'bob'),
          expect('bob.status', 'Busy'),
        ),
        step(
          's05',
          'Alice lost, though her write was not older. The tie-break is arbitrary, but it is the same on every copy.',
          same('alice.status', 'bob.status'),
        ),
        step.long(
          's06',
          'Any fixed rule works, as long as every copy uses the same one. Without it, two copies could disagree forever.',
          callout('bob.status', 'tie → higher node id', { tone: 'info' }),
        ),
      ],
      { startFrom: 'update-and-merge' },
    ),
    scene(
      'status-sync',
      {
        layout: 'hub',
        clock: { show: true },
        actors: [
          server('Relay'),
          alice({ icon: 'phone' }),
          device('laptop', 'Laptop', { owner: 'alice', icon: 'laptop' }),
        ],
      },
      [
        step(
          's01',
          "One person, two devices, one relay: Alice's phone, Alice's laptop, and a relay that keeps a copy and merges like everyone else.",
          crdt.init(['server', 'alice', 'laptop'], 'status', 'lww-register', {
            seed: [seed('set', 'Offline')],
          }),
          note('rule', RULE),
        ),
        step('s02', 'The phone goes offline in the subway.', offline('alice')),
        step(
          's03',
          'Time 5: on the phone, Alice sets Commuting. The phone cannot send yet.',
          tick(5),
          lww('status').set('alice', 'Commuting'),
          expect('alice.status', 'Commuting'),
          expect('alice.status@ts', 5),
        ),
        step(
          's04',
          'Time 7: at her desk, she sets At desk on the laptop. The laptop sends to the relay right away, and the relay merges.',
          tick(2),
          lww('status').set('laptop', 'At desk'),
          crdt.send('laptop', 'server', 'status', { id: 'm1' }),
          merge('m1'),
          expect('server.status', 'At desk'),
          expect('server.status@ts', 7),
        ),
        step(
          's05',
          'Time 9: the phone is back online and sends its state, Commuting with t=5.',
          tick(2),
          online('alice'),
          crdt.send('alice', 'server', 'status', { id: 'm2' }),
        ),
        step(
          's06',
          'Whoops — an older write arrives after a newer one. In a store without timestamps, the last arrival would overwrite At desk.',
          conflict('alice.status', 'server.status'),
        ),
        step(
          's07',
          'The relay compares timestamps: Commuting is t=5, At desk is t=7. Newer wins, so At desk stays.',
          merge('m2'), // "no change" pill on the relay
          highlight('server.status@ts'),
          expect('server.status', 'At desk'),
        ),
        step(
          's08',
          'The relay answers with its state. The phone takes At desk, and all three copies agree.',
          crdt.send('server', 'alice', 'status', { id: 'm3' }),
          merge('m3'),
          same('alice.status', 'laptop.status', 'server.status'),
          expect('alice.status', 'At desk'),
        ),
        step.long(
          's09',
          'One caveat: our clock is a simple counter. Real device clocks drift, and Unit IV shows what that breaks and how to fix it.',
        ),
      ],
      { inContext: true },
    ),
  ],
})
