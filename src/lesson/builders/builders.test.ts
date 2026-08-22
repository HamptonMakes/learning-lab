import { describe, expect, it } from 'vitest'
import { uuidV7 } from '@/uuid'
import {
  ActorSpecSchema,
  BoardSchema,
  COMMAND_TS,
  CommandSchema,
  CrdtSchemaSchema,
  SceneSchema,
  SeedOpSchema,
  StepSchema,
  ValueSchema,
  validateTopic,
} from '../schema'
import type { Command, CommandT } from '../types'
import {
  S,
  alice,
  allSame,
  annotate,
  apply,
  applyAll,
  bad,
  board,
  bob,
  broadcastState,
  bytes,
  callout,
  carol,
  check,
  clearMarks,
  clockOf,
  cnt,
  compare,
  conflict,
  crdt,
  cross,
  dana,
  del,
  deliver,
  device,
  doc,
  drop,
  duplicate,
  expect as expectEq,
  flattenCommands,
  gcounter,
  good,
  gset,
  highlight,
  hlc,
  insert,
  lamport,
  layout,
  list,
  lww,
  lwwMap,
  lwwSet,
  maxReg,
  merge,
  meter,
  move,
  mvReg,
  note,
  offline,
  online,
  opcounter,
  orSet,
  p,
  patch,
  pncounter,
  rec,
  ref,
  regex,
  relay,
  remove,
  removeBoard,
  rga,
  row,
  same,
  scalar,
  scene,
  seed,
  send,
  sendAndDeliver,
  server,
  service,
  set,
  skew,
  sort,
  spawn,
  sset,
  status,
  step,
  syncAll,
  table,
  text,
  tick,
  toValue,
  tomb,
  topic,
  twoPSet,
  unannotate,
  unmark,
  uuid,
  vclock,
  view,
} from './index'

const valid = (cmd: Command): Command => {
  const r = CommandSchema.safeParse(cmd)
  if (!r.success) throw new Error(`${cmd.t}: ${r.error.issues.map((i) => i.message).join('; ')}`)
  return cmd
}

/** One example per helper; the schema must accept each and the `t`s must cover all 43 commands. */
const EXAMPLES: Command[] = [
  spawn(carol()),
  remove('carol'),
  removeBoard('rule'),
  layout('ring', { hub: 'server' }),
  tick(),
  tick(150),
  skew('alice', 5),
  offline('alice'),
  online('alice'),
  status('alice', 'lock'),
  status('alice', null),
  note('rule', 'merge(a, b) = max(a, b)'),
  note('rule', 'law 1', { tone: 'info', label: 'rule', textId: 'rule.law1' }),
  set('alice.doc.title', 'Q3 plan v2'),
  set('laptop.id[0..6]', [0x01, 0xa0, 0x28, 0xe9, 0xb5, 0x00]),
  set('alice.n', scalar(1, { ts: 2, node: 'bob' }), { quiet: true }),
  patch('bob.likes', { tag: 'alice:1' }),
  insert('alice.list', 'milk', { index: 1 }),
  insert('alice.tbl', row('r3', { how: 'x' })),
  del('alice.list[milk]'),
  del('alice.list[milk]', { tombstone: true, quiet: true }),
  move('bob.inbox[alice:2]', 1),
  sort('server.chat', ['@ts', '@node', '.price', 'value', 'id']),
  annotate('laptop.id', 48, 52, 'version = 4', { unit: 'bit', tone: 'change', id: 'ver' }),
  annotate('laptop.id', 0, 6),
  unannotate('laptop.id'),
  unannotate('laptop.id', 'rand'),
  view('laptop.id', 'canonical'),
  view('laptop.id', 'bits', [6, 9]),
  send('alice', 'server', ref('alice.doc'), { id: 'm3', label: 'save', into: 'server.doc' }),
  send('server', ['alice', 'bob'], 'wait', { id: 'm4', stamp: 'clock' }),
  deliver('m3'),
  deliver('m3', { into: 'server.doc', park: true, recv: 'clock' }),
  drop('m1'),
  duplicate('op1', 'op1-retry'),
  relay('m-l@icloud', ['phone']),
  relay('m-l@icloud', 'phone', { into: 'phone.doc' }),
  highlight('bob.status@ts'),
  highlight(['a.x', 'b.x'], { tone: 'warn', sticky: true, id: 'h1' }),
  callout('server.doc.title', 'last write silently won', { tone: 'warn', sticky: true, id: 'c1' }),
  conflict('alice.doc.title', 'bob.doc.title'),
  compare(['alice.A', 'bob.B'], { expect: 'concurrent' }),
  same('alice.tags', 'bob.tags', 'carol.tags'),
  check('alice.x'),
  cross('alice.x', { sticky: true }),
  clearMarks(),
  unmark('c1'),
  expectEq('alice.likes', 2),
  crdt.init(['alice', 'bob'], 'status', 'lww-register', { seed: [seed('set', 'Offline')] }),
  crdt.doc(['alice', 'bob'], 'list', {
    title: S.lww(),
    items: S.set(S.map({ name: S.lww(), qty: S.pn() })),
  }),
  crdt.update('alice', 'status', 'set', 'In a meeting'),
  crdt.updateAt('alice', 'list', 'items[alice:1].qty', 'inc', 2),
  crdt.updateWith({ actor: 'alice', slot: 'x', op: 'set', args: [1], ts: 5, quiet: true }),
  crdt.send('alice', 'bob', 'status', { id: 'm1', mode: 'delta', label: 'state' }),
  crdt.send('alice', ['bob', 'carol'], 'status'),
  crdt.broadcast('alice', 'likes', { to: ['server'] }),
  crdt.broadcast('alice', 'likes'),
  crdt.merge('bob', 'alice', 'status'),
  crdt.sync('alice', 'bob', 'status'),
  crdt.sync('alice', 'server', 'note', { mode: 'ops' }),
  crdt.gc('alice', 'text', { upTo: { alice: 4, bob: 0, carol: 0 } }),
  crdt.gc('alice', 'text', { unsafe: true }),
  regex.init('matcher', 'ca*t', 'the cat sat'),
  regex.init('matcher', 'a', 'b', 'i'),
  regex.advance('matcher', 'backtrack'),
  lww('status').set('alice', 'In a meeting'),
  lwwMap('task').set('bob', 'status', 'Doing'),
  lwwMap('task').remove('bob', 'due'),
  maxReg('best').set('alice', 3),
  mvReg('cart').set('alice', 'milk, eggs'),
  gcounter('views').inc('alice', 2),
  gcounter('views').inc('alice'),
  pncounter('likes').dec('alice'),
  opcounter('likes').inc('alice'),
  gset('seen').add('alice', 'm1'),
  twoPSet('guests').remove('bob', 'dan'),
  lwwSet('fav').add('alice', 'jazz'),
  orSet('cart').remove('bob', 'milk'),
  rga('text').insertAfter('bob', 'alice:1', 'h'),
  rga('text').insertAt('bob', 0, 'h'),
  rga('text').type('alice', 'alice:5', ' world'),
  rga('text').delete('alice', 'alice:1'),
  rga('text').deleteAt('alice', 0),
  rga('text').deleteRange('alice', 'alice:1', 'alice:4'),
  vclock('vc').tick('alice'),
  lamport('clock').tick('carol'),
  hlc('hlc').tick('bob'),
  doc('list').at('items[alice:1].qty').inc('bob', 1),
  doc('list').at('items').add('alice', { name: 'milk' }),
  doc('list').at('items').remove('bob', 'bob:1'),
  good('alice.x'),
  tomb('bob.cart[milk]'),
  apply('alice:1@bob'),
  merge('m1'),
  ...bad('bob.doc', 'stale'),
  ...bad('bob.doc'),
  ...syncAll('card', ['alice', 'server'], ['bob', 'server']),
  ...broadcastState('carol', ['alice', 'bob'], 'views', 'm3'),
  ...allSame('views', ['alice', 'bob', 'carol']),
  ...applyAll(['alice:6', 'alice:7']),
  ...sendAndDeliver('alice', 'server', ref('alice.doc'), { id: 'm3', into: 'server.doc' }),
]

describe('command builders', () => {
  it('every example passes the command schema', () => {
    for (const cmd of EXAMPLES) valid(cmd)
  })

  it('cover all 43 command discriminants', () => {
    const used = new Set<CommandT>(EXAMPLES.map((c) => c.t))
    const missing = COMMAND_TS.filter((t) => !used.has(t))
    expect(missing).toEqual([])
    expect(COMMAND_TS).toHaveLength(43)
  })

  it('produce the literal a human would write (no undefined keys, no methods)', () => {
    expect(tick()).toEqual({ t: 'tick' })
    expect(Object.keys(tick())).toEqual(['t'])
    expect(layout('triangle')).toEqual({ t: 'layout', preset: 'triangle' })
    expect(note('rule', 'x')).toEqual({ t: 'note', id: 'rule', text: 'x' })
    expect(highlight('a.x')).toEqual({ t: 'highlight', path: 'a.x' })
    expect(deliver('m1')).toEqual({ t: 'deliver', message: 'm1' })
    expect(crdt.sync('alice', 'bob', 'x')).toEqual({
      t: 'crdt.sync',
      a: 'alice',
      b: 'bob',
      slot: 'x',
    })
    for (const cmd of EXAMPLES) {
      expect(JSON.parse(JSON.stringify(cmd))).toEqual(cmd)
      for (const v of Object.values(cmd)) expect(typeof v).not.toBe('function')
    }
  })

  it('del builds a delete; same builds compare expect equal; aliases resolve', () => {
    expect(del('a.list[x]')).toEqual({ t: 'delete', path: 'a.list[x]' })
    expect(same('a.x', 'b.x')).toEqual({ t: 'compare', paths: ['a.x', 'b.x'], expect: 'equal' })
    expect(apply('alice:1@bob')).toEqual({ t: 'deliver', message: 'alice:1@bob' })
    expect(merge('m1')).toEqual(deliver('m1'))
    expect(good('a.x')).toEqual({ t: 'highlight', path: 'a.x', tone: 'ok' })
    expect(tomb('a.list[x]')).toEqual({ t: 'highlight', path: 'a.list[x]@tomb', tone: 'warn' })
    expect(bad('b.doc', 'stale')).toEqual([
      { t: 'highlight', path: 'b.doc', tone: 'danger' },
      { t: 'callout', at: 'b.doc', text: 'stale', tone: 'danger' },
    ])
    expect(bad('b.doc')).toEqual([{ t: 'highlight', path: 'b.doc', tone: 'danger' }])
    expect(ref('a.doc')).toEqual({ ref: 'a.doc' })
    expect(p('a.doc')).toBe('a.doc')
  })

  it('set wraps a number[] (byte range) into a bytes Value and keeps scalars raw', () => {
    expect(set('a.id[0..2]', [1, 2])).toEqual({
      t: 'set',
      path: 'a.id[0..2]',
      value: { kind: 'bytes', bytes: [1, 2], display: 'hex', annotations: [] },
    })
    expect(set('a.x', 'Q3')).toEqual({ t: 'set', path: 'a.x', value: 'Q3' })
  })

  it('send/relay copy actor arrays; highlight/compare copy path arrays', () => {
    const to = ['alice', 'bob']
    const cmd = send('server', to, 'x', { id: 'm1' })
    expect(cmd.to).toEqual(to)
    expect(cmd.to).not.toBe(to)
    const paths = ['a.x', 'b.x']
    expect(highlight(paths).path).not.toBe(paths)
    expect(compare(paths).paths).not.toBe(paths)
  })
})

describe('crdt builders', () => {
  it('spread args; omit args when empty; updateAt carries path; updateWith carries ts/quiet', () => {
    expect(crdt.update('alice', 'status', 'set', 'In a meeting')).toEqual({
      t: 'crdt.update',
      actor: 'alice',
      slot: 'status',
      op: 'set',
      args: ['In a meeting'],
    })
    expect(gcounter('views').inc('alice')).toEqual({
      t: 'crdt.update',
      actor: 'alice',
      slot: 'views',
      op: 'inc',
    })
    expect(vclock('vc').tick('alice')).toEqual({
      t: 'crdt.update',
      actor: 'alice',
      slot: 'vc',
      op: 'tick',
    })
    expect(crdt.updateAt('alice', 'list', 'items[alice:1].qty', 'inc', 2)).toEqual({
      t: 'crdt.update',
      actor: 'alice',
      slot: 'list',
      path: 'items[alice:1].qty',
      op: 'inc',
      args: [2],
    })
    expect(lww('status').set('alice', 'x', { ts: 7, quiet: true })).toMatchObject({
      ts: 7,
      quiet: true,
    })
    expect(doc('list').at('items').add('alice', { name: 'milk' })).toEqual({
      t: 'crdt.update',
      actor: 'alice',
      slot: 'list',
      path: 'items',
      op: 'add',
      args: [{ name: 'milk' }],
    })
  })

  it('typed sugar emits the per-type op names of §5.1', () => {
    expect(lwwMap('t').set('bob', 'status', 'Doing')).toMatchObject({
      op: 'set',
      args: ['status', 'Doing'],
    })
    expect(lwwMap('t').remove('bob', 'due')).toMatchObject({ op: 'remove', args: ['due'] })
    expect(pncounter('l').dec('alice')).toMatchObject({ op: 'dec' })
    expect(opcounter('l').inc('alice', 3)).toMatchObject({ op: 'inc', args: [3] })
    expect(twoPSet('g').remove('bob', 'dan')).toMatchObject({ op: 'remove', args: ['dan'] })
    expect(orSet('c').add('alice', 'milk')).toMatchObject({ op: 'add', args: ['milk'] })
    expect(rga('x').insertAfter('bob', 'alice:1', 'h')).toMatchObject({
      op: 'insertAfter',
      args: ['alice:1', 'h'],
    })
    expect(rga('x').type('alice', 'HEAD', 'hi')).toMatchObject({ op: 'type', args: ['HEAD', 'hi'] })
    expect(rga('x').deleteRange('alice', 'alice:1', 'alice:3')).toMatchObject({
      op: 'deleteRange',
      args: ['alice:1', 'alice:3'],
    })
    expect(hlc('h').tick('bob')).toMatchObject({ op: 'tick', slot: 'h', actor: 'bob' })
    expect(maxReg('m').set('alice', 3)).toMatchObject({ op: 'set', args: [3] })
    expect(mvReg('m').set('alice', 'a')).toMatchObject({ op: 'set', args: ['a'] })
  })

  it('seed helpers', () => {
    expect(seed('set', 'Offline')).toEqual({ op: 'set', args: ['Offline'] })
    expect(seed('tick')).toEqual({ op: 'tick' })
    expect(seed.by('alice', 'add', 'milk')).toEqual({ by: 'alice', op: 'add', args: ['milk'] })
    expect(seed.at('title', 'set', 'Groceries')).toEqual({
      path: 'title',
      op: 'set',
      args: ['Groceries'],
    })
    expect(seed.text('alice', 'cat')).toEqual({ by: 'alice', op: 'type', args: ['HEAD', 'cat'] })
    for (const s of [
      seed('set', 1),
      seed.by('a', 'x'),
      seed.at('p', 'x', 1),
      seed.text('a', 'b'),
    ]) {
      expect(SeedOpSchema.safeParse(s).success).toBe(true)
    }
  })

  it('S.* schema builders are bare names without args and { type, args } with', () => {
    expect(S.lww()).toBe('lww-register')
    expect(S.lwwMap()).toBe('lww-map')
    expect(S.pn()).toBe('pn-counter')
    expect(S.g()).toBe('g-counter')
    expect(S.orSet()).toBe('or-set')
    expect(S.mvr()).toBe('mv-register')
    expect(S.max()).toBe('max-register')
    expect(S.lwwSet()).toBe('lww-element-set')
    expect(S.twoP()).toBe('two-phase-set')
    expect(S.gset()).toBe('g-set')
    expect(S.vclock()).toBe('vector-clock')
    expect(S.lamport()).toBe('lamport-clock')
    expect(S.hlc()).toBe('hlc')
    expect(S.opCounter()).toBe('op-counter')
    expect(S.rga({ display: 'text' })).toEqual({ type: 'rga', args: { display: 'text' } })
    expect(S.const('Lunch?')).toEqual({ const: 'Lunch?' })
    const schema = S.map({
      title: S.lww(),
      items: S.set(S.map({ qty: S.pn() })),
      log: S.list(S.lww()),
    })
    expect(schema).toEqual({
      map: {
        title: 'lww-register',
        items: { set: { map: { qty: 'pn-counter' } } },
        log: { list: 'lww-register' },
      },
    })
    expect(CrdtSchemaSchema.safeParse(schema).success).toBe(true)
  })
})

describe('macros', () => {
  it('expand to the plain command lists a human would write', () => {
    expect(syncAll('card', ['alice', 'server'], ['bob', 'server'])).toEqual([
      crdt.sync('alice', 'server', 'card'),
      crdt.sync('bob', 'server', 'card'),
    ])
    expect(broadcastState('carol', ['alice', 'bob'], 'views', 'm3')).toEqual([
      crdt.send('carol', ['alice', 'bob'], 'views', { id: 'm3' }),
      deliver('m3@alice'),
      deliver('m3@bob'),
    ])
    expect(allSame('views', ['alice', 'bob', 'carol'])).toEqual([
      compare(['alice.views', 'bob.views', 'carol.views'], { expect: 'equal' }),
    ])
    expect(applyAll(['alice:6', 'alice:7', 'alice:8'])).toEqual([
      deliver('alice:6'),
      deliver('alice:7'),
      deliver('alice:8'),
    ])
    expect(
      sendAndDeliver('alice', 'server', ref('alice.doc'), { id: 'm3', into: 'server.doc' }),
    ).toEqual([
      send('alice', 'server', ref('alice.doc'), { id: 'm3', into: 'server.doc' }),
      deliver('m3'),
    ])
    expect(sendAndDeliver('server', ['alice', 'bob'], 'go', { id: 'm9' })).toEqual([
      send('server', ['alice', 'bob'], 'go', { id: 'm9' }),
      deliver('m9@alice'),
      deliver('m9@bob'),
    ])
  })
})

describe('step / scene / topic', () => {
  it('step flattens nested arrays and sets hold via step.long / step.short', () => {
    const s = step(
      's01',
      'Say.',
      tick(),
      [highlight('a.x'), [check('a.x'), bad('b.x', 'no')]],
      allSame('v', ['a', 'b']),
    )
    expect(s).toEqual({
      id: 's01',
      say: 'Say.',
      do: [
        tick(),
        highlight('a.x'),
        check('a.x'),
        highlight('b.x', { tone: 'danger' }),
        callout('b.x', 'no', { tone: 'danger' }),
        compare(['a.v', 'b.v'], { expect: 'equal' }),
      ],
    })
    expect(step('s02', 'Nothing.')).toEqual({ id: 's02', say: 'Nothing.', do: [] })
    expect(step.long('s03', 'Long.')).toEqual({ id: 's03', say: 'Long.', do: [], hold: 'long' })
    expect(step.short('s04', 'Short.', tick())).toEqual({
      id: 's04',
      say: 'Short.',
      do: [tick()],
      hold: 'short',
    })
    expect(flattenCommands([[tick()], [[tick(2)]]])).toEqual([tick(), tick(2)])
    expect(StepSchema.safeParse(s).success).toBe(true)
  })

  it('scene takes a world or null + startFrom; topic is a typed identity', () => {
    const world = {
      layout: 'pair' as const,
      clock: { show: true },
      actors: [alice({ icon: 'phone' }), bob()],
    }
    const a = scene('update-and-merge', world, [step('s01', 'Hi.', tick())], {
      title: 'A',
      tryIt: { slot: 'x', ops: [{ op: 'set', args: 'prompt' }] },
    })
    expect(a).toEqual({
      id: 'update-and-merge',
      title: 'A',
      world,
      steps: [step('s01', 'Hi.', tick())],
      tryIt: { slot: 'x', ops: [{ op: 'set', args: 'prompt' }] },
    })
    const b = scene('tie-break', null, [step('s01', 'Again.')], {
      startFrom: 'update-and-merge',
      inContext: true,
    })
    expect(b).toEqual({
      id: 'tie-break',
      inContext: true,
      startFrom: 'update-and-merge',
      steps: [step('s01', 'Again.')],
    })
    expect(SceneSchema.safeParse(a).success).toBe(true)
    expect(SceneSchema.safeParse(b).success).toBe(true)
    const t = topic({
      id: 'x',
      title: 'X',
      goal: 'g',
      whenToUse: ['a'],
      whenNotToUse: ['b'],
      realWorld: 'r',
      scenes: [a, b],
    })
    expect(validateTopic(t).ok).toBe(true)
  })
})

describe('actors and boards', () => {
  it('the cast owns colours a/b/c/d; server/service/device carry their kinds', () => {
    expect(alice()).toEqual({ id: 'alice', kind: 'person', label: 'Alice', color: 'a' })
    expect(bob({ icon: 'laptop' })).toEqual({
      id: 'bob',
      kind: 'person',
      label: 'Bob',
      color: 'b',
      icon: 'laptop',
    })
    expect(carol().color).toBe('c')
    expect(dana()).toEqual({ id: 'dana', kind: 'person', label: 'Dana', color: 'd' })
    expect(server()).toEqual({ id: 'server', kind: 'server', label: 'Server', color: 'server' })
    expect(server('iCloud', { id: 'icloud', icon: 'cloud' })).toEqual({
      id: 'icloud',
      kind: 'server',
      label: 'iCloud',
      color: 'server',
      icon: 'cloud',
    })
    expect(service('edge-us', 'US edge', 'a')).toEqual({
      id: 'edge-us',
      kind: 'service',
      label: 'US edge',
      color: 'a',
    })
    expect(device('laptop', 'Laptop', { owner: 'alice' })).toEqual({
      id: 'laptop',
      kind: 'device',
      label: 'Laptop',
      owner: 'alice',
    })
    expect(
      alice({ holds: { n: 1, doc: { title: 'Q3' } }, online: false, subtitle: 'phone' }),
    ).toEqual({
      id: 'alice',
      kind: 'person',
      label: 'Alice',
      color: 'a',
      online: false,
      subtitle: 'phone',
      holds: { n: 1, doc: rec({ title: 'Q3' }) },
    })
    for (const a of [
      alice(),
      bob({ icon: 'laptop' }),
      carol(),
      dana(),
      server(),
      service('e', 'E', 'b'),
      device('l', 'L', { owner: 'alice' }),
    ]) {
      const r = ActorSpecSchema.safeParse(a)
      expect(r.success, JSON.stringify(r.success ? null : r.error.issues)).toBe(true)
    }
  })

  it('board wraps its value and passes the schema', () => {
    const b = board('rule', 'merge(a, b) = max(a, b)', { label: 'rule', tone: 'info' })
    expect(b).toEqual({
      id: 'rule',
      label: 'rule',
      value: { kind: 'scalar', value: 'merge(a, b) = max(a, b)' },
      tone: 'info',
    })
    expect(BoardSchema.safeParse(b).success).toBe(true)
    expect(BoardSchema.safeParse(board('t', text('x'))).success).toBe(true)
  })
})

describe('values', () => {
  const values = [
    scalar('Lunch', { ts: 2, node: 'bob' }),
    rec({ title: 'Q3 plan', owner: 'Bob', nested: { a: 1 }, tags: ['x', 'y'] }),
    rec.tree({ a: 1 }),
    list(['bread', 'milk']),
    list([rec({ a: 1 }), rec({ a: 2 })]),
    list([rec({ a: 1 })], { ids: ['first'], display: 'column' }),
    sset(['a', 'b']),
    cnt({ alice: 2, bob: 1 }),
    cnt({ alice: { inc: 3, dec: 1 } }),
    clockOf({ alice: 2, bob: 1 }),
    text('the cat sat'),
    text('cat', { cursor: 1, annotations: [{ from: 0, to: 1, tone: 'ok' }] }),
    table(['how', 'use'], [row('r1', { how: 'replaces', use: 'LWW register' })]),
    table([{ key: 'k', label: 'Key' }], []),
    meter(6, 24, 'values read'),
    meter(1),
    bytes('9c017e5502a1e4712d66c0158af34102'),
    bytes([1, 2, 3], { display: 'bits', range: [0, 2] }),
    uuid.v4('9c017e5502a1e4712d66c0158af34102'),
    uuid.v7({ ms: 1787392800001, rand: '1122b34455667788990a' }),
  ]

  it('every value builder passes the value schema', () => {
    for (const v of values) {
      const r = ValueSchema.safeParse(v)
      expect(r.success, JSON.stringify(r.success ? null : r.error.issues)).toBe(true)
    }
  })

  it('shapes', () => {
    expect(scalar('Lunch', { ts: 2, node: 'bob' })).toEqual({
      kind: 'scalar',
      value: 'Lunch',
      meta: { ts: 2, node: 'bob' },
    })
    expect(rec({ title: 'Q3', n: 1 })).toEqual({
      kind: 'record',
      fields: [
        { key: 'title', value: { kind: 'scalar', value: 'Q3' } },
        { key: 'n', value: { kind: 'scalar', value: 1 } },
      ],
    })
    expect(rec.tree({ a: 1 }).display).toBe('tree')
    expect(rec({ inner: { a: 1 } }).fields[0]?.value).toEqual(rec({ a: 1 }))
    expect(list(['bread', 'milk'])).toEqual({
      kind: 'list',
      items: [
        { id: 'bread', value: { kind: 'scalar', value: 'bread' } },
        { id: 'milk', value: { kind: 'scalar', value: 'milk' } },
      ],
    })
    expect(list([rec({ a: 1 }), 'x']).items.map((i) => i.id)).toEqual(['i0', 'x'])
    expect(list([rec({ a: 1 })], { ids: ['first'], display: 'text' })).toMatchObject({
      display: 'text',
      items: [{ id: 'first' }],
    })
    expect(sset(['b', 'a']).kind).toBe('set')
    expect(cnt({ alice: 2, bob: 1 })).toEqual({
      kind: 'counter',
      rows: [
        { node: 'alice', inc: 2 },
        { node: 'bob', inc: 1 },
      ],
      total: 3,
    })
    expect(cnt({ alice: { inc: 3, dec: 1 } }).total).toBe(2)
    expect(clockOf({ alice: 2 })).toEqual({ kind: 'clock', entries: { alice: 2 } })
    expect(text('the cat sat')).toEqual({ kind: 'text', text: 'the cat sat', annotations: [] })
    expect(table(['how'], [row('r1', { how: 'x' })])).toEqual({
      kind: 'table',
      columns: [{ key: 'how', label: 'how' }],
      rows: [{ id: 'r1', cells: { how: { kind: 'scalar', value: 'x' } } }],
    })
    expect(meter(6, 24, 'values read')).toEqual({
      kind: 'meter',
      value: 6,
      max: 24,
      label: 'values read',
    })
    expect(bytes('01a0')).toEqual({
      kind: 'bytes',
      bytes: [1, 160],
      display: 'hex',
      annotations: [],
    })
    expect(toValue(1)).toEqual({ kind: 'scalar', value: 1 })
    expect(toValue(['a'])).toEqual(list(['a']))
    expect(toValue(text('x'))).toEqual(text('x'))
  })

  it('uuid.v7 matches the §15.3 bytes and uuid.v4 forces version and variant', () => {
    const v7 = uuid.v7({ ms: 1787392800001, rand: '1122b34455667788990a' })
    const hex = v7.bytes.map((b) => b.toString(16).padStart(2, '0')).join('')
    expect(hex).toBe('01a028e9b5017122b34455667788990a')
    expect(v7).toEqual(uuidV7({ ms: 1787392800001, rand20hex: '1122b34455667788990a' }))
    expect(v7.annotations.map((a) => a.id)).toEqual(['time', 'ver', 'var', 'rand', 'rand'])
    const v4 = uuid.v4('9c017e5502a1e4712d66c0158af34102')
    expect((v4.bytes[6] ?? 0) >> 4).toBe(4)
    expect((v4.bytes[8] ?? 0) >> 6).toBe(0b10)
    expect(v4.annotations.map((a) => a.id)).toEqual(['ver', 'var', 'rand', 'rand', 'rand'])
  })
})
