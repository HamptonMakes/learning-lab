/**
 * I.4 — Transactions vs merges. Sort data by what a wrong answer costs: the same race
 * on a balance and on a shopping list (`money-vs-list`), then one online order sorted field by
 * field into a decision table (`sort-the-order`, in context). Plain values; the "good" merge of
 * the list is written by hand and the narration says so. Storyboard: docs/curriculum/unit-1-2.md §I.4.
 */
import {
  topic,
  scene,
  step,
  alice,
  bob,
  server,
  board,
  rec,
  sset,
  table,
  row,
  set,
  insert,
  note,
  highlight,
  callout,
  conflict,
  clearMarks,
  same,
  expect,
} from '@/lesson/builders'

const holds = () => ({ account: rec({ balance: 100 }), list: sset(['bread']) })

export default topic({
  id: 'not-everything-needs-a-transaction',
  title: 'Transactions vs merges',
  goal: 'Learn how to sort fields by what a wrong answer costs, so you know which need a transaction and which can merge.',
  rules: [
    'Sort each field by what a wrong answer costs.',
    'Money, seats, coupons: a wrong answer hurts. Use a transaction; writers take turns.',
    'Lists, labels, counts: wrong for a moment is fine. Merge; nobody waits.',
    'Most apps are mostly merge, with a little transaction.',
  ],
  shape: {
    name: 'Two kinds of data',
    fields: [
      {
        key: 'balance',
        example: '100',
        role: 'value',
        note: 'two copies both take 80: a wrong answer costs money',
      },
      {
        key: 'list',
        example: 'bread',
        role: 'value',
        note: 'two copies add milk and eggs: keep both',
      },
    ],
  },
  whenToUse: [
    'Money could be lost or created.',
    'Something could be given away twice (one seat, one username, one coupon).',
    'Several fields must change together (a debit without its credit is wrong).',
  ],
  whenNotToUse: [
    'The data is a set of things people add (list items, tags, comments): merge.',
    'A label or preference where newest wins is fine (title, status, color): merge.',
    'A count may lag for a moment (likes, views): merge.',
    'People expect to keep working offline.',
  ],
  realWorld:
    'An online shop: payment needs a transaction; the cart, the wish list and the delivery note do not.',
  scenes: [
    scene(
      'money-vs-list',
      {
        layout: 'pair',
        actors: [alice({ holds: holds() }), bob({ holds: holds() })],
      },
      [
        step(
          's01',
          'Two kinds of data, two copies each. No lock this time.',
          highlight(['alice.account', 'bob.account', 'alice.list', 'bob.list']),
        ),
        step(
          's02',
          'Both take 80 from the account at the same time. Each copy checks 100, says yes, and writes 20.',
          set('alice.account.balance', 20),
          set('bob.account.balance', 20),
        ),
        step.long(
          's03',
          'Whoops — put the copies together and the truth is -60. Real money is gone.',
          conflict('alice.account.balance', 'bob.account.balance'),
          callout('alice.account.balance', 'true balance: -60', { tone: 'danger' }),
        ),
        step(
          's04',
          'Now the shopping list. Alice adds milk; Bob adds eggs, at the same time.',
          clearMarks(),
          insert('alice.list', 'milk'),
          insert('bob.list', 'eggs'),
        ),
        step(
          's05',
          'Put these together and the right answer is obvious: keep both. We merged by hand here (simplified); in Unit II a rule will compute it.',
          insert('alice.list', 'eggs'),
          insert('bob.list', 'milk'),
          same('alice.list', 'bob.list'),
          expect('alice.list', ['bread', 'eggs', 'milk']),
        ),
        step(
          's06',
          'The difference is cost. A wrong balance hurts; a list that is wrong for a moment does not.',
          clearMarks(),
          callout('alice.account.balance', 'needs a transaction', { tone: 'danger', sticky: true }),
          callout('alice.list', 'can merge', { tone: 'ok', sticky: true }),
        ),
        step.long(
          's07',
          'Sort your data by what a wrong answer costs. Only some of it needs a **transaction**; the rest can merge.',
          note('rule', 'Sort data by the cost of a wrong answer: transaction, or merge.'),
        ),
      ],
    ),
    scene(
      'sort-the-order',
      {
        layout: 'row',
        actors: [
          server('Shop', {
            icon: 'cloud',
            holds: {
              order: rec({
                payment: 'pending',
                items: '2 items',
                note: 'ring the bell',
                stock: '4 left',
                coupon: 'unused',
              }),
            },
          }),
        ],
        boards: [board('sort', table(['field', 'answer'], []), { label: 'Sorted' })],
      },
      [
        step(
          's01',
          'One online order with five fields. Sort each one: transaction, or merge?',
          highlight('server.order'),
        ),
        step(
          's02',
          'Payment: charged twice or never is a disaster. Transaction.',
          highlight('server.order.payment', { tone: 'danger' }),
          insert('board.sort', row('payment', { field: 'payment', answer: 'transaction' })),
        ),
        step(
          's03',
          'Items in the cart: adds from phone and laptop should combine. Merge.',
          highlight('server.order.items', { tone: 'ok' }),
          insert('board.sort', row('items', { field: 'items', answer: 'merge' })),
        ),
        step(
          's04',
          'Delivery note: newest text wins is fine. Merge.',
          highlight('server.order.note', { tone: 'ok' }),
          insert('board.sort', row('note', { field: 'note', answer: 'merge (newest wins)' })),
        ),
        step(
          's05',
          'Coupon: it may be used once only. Transaction.',
          highlight('server.order.coupon', { tone: 'danger' }),
          insert('board.sort', row('coupon', { field: 'coupon', answer: 'transaction' })),
        ),
        step(
          's06',
          'Stock count: it depends. One extra T-shirt sold is fine; one extra concert seat is not.',
          highlight('server.order.stock', { tone: 'warn' }),
          insert('board.sort', row('stock', { field: 'stock', answer: 'depends on cost' })),
        ),
        step.long(
          's07',
          'Most apps are mostly merge with a little transaction. The rest of this course is about the merge part.',
          highlight('board.sort'),
        ),
      ],
      { inContext: true },
    ),
  ],
})
