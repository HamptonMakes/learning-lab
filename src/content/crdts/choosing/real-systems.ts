/**
 * V.4 — Real systems. Mostly boards: one table row per system (Yjs, Automerge, Riak KV, Redis
 * Enterprise, Apple Notes, Figma), plus one small live scene for the server-ordered style, because
 * it is the one people most often mistake for a CRDT. Claims are kept to what each project states
 * publicly; where the public detail is thin (Apple Notes) the narration says so.
 * Storyboard: docs/curriculum/unit-5-prototypes.md §V.4.
 */
import {
  topic,
  scene,
  step,
  alice,
  bob,
  server,
  board,
  table,
  row,
  tick,
  note,
  send,
  deliver,
  insert,
  highlight,
  callout,
  check,
  clearMarks,
  expect,
  good,
  crdt,
  seed,
  lwwMap,
} from '@/lesson/builders'
import type { TableRow } from '@/lesson/types'

const COLUMNS = [
  { key: 'sys', label: 'System' },
  { key: 'uses', label: 'Uses' },
  { key: 'why', label: 'Because' },
]

const ROWS = {
  yjs: row('yjs', { sys: 'Yjs', uses: 'sequence CRDT', why: 'editors, tiny updates' }),
  automerge: row('automerge', {
    sys: 'Automerge',
    uses: 'JSON CRDT + history',
    why: 'local-first apps',
  }),
  riak: row('riak', { sys: 'Riak KV', uses: 'CRDTs in the database', why: 'writes in any region' }),
  redis: row('redis', {
    sys: 'Redis Enterprise',
    uses: 'CRDTs per region',
    why: 'geo-spread keys',
  }),
  notes: row('notes', { sys: 'Apple Notes', uses: 'per-character ids', why: 'offline devices' }),
  figma: row('figma', { sys: 'Figma', uses: 'server-ordered LWW', why: 'a server is always up' }),
}

const systems = (...rows: TableRow[]) =>
  board('sys', table(COLUMNS, rows), { label: 'Who uses it' })

export default topic({
  id: 'real-systems',
  title: 'Real systems',
  goal: 'Learn what Yjs, Automerge, Riak, Redis Enterprise, Apple Notes and Figma use, and which kind of system your own problem needs.',
  rules: [
    'A document library (Yjs, Automerge) when the client must merge on its own, offline included.',
    'A database CRDT type (Riak, Redis Enterprise) when the server holds the data and you want no sync code.',
    'Server-ordered per-field writes (Figma) when a server is always in the path: one order, easy rules.',
    '"Uses CRDTs" does not mean "works offline for weeks". Check what is documented, and the clean-up story.',
  ],
  whenToUse: [
    'A document library (Yjs, Automerge) when the client must keep working alone.',
    'Yjs for editors: rich text, many editor bindings, small binary updates.',
    'Automerge for JSON data with history you can inspect and conflicts you can show.',
    'A database CRDT type (Riak, Redis Enterprise) when the server holds the data.',
    'Server-ordered per-field writes when a server is always in the path anyway.',
  ],
  whenNotToUse: [
    'Every client is always online to one server: server ordering is simpler and cheaper.',
    'A counter that lives in your database: use the database counter, not a document CRDT.',
    '"Uses CRDTs" does not mean "works offline for weeks": check the clean-up story.',
    'Do not copy an app you cannot read the source of; check what is really documented.',
  ],
  realWorld:
    'Yjs and Automerge (libraries), Riak KV and Redis Enterprise Active-Active (databases), Apple Notes (an app syncing over iCloud) and Figma (a design tool with a server in the middle).',
  scenes: [
    scene('libraries-and-databases', { layout: 'row', actors: [], boards: [systems()] }, [
      step(
        's01',
        'Six real systems, four different answers. We fill one row at a time, and say what each of them really does.',
        highlight('board.sys'),
      ),
      step(
        's02',
        'Yjs is a library for collaborative editors. Its text is a sequence CRDT: every character carries the id of the client that typed it.',
        insert('board.sys', ROWS.yjs),
        highlight('board.sys[yjs]'),
      ),
      step(
        's03',
        'Two Yjs peers first swap state vectors — how much each has seen from whom — then send only the missing updates.',
        note('sync', 'Yjs: compare state vectors, send the difference'),
        highlight('board.sys.uses'),
      ),
      step(
        's04',
        'Automerge is a JSON-like document that keeps its history. Every change has a hash, and peers compare heads to find what is missing.',
        insert('board.sys', ROWS.automerge),
        note('sync', 'Automerge: compare heads (hashes), send the difference'),
        highlight('board.sys[automerge]'),
      ),
      step(
        's05',
        'Automerge also keeps the losing side of a concurrent field write, so your app can show a conflict instead of hiding it.',
        callout('board.sys[automerge].uses', 'winner + readable losers'),
      ),
      step(
        's06',
        'Riak KV can hold CRDTs inside the database: counters, sets, flags, registers and maps that merge across regions on their own.',
        clearMarks(),
        insert('board.sys', ROWS.riak),
        highlight('board.sys[riak]'),
      ),
      step(
        's07',
        'A plain Riak value with no type keeps both writes as **sibling**s with a version vector, and your app picks ([Detecting conflicts](/crdts/vector-clocks/detecting-conflicts)).',
        callout('board.sys[riak].uses', 'no type: siblings'),
      ),
      step(
        's08',
        'Redis Enterprise Active-Active does the same per region: counters sum, sets are add-wins, and a plain string write is last-writer-wins (simplified).',
        clearMarks(),
        insert('board.sys', ROWS.redis),
        highlight('board.sys[redis]'),
      ),
      step.long(
        's09',
        'The split so far: a library when the client must merge on its own, a database type when the server holds the data and you want no sync code.',
        highlight('board.sys.uses'),
      ),
    ]),
    scene(
      'two-apps',
      {
        layout: 'hub',
        clock: { show: true },
        actors: [
          server('Figma', { icon: 'cloud' }),
          alice({ icon: 'laptop' }),
          bob({ icon: 'laptop' }),
        ],
        boards: [systems(ROWS.yjs, ROWS.automerge, ROWS.riak, ROWS.redis)],
      },
      [
        step(
          's01',
          'Apple Notes merges edits made on two devices over iCloud, and does not ask you to pick a version when you come back online.',
          insert('board.sys', ROWS.notes),
          highlight('board.sys[notes]'),
        ),
        step(
          's02',
          'What is public here comes from people reading the stored format, not from Apple: the note text carries per-character ids (simplified).',
          callout('board.sys[notes].uses', 'from public reverse-engineering', { tone: 'warn' }),
        ),
        step(
          's03',
          'Figma is the other world. A server is always in the path, and every object is a map of properties.',
          clearMarks(),
          crdt.init(['alice', 'bob', 'server'], 'rect', 'lww-map', {
            seed: [seed('set', 'fill', 'grey'), seed('set', 'x', 0)],
          }),
          highlight('server.rect'),
        ),
        step(
          's04',
          'Alice sets the fill and Bob moves the shape. Both changes go to the server.',
          send('alice', 'server', 'fill = red', { id: 'm1', label: 'fill' }),
          send('bob', 'server', 'x = 10', { id: 'm2', label: 'x' }),
          deliver('m1'),
          deliver('m2'),
        ),
        step(
          's05',
          'Time 1 and 2: the server applies them in the order they arrived, one property at a time.',
          tick(),
          lwwMap('rect').set('server', 'fill', 'red'),
          tick(),
          lwwMap('rect').set('server', 'x', 10),
          expect('server.rect', { fill: 'red', x: 10 }),
        ),
        step(
          's06',
          'It sends the result back. Different properties, so both changes survive — the per-field map of [LWW Map](/crdts/state-based/lww-map).',
          crdt.merge('alice', 'server', 'rect'),
          crdt.merge('bob', 'server', 'rect'),
          good('alice.rect'),
          good('bob.rect'),
          expect('alice.rect', { fill: 'red', x: 10 }),
        ),
        step(
          's07',
          'The same property at once? Time 3 and 4: the server order decides, and the loser sees the colour snap to the winner.',
          clearMarks(),
          send('alice', 'server', 'fill = blue', { id: 'm3', label: 'fill' }),
          send('bob', 'server', 'fill = green', { id: 'm4', label: 'fill' }),
          deliver('m3'),
          tick(),
          lwwMap('rect').set('server', 'fill', 'blue'),
          deliver('m4'),
          tick(),
          lwwMap('rect').set('server', 'fill', 'green'),
          crdt.merge('alice', 'server', 'rect'),
          crdt.merge('bob', 'server', 'rect'),
          highlight(['alice.rect.fill', 'bob.rect.fill']),
          expect('alice.rect.fill', 'green'),
        ),
        step(
          's08',
          'Moving a layer writes a parent and a position on the object, never a delete plus an insert — the fix from [Composing a document](/crdts/choosing/composing-a-document).',
          clearMarks(),
          send('alice', 'server', 'parent = group-2', { id: 'm5', label: 'move' }),
          deliver('m5'),
          tick(),
          lwwMap('rect').set('server', 'parent', 'group-2'),
          lwwMap('rect').set('server', 'pos', 0.5),
          crdt.merge('alice', 'server', 'rect'),
          crdt.merge('bob', 'server', 'rect'),
          expect('alice.rect.parent', 'group-2'),
        ),
        step(
          's09',
          'Figma calls this CRDT-inspired: with one server as the one order, you keep the easy rules and skip the hard parts.',
          insert('board.sys', ROWS.figma),
          callout('server', 'the server is the one order', { sticky: true, id: 'k1' }),
          highlight('board.sys[figma]'),
        ),
        step.long(
          's10',
          'Know which world you are in. No server in the write path means you carry the merge rules; a server always there means you can borrow its order.',
        ),
      ],
    ),
    scene(
      'which-would-you-pick',
      {
        layout: 'row',
        actors: [],
        boards: [
          board(
            'pick',
            table(
              [
                { key: 'need', label: 'You need' },
                { key: 'pick', label: 'Reach for' },
                { key: 'why', label: 'Because' },
              ],
              [],
            ),
            { label: 'Reach for' },
          ),
        ],
      },
      [
        step(
          's01',
          'Four situations. For each one, name the kind of system you would reach for first.',
          highlight('board.pick'),
        ),
        step(
          's02',
          'A notes app that works offline for days: a document library. Yjs for the editor, Automerge when you want the history.',
          insert(
            'board.pick',
            row('p1', {
              need: 'offline notes app',
              pick: 'Yjs or Automerge',
              why: 'merges on the device',
            }),
          ),
          highlight('board.pick[p1]'),
        ),
        step(
          's03',
          'A like counter across regions: a database counter type. No merge code in the app at all.',
          insert(
            'board.pick',
            row('p2', {
              need: 'counter across regions',
              pick: 'Riak or Redis type',
              why: 'the DB merges it',
            }),
          ),
          highlight('board.pick[p2]'),
        ),
        step(
          's04',
          'A design tool where a server is always present: per-property last-writer-wins in the server order.',
          insert(
            'board.pick',
            row('p3', {
              need: 'design tool + server',
              pick: 'server-ordered LWW',
              why: 'one order, easy rules',
            }),
          ),
          highlight('board.pick[p3]'),
        ),
        step(
          's05',
          'A shared grid of cells: a map of registers, one per cell, in a document library.',
          insert(
            'board.pick',
            row('p4', {
              need: 'shared grid of cells',
              pick: 'map of registers',
              why: 'per-cell newest wins',
            }),
          ),
          highlight('board.pick[p4]'),
        ),
        step.long(
          's06',
          'The pattern: a library when the client must work alone, a database type when the server holds the data, server ordering when the server is always there.',
          check('board.pick'),
        ),
      ],
      { inContext: true },
    ),
  ],
})
