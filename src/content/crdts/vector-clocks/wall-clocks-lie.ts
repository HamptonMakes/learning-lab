/**
 * IV.1 — Wall clocks lie. An LWW register stamped with device wall clocks: Bob's laptop runs five
 * minutes slow, so the write that happened last carries the smaller stamp and loses
 * (`two-clocks`). `clock-jumps-back` shows a device losing its own newest edit after its clock is
 * corrected backwards; `settings-keep-reverting` puts the same bug in context with an LWW map.
 * Every stamp and winner is computed by src/crdt/lww-register.ts and lww-map.ts; the scene clock
 * is 'time' so stamps read as hh:mm. Storyboard: docs/curriculum/unit-3-4.md §IV.1.
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
  cross,
  clearMarks,
  tick,
  skew,
  crdt,
  lww,
  lwwMap,
  seed,
  expect,
} from '@/lesson/builders'

const RULE = 'merge: higher stamp wins · tie → higher node id'
const TIME = { show: true, format: 'time', start: '10:00' } as const

export default topic({
  id: 'wall-clocks-lie',
  title: 'Wall clocks lie',
  goal: 'Explain why a wall-clock timestamp is not the same as "happened later", and spot where that breaks an LWW field.',
  whenToUse: [
    'Low-stakes fields where a wrong pick costs little, on devices that sync their clocks.',
    'In practice one writer per field, so two devices rarely race.',
    'You add a node-id tie-break and accept a few seconds of slop.',
    'You stamp with an HLC (IV.5) so a causal chain cannot go backwards.',
  ],
  whenNotToUse: [
    'Two devices may edit the same field inside the clock-error window.',
    'Devices can be offline or unsynced for long (airplane mode, IoT, a dead battery).',
    'Correctness matters: money, permissions, inventory.',
    'You need "happened before", not "was stamped later".',
  ],
  realWorld:
    'Cassandra LWW cells under clock skew (silently lost writes); Google Spanner TrueTime uses atomic clocks to bound the error.',
  scenes: [
    scene(
      'two-clocks',
      {
        layout: 'pair',
        clock: TIME,
        actors: [alice({ icon: 'phone', skew: 0 }), bob({ icon: 'laptop' })],
      },
      [
        step(
          's01',
          'Phone and laptop share a note title in an **LWW register**. Each device stamps its writes with its own clock.',
          crdt.init(['alice', 'bob'], 'title', 'lww-register', { seed: [seed('set', 'Untitled')] }),
          highlight(['alice.title@ts', 'bob.title@ts']),
        ),
        step(
          's02',
          "Bob's laptop clock is five minutes slow. Nobody notices; clocks drift all the time.",
          skew('bob', -5),
          highlight(['alice@clock', 'bob@clock'], { tone: 'warn' }),
          callout('bob@clock', '5 min slow', { tone: 'warn' }),
          expect('bob@clock', -5),
        ),
        step('s03', 'The merge rule from Unit II: the higher stamp wins.', note('rule', RULE)),
        step(
          's04',
          "At 10:06 Alice renames the note to 'Draft'. Her clock is right, so the stamp is 10:06.",
          tick(6),
          lww('title').set('alice', 'Draft'),
          expect('alice.title', 'Draft'),
          expect('alice.title@ts', 6),
        ),
        step(
          's05',
          "Two minutes later, at 10:08, Bob renames it to 'Final'. His slow clock stamps it 10:03.",
          tick(2),
          lww('title').set('bob', 'Final'),
          expect('bob.title', 'Final'),
          expect('bob.title@ts', 3),
        ),
        step(
          's06',
          "Compare the stamps: Bob's 10:03 is less than Alice's 10:06. The write that happened last looks older.",
          compare(['bob.title', 'alice.title'], { expect: 'less' }),
        ),
        step(
          's07',
          'They sync. LWW does what it is told: 10:06 beats 10:03, so Draft wins on both devices.',
          clearMarks(),
          crdt.sync('alice', 'bob', 'title'),
          expect('alice.title', 'Draft'),
          expect('bob.title', 'Draft'),
        ),
        step.long(
          's08',
          "Whoops — Bob's rename was the newest in real time, and it is gone. The numbers were compared correctly; the numbers lied.",
          cross('bob.title'),
          callout('bob.title', '10:03 < 10:06, but it happened last', { tone: 'danger' }),
        ),
        step.long(
          's09',
          'Clock skew is normal: seconds between phones, minutes for a device with no network, hours after a dead battery. A higher stamp does not mean it happened later.',
          clearMarks(),
          callout('bob@clock', 'skew is normal', { tone: 'warn', sticky: true }),
        ),
      ],
    ),
    scene(
      'clock-jumps-back',
      {
        layout: 'pair',
        clock: TIME,
        actors: [alice({ icon: 'phone', skew: 5 }), bob({ icon: 'laptop', skew: 0 })],
      },
      [
        step(
          's01',
          "Clocks also jump. Alice's phone runs five minutes fast, Bob's laptop is right, and both hold the title v1.",
          crdt.init(['alice', 'bob'], 'title', 'lww-register', { seed: [seed('set', 'v1')] }),
          highlight('alice@clock', { tone: 'warn' }),
          note('rule', RULE),
          expect('alice@clock', 5),
        ),
        step(
          's02',
          'At 10:01 Alice types v2, and her fast clock stamps it 10:06. She syncs with Bob, and both hold v2.',
          tick(),
          lww('title').set('alice', 'v2'),
          crdt.sync('alice', 'bob', 'title'),
          expect('alice.title@ts', 6),
          expect('bob.title', 'v2'),
        ),
        step(
          's03',
          'Her phone now syncs its clock with the network. It jumps back five minutes, to the true time.',
          skew('alice', 0),
          highlight('alice@clock', { tone: 'warn' }),
          callout('alice@clock', 'jumped back 5 min', { tone: 'warn' }),
          expect('alice@clock', 1),
        ),
        step(
          's04',
          'At 10:02 she types v3, her newest edit. Its stamp, 10:02, is lower than the 10:06 already on v2.',
          tick(),
          lww('title').set('alice', 'v3'),
          highlight(['alice@clock', 'alice.title@ts'], { tone: 'warn' }),
          expect('alice.title', 'v2'),
          expect('alice.title@ts', 6),
        ),
        step.long(
          's05',
          'Whoops — her own phone kept v2. A lower stamp cannot replace a higher one, so her newest edit never landed anywhere.',
          cross('alice.title'),
          callout('alice.title', 'v3 was dropped: 10:02 < 10:06', { tone: 'danger' }),
        ),
        step.long(
          's06',
          'A clock that moves backwards makes a newer write look older. A node-id tie-break cannot help here: the stamp itself is wrong.',
          clearMarks(),
          callout('alice@clock', 'time went backwards', { tone: 'danger', sticky: true }),
        ),
      ],
    ),
    scene(
      'settings-keep-reverting',
      {
        layout: 'pair',
        clock: TIME,
        actors: [alice({ icon: 'phone', skew: 5 }), bob({ icon: 'laptop', skew: 0 })],
      },
      [
        step(
          's01',
          'Settings sync between phone and laptop as an **LWW map**: theme and size, each field stamped by the wall clock. The phone is five minutes fast.',
          crdt.init(['alice', 'bob'], 'settings', 'lww-map', {
            seed: [seed('set', 'theme', 'light'), seed('set', 'size', 14)],
          }),
          note('rule', 'per field: higher stamp wins · tie → higher node id'),
          highlight('alice@clock', { tone: 'warn' }),
        ),
        step(
          's02',
          'At 10:00 Alice sets the theme to dark on the phone. Her fast clock stamps it 10:05.',
          lwwMap('settings').set('alice', 'theme', 'dark'),
          expect('alice.settings.theme', 'dark'),
          expect('alice.settings.theme@ts', 5),
        ),
        step(
          's03',
          'At 10:02 Bob sets it back to light on the laptop, stamp 10:02. They sync.',
          tick(2),
          lwwMap('settings').set('bob', 'theme', 'light'),
          crdt.sync('alice', 'bob', 'settings'),
          expect('bob.settings.theme', 'dark'),
        ),
        step.long(
          's04',
          "Whoops — dark wins: 10:05 beats 10:02. Bob's laptop flips back to dark, and he never asked for it.",
          cross('bob.settings.theme'),
          callout('bob', 'why does it keep reverting?', { tone: 'danger' }),
        ),
        step(
          's05',
          'He sets light again at 10:03, and his laptop keeps dark: 10:03 cannot beat 10:05. Bob cannot win until his clock passes 10:05.',
          clearMarks(),
          tick(),
          lwwMap('settings').set('bob', 'theme', 'light'),
          expect('bob.settings.theme', 'dark'),
          expect('bob.settings.theme@ts', 5),
          highlight('bob.settings.theme@ts', { tone: 'warn' }),
        ),
        step(
          's06',
          'Size is fine, because only Alice touches it: she sets 16, they sync, Bob takes it. The bug only bites when two devices race on one field.',
          lwwMap('settings').set('alice', 'size', 16),
          crdt.sync('alice', 'bob', 'settings'),
          check('bob.settings.size'),
          expect('bob.settings.size', 16),
        ),
        step.long(
          's07',
          'This is the most common LWW bug in real apps. The cure is a clock built from cause and effect, not from the wall: Lamport clocks, next.',
          callout('alice@clock', 'logical clocks →', { tone: 'info', sticky: true }),
        ),
      ],
      { inContext: true },
    ),
  ],
})
