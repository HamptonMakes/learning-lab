/**
 * Columnar I.1 — Rows vs columns. One `events` table on a board; two stores keep the same 24
 * values in different disk layouts (drawn as blocks, simplified). Two queries, one meter each:
 * bytes read, at 4 bytes a value (simplified). The point is the ratio, not the byte count.
 */
import {
  topic,
  scene,
  step,
  server,
  board,
  list,
  table,
  row,
  meter,
  set,
  highlight,
  callout,
  compare,
  clearMarks,
  good,
  expect,
} from '@/lesson/builders'

const EVENTS = table(
  ['id', 'user', 'price', 'country'],
  [
    row('e1', { id: 1, user: 'ann', price: 12, country: 'US' }),
    row('e2', { id: 2, user: 'bo', price: 40, country: 'US' }),
    row('e3', { id: 3, user: 'cy', price: 7, country: 'US' }),
    row('e4', { id: 4, user: 'di', price: 25, country: 'FR' }),
    row('e5', { id: 5, user: 'ed', price: 18, country: 'FR' }),
    row('e6', { id: 6, user: 'fay', price: 30, country: 'DE' }),
  ],
)

/** The same 24 values, row by row: one block per row (simplified). */
const ROW_BLOCKS = list(
  ['1 ann 12 US', '2 bo 40 US', '3 cy 7 US', '4 di 25 FR', '5 ed 18 FR', '6 fay 30 DE'],
  { ids: ['r1', 'r2', 'r3', 'r4', 'r5', 'r6'] },
)

/** The same 24 values, column by column: one block per column. */
const COLUMN_BLOCKS = list(
  ['1 2 3 4 5 6', 'ann bo cy di ed fay', '12 40 7 25 18 30', 'US US US FR FR DE'],
  { ids: ['id', 'user', 'price', 'country'] },
)

const MAX_BYTES = 96 // 24 values × 4 bytes

export default topic({
  id: 'rows-vs-columns',
  title: 'Rows vs columns',
  goal: 'Learn how the same table is laid out on disk row by row and column by column, and which queries each layout makes cheap.',
  rules: [
    'A row store keeps the values of one row together on disk.',
    'A column store keeps the values of one column together.',
    'A query reads whole blocks. You pay for every value in the blocks you touch, not only the ones you need.',
    'Few columns over many rows: columns win. One whole row by key: rows win.',
  ],
  shape: {
    name: 'events on disk',
    fields: [
      {
        key: 'row block',
        example: '1 ann 12 US',
        role: 'value',
        note: 'one row, all four columns (row store)',
      },
      {
        key: 'column block',
        example: '12 40 7 25 18 30',
        role: 'value',
        note: 'one column, price, all six rows (column store)',
      },
    ],
    note: 'The same 24 values, 4 bytes each (simplified). The layout decides which blocks a query must read.',
  },
  whenToUse: [
    'Analytics: scan a few columns over many rows (sums, averages, group by).',
    'Append-heavy event and log data, where compression matters.',
    'Queries known to touch few columns and many rows.',
  ],
  whenNotToUse: [
    'Fetch or update whole rows by key (OLTP, the app database): many small random writes.',
    'Wide single-row reads: show me this one record.',
    'Small data, where the layout does not matter yet.',
  ],
  realWorld:
    'An events table in ClickHouse, BigQuery or Parquet files, next to the same rows in Postgres.',
  scenes: [
    scene(
      'one-query-two-layouts',
      {
        layout: 'pair',
        actors: [
          server('Row store', { id: 'rows', icon: 'database' }),
          server('Column store', { id: 'cols', icon: 'database' }),
        ],
        boards: [board('events', EVENTS, { label: 'events' })],
      },
      [
        step(
          's01',
          'One table, events: 6 rows, 4 columns, 24 values. Two stores will keep the same data; only the layout on disk differs.',
          highlight('board.events'),
        ),
        step(
          's02',
          'A **row store** keeps the values of one row together on disk: row 1, then row 2, and so on. Six blocks, one per row (simplified).',
          set('rows.disk', ROW_BLOCKS),
          highlight(['board.events[e1]', 'rows.disk[r1]']),
          expect('rows.disk[r1]', '1 ann 12 US'),
        ),
        step(
          's03',
          'A **column store** keeps the values of one column together: all ids, then all users, then all prices, then all countries. Four blocks.',
          set('cols.disk', COLUMN_BLOCKS),
          highlight(['board.events.price', 'cols.disk[price]']),
          expect('cols.disk[price]', '12 40 7 25 18 30'),
        ),
        step(
          's04',
          'Query: the average price, which needs one column, price, from every row. The meters count bytes read, at 4 bytes a value (simplified).',
          callout('board.events', 'SELECT avg(price)', { tone: 'info', sticky: true, id: 'q' }),
          highlight('board.events.price', { sticky: true, id: 'band' }),
          set('rows.read', meter(0, MAX_BYTES, 'bytes read')),
          set('cols.read', meter(0, MAX_BYTES, 'bytes read')),
        ),
        step(
          's05',
          'Row store: every price sits inside its row, so it reads all 6 blocks. 24 values, 96 bytes, to keep 6 of them.',
          highlight('rows.disk', { tone: 'danger' }),
          set('rows.read', meter(96, MAX_BYTES, 'bytes read', { tone: 'danger' })),
          expect('rows.read', 96),
        ),
        step(
          's06',
          'Column store: read the price block only. 6 values, 24 bytes, and the same answer for a quarter of the reading.',
          good('cols.disk[price]'),
          set('cols.read', meter(24, MAX_BYTES, 'bytes read', { tone: 'ok' })),
          compare(['rows.read', 'cols.read'], { expect: 'greater' }),
          expect('cols.read', 24),
        ),
        step(
          's07',
          'With 100 columns the gap is a hundred times. That is why analytics databases store columns.',
          callout('cols.read', '24 vs 96', { tone: 'ok' }),
        ),
        step(
          's08',
          'Bonus: a column holds one kind of value, so it compresses well. US US US FR FR DE shrinks to US×3 FR×2 DE (simplified).',
          set('cols.disk[country]', 'US×3 FR×2 DE'),
          good('cols.disk[country]'),
          expect('cols.disk[country]', 'US×3 FR×2 DE'),
        ),
        step(
          's09',
          'The other query: one whole row, id 3. Row store: one block, 16 bytes; column store: all four blocks, 96 bytes (simplified).',
          clearMarks(),
          callout('board.events', 'SELECT * WHERE id = 3', { tone: 'info', sticky: true, id: 'q' }),
          highlight('board.events[e3]', { sticky: true, id: 'band' }),
          good('rows.disk[r3]'),
          set('rows.read', meter(16, MAX_BYTES, 'bytes read', { tone: 'ok' })),
          highlight('cols.disk', { tone: 'danger' }),
          set('cols.read', meter(96, MAX_BYTES, 'bytes read', { tone: 'danger' })),
          compare(['rows.read', 'cols.read'], { expect: 'less' }),
          expect('rows.read', 16),
          expect('cols.read', 96),
        ),
        step.long(
          's10',
          'Rows for "get this one record", columns for "sum this field over everything". Pick the layout by the question you ask most.',
          clearMarks(),
          callout('rows', 'get this one record', { tone: 'ok', sticky: true }),
          callout('cols', 'sum this field over everything', { tone: 'ok', sticky: true }),
        ),
      ],
    ),
  ],
})
