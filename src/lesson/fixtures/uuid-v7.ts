/**
 * docs/animation-dsl.md §15.3 — UUID v7, `time-first` (prototype module `uuids`), written verbatim
 * with the builders. Topic metadata is minimal; the scene is the spec's.
 */
import {
  topic,
  scene,
  step,
  device,
  rec,
  bytes,
  uuid,
  set,
  annotate,
  unannotate,
  view,
  highlight,
  callout,
  expect,
} from '@/lesson/builders'

export const uuidV7Topic = topic({
  id: 'uuid-v7',
  title: 'UUID v7',
  goal: 'Read a v7 id byte by byte and say why ids made later sort after ids made earlier.',
  whenToUse: [
    'Database keys that should sort by creation time (index locality, time-range scans).',
    'Ids minted on many machines with no coordination.',
    'Logs and events where "roughly when" is useful on its own.',
  ],
  whenNotToUse: [
    'The creation time must stay private (a v7 id leaks it to the millisecond).',
    'Nothing about the id may be guessable (v4 has 122 random bits; v7 has 74).',
    'A short, human-readable id is required.',
  ],
  realWorld: 'Primary keys in Postgres (uuidv7() since version 18) and event ids in many APIs.',
  scenes: [
    scene(
      'time-first',
      {
        layout: 'row',
        actors: [
          device('laptop', 'Laptop', {
            holds: { now: rec({ iso: '2026-08-22T10:00:00.000Z', ms: 1787392800000 }) },
          }),
        ],
      },
      [
        step(
          's01',
          'Take the current time as milliseconds since 1970: 1787392800000 (2026-08-22 10:00 UTC).',
          highlight('laptop.now.ms'),
        ),
        step(
          's02',
          'Start with 16 random bytes, like a v4 id.',
          set('laptop.id', bytes('9c017e5502a1e4712d66c0158af34102')), // creates the slot
          annotate('laptop.id', 0, 16, 'random', { tone: 'info', id: 'rand' }),
        ),
        step(
          's03',
          'Write the time as 6 bytes: 01 a0 28 e9 b5 00. They replace the first 6 bytes.',
          unannotate('laptop.id', 'rand'),
          set('laptop.id[0..6]', [0x01, 0xa0, 0x28, 0xe9, 0xb5, 0x00]),
          annotate('laptop.id', 0, 6, 'unix ms (48 bits)', { tone: 'change' }),
          expect('laptop.id[0..6]', '01a028e9b500'),
        ),
        step(
          's04',
          'Byte 6: its top 4 bits become 0111, version 7. Byte 8: its top 2 bits become 10, the variant.',
          view('laptop.id', 'bits', [6, 9]), // bytes 6, 7, 8 expanded ([from, to))
          set('laptop.id[6]', 0x74),
          set('laptop.id[8]', 0xad),
          annotate('laptop.id', 48, 52, 'version = 7', { unit: 'bit' }),
          annotate('laptop.id', 64, 66, 'variant = 10', { unit: 'bit' }),
        ),
        step(
          's05',
          'Everything else stays random: 74 bits.',
          view('laptop.id', 'hex'), // range cleared; bit annotations snap to nibbles in hex
          annotate('laptop.id', 52, 64, 'random', { unit: 'bit', tone: 'info' }),
          annotate('laptop.id', 66, 128, 'random', { unit: 'bit', tone: 'info' }),
        ),
        step(
          's06',
          'Canonical text: 01a028e9-b500-7471-ad66-c0158af34102. The 7 shows the version.',
          view('laptop.id', 'canonical'),
          highlight('laptop.id[6]'),
          expect('laptop.id', '01a028e9b5007471ad66c0158af34102'),
        ),
        step(
          's07',
          'One millisecond later, a new id starts with …b501. The time part is bigger, so the text sorts after.',
          set('laptop.id2', uuid.v7({ ms: 1787392800001, rand: '1122b34455667788990a' })),
          highlight(['laptop.id[5]', 'laptop.id2[5]']),
          expect('laptop.id2', '01a028e9b5017122b34455667788990a'),
        ),
        step.long(
          's08',
          'Anyone who sees a v7 id learns when it was made, to the millisecond. Decide if that is OK before you choose it.',
          callout('laptop.id', 'leaks creation time', { tone: 'warn', sticky: true }),
        ),
      ],
    ),
  ],
})
