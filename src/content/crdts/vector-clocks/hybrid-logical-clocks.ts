/**
 * IV.5 — Hybrid logical clocks. An `hlc` slot per device: wall time plus a counter. The counter
 * climbs while the wall part cannot move and resets when it does; a receive takes the biggest
 * wall of (mine, message, my clock). `wall-time-plus-a-counter` runs the rules, including a wall
 * clock that jumps back while the HLC does not. `the-title-fixed` replays IV.1 with the LWW
 * register stamped from the HLC (`args.clock`): the write that knew about the other one wins.
 * Every reading is computed by src/crdt/hlc.ts. Storyboard: docs/curriculum/unit-3-4.md §IV.5.
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
  compare,
  check,
  clearMarks,
  tick,
  skew,
  send,
  deliver,
  crdt,
  hlc,
  lww,
  seed,
  expect,
} from '@/lesson/builders'

const RULE =
  'event: wall = max(wall, my clock); same wall → counter + 1, else 0 · receive: max with stamp too'
const TIME = { show: true, format: 'time', start: '10:00' } as const

export default topic({
  id: 'hybrid-logical-clocks',
  title: 'Hybrid logical clocks',
  goal: 'Learn how to read an HLC stamp, run its two rules, and why it is a safe LWW timestamp along a causal chain.',
  whenToUse: [
    'LWW stamps where humans also want to know "when" (notes, settings, CRMs).',
    'Replacing raw wall-clock stamps in an existing LWW design: same size, fewer surprises.',
    'Ordering across a cluster whose skew is bounded (CockroachDB).',
    'One stamp for both "sort by time" and "cause before effect".',
  ],
  whenNotToUse: [
    'You must detect concurrency; an HLC is a total order and hides it (use vector clocks).',
    'Skew is unbounded (hours): one wild clock drags every HLC hours ahead of real time.',
    'A pure logical order is enough; a Lamport clock is simpler.',
    'Stamps must equal wall time exactly; an HLC can run ahead of the wall.',
  ],
  realWorld:
    'CockroachDB transaction timestamps; offline-first apps such as Actual Budget stamp LWW fields with HLCs.',
  scenes: [
    scene(
      'wall-time-plus-a-counter',
      {
        layout: 'pair',
        clock: TIME,
        actors: [alice({ icon: 'phone', skew: 5 }), bob({ icon: 'laptop', skew: 0 })],
      },
      [
        step(
          's01',
          "An **HLC** is a wall time plus a small counter. Alice's phone runs five minutes fast; Bob's laptop is right.",
          crdt.init(['alice', 'bob'], 'hlc', 'hlc'),
          highlight(['alice@clock', 'bob@clock'], { tone: 'warn' }),
          expect('alice@clock', 5),
          expect('alice.hlc', { wall: 0, counter: 0 }),
        ),
        step(
          's02',
          'Two rules: on an event take the bigger wall; on a receive also look at the stamp.',
          note('rule', RULE),
        ),
        step(
          's03',
          'At 10:01 Alice edits and sends it to Bob. Her HLC takes her clock, 10:06, with counter 0: (10:06, 0).',
          tick(),
          send('alice', 'bob', 'edit', { id: 'm1', stamp: 'hlc' }),
          expect('alice.hlc', { wall: 6, counter: 0 }),
        ),
        step(
          's04',
          "Bob's clock says 10:01. He receives (10:06, 0) and takes the biggest wall of the three, 10:06, with counter 0 + 1.",
          deliver('m1', { recv: 'hlc' }),
          callout('bob.hlc', 'max(10:01, 10:00, 10:06) = 10:06', { tone: 'info' }),
          expect('bob.hlc', { wall: 6, counter: 1 }),
        ),
        step(
          's05',
          "Bob's HLC (10:06, 1) is now ahead of his own wall clock. That is allowed: the HLC runs ahead, and the counter keeps his edits in order meanwhile.",
          callout('bob@clock', 'wall 10:01 · HLC 10:06', { tone: 'warn' }),
        ),
        step(
          's06',
          'Bob edits: (10:06, 2). The wall part cannot move yet, so the counter climbs.',
          hlc('hlc').tick('bob'),
          expect('bob.hlc', { wall: 6, counter: 2 }),
        ),
        step(
          's07',
          "Now the jump. Alice's phone syncs its clock with the network and drops back to 10:01, the true time.",
          skew('alice', 0),
          highlight('alice@clock', { tone: 'warn' }),
          callout('alice@clock', 'jumped back 5 min', { tone: 'warn' }),
          expect('alice@clock', 1),
        ),
        step(
          's08',
          'She edits again: (10:06, 1). Her wall clock went backwards, but her HLC did not, and it never does.',
          hlc('hlc').tick('alice'),
          check('alice.hlc'),
          expect('alice.hlc', { wall: 6, counter: 1 }),
        ),
        step(
          's09',
          "Six minutes later, at 10:07, real time passes the HLC. Bob's next edit reads (10:07, 0): the wall moved, so the counter resets.",
          clearMarks(),
          tick(6),
          hlc('hlc').tick('bob'),
          expect('bob.hlc', { wall: 7, counter: 0 }),
        ),
        step.long(
          's10',
          'Never backwards, cause before effect, and close to real time. Two rules, three properties.',
          callout('bob.hlc', 'monotonic · causal · ≈ wall time', { tone: 'info', sticky: true }),
        ),
      ],
    ),
    scene(
      'the-title-fixed',
      {
        layout: 'pair',
        clock: TIME,
        actors: [alice({ icon: 'phone', skew: 0 }), bob({ icon: 'laptop', skew: -5 })],
      },
      [
        step(
          's01',
          "Same phone and laptop as in Wall-clock timestamps: Bob's laptop is five minutes slow. But now the LWW title takes its stamps from an HLC.",
          crdt.init(['alice', 'bob'], 'hlc', 'hlc'),
          crdt.init(['alice', 'bob'], 'title', 'lww-register', {
            clock: { slot: 'hlc' },
            seed: [seed('set', 'Untitled')],
          }),
          note(
            'rule',
            'LWW: higher stamp wins · stamp = (HLC wall, counter) · a merge also feeds the HLC',
          ),
          highlight('bob@clock', { tone: 'warn' }),
          expect('bob@clock', -5),
        ),
        step(
          's02',
          'At 10:06 Alice renames the note to Draft. The stamp is her HLC reading: (10:06, 0).',
          tick(6),
          lww('title').set('alice', 'Draft'),
          expect('alice.title', 'Draft'),
          expect('alice.title@hlc', { wall: 6, counter: 0 }),
          expect('alice.hlc', { wall: 6, counter: 0 }),
        ),
        step(
          's03',
          "She pushes to Bob. The stamp travels with the value, and Bob's HLC receives it: (10:06, 1), though his clock says 10:01.",
          crdt.merge('bob', 'alice', 'title'),
          highlight('bob.hlc'),
          expect('bob.title', 'Draft'),
          expect('bob.hlc', { wall: 6, counter: 1 }),
        ),
        step(
          's04',
          'At 10:08 Bob renames it to Final. His clock says 10:03, but his HLC is already at 10:06, so the stamp is (10:06, 2).',
          tick(2),
          lww('title').set('bob', 'Final'),
          expect('bob@clock', 3),
          expect('bob.title', 'Final'),
          expect('bob.title@hlc', { wall: 6, counter: 2 }),
        ),
        step(
          's05',
          "Compare the stamps: Final (10:06, 2) is greater than Draft (10:06, 0). Bob knew about Alice's write, and his stamp says so.",
          compare(['bob.title', 'alice.title'], { expect: 'greater' }),
        ),
        step(
          's06',
          'They sync. Final wins on both: this time the newest write in real time is the one that stays.',
          clearMarks(),
          crdt.sync('alice', 'bob', 'title'),
          check('alice.title'),
          check('bob.title'),
          expect('alice.title', 'Final'),
          expect('bob.title', 'Final'),
        ),
        step.long(
          's07',
          'An HLC fixes the case of a write that saw another write but came from a slower clock. Two edits with no contact are still a tie-break; no clock can fix that.',
          callout('bob', 'causal: fixed · concurrent: still a tie-break', {
            tone: 'warn',
            sticky: true,
          }),
        ),
      ],
      { inContext: true },
    ),
  ],
})
