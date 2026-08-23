/**
 * UUIDs I.2 — UUID v7: time first, then random. Scene 1 is docs/animation-dsl.md §15.3 (the same
 * scene as src/lesson/fixtures/uuid-v7.ts), except `now` holds only the ms number — the stage shows
 * the value the id is built from, not its ISO spelling; scene 2 sorts three v7 ids and three v4 ids
 * made at the same three moments. Every finished id comes from `uuid.v7()` / `uuid.v4()`.
 */
import {
  topic,
  scene,
  step,
  device,
  server,
  rec,
  list,
  bytes,
  uuid,
  set,
  sort,
  annotate,
  unannotate,
  view,
  highlight,
  callout,
  check,
  cross,
  expect,
} from '@/lesson/builders'

/** 2026-08-22T10:00:00.000Z, the moment of scene 1. */
const T0 = 1787392800000

/** Scene 2: one id per moment, 1 ms apart. v7 ids sort by time; v4 ids do not. */
const V7_T0 = uuid.v7({ ms: T0, rand: '7471ad66c0158af34102' }) // the id scene 1 built
const V7_T1 = uuid.v7({ ms: T0 + 1, rand: '1122b34455667788990a' }) // scene 1's id2
const V7_T2 = uuid.v7({ ms: T0 + 2, rand: '3a0c9e17d25b6f48ee01' })
const V4_T0 = uuid.v4('3fa85c129be407712d66c0158af341b9') // starts 3f…
const V4_T1 = uuid.v4('9c017e5502a14f3d910b7ae266041cd8') // starts 9c…
const V4_T2 = uuid.v4('0b4e2d806c3a4a19bf521d9e0c7a6f31') // starts 0b…

const canonical = (id: { bytes: number[] }) => bytes(id.bytes, { display: 'canonical' })

export default topic({
  id: 'uuid-v7',
  title: 'UUID v7',
  goal: 'Learn how to read a v7 id byte by byte, and why ids made later sort after ids made earlier.',
  rules: [
    'Take the current time in milliseconds since 1970. Write it as the first 6 bytes, 48 bits.',
    'Fix the version, 7, in the top of byte 6, and the variant, 10, in the top of byte 8.',
    'Fill the rest with random bits: 74 of them (simplified).',
    'A later time means bigger first bytes, so v7 ids sort by creation time as plain text.',
  ],
  shape: {
    name: 'UUID v7 · 16 bytes',
    fields: [
      {
        key: 'id',
        example: '01a028e9-b500-7471-ad66-c0158af34102',
        role: 'value',
        note: 'hex, 8-4-4-4-12',
      },
      {
        key: 'time',
        example: '01a028e9b500',
        note: 'bytes 0–5: 1787392800000 ms = 2026-08-22 10:00 UTC',
      },
      { key: 'version', example: '7', note: 'top 4 bits of byte 6' },
      { key: 'variant', example: '10', note: 'top 2 bits of byte 8' },
      { key: 'random', example: '74 bits', note: 'the rest of bytes 6–15' },
    ],
  },
  whenToUse: [
    'Database keys that should sort by creation time (new rows land together in the index).',
    'Ids minted on many machines with no coordination.',
    'Logs and events where "roughly when" is useful on its own.',
  ],
  whenNotToUse: [
    'The creation time must stay private (a v7 id leaks it to the millisecond).',
    'Nothing about the id may be guessable (v4 has 122 random bits; v7 has 74).',
    'Strict global order: two ids in the same millisecond are in random order.',
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
            holds: { now: rec({ ms: 1787392800000 }) },
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
          'Everything else stays random: 74 bits (simplified).',
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
    scene('sorts-by-time', { layout: 'row', actors: [server('Server')] }, [
      step(
        's01',
        'Three devices made v7 ids at 10:00:00.000, .001 and .002. They reach the server in a different order: .001, .002, .000.',
        set(
          'server.v7',
          list(
            [
              rec({ made: '10:00:00.001', id: canonical(V7_T1) }),
              rec({ made: '10:00:00.002', id: canonical(V7_T2) }),
              rec({ made: '10:00:00.000', id: canonical(V7_T0) }),
            ],
            { ids: ['t1', 't2', 't0'] },
          ),
        ),
        expect('server.v7[t0].id', '01a028e9b5007471ad66c0158af34102'),
        expect('server.v7[t1].id', '01a028e9b5017122b34455667788990a'),
        expect('server.v7[t2].id', '01a028e9b5027a0c9e17d25b6f48ee01'),
      ),
      step(
        's02',
        'Sort the three by id, as plain text. The made times come out in order: .000, .001, .002.',
        sort('server.v7', ['.id']),
        check('server.v7'),
        expect('server.v7', [
          { made: '10:00:00.000', id: '01a028e9b5007471ad66c0158af34102' },
          { made: '10:00:00.001', id: '01a028e9b5017122b34455667788990a' },
          { made: '10:00:00.002', id: '01a028e9b5027a0c9e17d25b6f48ee01' },
        ]),
      ),
      step(
        's03',
        'Why: the first 6 bytes are the time. Byte 5 reads 00, 01, 02 down the list, so the earlier id has the smaller bytes and sorts first.',
        highlight(['server.v7[t0].id[5]', 'server.v7[t1].id[5]', 'server.v7[t2].id[5]']),
        expect('server.v7[t0].id[5]', 0x00),
        expect('server.v7[t1].id[5]', 0x01),
        expect('server.v7[t2].id[5]', 0x02),
      ),
      step(
        's04',
        'Now the same three moments with v4 ids, arriving in the same order: .001, .002, .000.',
        set(
          'server.v4',
          list(
            [
              rec({ made: '10:00:00.001', id: canonical(V4_T1) }),
              rec({ made: '10:00:00.002', id: canonical(V4_T2) }),
              rec({ made: '10:00:00.000', id: canonical(V4_T0) }),
            ],
            { ids: ['t1', 't2', 't0'] },
          ),
        ),
      ),
      step(
        's05',
        'Sort them by id: .002, .000, .001. Time is not inside a v4 id, so sorting by id says nothing about when.',
        sort('server.v4', ['.id']),
        cross('server.v4'),
        callout('server.v4', 'sorted ≠ made', { tone: 'warn' }),
        expect('server.v4', [
          { made: '10:00:00.002', id: '0b4e2d806c3a4a19bf521d9e0c7a6f31' },
          { made: '10:00:00.000', id: '3fa85c129be44771ad66c0158af341b9' },
          { made: '10:00:00.001', id: '9c017e5502a14f3d910b7ae266041cd8' },
        ]),
      ),
      step.long(
        's06',
        'Pick v4 when the id should say nothing. Pick v7 when it is a key you insert a lot and want to read back in time order.',
        callout('server.v7', 'sorted = made', { tone: 'ok', sticky: true }),
      ),
    ]),
  ],
})
