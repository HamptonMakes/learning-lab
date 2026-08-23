/**
 * The CRDT delivery layer (DSL §5.1), driven directly: init / update / send / merge / sync /
 * broadcast / apply / gc for every type, with hand-built worlds (`initWorld`) and the messages the
 * core would create from `OutgoingSpec`s. §15.1 (LWW) and §15.2 (OR-Set) step by step.
 */
import { describe, expect, it } from 'vitest'
import { plainValueAt } from '../path'
import {
  ReducerError,
  type ActorSpec,
  type Clock,
  type Command,
  type CrdtArgs,
  type CrdtName,
  type Mark,
  type Message,
  type Replica,
  type Value,
  type World,
} from '../types'
import type { ReduceCtx } from './context'
import {
  applyIncoming,
  isCrdtSlot,
  prepareOutgoing,
  prepareSyncOps,
  reduceCrdt,
  refreshHolds,
  replicaOf,
  stampForSend,
  type CrdtLocalCommand,
  type CrdtWireCommand,
  type OutgoingSpec,
} from './crdt'
import { createEventLog, type EventLog } from './events'
import { initWorld } from './world'

// ─── Harness ──────────────────────────────────────────────────────────────────────────────────

const person = (id: string, extra: Partial<ActorSpec> = {}): ActorSpec => ({
  id,
  kind: 'person',
  label: id,
  ...extra,
})

function world(
  actors: ActorSpec[] = [person('alice'), person('bob')],
  clock?: Partial<Clock>,
): World {
  return initWorld({ layout: 'pair', ...(clock ? { clock } : {}), actors })
}

type Ctx = ReduceCtx & { log: EventLog }
function ctx(stepId = 's01'): Ctx {
  return { sceneId: 'scene', stepId, log: createEventLog(), assert: (w) => w }
}

/** The core's job: an OutgoingSpec becomes a Message (parked when the recipient is offline). */
function toMessage(w: World, spec: OutgoingSpec): Message {
  const m: Message = {
    id: spec.id,
    from: spec.from,
    to: spec.to,
    payload: spec.payload,
    state: w.actors[spec.to]?.online ? 'flying' : 'parked',
    data: spec.data,
  }
  if (spec.label !== undefined) m.label = spec.label
  if (spec.size !== undefined) m.size = spec.size
  return m
}

/** crdt.send / crdt.broadcast / crdt.sync ops, with the messages appended to the world like the core does. */
function wire(
  w: World,
  cmd: CrdtWireCommand | Extract<Command, { t: 'crdt.sync' }>,
  c: Ctx = ctx(),
) {
  const r = cmd.t === 'crdt.sync' ? prepareSyncOps(w, cmd, c) : prepareOutgoing(w, cmd, c)
  const messages = r.messages.map((s) => toMessage(r.world, s))
  return {
    world: { ...r.world, messages: [...r.world.messages, ...messages] },
    messages,
    specs: r.messages,
  }
}

/** deliver: take the message out of the world (the core's part), then applyIncoming. */
function deliver(
  w: World,
  id: string,
  c: Ctx = ctx(),
  opts: { into?: string; park?: boolean; recv?: string } = {},
): World {
  const msg = w.messages.find((m) => m.id === id)
  if (!msg) throw new Error(`test: no message ${id}`)
  const without = { ...w, messages: w.messages.filter((m) => m.id !== id) }
  const next = applyIncoming(without, msg, opts, c)
  return next === without && opts.park ? w : next
}

function local(w: World, cmd: CrdtLocalCommand, c: Ctx = ctx()): World {
  return reduceCrdt(w, cmd, c)
}

const run = (w: World, cmds: CrdtLocalCommand[], c: Ctx = ctx()): World =>
  cmds.reduce((acc, cmd) => local(acc, cmd, c), w)

const holds = (w: World, actor: string, slot: string): Value | undefined =>
  w.actors[actor]?.holds[slot]
const text = (v: Value | undefined): unknown => (v?.kind === 'scalar' ? v.value : undefined)
const rep = (w: World, actor: string, slot: string): Replica => {
  const r = replicaOf(w, actor, slot)
  if (!r) throw new Error(`test: no replica ${actor}.${slot}`)
  return r
}
const marks = (w: World): Array<Omit<Mark, 'id'>> => w.marks.map(({ id: _id, ...rest }) => rest)
const plain = (w: World, path: string): unknown => plainValueAt(w, path)
const withNow = (w: World, now: number): World => ({ ...w, clock: { ...w.clock, now } })

const init = (actors: string[], slot: string, type: CrdtName, args?: CrdtArgs): CrdtLocalCommand =>
  args ? { t: 'crdt.init', actors, slot, type, args } : { t: 'crdt.init', actors, slot, type }
const update = (
  actor: string,
  slot: string,
  op: string,
  args?: unknown[],
  extra: { ts?: number; path?: string } = {},
): CrdtLocalCommand => ({ t: 'crdt.update', actor, slot, op, ...(args ? { args } : {}), ...extra })

// ─── init & seeds ─────────────────────────────────────────────────────────────────────────────

describe('crdt.init / crdt.doc', () => {
  it('creates a replica per actor, applies seeds by the pseudo-node seed (seed:1, ts 0, invisible to version)', () => {
    const w = local(
      world(),
      init(['alice', 'bob'], 'status', 'lww-register', {
        seed: [{ op: 'set', args: ['Offline'] }],
      }),
    )
    for (const a of ['alice', 'bob']) {
      expect(holds(w, a, 'status')).toEqual({
        kind: 'scalar',
        value: 'Offline',
        meta: { ts: 0, node: 'seed' },
      })
      const r = rep(w, a, 'status')
      expect(r).toMatchObject({
        type: 'lww-register',
        seq: 0,
        version: {},
        applied: ['seed:1'],
        pending: [],
      })
      expect(r.log).toEqual([
        {
          id: 'seed:1',
          op: { set: 'Offline', ts: 0, node: 'seed' },
          deps: {},
          label: 'set Offline',
          ts: 0,
        },
      ])
      expect(isCrdtSlot(w, a, 'status')).toBe(true)
      expect(w.actors[a]?.outbox).toEqual([])
    }
    expect(isCrdtSlot(w, 'alice', 'nope')).toBe(false)
  })
  it("seeds by an actor consume that actor's seq and count in every version vector", () => {
    const w = local(
      world(),
      init(['alice', 'bob'], 'cart', 'or-set', {
        seed: [
          { by: 'alice', op: 'add', args: ['milk'] },
          { op: 'add', args: ['eggs'] },
        ],
      }),
    )
    expect(rep(w, 'alice', 'cart')).toMatchObject({
      seq: 1,
      version: { alice: 1 },
      applied: ['alice:1', 'seed:1'],
    })
    expect(rep(w, 'bob', 'cart')).toMatchObject({
      seq: 0,
      version: { alice: 1 },
      applied: ['alice:1', 'seed:1'],
    })
    expect(plain(w, 'bob.cart[milk]@tags')).toEqual([{ tag: 'alice:1', alive: true }])
    expect(plain(w, 'bob.cart[eggs]@tags')).toEqual([{ tag: 'seed:1', alive: true }])
    expect(rep(w, 'bob', 'cart').log[1]?.deps).toEqual({ alice: 1 })
  })
  it('seed.text (the rga type macro) expands to one insert per character, chained on minted ids', () => {
    const w = local(
      world(),
      init(['alice', 'bob'], 'text', 'rga', {
        seed: [{ by: 'alice', op: 'type', args: ['HEAD', 'cat'] }],
        display: 'text',
      }),
    )
    expect(plain(w, 'bob.text')).toEqual(['c', 'a', 't'])
    expect(rep(w, 'bob', 'text').log.map((r) => [r.id, r.label, r.ts])).toEqual([
      ['alice:1', 'insert "c" after HEAD', 0], // seeds default to ts 0 ("the beginning of time")
      ['alice:2', 'insert "a" after alice:1', 0],
      ['alice:3', 'insert "t" after alice:2', 0],
    ])
    expect(rep(w, 'alice', 'text').seq).toBe(3)
    expect(holds(w, 'alice', 'text')).toMatchObject({ kind: 'list', display: 'text' })
  })
  it('init on an existing slot adds replicas for new actors only (same seeds), never resets existing ones', () => {
    let w = local(
      world([person('alice'), person('bob'), person('carol'), person('dave')]),
      init(['alice', 'bob'], 'likes', 'g-counter', {
        seed: [{ by: 'alice', op: 'inc', args: [2] }],
      }),
    )
    w = local(w, update('alice', 'likes', 'inc'))
    const before = rep(w, 'alice', 'likes')
    w = local(w, init(['alice', 'carol'], 'likes', 'g-counter'))
    expect(rep(w, 'alice', 'likes')).toBe(before)
    expect(holds(w, 'carol', 'likes')).toEqual({
      kind: 'counter',
      rows: [{ node: 'alice', inc: 2 }],
      total: 2,
    })
    expect(rep(w, 'carol', 'likes')).toMatchObject({ version: { alice: 1 }, applied: ['alice:1'] })
    expect(() => local(w, init(['alice'], 'likes', 'g-counter'))).toThrow(ReducerError)
    expect(() => local(w, init(['bob'], 'likes', 'pn-counter'))).toThrow(/already a g-counter/)
    expect(() => local(w, init(['dave'], 'likes', 'g-counter', { seed: [] }))).toThrow(
      /repeat its args/,
    )
    expect(() => local(w, init(['erin'], 'x', 'g-counter'))).toThrow(/no actor "erin"/)
  })
  it('vector-clock pre-fills the init actors; lww-element-set defaults bias add; unknown type throws', () => {
    let w = local(world(), init(['alice', 'bob'], 'vc', 'vector-clock'))
    expect(holds(w, 'alice', 'vc')).toEqual({ kind: 'clock', entries: { alice: 0, bob: 0 } })
    w = local(w, init(['alice'], 'fav', 'lww-element-set'))
    expect(rep(w, 'alice', 'fav').state).toMatchObject({ bias: 'add' })
    expect(() => local(w, init(['alice'], 'x', 'nope' as never))).toThrow(/unknown CRDT type/)
  })
  it('crdt.doc composes parts; seed.at targets a part; add(init) mints the sub-document id = op id', () => {
    let w = local(world(), {
      t: 'crdt.doc',
      actors: ['alice', 'bob'],
      slot: 'list',
      fields: {
        title: 'lww-register',
        items: { set: { map: { name: 'lww-register', qty: 'pn-counter' } } },
      },
      args: { seed: [{ path: 'title', op: 'set', args: ['Groceries'] }], wire: 'ops' },
    })
    expect(plain(w, 'bob.list.title')).toBe('Groceries')
    expect(plain(w, 'bob.list.title@type')).toBe('lww-register')
    w = local(w, update('alice', 'list', 'add', [{ name: 'milk' }], { path: 'items' }))
    expect(rep(w, 'alice', 'list').log.at(-1)).toMatchObject({
      id: 'alice:1',
      path: 'items',
      label: 'items: add {name: milk} #alice:1',
    })
    expect(plain(w, 'alice.list.items[alice:1].name')).toBe('milk')
    expect(plain(w, 'alice.list.items[alice:1]@tags')).toEqual([{ tag: 'alice:1', alive: true }])
    w = local(w, update('alice', 'list', 'inc', [2], { path: 'items[alice:1].qty' }))
    expect(plain(w, 'alice.list.items[alice:1].qty')).toBe(2)
    expect(w.actors.alice?.outbox.map((c) => c.label)).toEqual([
      'items: add {name: milk} #alice:1',
      'items[alice:1].qty: inc 2',
    ])
    expect(() => local(w, update('alice', 'list', 'set', ['x'], { path: 'nope' }))).toThrow(
      ReducerError,
    )
    expect(() => local(w, update('alice', 'list', 'set', ['x']))).toThrow(
      /map; address one of its fields/,
    )
  })
})

// ─── update: ids, bookkeeping, time ───────────────────────────────────────────────────────────

describe('crdt.update', () => {
  it('mints one op id per update (`alice:1`…), bumps seq/version/applied/log/pending, refreshes holds + outbox chips', () => {
    let w = local(world(), init(['alice', 'bob'], 'views', 'g-counter', { wire: 'ops' }))
    w = local(w, update('alice', 'views', 'inc'))
    w = local(w, update('alice', 'views', 'inc', [2]))
    w = local(w, update('bob', 'views', 'inc', [5]))
    const a = rep(w, 'alice', 'views')
    expect(a).toMatchObject({
      seq: 2,
      version: { alice: 2 },
      applied: ['alice:1', 'alice:2'],
      pending: ['alice:1', 'alice:2'],
    })
    expect(a.log.map((r) => ({ id: r.id, label: r.label, deps: r.deps }))).toEqual([
      { id: 'alice:1', label: 'inc 1', deps: {} },
      { id: 'alice:2', label: 'inc 2', deps: { alice: 1 } },
    ])
    expect(holds(w, 'alice', 'views')).toEqual({
      kind: 'counter',
      rows: [{ node: 'alice', inc: 3 }],
      total: 3,
    })
    expect(w.actors.alice?.outbox).toEqual([
      { slot: 'views', id: 'alice:1', label: 'inc 1' },
      { slot: 'views', id: 'alice:2', label: 'inc 2' },
    ])
    expect(rep(w, 'bob', 'views')).toMatchObject({
      seq: 1,
      version: { bob: 1 },
      pending: ['bob:1'],
    })
    expect(w.actors.bob?.outbox).toEqual([{ slot: 'views', id: 'bob:1', label: 'inc 5' }])
  })
  it('stamps: wall time (clock.now + skew), cmd.ts override, autoTick only for wall-clock-stamped types', () => {
    let w = local(
      world([person('alice', { skew: 5 }), person('bob')], { now: 1, autoTick: true }),
      init(['alice', 'bob'], 'status', 'lww-register'),
    )
    w = local(w, init(['alice', 'bob'], 'views', 'g-counter'))
    w = local(w, update('alice', 'status', 'set', ['x']))
    expect(w.clock.now).toBe(2) // autoTick before a wall-clock-stamped update
    expect(holds(w, 'alice', 'status')).toMatchObject({ meta: { ts: 7, node: 'alice' } })
    w = local(w, update('alice', 'views', 'inc'))
    expect(w.clock.now).toBe(2) // never before a counter
    w = local(w, update('bob', 'status', 'set', ['y'], { ts: 99 }))
    expect(w.clock.now).toBe(2) // an explicit ts is not a wall-clock stamp
    expect(holds(w, 'bob', 'status')).toMatchObject({ meta: { ts: 99, node: 'bob' } })
    expect(rep(w, 'bob', 'status').log[0]?.ts).toBe(99)
  })
  it('rga: Lamport by default (max ts seen + 1; concurrent inserts tie), wall clock with stamp: clock', () => {
    let w = local(
      world([person('alice'), person('bob')], { now: 10, autoTick: true }),
      init(['alice', 'bob'], 'text', 'rga'),
    )
    w = local(w, update('alice', 'text', 'type', ['HEAD', 'ab']))
    expect(rep(w, 'alice', 'text').log.map((r) => r.ts)).toEqual([1, 2])
    expect(w.clock.now).toBe(10)
    w = local(w, update('bob', 'text', 'insertAfter', ['HEAD', 'z']))
    expect(rep(w, 'bob', 'text').log[0]?.ts).toBe(1) // bob saw nothing: ties with alice:1
    w = local(w, { t: 'crdt.merge', into: 'bob', from: 'alice', slot: 'text' })
    w = local(w, update('bob', 'text', 'insertAt', [0, 'q']))
    expect(rep(w, 'bob', 'text').log.at(-1)?.ts).toBe(3) // fresh insert outranks everything seen
    w = local(w, init(['alice'], 'notes', 'rga', { stamp: 'clock' }))
    w = local(w, update('alice', 'notes', 'insertAt', [0, 'n']))
    expect(w.clock.now).toBe(11)
    expect(rep(w, 'alice', 'notes').log[0]?.ts).toBe(11)
  })
  it('args.clock: stamps come from the HLC slot (wall·65536 + counter), which ticks with the actor wall time', () => {
    let w = local(
      world([person('alice'), person('bob')], { now: 3 }),
      init(['alice', 'bob'], 'hlc', 'hlc'),
    )
    w = local(w, init(['alice', 'bob'], 'status', 'lww-register', { clock: { slot: 'hlc' } }))
    w = local(w, update('alice', 'status', 'set', ['x']))
    expect(holds(w, 'alice', 'status')).toEqual({
      kind: 'scalar',
      value: 'x',
      meta: { ts: 3 * 65536, node: 'alice', hlc: { wall: 3, counter: 0 } },
    })
    expect(plain(w, 'alice.hlc')).toEqual({ wall: 3, counter: 0 })
    w = local(w, update('alice', 'status', 'set', ['y']))
    expect(holds(w, 'alice', 'status')).toMatchObject({
      meta: { ts: 3 * 65536 + 1, hlc: { wall: 3, counter: 1 } },
    })
    // merging runs the receiver's HLC receive rule with the greatest stamp carried
    w = local(w, { t: 'crdt.merge', into: 'bob', from: 'alice', slot: 'status' })
    expect(plain(w, 'bob.hlc')).toEqual({ wall: 3, counter: 2 })
    w = local(w, init(['alice'], 'other', 'lww-register', { clock: { slot: 'nope' } }))
    expect(() => local(w, update('alice', 'other', 'set', ['x']))).toThrow(/not an hlc replica/)
  })
  it('adds an unchanged mark when toValue() did not change (2P re-add, max-register lower write)', () => {
    let w = local(world(), init(['alice'], 'guests', 'two-phase-set'))
    w = local(w, update('alice', 'guests', 'add', ['dan']))
    expect(marks(w)).toEqual([])
    w = local(w, update('alice', 'guests', 'add', ['dan']))
    expect(marks(w)).toEqual([{ kind: 'unchanged', path: 'alice.guests' }])
    expect(rep(w, 'alice', 'guests').seq).toBe(2) // still one op id per update
    w = local(w, init(['alice'], 'best', 'max-register'))
    w = run(w, [update('alice', 'best', 'set', [5]), update('alice', 'best', 'set', [3])])
    expect(marks(w).filter((m) => m.kind === 'unchanged')).toHaveLength(2)
    expect(plain(w, 'alice.best')).toBe(5)
  })
  it('errors: unknown op, bad arity, a remove the type rejects, path on a plain slot, unknown slot / actor', () => {
    const w = local(world(), init(['alice'], 'guests', 'two-phase-set'))
    expect(() => local(w, update('alice', 'guests', 'frob'))).toThrow(/unknown op "frob"/)
    expect(() => local(w, update('alice', 'guests', 'add'))).toThrow(/takes 1 argument/)
    expect(() => local(w, update('alice', 'guests', 'remove', ['zed']))).toThrow(/never added/)
    expect(() => local(w, update('alice', 'guests', 'add', ['x'], { path: 'a' }))).toThrow(
      /only for composed documents/,
    )
    expect(() => local(w, update('alice', 'nope', 'add', ['x']))).toThrow(/no CRDT slot "nope"/)
    expect(() => local(w, update('zed', 'guests', 'add', ['x']))).toThrow(/no actor "zed"/)
    try {
      local(w, update('alice', 'guests', 'frob'), ctx('s07'))
    } catch (e) {
      expect(e).toBeInstanceOf(ReducerError)
      expect((e as ReducerError).ctx).toMatchObject({
        stepId: 's07',
        command: { t: 'crdt.update', op: 'frob' },
      })
    }
  })
  it('deleteRange deletes the live elements between two ids in sequence order, one op each', () => {
    let w = local(
      world(),
      init(['alice'], 'text', 'rga', {
        seed: [{ by: 'alice', op: 'type', args: ['HEAD', 'hello'] }],
      }),
    )
    w = local(w, update('alice', 'text', 'deleteRange', ['alice:2', 'alice:4']))
    expect(plain(w, 'alice.text')).toEqual(['h', 'o'])
    expect(rep(w, 'alice', 'text').pending).toEqual(['alice:6', 'alice:7', 'alice:8'])
    expect(() => local(w, update('alice', 'text', 'deleteRange', ['alice:4', 'alice:2']))).toThrow(
      /comes before/,
    )
  })
  it('lww-map / mv-register / lww-element-set / op-counter / clocks drive through update', () => {
    let w = local(
      world([person('alice'), person('bob')], { now: 1 }),
      init(['alice', 'bob'], 'task', 'lww-map'),
    )
    w = run(w, [
      update('alice', 'task', 'set', ['title', 'Q3']),
      update('alice', 'task', 'remove', ['title'], { ts: 2 }),
    ])
    expect(rep(w, 'alice', 'task').log.map((r) => r.label)).toEqual([
      'set title = Q3',
      'remove title',
    ])
    expect(plain(w, 'alice.task.title@tomb')).toBe(true)
    w = local(w, init(['alice', 'bob'], 'cart', 'mv-register'))
    w = run(w, [update('alice', 'cart', 'set', ['milk']), update('bob', 'cart', 'set', ['eggs'])])
    w = local(w, { t: 'crdt.sync', a: 'alice', b: 'bob', slot: 'cart' })
    expect(plain(w, 'alice.cart')).toEqual(['eggs', 'milk'])
    expect(plain(w, 'alice.cart@vc')).toEqual({ alice: 1, bob: 1 })
    w = local(w, update('alice', 'cart', 'set', ['bread']))
    expect(holds(w, 'alice', 'cart')).toEqual({
      kind: 'scalar',
      value: 'bread',
      meta: { vc: { alice: 2, bob: 1 } },
    })
    w = local(w, init(['alice'], 'fav', 'lww-element-set', { bias: 'remove' }))
    w = run(w, [
      update('alice', 'fav', 'add', ['jazz']),
      update('alice', 'fav', 'remove', ['jazz']),
    ])
    expect(plain(w, 'alice.fav')).toEqual([]) // same ts, bias remove
    expect(plain(w, 'alice.fav[jazz]@removeTs')).toBe(1)
    w = local(w, init(['alice'], 'likes', 'op-counter', { expose: ['applied'] }))
    w = run(w, [update('alice', 'likes', 'inc'), update('alice', 'likes', 'dec', [3])])
    expect(holds(w, 'alice', 'likes')).toEqual({
      kind: 'scalar',
      value: -2,
      meta: { applied: ['alice:1', 'alice:2'] },
    })
    w = run(w, [
      init(['alice'], 'lc', 'lamport-clock'),
      update('alice', 'lc', 'tick'),
      update('alice', 'lc', 'tick'),
    ])
    expect(plain(w, 'alice.lc')).toBe(2)
    w = run(w, [init(['alice', 'bob'], 'vc', 'vector-clock'), update('bob', 'vc', 'tick')])
    expect(plain(w, 'bob.vc')).toEqual({ alice: 0, bob: 1 })
    w = run(w, [init(['alice'], 'h', 'hlc'), update('alice', 'h', 'tick')])
    expect(plain(w, 'alice.h')).toEqual({ wall: 1, counter: 0 })
    expect(rep(w, 'alice', 'h').log[0]?.label).toBe('tick')
  })
})

// ─── §15.1 LWW register: update-and-merge ─────────────────────────────────────────────────────

describe('§15.1 LWW register — send and merge', () => {
  it('walks the scene: t=1 / t=2 writes, send m1, merge → no change; m2 → via chip', () => {
    let w = local(
      world(),
      init(['alice', 'bob'], 'status', 'lww-register', {
        seed: [{ op: 'set', args: ['Offline'] }],
      }),
    )
    w = local(withNow(w, 1), update('alice', 'status', 'set', ['In a meeting']))
    expect(plain(w, 'alice.status@ts')).toBe(1)
    expect(plain(w, 'alice.status@node')).toBe('alice')
    w = local(withNow(w, 2), update('bob', 'status', 'set', ['Lunch']))
    expect(plain(w, 'bob.status@ts')).toBe(2)
    // s05: Alice sends her state
    const s05 = ctx('s05')
    const sent = wire(
      w,
      { t: 'crdt.send', from: 'alice', to: 'bob', slot: 'status', id: 'm1' },
      s05,
    )
    w = sent.world
    expect(sent.specs).toEqual([
      {
        from: 'alice',
        to: 'bob',
        id: 'm1',
        payload: {
          kind: 'scalar',
          value: 'In a meeting',
          meta: { type: 'lww-register', ts: 1, node: 'alice' },
        },
        data: {
          kind: 'state',
          slot: 'status',
          state: { value: 'In a meeting', ts: 1, node: 'alice' },
          version: { alice: 1 },
        },
      },
    ])
    expect(rep(w, 'alice', 'status').pending).toEqual([])
    expect(w.actors.alice?.outbox).toEqual([])
    // s06: Bob merges — 2 beats 1, he keeps Lunch, "no change" pill, no via
    const s06 = ctx('s06')
    w = deliver(w, 'm1', s06)
    expect(plain(w, 'bob.status')).toBe('Lunch')
    expect(marks(w)).toEqual([{ kind: 'unchanged', path: 'bob.status' }])
    expect(s06.log.events).toEqual([])
    expect(rep(w, 'bob', 'status').version).toEqual({ alice: 1, bob: 1 })
    // s07: Bob sends his state; Alice takes Lunch, t=2, bob — via chip
    const s07 = ctx('s07')
    const sent2 = wire(
      w,
      { t: 'crdt.send', from: 'bob', to: 'alice', slot: 'status', id: 'm2' },
      s07,
    )
    w = deliver(sent2.world, 'm2', s07)
    expect(holds(w, 'alice', 'status')).toEqual({
      kind: 'scalar',
      value: 'Lunch',
      meta: { ts: 2, node: 'bob' },
    })
    expect(s07.log.events).toEqual([
      { kind: 'via', path: 'alice.status', message: 'm2' },
      { kind: 'action', path: 'alice.status', label: { key: 'stage.op.merge', by: 'bob' } },
    ])
    expect(plain(w, 'alice.status@node')).toBe('bob')
    expect(rep(w, 'alice', 'status').version).toEqual({ alice: 1, bob: 1 })
  })
  it('crdt.send: generated ids m1, m2…, fan-out `${id}@${to}`, delta / full sizes, label, errors', () => {
    let w = local(
      world([person('alice'), person('bob'), person('carol')]),
      init(['alice', 'bob', 'carol'], 'cart', 'or-set'),
    )
    w = run(w, [update('alice', 'cart', 'add', ['milk']), update('alice', 'cart', 'add', ['eggs'])])
    const one = wire(w, { t: 'crdt.send', from: 'alice', to: 'bob', slot: 'cart' })
    expect(one.specs.map((s) => s.id)).toEqual(['m1'])
    expect(one.specs[0]?.size).toBeUndefined()
    expect(one.world.ids).toBe(1)
    const fan = wire(one.world, {
      t: 'crdt.send',
      from: 'alice',
      to: ['bob', 'carol'],
      slot: 'cart',
      mode: 'full',
      label: 'state',
    })
    expect(fan.specs.map((s) => [s.id, s.label])).toEqual([
      ['m2@bob', 'state'],
      ['m2@carol', 'state'],
    ])
    expect(fan.specs[0]?.size).toBeGreaterThan(0)
    expect(fan.specs[0]?.payload).toEqual({
      kind: 'scalar',
      value: 'eggs, milk',
      meta: { type: 'or-set' },
    })
    // delta carries only the pending ops applied to init(): smaller than full
    let w2 = local(world(), init(['alice', 'bob'], 'cart', 'or-set'))
    w2 = run(w2, [
      update('alice', 'cart', 'add', ['milk']),
      update('alice', 'cart', 'add', ['eggs']),
      update('alice', 'cart', 'add', ['bread']),
    ])
    const full = wire(w2, {
      t: 'crdt.send',
      from: 'alice',
      to: 'bob',
      slot: 'cart',
      id: 'f',
      mode: 'full',
    })
    const pre = prepareOutgoing(
      w2,
      { t: 'crdt.send', from: 'alice', to: 'bob', slot: 'cart', id: 'f', mode: 'full' },
      ctx(),
    ) // pending cleared after a send
    w2 = pre.world
    w2 = local(w2, update('alice', 'cart', 'add', ['jam']))
    const delta = wire(w2, {
      t: 'crdt.send',
      from: 'alice',
      to: 'bob',
      slot: 'cart',
      id: 'd',
      mode: 'delta',
    })
    expect(delta.specs[0]?.size ?? 0).toBeLessThan(full.specs[0]?.size ?? 0)
    expect(delta.specs[0]?.data).toMatchObject({
      kind: 'state',
      state: { entries: { jam: { tags: { 'alice:4': true } } } },
    })
    expect(text(delta.specs[0]?.payload)).toBe('jam')
    // merging the delta at bob brings only jam (he had nothing)
    const bob = deliver(delta.world, 'd')
    expect(plain(bob, 'bob.cart')).toEqual(['jam'])
    expect(() =>
      prepareOutgoing(w, { t: 'crdt.send', from: 'alice', to: 'alice', slot: 'cart' }, ctx()),
    ).toThrow(/itself/)
    expect(() =>
      prepareOutgoing(w, { t: 'crdt.send', from: 'alice', to: 'zed', slot: 'cart' }, ctx()),
    ).toThrow(/no actor "zed"/)
    expect(() =>
      prepareOutgoing(
        one.world,
        { t: 'crdt.send', from: 'alice', to: 'bob', slot: 'cart', id: 'm1' },
        ctx(),
      ),
    ).toThrow(/already in flight/)
    expect(() =>
      prepareOutgoing(
        { ...one.world, ids: 0 },
        { t: 'crdt.send', from: 'alice', to: 'bob', slot: 'cart' },
        ctx(),
      ),
    ).toThrow(/collides/)
  })
  it('crdt.merge: instant, flow mark + sync event, unchanged when nothing changed, both online', () => {
    let w = local(world(), init(['alice', 'bob'], 'views', 'g-counter'))
    w = local(w, update('alice', 'views', 'inc', [2]))
    const c = ctx()
    w = local(w, { t: 'crdt.merge', into: 'bob', from: 'alice', slot: 'views' }, c)
    expect(plain(w, 'bob.views')).toBe(2)
    expect(marks(w)).toEqual([{ kind: 'flow', from: 'alice.views', to: 'bob.views' }])
    expect(c.log.events).toEqual([
      { kind: 'sync', slot: 'views', from: 'alice', to: 'bob', both: false },
      { kind: 'action', path: 'bob.views', label: { key: 'stage.op.merge', by: 'alice' } },
    ])
    expect(rep(w, 'bob', 'views')).toMatchObject({ version: { alice: 1 }, pending: [] })
    w = local(w, { t: 'crdt.merge', into: 'bob', from: 'alice', slot: 'views' })
    expect(marks(w).slice(1)).toEqual([
      { kind: 'flow', from: 'alice.views', to: 'bob.views' },
      { kind: 'unchanged', path: 'bob.views' },
    ])
    const offline = {
      ...w,
      actors: { ...w.actors, bob: { ...w.actors.bob, online: false } },
    } as World
    expect(() =>
      local(offline, { t: 'crdt.merge', into: 'bob', from: 'alice', slot: 'views' }),
    ).toThrow(/offline/)
    expect(() =>
      local(w, { t: 'crdt.merge', into: 'alice', from: 'alice', slot: 'views' }),
    ).toThrow(/itself/)
  })
  it('holds refresh: refreshHolds recomputes the value and the outbox from the replicas', () => {
    let w = local(world(), init(['alice'], 'views', 'g-counter', { wire: 'ops' }))
    w = local(w, update('alice', 'views', 'inc'))
    const stale = {
      ...w,
      actors: { ...w.actors, alice: { ...w.actors.alice, holds: {}, outbox: [] } },
    } as World
    const fresh = refreshHolds(stale, 'alice', 'views')
    expect(fresh.actors.alice?.holds.views).toEqual(holds(w, 'alice', 'views'))
    expect(fresh.actors.alice?.outbox).toEqual([{ slot: 'views', id: 'alice:1', label: 'inc 1' }])
    expect(refreshHolds(w, 'alice', 'nope')).toBe(w)
  })
})

// ─── §15.2 OR-Set: tags ───────────────────────────────────────────────────────────────────────

describe('§15.2 OR-Set — re-add after a concurrent remove (crdt.sync)', () => {
  it('tags alice:1 / alice:2 with the exact alive flags of the spec', () => {
    let w = local(world(), init(['alice', 'bob'], 'cart', 'or-set'))
    // s02
    w = local(w, update('alice', 'cart', 'add', ['milk']))
    expect(plain(w, 'alice.cart[milk]@tags')).toEqual([{ tag: 'alice:1', alive: true }])
    // s03: they sync — flow arrow, "no change" on Alice's side
    const s03 = ctx('s03')
    w = local(w, { t: 'crdt.sync', a: 'alice', b: 'bob', slot: 'cart' }, s03)
    expect(plain(w, 'bob.cart[milk]@tags')).toEqual([{ tag: 'alice:1', alive: true }])
    expect(marks(w)).toEqual([
      { kind: 'flow', from: 'alice.cart', to: 'bob.cart', both: true },
      { kind: 'unchanged', path: 'alice.cart' },
    ])
    expect(s03.log.events).toEqual([
      { kind: 'sync', slot: 'cart', from: 'alice', to: 'bob', both: true },
      { kind: 'action', path: 'bob.cart', label: { key: 'stage.op.merge', by: 'alice' } },
    ])
    expect(rep(w, 'bob', 'cart').version).toEqual({ alice: 1 })
    // s04: Bob removes milk — he drops alice:1
    w = { ...w, marks: [] }
    w = local(w, update('bob', 'cart', 'remove', ['milk']))
    expect(plain(w, 'bob.cart')).toEqual([])
    expect(plain(w, 'bob.cart[milk]@tomb')).toBe(true)
    expect(rep(w, 'bob', 'cart').log.at(-1)?.label).toBe('remove milk {alice:1}')
    // s05: Alice adds milk again — new tag alice:2
    w = local(w, update('alice', 'cart', 'add', ['milk']))
    expect(plain(w, 'alice.cart[milk]@tags')).toEqual([
      { tag: 'alice:1', alive: true },
      { tag: 'alice:2', alive: true },
    ])
    // s06: they sync — alice:2 survives, milk is in
    w = { ...w, marks: [] }
    w = local(w, { t: 'crdt.sync', a: 'alice', b: 'bob', slot: 'cart' })
    expect(plain(w, 'bob.cart')).toEqual(['milk'])
    expect(plain(w, 'bob.cart[milk]@tags')).toEqual([
      { tag: 'alice:1', alive: false },
      { tag: 'alice:2', alive: true },
    ])
    expect(plain(w, 'alice.cart[milk]@tags')).toEqual(plain(w, 'bob.cart[milk]@tags'))
    expect(marks(w)).toEqual([{ kind: 'flow', from: 'alice.cart', to: 'bob.cart', both: true }]) // both sides changed
    expect(rep(w, 'alice', 'cart').version).toEqual({ alice: 2, bob: 1 })
    expect(rep(w, 'bob', 'cart').version).toEqual({ alice: 2, bob: 1 })
  })
})

// ─── broadcast / apply (op-based) ─────────────────────────────────────────────────────────────

describe('crdt.broadcast + deliver (ops on the wire)', () => {
  it('one {kind:op} message per pending op per recipient, ids `${opId}@${to}`, pending flushed, dedupe on re-delivery', () => {
    let w = local(
      world([person('alice'), person('bob'), person('carol')]),
      init(['alice', 'bob', 'carol'], 'likes', 'op-counter'),
    )
    w = run(w, [update('alice', 'likes', 'inc'), update('alice', 'likes', 'dec', [2])])
    const c = ctx()
    const out = wire(w, { t: 'crdt.broadcast', from: 'alice', slot: 'likes' }, c)
    w = out.world
    expect(out.specs.map((s) => s.id)).toEqual([
      'alice:1@bob',
      'alice:1@carol',
      'alice:2@bob',
      'alice:2@carol',
    ])
    expect(out.specs[0]).toMatchObject({
      from: 'alice',
      to: 'bob',
      payload: { kind: 'scalar', value: 'inc 1', meta: { tag: 'alice:1', ts: 0, node: 'alice' } },
      data: {
        kind: 'op',
        slot: 'likes',
        op: { id: 'alice:1', op: { id: 'alice:1', add: 1 }, deps: {}, label: 'inc 1', ts: 0 },
      },
    })
    expect(rep(w, 'alice', 'likes').pending).toEqual([])
    expect(w.actors.alice?.outbox).toEqual([])
    w = deliver(w, 'alice:1@bob', c)
    expect(plain(w, 'bob.likes')).toBe(1)
    expect(rep(w, 'bob', 'likes')).toMatchObject({ version: { alice: 1 }, applied: ['alice:1'] })
    expect(rep(w, 'bob', 'likes').log.map((r) => r.id)).toEqual(['alice:1'])
    expect(c.log.events.slice(-2)).toEqual([
      { kind: 'via', path: 'bob.likes', message: 'alice:1@bob' },
      {
        kind: 'action',
        path: 'bob.likes',
        label: { key: 'stage.op.inc', vars: { n: 1 }, by: 'alice' },
      },
    ])
    // a duplicate (retry) changes nothing and says so
    const dup: Message = { ...(out.messages[0] as Message), id: 'alice:1-retry@bob' }
    const w2 = applyIncoming(w, dup, {}, c)
    expect(plain(w2, 'bob.likes')).toBe(1)
    expect(marks(w2)).toEqual([{ kind: 'unchanged', path: 'bob.likes' }])
    w = deliver(w, 'alice:2@bob', c)
    expect(plain(w, 'bob.likes')).toBe(-1)
    expect(rep(w, 'bob', 'likes').version).toEqual({ alice: 2 })
  })
  it('causal readiness: an op whose deps the recipient lacks throws, or parks (world untouched) with park', () => {
    let w = local(world(), init(['alice', 'bob'], 'likes', 'op-counter'))
    w = run(w, [update('alice', 'likes', 'inc'), update('alice', 'likes', 'inc')])
    const out = wire(w, { t: 'crdt.broadcast', from: 'alice', slot: 'likes' })
    w = out.world
    expect(() => deliver(w, 'alice:2@bob')).toThrow(/not ready/)
    const parked = deliver(w, 'alice:2@bob', ctx(), { park: true })
    expect(parked).toBe(w)
    w = deliver(w, 'alice:1@bob')
    w = deliver(w, 'alice:2@bob')
    expect(plain(w, 'bob.likes')).toBe(2)
    // an op created after seeing another node's op depends on it
    let w3 = local(
      world([person('alice'), person('bob'), person('carol')]),
      init(['alice', 'bob', 'carol'], 'cart', 'or-set'),
    )
    w3 = local(w3, update('bob', 'cart', 'add', ['milk']))
    const b = wire(w3, { t: 'crdt.broadcast', from: 'bob', slot: 'cart', to: ['alice'] })
    w3 = deliver(b.world, 'bob:1@alice')
    w3 = local(w3, update('alice', 'cart', 'remove', ['milk']))
    expect(rep(w3, 'alice', 'cart').log.at(-1)).toMatchObject({
      id: 'alice:1',
      deps: { bob: 1 },
      label: 'remove milk {bob:1}',
    })
    const a = wire(w3, { t: 'crdt.broadcast', from: 'alice', slot: 'cart', to: ['carol'] })
    expect(a.specs[0]?.payload).toEqual({
      kind: 'scalar',
      value: 'remove milk {bob:1}',
      meta: { tag: 'alice:1', ts: 0, node: 'alice', tags: [{ tag: 'bob:1', alive: false }] },
    })
    expect(() => deliver(a.world, 'alice:1@carol')).toThrow(/depends on \{bob 1\}/)
  })
  it('broadcast: default recipients = every other holder (offline or not), id override needs exactly one pending op, empty outbox throws', () => {
    let w = local(
      world([person('alice'), person('bob', { online: false }), person('carol')]),
      init(['alice', 'bob'], 'likes', 'op-counter'),
    )
    expect(() =>
      prepareOutgoing(w, { t: 'crdt.broadcast', from: 'alice', slot: 'likes' }, ctx()),
    ).toThrow(/empty/)
    w = local(w, update('alice', 'likes', 'inc'))
    const out = wire(w, { t: 'crdt.broadcast', from: 'alice', slot: 'likes', id: 'op1' })
    expect(out.specs.map((s) => s.id)).toEqual(['op1@bob'])
    expect(out.messages[0]?.state).toBe('parked')
    w = run(w, [update('alice', 'likes', 'inc')])
    expect(() =>
      prepareOutgoing(w, { t: 'crdt.broadcast', from: 'alice', slot: 'likes', id: 'x' }, ctx()),
    ).toThrow(/exactly one pending/)
    expect(() =>
      prepareOutgoing(
        w,
        { t: 'crdt.broadcast', from: 'alice', slot: 'likes', to: ['alice'] },
        ctx(),
      ),
    ).toThrow(/itself/)
    let solo = local(world([person('alice')]), init(['alice'], 'likes', 'op-counter'))
    solo = local(solo, update('alice', 'likes', 'inc'))
    expect(() =>
      prepareOutgoing(solo, { t: 'crdt.broadcast', from: 'alice', slot: 'likes' }, ctx()),
    ).toThrow(/no other actor/)
  })
  it('rga ops apply at the recipient and converge; a delete before its insert is not ready', () => {
    let w = local(world(), init(['alice', 'bob'], 'text', 'rga', { display: 'text' }))
    w = run(w, [
      update('alice', 'text', 'type', ['HEAD', 'hi']),
      update('alice', 'text', 'delete', ['alice:1']),
    ])
    const out = wire(w, { t: 'crdt.broadcast', from: 'alice', slot: 'text' })
    w = out.world
    expect(out.specs.map((s) => text(s.payload))).toEqual([
      'insert "h" after HEAD',
      'insert "i" after alice:1',
      'delete alice:1',
    ])
    expect(() => deliver(w, 'alice:3@bob')).toThrow(/not ready/)
    w = deliver(w, 'alice:1@bob')
    w = deliver(w, 'alice:2@bob')
    w = deliver(w, 'alice:3@bob')
    expect(plain(w, 'bob.text')).toEqual(['i'])
    expect(plain(w, 'bob.text[alice:1]@tomb')).toBe(true)
    expect(holds(w, 'bob', 'text')).toEqual(holds(w, 'alice', 'text'))
  })
  it('an idempotent effect that changes nothing visibly adds an unchanged mark', () => {
    let w = local(world(), init(['alice', 'bob'], 'status', 'lww-register'))
    w = local(withNow(w, 5), update('bob', 'status', 'set', ['new']))
    w = local(withNow(w, 1), update('alice', 'status', 'set', ['old']))
    const out = wire(w, { t: 'crdt.broadcast', from: 'alice', slot: 'status' })
    const c = ctx()
    const next = deliver(out.world, 'alice:1@bob', c)
    expect(plain(next, 'bob.status')).toBe('new')
    expect(marks(next)).toEqual([{ kind: 'unchanged', path: 'bob.status' }])
    expect(c.log.events).toEqual([])
    expect(rep(next, 'bob', 'status').applied).toEqual(['bob:1', 'alice:1'])
  })
})

// ─── crdt.sync mode 'ops' ─────────────────────────────────────────────────────────────────────

describe('crdt.sync mode ops (state-vector exchange)', () => {
  it('emits the ops each side lacks (by node, then seq), clears pending, both online; reduceCrdt refuses the mode', () => {
    let w = local(
      world([person('alice'), person('server')]),
      init(['alice', 'server'], 'note', 'rga'),
    )
    w = run(w, [
      update('alice', 'note', 'type', ['HEAD', 'ab']),
      update('server', 'note', 'type', ['HEAD', 'c']),
    ])
    const c = ctx()
    const out = wire(w, { t: 'crdt.sync', a: 'alice', b: 'server', slot: 'note', mode: 'ops' }, c)
    expect(out.specs.map((s) => s.id)).toEqual([
      'alice:1@server',
      'alice:2@server',
      'server:1@alice',
    ])
    expect(out.specs[0]?.data).toMatchObject({ kind: 'op', slot: 'note', op: { id: 'alice:1' } })
    expect(rep(out.world, 'alice', 'note').pending).toEqual([])
    expect(rep(out.world, 'server', 'note').pending).toEqual([])
    expect(marks(out.world)).toEqual([])
    w = out.world
    for (const id of ['alice:1@server', 'alice:2@server', 'server:1@alice']) w = deliver(w, id, c)
    expect(plain(w, 'alice.note')).toEqual(plain(w, 'server.note'))
    expect(plain(w, 'alice.note')).toEqual(['c', 'a', 'b'])
    // nothing left to exchange: no messages, both sides marked unchanged
    const again = wire(w, { t: 'crdt.sync', a: 'alice', b: 'server', slot: 'note', mode: 'ops' })
    expect(again.specs).toEqual([])
    expect(marks(again.world)).toEqual([
      { kind: 'unchanged', path: 'alice.note' },
      { kind: 'unchanged', path: 'server.note' },
    ])
    expect(() =>
      reduceCrdt(w, { t: 'crdt.sync', a: 'alice', b: 'server', slot: 'note', mode: 'ops' }, ctx()),
    ).toThrow(/prepareSyncOps/)
    expect(() =>
      prepareSyncOps(w, { t: 'crdt.sync', a: 'alice', b: 'server', slot: 'note' }, ctx()),
    ).toThrow(/mode 'ops' only/)
  })
  it('seeds are never re-sent; one direction only when the other side is ahead', () => {
    let w = local(
      world(),
      init(['alice', 'bob'], 'cart', 'or-set', { seed: [{ op: 'add', args: ['milk'] }] }),
    )
    w = local(w, update('alice', 'cart', 'add', ['eggs']))
    const out = wire(w, { t: 'crdt.sync', a: 'bob', b: 'alice', slot: 'cart', mode: 'ops' })
    expect(out.specs.map((s) => s.id)).toEqual(['alice:1@bob'])
    expect(marks(out.world)).toEqual([{ kind: 'unchanged', path: 'alice.cart' }])
  })
})

// ─── stamps and clocks ────────────────────────────────────────────────────────────────────────

describe('send.stamp / deliver recv (clock rules)', () => {
  const stamped = (w: World, from: string, to: string, slot: string, id: string, into?: string) => {
    const c = ctx()
    const s = stampForSend(w, from, slot, c)
    const payload: Value = { kind: 'scalar', value: 'hi', meta: s.meta }
    const msg: Message = {
      id,
      from,
      to,
      payload,
      state: 'flying',
      data: { kind: 'stamp', slot, stamp: s.meta },
    }
    if (into) msg.into = into
    return { world: { ...s.world, messages: [...s.world.messages, msg] }, meta: s.meta, c }
  }
  it('lamport: send = tick, receive = max + 1; the plain payload still lands at into with a via', () => {
    let w = run(local(world(), init(['alice', 'bob'], 'clock', 'lamport-clock')), [
      update('alice', 'clock', 'tick'),
      update('alice', 'clock', 'tick'),
    ])
    const s = stamped(w, 'alice', 'bob', 'clock', 'm1', 'bob.note')
    expect(s.meta).toEqual({ ts: 3 })
    expect(plain(s.world, 'alice.clock')).toBe(3)
    w = deliver(s.world, 'm1', s.c, { into: 'bob.note' })
    expect(plain(w, 'bob.clock')).toBe(4)
    expect(holds(w, 'bob', 'note')).toEqual({ kind: 'scalar', value: 'hi', meta: { ts: 3 } })
    expect(s.c.log.events).toEqual([
      { kind: 'action', path: 'alice.clock', label: { key: 'stage.op.tick', by: 'alice' } },
      { kind: 'via', path: 'bob.clock', message: 'm1' },
      { kind: 'action', path: 'bob.clock', label: { key: 'stage.op.receive', by: 'alice' } },
      { kind: 'via', path: 'bob.note', message: 'm1' },
      { kind: 'action', path: 'bob.note', label: { key: 'stage.op.setPlain', by: 'alice' } },
    ])
    // a bare `recv` on a plain message reads the stamp from payload.meta; no into ⇒ via on the card
    const c2 = ctx()
    const plainMsg: Message = {
      id: 'm2',
      from: 'alice',
      to: 'bob',
      payload: { kind: 'scalar', value: 'x', meta: { ts: 10 } },
      state: 'flying',
    }
    const w2 = applyIncoming(w, plainMsg, { recv: 'clock' }, c2)
    expect(plain(w2, 'bob.clock')).toBe(11)
    expect(c2.log.events.at(-1)).toEqual({ kind: 'via', path: 'bob', message: 'm2' })
    expect(() =>
      applyIncoming(
        w,
        { ...plainMsg, payload: { kind: 'scalar', value: 'x' } },
        { recv: 'clock' },
        ctx(),
      ),
    ).toThrow(/carries no ts/)
  })
  it('vector clock: send = tick own entry; receive = per-node max then tick', () => {
    let w = run(local(world(), init(['alice', 'bob'], 'vc', 'vector-clock')), [
      update('alice', 'vc', 'tick'),
    ])
    const s = stamped(w, 'alice', 'bob', 'vc', 'm1')
    expect(s.meta).toEqual({ vc: { alice: 2, bob: 0 } })
    w = deliver(s.world, 'm1', s.c)
    expect(plain(w, 'bob.vc')).toEqual({ alice: 2, bob: 1 })
    expect(s.c.log.events).toEqual([
      { kind: 'action', path: 'alice.vc', label: { key: 'stage.op.tick', by: 'alice' } },
      { kind: 'via', path: 'bob.vc', message: 'm1' },
      { kind: 'action', path: 'bob.vc', label: { key: 'stage.op.receive', by: 'alice' } },
      { kind: 'via', path: 'bob', message: 'm1' },
    ])
  })
  it('hlc: send = hlcNow(actor wall time); receive = hlcReceive with the recipient wall time', () => {
    let w = local(
      world([person('alice', { skew: 2 }), person('bob')], { now: 5 }),
      init(['alice', 'bob'], 'hlc', 'hlc'),
    )
    const s = stamped(w, 'alice', 'bob', 'hlc', 'm1')
    expect(s.meta).toEqual({ hlc: { wall: 7, counter: 0 }, ts: 7 * 65536 })
    w = deliver(s.world, 'm1', s.c)
    expect(plain(w, 'bob.hlc')).toEqual({ wall: 7, counter: 1 })
    expect(() => stampForSend(w, 'alice', 'nope', ctx())).toThrow(/no CRDT slot/)
    const w2 = local(w, init(['alice'], 'n', 'g-counter'))
    expect(() => stampForSend(w2, 'alice', 'n', ctx())).toThrow(
      /needs a lamport-clock, vector-clock or hlc/,
    )
    expect(() =>
      applyIncoming(
        w2,
        {
          id: 'x',
          from: 'bob',
          to: 'alice',
          payload: { kind: 'scalar', value: 1, meta: { ts: 1 } },
          state: 'flying',
        },
        { recv: 'n' },
        ctx(),
      ),
    ).toThrow(/receive rule needs/)
  })
  it('applyIncoming: state messages refuse into; a message without data or recv is left to the core', () => {
    let w = local(world(), init(['alice', 'bob'], 'views', 'g-counter'))
    w = local(w, update('alice', 'views', 'inc'))
    const out = wire(w, { t: 'crdt.send', from: 'alice', to: 'bob', slot: 'views', id: 'm1' })
    expect(() => deliver(out.world, 'm1', ctx(), { into: 'bob.views' })).toThrow(
      /not allowed for a state/,
    )
    const plainMsg: Message = {
      id: 'p',
      from: 'alice',
      to: 'bob',
      payload: { kind: 'scalar', value: 1 },
      state: 'flying',
    }
    expect(applyIncoming(w, plainMsg, {}, ctx())).toBe(w)
    expect(() => applyIncoming(w, { ...plainMsg, to: 'zed' }, {}, ctx())).toThrow(/no actor "zed"/)
  })
})

// ─── gc ───────────────────────────────────────────────────────────────────────────────────────

describe('crdt.gc', () => {
  function typed(): World {
    let w = local(
      world(),
      init(['alice', 'bob'], 'text', 'rga', { display: 'text', expose: ['stats'] }),
    )
    w = run(w, [
      update('alice', 'text', 'type', ['HEAD', 'cat']),
      update('alice', 'text', 'delete', ['alice:2']),
    ])
    return w
  }
  it('proves upTo ≤ every replica version, drops stable RGA tombstones (re-anchoring), compacts applied', () => {
    let w = typed()
    expect(() =>
      local(w, { t: 'crdt.gc', actor: 'alice', slot: 'text', upTo: { alice: 4, bob: 0 } }),
    ).toThrow(/not stable — "bob.text"/)
    const out = wire(w, { t: 'crdt.broadcast', from: 'alice', slot: 'text' })
    w = out.world
    for (const id of out.specs.map((s) => s.id)) w = deliver(w, id)
    expect(plain(w, 'bob.text@stats')).toEqual({ stored: 3, visible: 2 })
    w = local(w, { t: 'crdt.gc', actor: 'alice', slot: 'text', upTo: { alice: 4, bob: 0 } })
    expect(plain(w, 'alice.text@stats')).toEqual({ stored: 2, visible: 2 })
    expect(plain(w, 'alice.text')).toEqual(['c', 't'])
    expect(rep(w, 'alice', 'text').applied).toEqual([])
    expect(marks(w)).toEqual([]) // the stats changed: no "no change" pill
    // a second gc has nothing left to drop
    w = local(w, { t: 'crdt.gc', actor: 'alice', slot: 'text', upTo: { alice: 4, bob: 0 } })
    expect(marks(w)).toEqual([{ kind: 'unchanged', path: 'alice.text' }])
    // an unknown delete (newer than upTo) keeps its tombstone
    let w2 = typed()
    w2 = local(w2, { t: 'crdt.gc', actor: 'alice', slot: 'text', upTo: { alice: 3 }, unsafe: true })
    expect(plain(w2, 'alice.text@stats')).toEqual({ stored: 3, visible: 2 })
    expect(rep(w2, 'alice', 'text').applied).toEqual(['alice:4'])
  })
  it('unsafe skips the proof, defaults upTo to the own version, and lets a lagging merge resurrect', () => {
    let w = typed()
    expect(() => local(w, { t: 'crdt.gc', actor: 'alice', slot: 'text' })).toThrow(/needs "upTo"/)
    w = local(w, { t: 'crdt.gc', actor: 'alice', slot: 'text', unsafe: true })
    expect(plain(w, 'alice.text@stats')).toEqual({ stored: 2, visible: 2 })
    // bob never saw the delete: his full state brings 'a' back alive
    let bob = local(
      world(),
      init(['alice', 'bob'], 'text', 'rga', { display: 'text', expose: ['stats'] }),
    )
    bob = run(bob, [update('alice', 'text', 'type', ['HEAD', 'cat'])])
    bob = local(bob, { t: 'crdt.merge', into: 'bob', from: 'alice', slot: 'text' })
    const m = { ...w, replicas: { ...w.replicas, bob: bob.replicas.bob } } as World
    const back = local(refreshHolds(m, 'bob', 'text'), {
      t: 'crdt.merge',
      into: 'alice',
      from: 'bob',
      slot: 'text',
    })
    // 'a' is back. Alice forgot the structure that placed it (her 't' was re-anchored on 'c' when the
    // tombstone went), so the zombie lands after its old anchor's subtree — the price of an unsafe gc.
    expect(plain(back, 'alice.text')).toEqual(['c', 't', 'a'])
    expect(plain(back, 'alice.text@stats')).toEqual({ stored: 3, visible: 3 })
  })
  it('or-set / two-phase-set / lww-element-set / lww-map / op-counter gc; types without gc throw', () => {
    let w = local(world(), init(['alice', 'bob'], 'cart', 'or-set'))
    w = run(w, [
      update('alice', 'cart', 'add', ['milk']),
      update('alice', 'cart', 'remove', ['milk']),
      update('alice', 'cart', 'add', ['eggs']),
    ])
    w = local(w, { t: 'crdt.sync', a: 'alice', b: 'bob', slot: 'cart' })
    expect(plain(w, 'bob.cart[milk]@tomb')).toBe(true)
    w = local(w, { t: 'crdt.gc', actor: 'alice', slot: 'cart', upTo: { alice: 3 } })
    expect(holds(w, 'alice', 'cart')).toEqual({
      kind: 'set',
      items: [
        {
          id: 'eggs',
          value: {
            kind: 'scalar',
            value: 'eggs',
            meta: { tags: [{ tag: 'alice:3', alive: true }] },
          },
        },
      ],
    })
    expect(rep(w, 'alice', 'cart').state).toMatchObject({ tombstones: {} })
    // bob holds the tombstone too but only merged it in: the element's own tag alice:1 ≤ upTo proves it
    w = local(w, { t: 'crdt.gc', actor: 'bob', slot: 'cart', upTo: { alice: 3 } })
    expect(plain(w, 'bob.cart')).toEqual(['eggs'])
    expect(rep(w, 'bob', 'cart').state).toMatchObject({ tombstones: {} })
    let g = local(world(), init(['alice'], 'guests', 'two-phase-set'))
    g = run(g, [
      update('alice', 'guests', 'add', ['dan']),
      update('alice', 'guests', 'remove', ['dan']),
    ])
    g = local(g, { t: 'crdt.gc', actor: 'alice', slot: 'guests', upTo: { alice: 2 } })
    expect(holds(g, 'alice', 'guests')).toEqual({ kind: 'set', items: [] })
    let l = local(world([person('alice')], { now: 1 }), init(['alice'], 'fav', 'lww-element-set'))
    l = run(l, [
      update('alice', 'fav', 'add', ['jazz']),
      update('alice', 'fav', 'remove', ['jazz'], { ts: 2 }),
    ])
    l = local(l, { t: 'crdt.gc', actor: 'alice', slot: 'fav', upTo: { alice: 2 } })
    expect(holds(l, 'alice', 'fav')).toEqual({ kind: 'set', items: [] })
    let m = local(world(), init(['alice'], 'task', 'lww-map'))
    m = run(m, [
      update('alice', 'task', 'set', ['due', 'Fri']),
      update('alice', 'task', 'remove', ['due'], { ts: 1 }),
    ])
    m = local(m, { t: 'crdt.gc', actor: 'alice', slot: 'task', upTo: { alice: 2 } })
    expect(holds(m, 'alice', 'task')).toEqual({ kind: 'record', fields: [] })
    let o = local(world(), init(['alice'], 'likes', 'op-counter', { expose: ['applied'] }))
    o = run(o, [update('alice', 'likes', 'inc'), update('alice', 'likes', 'inc')])
    o = local(o, { t: 'crdt.gc', actor: 'alice', slot: 'likes', upTo: { alice: 1 } })
    expect(holds(o, 'alice', 'likes')).toEqual({
      kind: 'scalar',
      value: 2,
      meta: { applied: ['alice:2'] },
    })
    const c = local(world(), init(['alice'], 'views', 'g-counter'))
    expect(() => local(c, { t: 'crdt.gc', actor: 'alice', slot: 'views', unsafe: true })).toThrow(
      /nothing to collect/,
    )
  })
  it('doc gc collects removed set members (and their sub-documents) part by part', () => {
    let w = local(world(), {
      t: 'crdt.doc',
      actors: ['alice'],
      slot: 'list',
      fields: { items: { set: { map: { name: 'lww-register' } } } },
    })
    w = run(w, [
      update('alice', 'list', 'add', [{ name: 'milk' }], { path: 'items' }),
      update('alice', 'list', 'remove', ['alice:1'], { path: 'items' }),
    ])
    expect(holds(w, 'alice', 'list')).toMatchObject({
      fields: [
        {
          key: 'items',
          value: { items: [{ id: 'alice:1', value: { meta: { tombstone: true } } }] },
        },
      ],
    })
    w = local(w, { t: 'crdt.gc', actor: 'alice', slot: 'list', upTo: { alice: 2 } })
    expect(holds(w, 'alice', 'list')).toEqual({
      kind: 'record',
      fields: [{ key: 'items', value: { kind: 'set', items: [], meta: { type: 'or-set' } } }],
    })
  })
})

// ─── determinism ──────────────────────────────────────────────────────────────────────────────

describe('determinism', () => {
  it('two runs of the same commands give deep-equal worlds, and inputs are never mutated', () => {
    const cmds: CrdtLocalCommand[] = [
      init(['alice', 'bob'], 'cart', 'or-set', { seed: [{ op: 'add', args: ['milk'] }] }),
      update('alice', 'cart', 'add', ['eggs']),
      update('bob', 'cart', 'remove', ['milk']),
      { t: 'crdt.sync', a: 'alice', b: 'bob', slot: 'cart' },
    ]
    const w0 = world()
    const frozen = JSON.stringify(w0)
    const a = run(w0, cmds)
    const b = run(w0, cmds)
    expect(a).toEqual(b)
    expect(JSON.stringify(w0)).toBe(frozen)
    expect(JSON.parse(JSON.stringify(a))).toEqual(a) // replicas are plain JSON
  })
})

// ─── Action labels (DSL §14 `Change.action`) ──────────────────────────────────────────────────

describe('action events (the mutation points a value change shows)', () => {
  const actions = (c: Ctx) =>
    c.log.events.flatMap((e) => (e.kind === 'action' ? [{ path: e.path, ...e.label }] : []))

  it('crdt.update: the op label, in the actor, on the node the op touched', () => {
    let w = local(world(), init(['alice', 'bob'], 'views', 'g-counter'))
    const c1 = ctx()
    w = local(w, update('alice', 'views', 'inc'), c1)
    expect(actions(c1)).toEqual([
      { path: 'alice.views[alice]', key: 'stage.op.inc', vars: { n: 1 }, by: 'alice' },
    ])
    w = local(w, init(['alice', 'bob'], 'status', 'lww-register'))
    const c2 = ctx()
    w = local(w, update('alice', 'status', 'set', ['Lunch']), c2)
    expect(actions(c2)).toEqual([
      { path: 'alice.status', key: 'stage.op.set', vars: { value: 'Lunch' }, by: 'alice' },
    ])
    w = local(w, init(['alice', 'bob'], 'cart', 'or-set'))
    const c3 = ctx()
    w = local(w, update('alice', 'cart', 'add', ['milk']), c3)
    w = local(w, update('alice', 'cart', 'add', ['eggs']), c3)
    w = local(w, update('alice', 'cart', 'remove', ['milk']), c3)
    expect(actions(c3)).toEqual([
      {
        path: 'alice.cart[milk]',
        key: 'stage.op.addTag',
        vars: { value: 'milk', tag: 'alice:1' },
        by: 'alice',
      },
      {
        path: 'alice.cart[eggs]',
        key: 'stage.op.addTag',
        vars: { value: 'eggs', tag: 'alice:2' },
        by: 'alice',
      },
      {
        path: 'alice.cart[milk]',
        key: 'stage.op.removeTags',
        vars: { value: 'milk', tags: 'alice:1' },
        by: 'alice',
      },
    ])
    w = local(w, init(['alice', 'bob'], 'note', 'rga'))
    const c4 = ctx()
    w = local(w, update('alice', 'note', 'insertAfter', ['HEAD', 'h']), c4)
    expect(actions(c4)).toEqual([
      {
        path: 'alice.note[alice:1]',
        key: 'stage.op.insert',
        vars: { value: '"h"', anchor: 'HEAD' },
        by: 'alice',
      },
    ])
    // an op that changes nothing visible (g-set re-add) names the slot; a clock tick names the slot
    w = local(w, init(['alice'], 'seen', 'g-set'))
    w = local(w, update('alice', 'seen', 'add', ['x']))
    const c5 = ctx()
    local(w, update('alice', 'seen', 'add', ['x']), c5)
    expect(actions(c5)).toEqual([
      { path: 'alice.seen', key: 'stage.op.add', vars: { value: 'x' }, by: 'alice' },
    ])
  })

  it('crdt.update on a composed document lands on the part; rga macros make one chip for the run', () => {
    let w = local(world(), {
      t: 'crdt.doc',
      actors: ['alice'],
      slot: 'card',
      fields: { title: 'lww-register', qty: 'g-counter', text: 'rga' },
    })
    const c = ctx()
    w = local(w, update('alice', 'card', 'inc', [2], { path: 'qty' }), c)
    w = local(w, update('alice', 'card', 'set', ['Q3'], { path: 'title' }), c)
    w = local(w, update('alice', 'card', 'type', ['HEAD', 'hi'], { path: 'text' }), c)
    expect(actions(c)).toEqual([
      { path: 'alice.card.qty[alice]', key: 'stage.op.inc', vars: { n: 2 }, by: 'alice' },
      { path: 'alice.card.title', key: 'stage.op.set', vars: { value: 'Q3' }, by: 'alice' },
      {
        path: 'alice.card.text',
        key: 'stage.op.insert',
        vars: { value: '"hi"', anchor: 'HEAD' },
        by: 'alice',
      },
    ])
    const c2 = ctx()
    local(w, update('alice', 'card', 'deleteRange', ['alice:3', 'alice:4'], { path: 'text' }), c2)
    expect(actions(c2)).toEqual([
      {
        path: 'alice.card.text',
        key: 'stage.op.deleteRange',
        vars: { from: 'alice:3', to: 'alice:4' },
        by: 'alice',
      },
    ])
  })

  it('merge / sync: "merge" on every slot that changed, in the hue of where the state came from', () => {
    let w = local(world(), init(['alice', 'bob'], 'cart', 'or-set'))
    w = local(w, update('alice', 'cart', 'add', ['milk']))
    w = local(w, update('bob', 'cart', 'add', ['eggs']))
    const c = ctx()
    w = local(w, { t: 'crdt.sync', a: 'alice', b: 'bob', slot: 'cart' }, c)
    expect(actions(c)).toEqual([
      { path: 'alice.cart', key: 'stage.op.merge', by: 'bob' },
      { path: 'bob.cart', key: 'stage.op.merge', by: 'alice' },
    ])
    // nothing new for bob → no merge chip for him (the "no change" pill speaks)
    w = local(w, update('alice', 'cart', 'add', ['jam']))
    const c2 = ctx()
    w = local(w, { t: 'crdt.merge', into: 'bob', from: 'alice', slot: 'cart' }, c2)
    expect(actions(c2)).toEqual([{ path: 'bob.cart', key: 'stage.op.merge', by: 'alice' }])
    const c3 = ctx()
    local(w, { t: 'crdt.merge', into: 'bob', from: 'alice', slot: 'cart' }, c3)
    expect(actions(c3)).toEqual([])
  })

  it('a delivered state merges ("merge"); a delivered op carries its own label in its creator', () => {
    let w = local(world(), init(['alice', 'bob'], 'views', 'g-counter'))
    w = local(w, update('alice', 'views', 'inc', [3]))
    const sent = wire(w, { t: 'crdt.send', from: 'alice', to: 'bob', slot: 'views', id: 'm1' })
    const c = ctx()
    w = deliver(sent.world, 'm1', c)
    expect(actions(c)).toEqual([{ path: 'bob.views', key: 'stage.op.merge', by: 'alice' }])
    w = local(w, init(['alice', 'bob'], 'cart', 'or-set', { wire: 'ops' }))
    w = local(w, update('alice', 'cart', 'add', ['milk']))
    const out = wire(w, { t: 'crdt.broadcast', from: 'alice', slot: 'cart' })
    const c2 = ctx()
    deliver(out.world, 'alice:1@bob', c2)
    expect(actions(c2)).toEqual([
      {
        path: 'bob.cart[milk]',
        key: 'stage.op.addTag',
        vars: { value: 'milk', tag: 'alice:1' },
        by: 'alice',
      },
    ])
  })
})
