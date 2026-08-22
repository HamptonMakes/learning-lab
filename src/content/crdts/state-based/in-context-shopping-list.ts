/**
 * II.10 — In context: a shared shopping list. One composed document (`crdt.doc`): an LWW title,
 * an OR-Set of items, and per item an LWW name and a PN-Counter qty. A phone and a laptop edit
 * offline and sync through a server; each part merges by its own rule. Scenes: `build-it`,
 * `offline-weekend` (title race, remove, counter), `one-more-race` (remove vs edit-inside).
 */
import {
  topic,
  scene,
  step,
  alice,
  bob,
  server,
  highlight,
  callout,
  conflict,
  cross,
  clearMarks,
  same,
  tomb,
  tick,
  offline,
  online,
  crdt,
  doc,
  seed,
  S,
  syncAll,
  expect,
} from '@/lesson/builders'

const listSchema = { title: S.lww(), items: S.set(S.map({ name: S.lww(), qty: S.pn() })) }

/** Alice (phone) and Bob (laptop) both sync through the server, Alice last so all three agree. */
const syncRound = () => syncAll('list', ['alice', 'server'], ['bob', 'server'], ['alice', 'server'])

export default topic({
  id: 'in-context-shopping-list',
  title: 'In context: a shared shopping list',
  goal: 'Compose LWW fields, an OR-Set and PN-Counters into one document, and predict how each part merges.',
  whenToUse: [
    'Shared lists and boards edited offline: groceries, packing, chores.',
    'Each piece of data has an obvious right merge when you look at it alone.',
    'A short window of disagreement is acceptable.',
  ],
  whenNotToUse: [
    'The list has a strict order that both users reorder (a sequence CRDT, Unit III).',
    'Quantities are inventory with a hard floor.',
    'You need an audit log of who did what (operations, Unit III).',
  ],
  realWorld:
    'Shared grocery apps such as Apple Reminders lists, AnyList or Bring!, editing offline on two phones.',
  scenes: [
    scene(
      'build-it',
      {
        layout: 'hub',
        clock: { show: true },
        actors: [server(), alice({ icon: 'phone' }), bob({ icon: 'laptop' })],
      },
      [
        step(
          's01',
          'One shared list. The title is an LWW register; the items are an **OR-Set**; each item has a name (LWW) and a qty (**PN-Counter**).',
          crdt.doc(['server', 'alice', 'bob'], 'list', listSchema, {
            seed: [seed.at('title', 'set', 'Groceries')],
          }),
          expect('alice.list.title', 'Groceries'),
        ),
        step(
          's02',
          'Alice adds milk. The new item gets the tag alice:1 as its id, and its qty starts at 0.',
          doc('list').at('items').add('alice', { name: 'milk' }),
          highlight('alice.list.items[alice:1]@tags'),
          expect('alice.list.items[alice:1].name', 'milk'),
          expect('alice.list.items[alice:1].qty', 0),
        ),
        step(
          's03',
          'She sets qty to 2: two increments on the milk counter, in her own row.',
          doc('list').at('items[alice:1].qty').inc('alice', 2),
          expect('alice.list.items[alice:1].qty', 2),
        ),
        step(
          's04',
          'Bob adds eggs (tag bob:1) with qty 12.',
          doc('list').at('items').add('bob', { name: 'eggs' }),
          doc('list').at('items[bob:1].qty').inc('bob', 12),
          highlight('bob.list.items[bob:1]@tags'),
          expect('bob.list.items[bob:1].qty', 12),
        ),
        step(
          's05',
          'Both sync through the server. The item set unions; each qty merges row by row; the title is untouched so far.',
          syncRound(),
          same('server.list', 'alice.list', 'bob.list'),
          expect('alice.list.items[bob:1].qty', 12),
          expect('bob.list.items[alice:1].qty', 2),
        ),
        step(
          's06',
          'Look at the sidecar: a stamp on the title, a tag on each item, a per-node row in each qty. Each part carries what its rule needs.',
          highlight([
            'alice.list.title@ts',
            'alice.list.items[alice:1]@tags',
            'alice.list.items[alice:1].qty',
          ]),
        ),
        step.long(
          's07',
          'Every part brought its own merge rule, so the whole document has one. Now let us break the network.',
        ),
      ],
      { inContext: true },
    ),
    scene(
      'offline-weekend',
      null,
      [
        step(
          's01',
          'Saturday: both devices lose the server. They keep editing their own copies.',
          clearMarks(),
          offline('alice'),
          offline('bob'),
        ),
        step(
          's02',
          'At t=1 Alice renames the list to Party shop and adds one more milk: her qty reads 3.',
          tick(),
          doc('list').at('title').set('alice', 'Party shop'),
          doc('list').at('items[alice:1].qty').inc('alice', 1),
          expect('alice.list.title', 'Party shop'),
          expect('alice.list.title@ts', 1),
          expect('alice.list.items[alice:1].qty', 3),
        ),
        step(
          's03',
          'At t=2 Bob buys the eggs and removes them. He also drops milk by one: his qty reads 1.',
          tick(),
          doc('list').at('items').remove('bob', 'bob:1'),
          doc('list').at('items[alice:1].qty').dec('bob', 1),
          tomb('bob.list.items[bob:1]'),
          expect('bob.list.items[bob:1]@tomb', true),
          expect('bob.list.items[alice:1].qty', 1),
        ),
        step(
          's04',
          'At t=3 Bob renames the list too: Sat shopping. Two titles, one race.',
          tick(),
          doc('list').at('title').set('bob', 'Sat shopping'),
          conflict('alice.list.title', 'bob.list.title'),
          expect('bob.list.title@ts', 3),
        ),
        step(
          's05',
          'Sunday: both come back online and sync through the server. Watch each part.',
          clearMarks(),
          online('alice'),
          online('bob'),
          syncRound(),
        ),
        step(
          's06',
          'Title: LWW. Sat shopping carries t=3, the newest stamp, so it wins on every copy — and nobody was asked.',
          highlight('alice.list.title@ts'),
          expect('alice.list.title', 'Sat shopping'),
          expect('server.list.title', 'Sat shopping'),
        ),
        step(
          's07',
          'Eggs: OR-Set. Bob dropped the only tag, bob:1, and nobody added eggs again, so eggs are gone everywhere.',
          highlight('alice.list.items[bob:1]@tomb', { tone: 'warn' }),
          expect('alice.list.items[bob:1]@tomb', true),
          expect('server.list.items[bob:1]@tomb', true),
        ),
        step(
          's08',
          'Milk qty is a PN-Counter: Alice +3 in her row, Bob −1 in his, total 2. Both edits counted; nothing was overwritten.',
          highlight('alice.list.items[alice:1].qty'),
          callout('alice.list.items[alice:1].qty', '3 − 1 = 2', { tone: 'info' }),
          expect('alice.list.items[alice:1].qty', 2),
        ),
        step(
          's09',
          'Every copy agrees: Sat shopping, milk with qty 2, no eggs. No lock, no lost edit, no conflict screen.',
          clearMarks(),
          same('server.list', 'alice.list', 'bob.list'),
          expect('bob.list.items[alice:1].qty', 2),
        ),
        step.long(
          's10',
          'Each part merged by its own rule, so the document as a whole did too. Composition is how real apps use CRDTs.',
        ),
      ],
      { startFrom: 'build-it', inContext: true },
    ),
    scene(
      'one-more-race',
      null,
      [
        step(
          's01',
          'One last race. Alice removes milk from her phone: she drops its tag, alice:1.',
          doc('list').at('items').remove('alice', 'alice:1'),
          tomb('alice.list.items[alice:1]'),
          expect('alice.list.items[alice:1]@tomb', true),
        ),
        step(
          's02',
          'At the same time, on the laptop, Bob bumps milk to qty 3. Neither has seen the other.',
          doc('list').at('items[alice:1].qty').inc('bob', 1),
          highlight('bob.list.items[alice:1].qty'),
          conflict('alice.list.items[alice:1]', 'bob.list.items[alice:1]'),
          expect('bob.list.items[alice:1].qty', 3),
        ),
        step(
          's03',
          "They sync. Membership is the OR-Set's call: Alice dropped the only tag and Bob added none, so milk is gone, counter and all.",
          clearMarks(),
          syncRound(),
          same('server.list', 'alice.list', 'bob.list'),
          expect('bob.list.items[alice:1]@tomb', true),
          expect('server.list.items[alice:1]@tomb', true),
        ),
        step(
          's04',
          "Whoops — Bob's +1 vanished with the item. An edit inside an element does not protect it from a remove.",
          cross('bob.list.items[alice:1]'),
          callout('bob.list.items[alice:1]', 'edit-inside lost to remove', { tone: 'warn' }),
        ),
        step(
          's05',
          'The fix, if any edit should keep the item: the app re-adds on edit, with a new tag. That is an app rule on top of the CRDT.',
          clearMarks(),
          callout('bob.list.items', 're-add on edit = new tag', { tone: 'info' }),
        ),
        step.long(
          's06',
          'Removing an item beats editing inside it. Decide whether that is what you want before you ship the schema.',
        ),
      ],
      { startFrom: 'offline-weekend', inContext: true },
    ),
  ],
})
