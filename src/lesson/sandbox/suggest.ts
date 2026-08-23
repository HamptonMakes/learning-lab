/**
 * "Try this" suggestions for the sandbox (docs/animation-dsl.md §11). `suggestExperiments(world,
 * tryIt?)` looks at the CRDT slots of the start world and returns two or three short experiments:
 * one per slot, chosen by the slot's type (a race for registers, a double-count check for counters,
 * an add-vs-remove race for sets, typing on both sides for an RGA, two ticks for clocks, broadcast +
 * deliver for an ops-wired slot), plus one about a partition (offline, change, back online, sync).
 *
 * Every suggestion carries `done(history)`: a small pattern check over the sandbox history (the
 * frames after the start) so the checklist ticks itself. Detection is deliberately simple — it
 * reads the commands of each step (and the delivered messages of its change log) and looks for
 * the shape of the experiment, e.g. "writes by two actors, then an exchange of that slot".
 *
 * Pure: no React, no i18n — copy is `{ key, vars }` for `t()`.
 */
import type { Actor, ActorId, Command, Frame, Replica, SlotId, TryIt, World } from '../types'
import type { UiText } from './derive'

export type Suggestion = {
  /** Stable within one world: `${kind}-${slot}`; also the `data-testid` suffix. */
  id: string
  kind: SuggestionKind
  slot: SlotId
  text: UiText
  /** True once the sandbox history (start frame first) shows the experiment. */
  done: (history: readonly Frame[]) => boolean
}

export type SuggestionKind =
  | 'race'
  | 'doubleCount'
  | 'addRemove'
  | 'readd'
  | 'addBoth'
  | 'typeBoth'
  | 'ticks'
  | 'broadcastDeliver'
  | 'offlineFirst'
  | 'partition'

// ─── Events: the flat, ordered story of a sandbox history ─────────────────────────────────────

type Ev =
  | { kind: 'update'; actor: ActorId; slot: SlotId; op: string; arg: string }
  | { kind: 'exchange'; slot: SlotId } // crdt.sync / crdt.merge / a delivered state or op message
  | { kind: 'broadcast'; actor: ActorId; slot: SlotId }
  | { kind: 'offline'; actor: ActorId }
  | { kind: 'online'; actor: ActorId }

const argKey = (args: unknown[] | undefined): string => {
  try {
    return JSON.stringify(args?.[0]) ?? ''
  } catch {
    return ''
  }
}

/** The events of every frame after the start, in order. */
export function historyEvents(history: readonly Frame[]): Ev[] {
  const out: Ev[] = []
  for (const frame of history.slice(1)) {
    const delivered = frame.changes.flatMap((c) =>
      c.kind === 'message' && c.op === 'delivered' ? [c.message] : [],
    )
    for (const cmd of frame.step.do as Command[]) {
      switch (cmd.t) {
        case 'crdt.update':
          out.push({
            kind: 'update',
            actor: cmd.actor,
            slot: cmd.slot,
            op: cmd.op,
            arg: argKey(cmd.args),
          })
          break
        case 'crdt.sync':
          out.push({ kind: 'exchange', slot: cmd.slot })
          break
        case 'crdt.merge':
          out.push({ kind: 'exchange', slot: cmd.slot })
          break
        case 'crdt.broadcast':
          out.push({ kind: 'broadcast', actor: cmd.from, slot: cmd.slot })
          break
        case 'crdt.send':
          out.push({ kind: 'broadcast', actor: cmd.from, slot: cmd.slot })
          break
        case 'deliver': {
          const data = delivered.find((m) => m.id === cmd.message)?.data
          if (data && (data.kind === 'op' || data.kind === 'state')) {
            out.push({ kind: 'exchange', slot: data.slot })
          }
          break
        }
        case 'offline':
          out.push({ kind: 'offline', actor: cmd.actor })
          break
        case 'online':
          out.push({ kind: 'online', actor: cmd.actor })
          break
        default:
          break
      }
    }
  }
  return out
}

// ─── Patterns ─────────────────────────────────────────────────────────────────────────────────

type Pattern = (events: Ev[], slot: SlotId) => boolean

/** Writes (matching `ops`, if given) by two different actors, then an exchange of the slot. */
const writesByTwoThenExchange =
  (ops?: ReadonlySet<string>): Pattern =>
  (events, slot) => {
    const writers = new Set<ActorId>()
    for (const e of events) {
      if (e.kind === 'update' && e.slot === slot && (!ops || ops.has(e.op))) writers.add(e.actor)
      else if (e.kind === 'exchange' && e.slot === slot) {
        if (writers.size >= 2) return true
        writers.clear()
      }
    }
    return false
  }

/** Increments by two actors, an exchange, then another exchange of the slot. */
const doubleCount: Pattern = (events, slot) => {
  const writers = new Set<ActorId>()
  let synced = false
  for (const e of events) {
    if (e.kind === 'update' && e.slot === slot) writers.add(e.actor)
    else if (e.kind === 'exchange' && e.slot === slot) {
      if (synced) return true
      if (writers.size >= 2) synced = true
      writers.clear()
    }
  }
  return false
}

/** One actor adds X while another removes X (same round), then an exchange. */
const addRemoveRace: Pattern = (events, slot) => {
  let adds = new Map<string, ActorId>()
  let removes = new Map<string, ActorId>()
  for (const e of events) {
    if (e.kind === 'update' && e.slot === slot) {
      if (e.op === 'add') adds.set(e.arg, e.actor)
      if (e.op === 'remove') removes.set(e.arg, e.actor)
    } else if (e.kind === 'exchange' && e.slot === slot) {
      for (const [arg, actor] of adds) {
        const remover = removes.get(arg)
        if (remover !== undefined && remover !== actor) return true
      }
      adds = new Map()
      removes = new Map()
    }
  }
  return false
}

/** Remove X, later add X again (anyone), then an exchange. */
const removeThenReadd: Pattern = (events, slot) => {
  const removed = new Set<string>()
  let readded = false
  for (const e of events) {
    if (e.kind === 'update' && e.slot === slot) {
      if (e.op === 'remove') removed.add(e.arg)
      if (e.op === 'add' && removed.has(e.arg)) readded = true
    } else if (e.kind === 'exchange' && e.slot === slot && readded) return true
  }
  return false
}

/** Two ticks by the same actor, then an exchange. */
const twoTicksThenExchange: Pattern = (events, slot) => {
  const ticks = new Map<ActorId, number>()
  for (const e of events) {
    if (e.kind === 'update' && e.slot === slot && e.op === 'tick') {
      ticks.set(e.actor, (ticks.get(e.actor) ?? 0) + 1)
    } else if (e.kind === 'exchange' && e.slot === slot) {
      if ([...ticks.values()].some((n) => n >= 2)) return true
      ticks.clear()
    }
  }
  return false
}

/** A broadcast of the slot, then a delivery of it. */
const broadcastThenDeliver: Pattern = (events, slot) => {
  let sent = false
  for (const e of events) {
    if (e.kind === 'broadcast' && e.slot === slot) sent = true
    else if (e.kind === 'exchange' && e.slot === slot && sent) return true
  }
  return false
}

/** Someone goes offline, a broadcast happens meanwhile, they come back, a delivery follows. */
const offlineThenBroadcast: Pattern = (events, slot) => {
  const offline = new Set<ActorId>()
  let parkedFor = new Set<ActorId>()
  let back = false
  for (const e of events) {
    if (e.kind === 'offline') offline.add(e.actor)
    else if (e.kind === 'broadcast' && e.slot === slot && offline.size > 0) {
      parkedFor = new Set(offline)
    } else if (e.kind === 'online') {
      offline.delete(e.actor)
      if (parkedFor.has(e.actor)) back = true
    } else if (e.kind === 'exchange' && e.slot === slot && back) return true
  }
  return false
}

/** Someone goes offline, both sides write, they come back, then an exchange of the slot. */
const partition: Pattern = (events, slot) => {
  const offline = new Set<ActorId>()
  let writers = new Set<ActorId>()
  let ready = false
  for (const e of events) {
    if (e.kind === 'offline') {
      offline.add(e.actor)
      writers = new Set()
    } else if (e.kind === 'update' && e.slot === slot && offline.size > 0) writers.add(e.actor)
    else if (e.kind === 'online') {
      offline.delete(e.actor)
      if (writers.size >= 2) ready = true
    } else if (e.kind === 'exchange' && e.slot === slot) {
      if (ready) return true
      writers = new Set()
    }
  }
  return false
}

// ─── Choosing ─────────────────────────────────────────────────────────────────────────────────

const ADD = new Set(['add'])
const TYPE = new Set(['type', 'insert', 'insertAt'])

function typePattern(replica: Replica): { kind: SuggestionKind; check: Pattern } | undefined {
  if (replica.args.wire === 'ops') return { kind: 'broadcastDeliver', check: broadcastThenDeliver }
  switch (replica.type) {
    case 'lww-register':
    case 'max-register':
    case 'mv-register':
    case 'lww-map':
    case 'doc':
      return { kind: 'race', check: writesByTwoThenExchange() }
    case 'g-counter':
    case 'pn-counter':
    case 'op-counter':
      return { kind: 'doubleCount', check: doubleCount }
    case 'or-set':
    case 'lww-element-set':
      return { kind: 'addRemove', check: addRemoveRace }
    case 'two-phase-set':
      return { kind: 'readd', check: removeThenReadd }
    case 'g-set':
      return { kind: 'addBoth', check: writesByTwoThenExchange(ADD) }
    case 'rga':
      return { kind: 'typeBoth', check: writesByTwoThenExchange(TYPE) }
    case 'lamport-clock':
    case 'vector-clock':
    case 'hlc':
      return { kind: 'ticks', check: twoTicksThenExchange }
  }
}

const MAX = 3

/**
 * Two or three experiments for `world` (restricted by `tryIt` like the controls are). Slots are
 * visited in world order; a slot needs two online-capable holders to suggest anything.
 */
export function suggestExperiments(world: World, tryIt?: TryIt): Suggestion[] {
  const actorIds = Object.keys(world.actors)
  const slotIds: SlotId[] = []
  for (const a of actorIds) {
    for (const s of Object.keys(world.replicas[a] ?? {})) if (!slotIds.includes(s)) slotIds.push(s)
  }
  const slots = slotIds.filter((s) => !tryIt || s === tryIt.slot)
  const net = (kind: 'sync' | 'send' | 'offline'): boolean =>
    !tryIt?.network || tryIt.network.includes(kind)
  const canExchange = net('sync') || net('send')

  const out: Suggestion[] = []
  const make = (
    kind: SuggestionKind,
    slot: SlotId,
    check: Pattern,
    vars: Record<string, string>,
  ): Suggestion => ({
    id: `${kind}-${slot}`,
    kind,
    slot,
    text: { key: `tryIt.suggest.${kind}`, vars: { slot, ...vars } },
    done: (history) => check(historyEvents(history), slot),
  })

  let partitionSlot: { slot: SlotId; a: Actor; b: Actor; wire: 'state' | 'ops' } | undefined
  for (const slot of slots) {
    const holders = actorIds
      .filter((a) => world.replicas[a]?.[slot] !== undefined)
      .filter((a) => !tryIt?.actors || tryIt.actors.includes(a))
      .map((a) => world.actors[a])
      .filter((a): a is Actor => a !== undefined)
    const [a, b] = holders
    const replica = a ? world.replicas[a.id]?.[slot] : undefined
    if (!a || !b || !replica || !canExchange) continue
    const p = typePattern(replica)
    if (p && out.length < MAX) out.push(make(p.kind, slot, p.check, { a: a.label, b: b.label }))
    partitionSlot ??= { slot, a, b, wire: replica.args.wire ?? 'state' }
  }
  if (partitionSlot && net('offline') && out.length < MAX) {
    const { slot, a, b, wire } = partitionSlot
    out.push(
      wire === 'ops'
        ? make('offlineFirst', slot, offlineThenBroadcast, { a: a.label, b: b.label })
        : make('partition', slot, partition, { a: a.label, b: b.label }),
    )
  }
  return out
}
