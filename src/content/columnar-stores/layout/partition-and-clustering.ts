/**
 * Columnar I.2 — Partition and clustering keys (Cassandra / ScyllaDB style). Three nodes own
 * token ranges 0–99 (simplified); hash values are made up for the lesson and said so. Each node
 * stores one small table per partition; the clustering key keeps rows sorted inside it.
 */
import {
  topic,
  scene,
  step,
  device,
  server,
  board,
  rec,
  table,
  row,
  meter,
  text,
  set,
  insert,
  sort,
  note,
  send,
  deliver,
  ref,
  highlight,
  callout,
  check,
  clearMarks,
  bad,
  expect,
} from '@/lesson/builders'

const COLS = ['sent', 'body']

const nodes = () => [
  server('Node A', { id: 'node-a', subtitle: 'tokens 0–33' }),
  server('Node B', { id: 'node-b', subtitle: 'tokens 34–66' }),
  server('Node C', { id: 'node-c', subtitle: 'tokens 67–99' }),
]

export default topic({
  id: 'partition-and-clustering',
  title: 'Partition and clustering keys',
  goal: 'Learn how a partition key picks the node, a clustering key sets the order inside it, and why a query that names both is fast.',
  whenToUse: [
    'Huge write volume with queries known up front, keyed by an entity plus time.',
    'Many data centres and no single primary.',
    'Append-mostly data read back in key order (messages by channel, events by device).',
  ],
  whenNotToUse: [
    'Ad-hoc queries, joins or aggregates across partitions: a warehouse or a column store.',
    'Small data or few queries per second: a relational database is simpler.',
    'Find rows where the text contains a word: a search index.',
  ],
  realWorld:
    'A chat messages table in Cassandra or ScyllaDB: PRIMARY KEY ((channel_id), sent_at), clustering order sent_at DESC.',
  scenes: [
    scene(
      'partition-key',
      {
        layout: 'hub',
        hub: 'client',
        actors: [device('client', 'Client', { icon: 'laptop' }), ...nodes()],
      },
      [
        step(
          's01',
          'Three nodes; each owns a range of hash values, called tokens: 0 to 99 in all (simplified). The table messages has a **partition key**, channel.',
          note('schema', 'messages: PRIMARY KEY ((channel), sent)', { label: 'table' }),
          highlight(['node-a', 'node-b', 'node-c']),
        ),
        step(
          's02',
          'A message arrives: channel 42, sent 10:00, body hi. hash(42) = 51 (made up for this lesson), and token 51 is in the range of Node B.',
          set('client.msg', rec({ channel: 42, sent: '10:00', body: 'hi' })),
          highlight('client.msg.channel'),
          callout('client.msg.channel', 'hash(42) = 51', { tone: 'info' }),
          expect('client.msg.channel', 42),
        ),
        step(
          's03',
          'So Node B stores it. The client sends the row there and nowhere else (simplified: one copy, no replicas).',
          send('client', 'node-b', ref('client.msg'), { id: 'm1', label: 'hash=51' }),
          deliver('m1'),
          set('node-b.ch42', table(COLS, [row('m1', { sent: '10:00', body: 'hi' })])),
          expect('node-b.ch42', [{ sent: '10:00', body: 'hi' }]),
        ),
        step(
          's04',
          'Another message, channel 7: hash(7) = 80, the range of Node C. It goes to Node C.',
          set('client.msg', rec({ channel: 7, sent: '10:01', body: 'yo' })),
          send('client', 'node-c', ref('client.msg'), { id: 'm2', label: 'hash=80' }),
          deliver('m2'),
          set('node-c.ch7', table(COLS, [row('m2', { sent: '10:01', body: 'yo' })])),
          expect('node-c.ch7', [{ sent: '10:01', body: 'yo' }]),
        ),
        step(
          's05',
          'Channel 42 again, sent 10:05. hash(42) is always 51, so always Node B: all of channel 42 lives together, in one **partition**.',
          set('client.msg', rec({ channel: 42, sent: '10:05', body: 'lunch?' })),
          send('client', 'node-b', ref('client.msg'), { id: 'm3', label: 'hash=51' }),
          deliver('m3'),
          insert('node-b.ch42', row('m3', { sent: '10:05', body: 'lunch?' })),
          expect('node-b.ch42', [
            { sent: '10:00', body: 'hi' },
            { sent: '10:05', body: 'lunch?' },
          ]),
        ),
        step(
          's06',
          'A late message for channel 42, sent 10:02, arrives now. Inside the partition, rows stay sorted by the **clustering key**, sent: it slots in between.',
          set('client.msg', rec({ channel: 42, sent: '10:02', body: 'brb' })),
          send('client', 'node-b', ref('client.msg'), { id: 'm4', label: 'hash=51' }),
          deliver('m4'),
          insert('node-b.ch42', row('m4', { sent: '10:02', body: 'brb' })),
          sort('node-b.ch42', ['.sent']),
          highlight('node-b.ch42[m4]'),
          expect('node-b.ch42', [
            { sent: '10:00', body: 'hi' },
            { sent: '10:02', body: 'brb' },
            { sent: '10:05', body: 'lunch?' },
          ]),
        ),
        step(
          's07',
          'Query: the messages of channel 42 sent after 10:01. One hash, one node, one sorted run: fast.',
          callout('client', 'WHERE channel = 42 AND sent > 10:01', {
            tone: 'info',
            sticky: true,
            id: 'query',
          }),
          send('client', 'node-b', 'channel 42, sent > 10:01?', { id: 'q1', label: 'hash=51' }),
          deliver('q1'),
          highlight(['node-b.ch42[m4]', 'node-b.ch42[m3]'], { tone: 'ok' }),
        ),
        step(
          's08',
          'Whoops — a query with no partition key: every message that says hi. Every node, every partition, and Cassandra refuses it unless you add ALLOW FILTERING.',
          clearMarks(),
          callout('client', "WHERE body = 'hi'", { tone: 'danger', sticky: true, id: 'query' }),
          send('client', ['node-a', 'node-b', 'node-c'], 'body = hi?', { id: 'q2' }),
          deliver('q2@node-a'),
          deliver('q2@node-b'),
          deliver('q2@node-c'),
          highlight(['node-a', 'node-b', 'node-c'], { tone: 'danger' }),
        ),
        step.long(
          's09',
          'The fix: design the table from the query. Partition key = what you look up by; clustering key = the order you want it back in.',
          clearMarks(),
          callout('node-b', 'partition → node · clustering → order', { tone: 'ok', sticky: true }),
        ),
      ],
    ),
    scene(
      'hot-partition',
      {
        layout: 'hub',
        hub: 'client',
        actors: [
          device('client', 'Client', { icon: 'laptop' }),
          server('Node A', {
            id: 'node-a',
            subtitle: 'tokens 0–33',
            holds: { load: meter(3, 100, 'load %') },
          }),
          server('Node B', {
            id: 'node-b',
            subtitle: 'tokens 34–66',
            holds: { load: meter(97, 100, 'load %', { tone: 'danger' }) },
          }),
          server('Node C', {
            id: 'node-c',
            subtitle: 'tokens 67–99',
            holds: { load: meter(5, 100, 'load %') },
          }),
        ],
        boards: [
          board('schema', text('messages: PRIMARY KEY ((channel), sent)'), { label: 'table' }),
        ],
      },
      [
        step(
          's01',
          'Channel 42 is busy: a million messages a day, and every one of them lands on Node B. A **hot partition**: B at 97% load, A and C at 3% and 5%.',
          bad('node-b.load'),
          expect('node-a.load', 3),
          expect('node-b.load', 97),
          expect('node-c.load', 5),
        ),
        step(
          's02',
          'The fix: add the day to the partition key, (channel, day). Each day of channel 42 then hashes to a different token.',
          note('schema', 'messages: PRIMARY KEY ((channel, day), sent)', { label: 'table' }),
          highlight('board.schema'),
        ),
        step(
          's03',
          'Three days, three nodes: hash(42, Aug 20) = 12 goes to Node A, hash(42, Aug 21) = 71 to Node C, hash(42, Aug 22) = 51 to Node B. The load spreads.',
          send('client', 'node-a', rec({ sent: '09:14', body: 'morning' }), {
            id: 'd1',
            label: 'hash=12',
          }),
          send('client', 'node-c', rec({ sent: '18:02', body: 'done' }), {
            id: 'd2',
            label: 'hash=71',
          }),
          send('client', 'node-b', rec({ sent: '10:00', body: 'hi' }), {
            id: 'd3',
            label: 'hash=51',
          }),
          deliver('d1'),
          deliver('d2'),
          deliver('d3'),
          set('node-a.aug20', table(COLS, [row('d1', { sent: '09:14', body: 'morning' })])),
          set('node-c.aug21', table(COLS, [row('d2', { sent: '18:02', body: 'done' })])),
          set('node-b.aug22', table(COLS, [row('d3', { sent: '10:00', body: 'hi' })])),
          set('node-a.load', meter(33, 100, 'load %', { tone: 'ok' })),
          set('node-b.load', meter(35, 100, 'load %', { tone: 'ok' })),
          set('node-c.load', meter(32, 100, 'load %', { tone: 'ok' })),
          expect('node-a.load', 33),
          expect('node-b.load', 35),
          expect('node-c.load', 32),
        ),
        step(
          's04',
          'The cost: the last 20 messages may now sit in two partitions, today and yesterday. Two reads instead of one, still fast.',
          callout('client', 'channel 42, Aug 22 and Aug 21', {
            tone: 'info',
            sticky: true,
            id: 'query',
          }),
          send('client', ['node-b', 'node-c'], '(42, Aug 22), (42, Aug 21)?', { id: 'q3' }),
          deliver('q3@node-b'),
          deliver('q3@node-c'),
          highlight(['node-b.aug22', 'node-c.aug21'], { tone: 'ok' }),
        ),
        step(
          's05',
          'A question like messages per country does not fit this table. That is a job for a column store: see [Rows vs columns](/columnar-stores/layout/rows-vs-columns).',
          clearMarks(),
          callout('client', 'analytics → column store', {
            tone: 'info',
            sticky: true,
            id: 'query',
          }),
        ),
        step.long(
          's06',
          'Use both: partitions for the questions your app asks, columns for the questions your analysts ask.',
          check('node-a.aug20'),
          check('node-b.aug22'),
          check('node-c.aug21'),
        ),
      ],
      { inContext: true },
    ),
  ],
})
