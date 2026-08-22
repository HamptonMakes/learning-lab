/**
 * UUIDs I.1 — UUID v4: 16 random bytes, 6 fixed bits. Scene 1 builds one id byte by byte on a
 * laptop; scene 2 (in context) lets two offline devices mint order ids that never clash.
 * Bytes come from `uuid.v4()` (src/uuid/) wherever a finished id is shown, never hand-typed.
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
  annotate,
  unannotate,
  view,
  online,
  send,
  deliver,
  ref,
  highlight,
  callout,
  compare,
  check,
  clearMarks,
  expect,
} from '@/lesson/builders'

/** The 32 hex characters "we rolled once" for scene 1 (byte 6 = 07, byte 8 = 2d before forcing). */
const ROLLED = '3fa85c129be407712d66c0158af341b9'
/** The same roll through the real builder: byte 6 → 47, byte 8 → ad. */
const PHONE_ID = uuid.v4(ROLLED)
const TABLET_ID = uuid.v4('9c017e5502a14f3d910b7ae266041cd8')

export default topic({
  id: 'uuid-v4',
  title: 'UUID v4',
  goal: 'Read a v4 id byte by byte and explain why two devices can make ids without talking to each other.',
  whenToUse: [
    'Ids minted on many devices or services with no coordinator (offline apps, CRDT op ids).',
    'Public ids in URLs that must not reveal order, count or time.',
    'Any key where random and unique is all you need.',
  ],
  whenNotToUse: [
    'Primary keys in a table with many inserts: use v7 (next topic).',
    'Ids that humans must read or type: use short codes.',
    'Sorting by id should mean sorting by time: use v7.',
  ],
  realWorld:
    'Order ids in a checkout service; gen_random_uuid() in Postgres; crypto.randomUUID() in browsers and Node.',
  scenes: [
    scene('random-bytes', { layout: 'row', actors: [device('laptop', 'Laptop')] }, [
      step(
        's01',
        'A **UUID** is 16 bytes. Start with 16 random bytes (we rolled them once for this lesson).',
        set('laptop.id', bytes(ROLLED)),
        annotate('laptop.id', 0, 16, 'random', { tone: 'info', id: 'rand' }),
        expect('laptop.id', ROLLED),
      ),
      step(
        's02',
        'Byte 6 (count from 0): its top 4 bits are replaced by 0100, the version, 4. So 07 becomes 47.',
        view('laptop.id', 'bits', [6, 7]),
        set('laptop.id[6]', 0x47),
        annotate('laptop.id', 48, 52, 'version = 4', { unit: 'bit', tone: 'change' }),
        expect('laptop.id[6]', 0x47),
      ),
      step(
        's03',
        'Byte 8: its top 2 bits become 10, the variant, which says this is a standard UUID. So 2d becomes ad.',
        view('laptop.id', 'bits', [8, 9]),
        set('laptop.id[8]', 0xad),
        annotate('laptop.id', 64, 66, 'variant = 10', { unit: 'bit', tone: 'change' }),
        expect('laptop.id[8]', 0xad),
      ),
      step(
        's04',
        'Everything else stays random: 122 bits. Six fixed bits, 122 rolled ones.',
        view('laptop.id', 'hex'),
        unannotate('laptop.id', 'rand'),
        annotate('laptop.id', 0, 48, 'random', { unit: 'bit', tone: 'info', id: 'rand-a' }),
        annotate('laptop.id', 52, 64, 'random', { unit: 'bit', tone: 'info', id: 'rand-b' }),
        annotate('laptop.id', 66, 128, 'random', { unit: 'bit', tone: 'info', id: 'rand-c' }),
        expect('laptop.id', '3fa85c129be44771ad66c0158af341b9'),
      ),
      step(
        's05',
        'Write each byte as two hex digits, with dashes in an 8-4-4-4-12 pattern: 3fa85c12-9be4-4771-ad66-c0158af341b9.',
        view('laptop.id', 'canonical'),
        expect('laptop.id', '3fa85c129be44771ad66c0158af341b9'),
      ),
      step(
        's06',
        'The third group starts with 4: the version. The fourth group starts with 8, 9, a or b: the variant bits 10.',
        highlight(['laptop.id[6]', 'laptop.id[8]']),
      ),
      step(
        's07',
        '122 random bits give about 5.3 × 10^36 ids. Two devices rolling at once will not collide in practice: odds, not a promise.',
        callout('laptop.id', '2^122 ≈ 5.3 × 10^36', { tone: 'info', sticky: true }),
      ),
      step.long(
        's08',
        'No counter, no server, no clock. That is why every device can make its own id, and why the id says nothing about when or where.',
        check('laptop.id'),
      ),
    ]),
    scene(
      'two-orders',
      {
        layout: 'triangle',
        actors: [
          server('Server', { holds: { orders: list([]) } }),
          device('phone', 'Phone', { icon: 'phone', online: false }),
          device('tablet', 'Tablet', { icon: 'tablet', online: false }),
        ],
      },
      [
        step(
          's01',
          'Two devices, both offline. Each starts a new order and needs an id for it right now.',
          set('phone.order', rec({ total: '€12' })),
          set('tablet.order', rec({ total: '€40' })),
        ),
        step(
          's02',
          'Each rolls its own v4 id. No request to a server, no shared counter.',
          set('phone.order.id', bytes(PHONE_ID.bytes, { display: 'canonical' })),
          set('tablet.order.id', bytes(TABLET_ID.bytes, { display: 'canonical' })),
          highlight(['phone.order.id', 'tablet.order.id']),
          expect('phone.order.id', '3fa85c129be44771ad66c0158af341b9'),
          expect('tablet.order.id', '9c017e5502a14f3d910b7ae266041cd8'),
        ),
        step(
          's03',
          'Both come back online and send their orders to the server.',
          online('phone'),
          online('tablet'),
          send('phone', 'server', ref('phone.order'), {
            id: 'o1',
            label: 'order',
            into: 'server.orders[phone]',
          }),
          send('tablet', 'server', ref('tablet.order'), {
            id: 'o2',
            label: 'order',
            into: 'server.orders[tablet]',
          }),
        ),
        step(
          's04',
          'The server stores both. Different ids, no clash, and it never had to hand out numbers.',
          deliver('o1'),
          deliver('o2'),
          compare(['server.orders[phone].id', 'server.orders[tablet].id'], {
            expect: 'different',
          }),
          expect('server.orders[phone].id', '3fa85c129be44771ad66c0158af341b9'),
          expect('server.orders[tablet].id', '9c017e5502a14f3d910b7ae266041cd8'),
        ),
        step(
          's05',
          'Whoops — with serial numbers, both devices would have said order 1001. Two orders, one key.',
          callout('server.orders', '#1001 vs #1001', { tone: 'danger' }),
        ),
        step(
          's06',
          'The fix: every device names its own things, and random names do not collide in practice. The CRDT course uses this for [op ids](/crdts/operation-based/every-device-needs-a-name).',
          clearMarks(),
          check('server.orders[phone].id'),
          check('server.orders[tablet].id'),
        ),
        step.long(
          's07',
          'One more thing: a v4 id tells you nothing, not when, not where. Good for privacy, bad for sorting, and that is where v7 comes in.',
          callout('server.orders', 'no time inside', { tone: 'info', sticky: true }),
        ),
      ],
      { inContext: true },
    ),
  ],
})
