/**
 * CRDT command builders (docs/animation-dsl.md §8.4): the `crdt.*` namespace, seed helpers, typed
 * per-CRDT sugar (op names are a compile error, not a runtime surprise), the loosely typed
 * `doc(slot).at(path)` and the `S.*` schema builders for composed documents.
 */
import type {
  ActorId,
  CrdtArgs,
  CrdtName,
  CrdtSchema,
  MessageId,
  Scalar,
  SeedOp,
  SlotId,
  VectorClock,
} from '../types'
import { compact, type Cmd } from './internal'

// ─── crdt.* ───────────────────────────────────────────────────────────────────────────────────

export type UpdateOpts = { ts?: number; quiet?: boolean }
export type CrdtSendOpts = {
  id?: MessageId
  label?: string
  mode?: 'full' | 'delta'
  textId?: string
}
export type CrdtBroadcastOpts = { to?: ReadonlyArray<ActorId>; id?: MessageId }
export type CrdtGcOpts = { upTo?: VectorClock; unsafe?: boolean }

function update(
  actor: ActorId,
  slot: SlotId,
  op: string,
  args: ReadonlyArray<unknown>,
  extra?: UpdateOpts & { path?: string },
): Cmd<'crdt.update'> {
  return compact({
    t: 'crdt.update',
    actor,
    slot,
    path: extra?.path,
    op,
    args: args.length > 0 ? [...args] : undefined,
    ts: extra?.ts,
    quiet: extra?.quiet,
  })
}

export const crdt = {
  /** `crdt.init(['alice', 'bob'], 'status', 'lww-register', { seed: [seed('set', 'Offline')] })`. */
  init(
    actors: ReadonlyArray<ActorId>,
    slot: SlotId,
    type: CrdtName,
    args?: CrdtArgs,
  ): Cmd<'crdt.init'> {
    return compact({ t: 'crdt.init', actors: [...actors], slot, type, args })
  },
  /** `crdt.doc(['alice', 'bob'], 'list', { title: S.lww(), items: S.set(S.map({...})) }, { seed })`. */
  doc(
    actors: ReadonlyArray<ActorId>,
    slot: SlotId,
    fields: Record<string, CrdtSchema>,
    args?: CrdtArgs,
  ): Cmd<'crdt.doc'> {
    return compact({ t: 'crdt.doc', actors: [...actors], slot, fields, args })
  },
  /** `crdt.update('alice', 'status', 'set', 'In a meeting')` — args spread. */
  update(actor: ActorId, slot: SlotId, op: string, ...args: unknown[]): Cmd<'crdt.update'> {
    return update(actor, slot, op, args)
  },
  /** `crdt.updateAt('alice', 'list', 'items[alice:1].qty', 'inc', 2)` — a composed-document part. */
  updateAt(
    actor: ActorId,
    slot: SlotId,
    path: string,
    op: string,
    ...args: unknown[]
  ): Cmd<'crdt.update'> {
    return update(actor, slot, op, args, { path })
  },
  /** The raw form, for `ts` / `quiet` / `path` together: `crdt.updateWith({ actor, slot, op, args, ts })`. */
  updateWith(u: {
    actor: ActorId
    slot: SlotId
    op: string
    args?: ReadonlyArray<unknown>
    path?: string
    ts?: number
    quiet?: boolean
  }): Cmd<'crdt.update'> {
    return update(u.actor, u.slot, u.op, u.args ?? [], { path: u.path, ts: u.ts, quiet: u.quiet })
  },
  /** `crdt.send('alice', 'bob', 'status', { id: 'm1', mode: 'delta', label: 'state' })` — state on the wire. */
  send(
    from: ActorId,
    to: ActorId | ReadonlyArray<ActorId>,
    slot: SlotId,
    opts?: CrdtSendOpts,
  ): Cmd<'crdt.send'> {
    return compact({
      t: 'crdt.send',
      from,
      to: typeof to === 'string' ? to : [...to],
      slot,
      id: opts?.id,
      label: opts?.label,
      mode: opts?.mode,
      textId: opts?.textId,
    })
  },
  /** `crdt.broadcast('alice', 'likes', { to: ['server'] })` — ops on the wire: flush the outbox. */
  broadcast(from: ActorId, slot: SlotId, opts?: CrdtBroadcastOpts): Cmd<'crdt.broadcast'> {
    return compact({
      t: 'crdt.broadcast',
      from,
      slot,
      to: opts?.to === undefined ? undefined : [...opts.to],
      id: opts?.id,
    })
  },
  /** `crdt.merge('bob', 'alice', 'status')` — instant one-way merge into Bob from Alice. */
  merge(into: ActorId, from: ActorId, slot: SlotId): Cmd<'crdt.merge'> {
    return { t: 'crdt.merge', into, from, slot }
  },
  /** `crdt.sync('alice', 'bob', 'status')` / `crdt.sync('alice', 'server', 'note', { mode: 'ops' })`. */
  sync(a: ActorId, b: ActorId, slot: SlotId, opts?: { mode?: 'state' | 'ops' }): Cmd<'crdt.sync'> {
    return compact({ t: 'crdt.sync', a, b, slot, mode: opts?.mode })
  },
  /** `crdt.gc('alice', 'text', { upTo: { alice: 4, bob: 0 } })` / `{ unsafe: true }` (say "(simplified)"). */
  gc(actor: ActorId, slot: SlotId, opts?: CrdtGcOpts): Cmd<'crdt.gc'> {
    return compact({ t: 'crdt.gc', actor, slot, upTo: opts?.upTo, unsafe: opts?.unsafe })
  },
}

// ─── Seeds ────────────────────────────────────────────────────────────────────────────────────

const seedOp = (
  op: string,
  args: ReadonlyArray<unknown>,
  rest?: { by?: string; path?: string },
): SeedOp =>
  compact({ by: rest?.by, path: rest?.path, op, args: args.length > 0 ? [...args] : undefined })

/**
 * `seed('set', 'Offline')` — by the pseudo-node `seed`, `ts` 0. `seed.by('alice', 'add', 'milk')`
 * consumes Alice's seq; `seed.at('title', 'set', 'Groceries')` targets a doc part;
 * `seed.text('alice', 'cat')` is the RGA `type` macro anchored at HEAD. For `by` + `path` (or a
 * `ts`), write the `{ by, path, op, args, ts }` literal.
 */
export const seed = Object.assign((op: string, ...args: unknown[]): SeedOp => seedOp(op, args), {
  by: (by: ActorId, op: string, ...args: unknown[]): SeedOp => seedOp(op, args, { by }),
  at: (path: string, op: string, ...args: unknown[]): SeedOp => seedOp(op, args, { path }),
  text: (by: ActorId, s: string): SeedOp => ({ by, op: 'type', args: ['HEAD', s] }),
})

// ─── Typed per-CRDT sugar ─────────────────────────────────────────────────────────────────────

type Anchor = string // an element id (`alice:1`) or 'HEAD'

/** `lww('status').set('alice', 'In a meeting')`. */
export const lww = (slot: SlotId) => ({
  set: (actor: ActorId, value: unknown, opts?: UpdateOpts) =>
    update(actor, slot, 'set', [value], opts),
})
/** `lwwMap('task').set('bob', 'status', 'Doing')` / `.remove('bob', 'due')`. */
export const lwwMap = (slot: SlotId) => ({
  set: (actor: ActorId, key: string, value: unknown, opts?: UpdateOpts) =>
    update(actor, slot, 'set', [key, value], opts),
  remove: (actor: ActorId, key: string, opts?: UpdateOpts) =>
    update(actor, slot, 'remove', [key], opts),
})
/** `maxReg('best').set('alice', 3)`. */
export const maxReg = (slot: SlotId) => ({
  set: (actor: ActorId, n: number, opts?: UpdateOpts) => update(actor, slot, 'set', [n], opts),
})
/** `mvReg('cart').set('alice', 'milk, eggs')`. */
export const mvReg = (slot: SlotId) => ({
  set: (actor: ActorId, value: unknown, opts?: UpdateOpts) =>
    update(actor, slot, 'set', [value], opts),
})
const incDec = (slot: SlotId) => ({
  /** `inc(actor)` = +1; `inc(actor, n)`. */
  inc: (actor: ActorId, n?: number, opts?: UpdateOpts) =>
    update(actor, slot, 'inc', n === undefined ? [] : [n], opts),
  /** `dec(actor)` = −1; `dec(actor, n)`. */
  dec: (actor: ActorId, n?: number, opts?: UpdateOpts) =>
    update(actor, slot, 'dec', n === undefined ? [] : [n], opts),
})
/** `gcounter('views').inc('alice', 2)`. */
export const gcounter = (slot: SlotId) => {
  const { inc } = incDec(slot)
  return { inc }
}
/** `pncounter('likes').dec('alice')`. */
export const pncounter = incDec
/** `opcounter('likes').inc('alice')`. */
export const opcounter = incDec
const addOnly = (slot: SlotId) => ({
  add: (actor: ActorId, element: unknown, opts?: UpdateOpts) =>
    update(actor, slot, 'add', [element], opts),
})
const addRemove = (slot: SlotId) => ({
  ...addOnly(slot),
  remove: (actor: ActorId, element: unknown, opts?: UpdateOpts) =>
    update(actor, slot, 'remove', [element], opts),
})
/** `gset('seen').add('alice', 'm1')`. */
export const gset = addOnly
/** `twoPSet('guests').remove('bob', 'dan')`. */
export const twoPSet = addRemove
/** `lwwSet('fav').add('alice', 'jazz')`. */
export const lwwSet = addRemove
/** `orSet('cart').remove('bob', 'milk')`. */
export const orSet = addRemove
/** `rga('text').insertAfter('bob', 'alice:1', 'h')` · `.type('alice', 'alice:5', ' world')` · `.delete('alice', 'alice:1')`. */
export const rga = (slot: SlotId) => ({
  insertAfter: (actor: ActorId, anchor: Anchor, value: unknown, opts?: UpdateOpts) =>
    update(actor, slot, 'insertAfter', [anchor, value], opts),
  insertAt: (actor: ActorId, index: number, value: unknown, opts?: UpdateOpts) =>
    update(actor, slot, 'insertAt', [index, value], opts),
  delete: (actor: ActorId, id: string, opts?: UpdateOpts) =>
    update(actor, slot, 'delete', [id], opts),
  deleteAt: (actor: ActorId, index: number, opts?: UpdateOpts) =>
    update(actor, slot, 'deleteAt', [index], opts),
  /** One real insert per character, each with its own id (expanded inside the reducer). */
  type: (actor: ActorId, anchor: Anchor, s: string, opts?: UpdateOpts) =>
    update(actor, slot, 'type', [anchor, s], opts),
  deleteRange: (actor: ActorId, fromId: string, toId: string, opts?: UpdateOpts) =>
    update(actor, slot, 'deleteRange', [fromId, toId], opts),
})
const ticker = (slot: SlotId) => ({
  tick: (actor: ActorId, opts?: UpdateOpts) => update(actor, slot, 'tick', [], opts),
})
/** `vclock('vc').tick('alice')`. */
export const vclock = ticker
/** `lamport('clock').tick('carol')`. */
export const lamport = ticker
/** `hlc('hlc').tick('bob')`. */
export const hlc = ticker

/** Every leaf op a composed-document part can take (loosely typed: `(actor, ...args)`). */
export const DOC_OPS = [
  'set',
  'remove',
  'add',
  'inc',
  'dec',
  'insertAfter',
  'insertAt',
  'delete',
  'deleteAt',
  'type',
  'deleteRange',
  'tick',
] as const
export type DocOp = (typeof DOC_OPS)[number]
export type DocPartOps = Record<DocOp, (actor: ActorId, ...args: unknown[]) => Cmd<'crdt.update'>>

/**
 * `doc('list').at('items[alice:1].qty').inc('bob', 1)` · `doc('list').at('items').add('alice', { name: 'milk' })`
 * — loosely typed; the reducer dry-run checks op names and arity against the part's type.
 */
export const doc = (slot: SlotId) => ({
  at: (path: string): DocPartOps => {
    const ops = {} as DocPartOps
    for (const op of DOC_OPS) {
      ops[op] = (actor: ActorId, ...args: unknown[]) => update(actor, slot, op, args, { path })
    }
    return ops
  },
})

// ─── S.* schema builders ──────────────────────────────────────────────────────────────────────

const leaf =
  (type: CrdtName) =>
  (args?: CrdtArgs): CrdtSchema =>
    args === undefined ? type : { type, args }

/** Composed-document schema nodes: `S.map({ title: S.lww(), items: S.set(S.map({ qty: S.pn() })) })`. */
export const S = {
  lww: leaf('lww-register'),
  lwwMap: leaf('lww-map'),
  mvr: leaf('mv-register'),
  max: leaf('max-register'),
  g: leaf('g-counter'),
  pn: leaf('pn-counter'),
  opCounter: leaf('op-counter'),
  gset: leaf('g-set'),
  twoP: leaf('two-phase-set'),
  lwwSet: leaf('lww-element-set'),
  orSet: leaf('or-set'),
  rga: leaf('rga'),
  lamport: leaf('lamport-clock'),
  vclock: leaf('vector-clock'),
  hlc: leaf('hlc'),
  /** An immutable label (a poll question). */
  const: (value: Scalar): CrdtSchema => ({ const: value }),
  /** Fixed fields. */
  map: (fields: Record<string, CrdtSchema>): CrdtSchema => ({ map: fields }),
  /** An RGA whose items follow the schema. */
  list: (of: CrdtSchema): CrdtSchema => ({ list: of }),
  /** An OR-Set of sub-documents, keyed by the tag of the add that created them. */
  set: (of: CrdtSchema): CrdtSchema => ({ set: of }),
}
