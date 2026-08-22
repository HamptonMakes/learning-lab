/**
 * Sandbox control derivation (docs/animation-dsl.md §11). `deriveControls(world, tryIt?)` looks at
 * the replicas of a world and returns, for every actor and every CRDT slot, the op buttons that
 * make sense for the slot's type (set / inc / add / type …), plus the delivery controls (sync pairs,
 * broadcast + deliver-all, offline/online toggles, tick). Every control builds plain DSL commands;
 * the sandbox runs them through the real reducer, so the stage can never show a state the real
 * code did not compute.
 *
 * A scene's `TryIt` declaration is an optional override: it restricts the controls to one slot,
 * a list of actors, a list of ops (with labels and fixed or prompted args) and a list of network
 * controls. Without it, everything is derived from the world.
 *
 * Pure: no React, no i18n — labels are `{ key, vars }` for `t()` (or `{ text }` when a TryIt
 * supplies a literal label).
 */
import { crdt, deliver, drop, offline, online, tick } from '../builders'
import { plainValue } from '../path'
import type {
  Actor,
  ActorId,
  Command,
  CrdtName,
  CrdtSchema,
  Item,
  Message,
  MessageId,
  NodeId,
  Replica,
  SlotId,
  TryIt,
  Value,
  VectorClock,
  World,
} from '../types'

// ─── Types ────────────────────────────────────────────────────────────────────────────────────

/** A localizable piece of UI text: a `t()` key with vars, or a literal (from a TryIt label). */
export type UiText = { key: string; vars?: Record<string, string | number> } | { text: string }

export type SandboxPrompt =
  | { kind: 'text'; label: UiText }
  | { kind: 'number'; label: UiText }
  | { kind: 'field' } // key + value (lww-map set)
  | { kind: 'choice'; options: Array<{ id: string; label: string }> } // pick an existing item

/** What the prompt collected; `choice` is an option id of a `choice` prompt. */
export type SandboxInput = { value?: string; key?: string; choice?: string }

export type SandboxControl = {
  /** Unique among all controls of one derivation; also the `data-testid` suffix (`try-it-${id}`). */
  id: string
  /** Analytics action (`set`, `inc`, `sync`, `offline` …). */
  action: string
  label: UiText
  prompt?: SandboxPrompt
  /** Present ⇒ the button is disabled; the value says why. */
  disabled?: UiText
  /** The commands of one sandbox step. Pure; `input` comes from the prompt (if any). */
  commands: (input?: SandboxInput) => Command[]
  /** The narration of that step. */
  say: (input?: SandboxInput) => UiText
}

export type SandboxSlotControls = { slot: SlotId; type: CrdtName | 'doc'; ops: SandboxControl[] }
export type SandboxActorControls = {
  actor: Actor
  slots: SandboxSlotControls[]
  /** Per-actor delivery controls: broadcast of an ops-wired slot, send, offline/online toggle. */
  network: SandboxControl[]
}
export type SandboxControls = {
  actors: SandboxActorControls[]
  /** Global delivery controls: sync pairs, deliver all, drop all, tick. */
  network: SandboxControl[]
  /** True when there is nothing to press at all. */
  empty: boolean
}

// ─── Helpers ──────────────────────────────────────────────────────────────────────────────────

type Vars = Record<string, string | number>

const L = (name: string, vars?: Vars): UiText =>
  vars ? { key: `tryIt.op.${name}`, vars } : { key: `tryIt.op.${name}` }
const N = (name: string, vars?: Vars): UiText =>
  vars ? { key: `tryIt.net.${name}`, vars } : { key: `tryIt.net.${name}` }
const R = (name: string): UiText => ({ key: `tryIt.reason.${name}` })
const SAY = (name: string, vars: Vars): UiText => ({ key: `tryIt.say.${name}`, vars })
const PROMPT_VALUE: SandboxPrompt = { kind: 'text', label: { key: 'tryIt.prompt.value' } }
const PROMPT_NUMBER: SandboxPrompt = { kind: 'number', label: { key: 'tryIt.prompt.number' } }
const PROMPT_TEXT: SandboxPrompt = { kind: 'text', label: { key: 'tryIt.prompt.text' } }

/** The display text of a value, for choice options and narration. */
function display(v: Value | undefined): string {
  if (!v) return ''
  const plain = plainValue(v)
  if (typeof plain === 'string') return plain
  return JSON.stringify(plain) ?? ''
}

const live = (items: readonly Item[]): Item[] =>
  items.filter((it) => it.value.meta?.tombstone !== true)

/** Parse prompt text like the value it joins: numbers stay numbers, everything else is text. */
function coerce(text: string, like: unknown): unknown {
  if (typeof like === 'number') {
    const n = Number(text)
    return Number.isFinite(n) ? n : text
  }
  return text
}

function numberOf(input?: SandboxInput): number {
  const n = Number(input?.value ?? '')
  return Number.isFinite(n) ? n : 0
}

const textOf = (input?: SandboxInput): string => input?.value ?? ''

/** Prompt text for an op the sandbox knows nothing about: numbers and booleans become typed. */
function autoValue(text: string): unknown {
  const trimmed = text.trim()
  if (trimmed === 'true') return true
  if (trimmed === 'false') return false
  if (trimmed !== '' && Number.isFinite(Number(trimmed))) return Number(trimmed)
  return text
}

function pairs<T>(xs: readonly T[]): Array<[T, T]> {
  const out: Array<[T, T]> = []
  for (let i = 0; i < xs.length; i++) {
    for (let j = i + 1; j < xs.length; j++) {
      const a = xs[i]
      const b = xs[j]
      if (a !== undefined && b !== undefined) out.push([a, b])
    }
  }
  return out
}

function parseDot(id: string): { node: NodeId; seq: number } {
  const i = id.lastIndexOf(':')
  return { node: id.slice(0, i), seq: Number(id.slice(i + 1)) }
}

/** Top-level fields of a composed document whose leaf is an LWW register. */
function topLevelLwwFields(schema: CrdtSchema | undefined): string[] {
  if (!schema || typeof schema === 'string' || !('map' in schema)) return []
  return Object.entries(schema.map)
    .filter(
      ([, s]) =>
        s === 'lww-register' || (typeof s === 'object' && 'type' in s && s.type === 'lww-register'),
    )
    .map(([key]) => key)
}

const WALL_CLOCK_TYPES: ReadonlySet<string> = new Set([
  'lww-register',
  'lww-map',
  'lww-element-set',
])

/** True when this replica's writes are stamped with the wall clock (a same-time write can tie). */
function stampsWithWallClock(r: Replica): boolean {
  if (r.type === 'rga') return r.args.stamp === 'clock'
  if (r.type === 'doc') return topLevelLwwFields(r.schema).length > 0
  return WALL_CLOCK_TYPES.has(r.type) && r.args.clock === undefined
}

/** True when a `tick` visibly matters for this replica (wall-clock stamps, or an HLC's wall part). */
const usesWallClock = (r: Replica): boolean => r.type === 'hlc' || stampsWithWallClock(r)

// ─── Op specs per type ────────────────────────────────────────────────────────────────────────

/** One op button before it is bound to an actor: the args come from the prompt input. */
export type OpSpec = {
  op: string
  action: string
  label: UiText
  prompt?: SandboxPrompt
  disabled?: UiText
  path?: string
  args: (input?: SandboxInput) => unknown[]
  sayKey: string
  sayVars?: (input?: SandboxInput) => Vars
}

function registerSet(value: Value | undefined): OpSpec {
  const current = value?.kind === 'scalar' ? value.value : undefined
  const numeric = typeof current === 'number'
  return {
    op: 'set',
    action: 'set',
    label: L('set'),
    prompt: numeric ? PROMPT_NUMBER : PROMPT_VALUE,
    args: (i) => [numeric ? numberOf(i) : textOf(i)],
    sayKey: 'set',
    sayVars: (i) => ({ value: textOf(i) }),
  }
}

const counterOp = (op: 'inc' | 'dec'): OpSpec => ({
  op,
  action: op,
  label: L(op),
  args: () => [1],
  sayKey: op,
})

function setOps(value: Value | undefined, removable: boolean): OpSpec[] {
  const items = value?.kind === 'set' ? live(value.items) : []
  const sample = items[0] ? plainValue(items[0].value) : undefined
  const add: OpSpec = {
    op: 'add',
    action: 'add',
    label: L('add'),
    prompt: PROMPT_VALUE,
    args: (i) => [coerce(textOf(i), sample)],
    sayKey: 'add',
    sayVars: (i) => ({ value: textOf(i) }),
  }
  if (!removable) return [add]
  const byId = new Map(items.map((it) => [it.id, it]))
  const chosen = (i?: SandboxInput): Item | undefined =>
    i?.choice !== undefined ? byId.get(i.choice) : undefined
  const remove: OpSpec = {
    op: 'remove',
    action: 'remove',
    label: L('remove'),
    prompt: {
      kind: 'choice',
      options: items.map((it) => ({ id: it.id, label: display(it.value) })),
    },
    args: (i) => {
      const it = chosen(i)
      return [it ? plainValue(it.value) : (i?.choice ?? '')]
    },
    sayKey: 'remove',
    sayVars: (i) => ({ value: display(chosen(i)?.value) }),
  }
  if (items.length === 0) remove.disabled = R('noItems')
  return [add, remove]
}

function mapOps(value: Value | undefined): OpSpec[] {
  const fields =
    value?.kind === 'record' ? value.fields.filter((f) => f.value.meta?.tombstone !== true) : []
  const set: OpSpec = {
    op: 'set',
    action: 'setField',
    label: L('setField'),
    prompt: { kind: 'field' },
    args: (i) => {
      const key = i?.key ?? ''
      const like = fields.find((f) => f.key === key)
      return [key, coerce(textOf(i), like ? plainValue(like.value) : undefined)]
    },
    sayKey: 'setField',
    sayVars: (i) => ({ key: i?.key ?? '', value: textOf(i) }),
  }
  const remove: OpSpec = {
    op: 'remove',
    action: 'removeField',
    label: L('removeField'),
    prompt: { kind: 'choice', options: fields.map((f) => ({ id: f.key, label: f.key })) },
    args: (i) => [i?.choice ?? ''],
    sayKey: 'removeField',
    sayVars: (i) => ({ key: i?.choice ?? '' }),
  }
  if (fields.length === 0) remove.disabled = R('noFields')
  return [set, remove]
}

function rgaOps(value: Value | undefined): OpSpec[] {
  const visible = value?.kind === 'list' ? live(value.items) : []
  const last = visible[visible.length - 1]
  const anchor = last ? last.id : 'HEAD'
  const type: OpSpec = {
    op: 'type',
    action: 'type',
    label: L('type'),
    prompt: PROMPT_TEXT,
    args: (i) => [anchor, textOf(i)],
    sayKey: 'type',
    sayVars: (i) => ({ value: textOf(i) }),
  }
  const del: OpSpec = {
    op: 'delete',
    action: 'deleteLast',
    label: L('deleteLast'),
    args: () => [last ? last.id : ''],
    sayKey: 'deleteLast',
    sayVars: () => ({ value: display(last?.value) }),
  }
  if (!last) del.disabled = R('noItems')
  return [type, del]
}

const clockTick: OpSpec = {
  op: 'tick',
  action: 'tick',
  label: L('tick'),
  args: () => [],
  sayKey: 'tick',
}

function docOps(replica: Replica, value: Value | undefined): OpSpec[] {
  return topLevelLwwFields(replica.schema).map((field) => {
    const current =
      value?.kind === 'record' ? value.fields.find((f) => f.key === field)?.value : undefined
    return {
      ...registerSet(current),
      path: field,
      label: L('setDoc', { field }),
      sayKey: 'setField',
      sayVars: (i) => ({ key: field, value: textOf(i) }),
    }
  })
}

/** The default op buttons for a replica, from its type and its current (visible) value. */
export function defaultOpSpecs(replica: Replica, value: Value | undefined): OpSpec[] {
  switch (replica.type) {
    case 'max-register':
      return [{ ...registerSet(value), prompt: PROMPT_NUMBER, args: (i) => [numberOf(i)] }]
    case 'lww-register':
    case 'mv-register':
      return [registerSet(value)]
    case 'lww-map':
      return mapOps(value)
    case 'g-counter':
      return [counterOp('inc')]
    case 'pn-counter':
    case 'op-counter':
      return [counterOp('inc'), counterOp('dec')]
    case 'g-set':
      return setOps(value, false)
    case 'two-phase-set':
    case 'lww-element-set':
    case 'or-set':
      return setOps(value, true)
    case 'rga':
      return rgaOps(value)
    case 'lamport-clock':
    case 'vector-clock':
    case 'hlc':
      return [clockTick]
    case 'doc':
      return docOps(replica, value)
  }
}

/** Apply a TryIt `ops` list on top of the defaults: pick, relabel, fix or prompt the args. */
function overrideOpSpecs(defaults: OpSpec[], tryIt: TryIt): OpSpec[] {
  return tryIt.ops.map((o): OpSpec => {
    const base = defaults.find((d) => d.op === o.op)
    const spec: OpSpec = base
      ? { ...base }
      : {
          op: o.op,
          action: o.op,
          label: { text: o.op },
          args: (i) => (i?.value === undefined ? [] : [autoValue(textOf(i))]),
          sayKey: 'op',
          sayVars: () => ({ op: o.op }),
        }
    if (o.label !== undefined) spec.label = { text: o.label }
    if (Array.isArray(o.args)) {
      const fixed = [...o.args]
      delete spec.prompt
      delete spec.disabled
      spec.args = () => fixed
      spec.sayKey = 'op'
      spec.sayVars = () => ({ op: o.op })
    } else if (o.args === 'prompt' && !spec.prompt) {
      spec.prompt = PROMPT_VALUE
      spec.args = (i) => [autoValue(textOf(i))]
      spec.sayKey = 'op'
      spec.sayVars = () => ({ op: o.op })
    }
    return spec
  })
}

/**
 * Bind an op spec to an actor. `pretick` prepends a `tick` (the slot stamps with the wall clock
 * and the scene does not `autoTick`): without it a sandbox write at the same time as the current
 * stamp would lose the tie-break and visibly change nothing — real, but baffling on a button.
 */
function bindOp(actor: Actor, slot: SlotId, spec: OpSpec, pretick: boolean): SandboxControl {
  const suffix = spec.path !== undefined ? `-${spec.path}` : ''
  const control: SandboxControl = {
    id: `op-${actor.id}-${slot}-${spec.op}${suffix}`,
    action: spec.action,
    label: spec.label,
    commands: (input) => {
      const u: Parameters<typeof crdt.updateWith>[0] = {
        actor: actor.id,
        slot,
        op: spec.op,
        args: spec.args(input),
      }
      if (spec.path !== undefined) u.path = spec.path
      const update = crdt.updateWith(u)
      return pretick ? [tick(), update] : [update]
    },
    say: (input) => SAY(spec.sayKey, { actor: actor.label, slot, ...spec.sayVars?.(input) }),
  }
  if (spec.prompt) control.prompt = spec.prompt
  if (spec.disabled) control.disabled = spec.disabled
  return control
}

// ─── Delivery ─────────────────────────────────────────────────────────────────────────────────

/**
 * The live messages one `deliver` each can apply now, in a causally safe order: state / stamp
 * messages and messages that will park (offline recipient) are always ready; an op message is
 * ready once its deps are covered by the recipient's version (counting the deliveries before it
 * in this list). Parked messages of an offline actor stay parked; ops that cannot become ready
 * here stay in flight.
 */
export function deliverableMessages(world: World): MessageId[] {
  const versions = new Map<string, VectorClock>()
  const versionOf = (actor: ActorId, slot: SlotId): VectorClock | undefined => {
    const key = `${actor} ${slot}`
    const cached = versions.get(key)
    if (cached) return cached
    const replica = world.replicas[actor]?.[slot]
    if (!replica) return undefined
    const copy = { ...replica.version }
    versions.set(key, copy)
    return copy
  }
  const ready = (m: Message): boolean => {
    const to = world.actors[m.to]
    if (!to) return false
    if (m.data?.kind !== 'op' || !to.online) return true
    const v = versionOf(m.to, m.data.slot)
    if (!v) return true // no replica here: let the reducer explain
    const { node, seq } = parseDot(m.data.op.id)
    if (seq <= (v[node] ?? 0)) return true // a duplicate: no effect
    return Object.entries(m.data.op.deps).every(([n, s]) => (v[n] ?? 0) >= s)
  }
  const apply = (m: Message): void => {
    if (m.data?.kind !== 'op') return
    const v = versionOf(m.to, m.data.slot)
    if (!v) return
    const { node, seq } = parseDot(m.data.op.id)
    v[node] = Math.max(v[node] ?? 0, seq)
  }
  let remaining = world.messages.filter(
    (m) => !(m.state === 'parked' && world.actors[m.to]?.online === false),
  )
  const out: MessageId[] = []
  let progress = true
  while (progress && remaining.length > 0) {
    progress = false
    for (const m of remaining) {
      if (!ready(m)) continue
      out.push(m.id)
      apply(m)
      remaining = remaining.filter((x) => x !== m)
      progress = true
      break
    }
  }
  return out
}

function toggleControl(actor: Actor): SandboxControl {
  return actor.online
    ? {
        id: `actor-${actor.id}-offline`,
        action: 'offline',
        label: N('offline'),
        commands: () => [offline(actor.id)],
        say: () => SAY('offline', { actor: actor.label }),
      }
    : {
        id: `actor-${actor.id}-online`,
        action: 'online',
        label: N('online'),
        commands: () => [online(actor.id)],
        say: () => SAY('online', { actor: actor.label }),
      }
}

function broadcastControl(actor: Actor, slot: SlotId, replica: Replica): SandboxControl {
  const c: SandboxControl = {
    id: `net-${actor.id}-${slot}-broadcast`,
    action: 'broadcast',
    label: N('broadcast', { slot }),
    commands: () => [crdt.broadcast(actor.id, slot)],
    say: () => SAY('broadcast', { actor: actor.label, slot }),
  }
  if (replica.pending.length === 0) c.disabled = R('outboxEmpty')
  return c
}

function sendControl(from: Actor, to: Actor, slot: SlotId): SandboxControl {
  return {
    id: `net-${from.id}-${slot}-send-${to.id}`,
    action: 'send',
    label: N('send', { to: to.label, slot }),
    commands: () => [crdt.send(from.id, to.id, slot)],
    say: () => SAY('send', { actor: from.label, to: to.label, slot }),
  }
}

function syncControl(a: Actor, b: Actor, slot: SlotId): SandboxControl {
  const c: SandboxControl = {
    id: `net-sync-${slot}-${a.id}-${b.id}`,
    action: 'sync',
    label: N('sync', { a: a.label, b: b.label, slot }),
    commands: () => [crdt.sync(a.id, b.id, slot)],
    say: () => SAY('sync', { a: a.label, b: b.label, slot }),
  }
  if (!a.online || !b.online) c.disabled = R('offline')
  return c
}

function deliverAllControl(world: World): SandboxControl {
  const ids = deliverableMessages(world)
  const c: SandboxControl = {
    id: 'net-deliver-all',
    action: 'deliverAll',
    label: N('deliverAll'),
    commands: () => ids.map((id) => deliver(id)),
    say: () => SAY('deliverAll', { count: ids.length }),
  }
  if (ids.length === 0) c.disabled = R('nothingInFlight')
  return c
}

function dropAllControl(world: World): SandboxControl {
  const ids = world.messages.map((m) => m.id)
  const c: SandboxControl = {
    id: 'net-drop-all',
    action: 'dropAll',
    label: N('dropAll'),
    commands: () => ids.map((id) => drop(id)),
    say: () => SAY('dropAll', { count: ids.length }),
  }
  if (ids.length === 0) c.disabled = R('nothingInFlight')
  return c
}

const tickControl: SandboxControl = {
  id: 'net-tick',
  action: 'tick',
  label: N('tick'),
  commands: () => [tick()],
  say: () => SAY('clockTick', {}),
}

// ─── deriveControls ───────────────────────────────────────────────────────────────────────────

type NetKind = NonNullable<TryIt['network']>[number]

/**
 * Every control the sandbox offers for `world`. With `tryIt`, only its slot / actors / ops /
 * network kinds (an undefined `tryIt.network` keeps the derived delivery controls of that slot).
 */
export function deriveControls(world: World, tryIt?: TryIt): SandboxControls {
  const actorIds = Object.keys(world.actors)
  const slotIds = new Set<SlotId>()
  for (const a of actorIds) for (const s of Object.keys(world.replicas[a] ?? {})) slotIds.add(s)
  const slots = [...slotIds].filter((s) => !tryIt || s === tryIt.slot)
  const holders = (slot: SlotId): Actor[] =>
    actorIds
      .filter((a) => world.replicas[a]?.[slot] !== undefined)
      .filter((a) => !tryIt?.actors || tryIt.actors.includes(a))
      .map((a) => world.actors[a])
      .filter((a): a is Actor => a !== undefined)
  const involved = new Set<ActorId>()
  for (const s of slots) for (const a of holders(s)) involved.add(a.id)

  const net = (kind: NetKind): boolean => !tryIt?.network || tryIt.network.includes(kind)
  const explicit = (kind: NetKind): boolean => tryIt?.network?.includes(kind) === true
  const wireOf = (slot: SlotId): 'state' | 'ops' => {
    for (const a of actorIds) {
      const r = world.replicas[a]?.[slot]
      if (r) return r.args.wire ?? 'state'
    }
    return 'state'
  }

  const actors: SandboxActorControls[] = []
  for (const id of actorIds) {
    const actor = world.actors[id]
    if (!actor || !involved.has(id)) continue
    const slotControls: SandboxSlotControls[] = []
    const network: SandboxControl[] = []
    for (const slot of slots) {
      const replica = world.replicas[id]?.[slot]
      if (!replica) continue
      const defaults = defaultOpSpecs(replica, actor.holds[slot])
      const specs = tryIt ? overrideOpSpecs(defaults, tryIt) : defaults
      const pretick = stampsWithWallClock(replica) && world.clock.autoTick !== true
      slotControls.push({
        slot,
        type: replica.type,
        ops: specs.map((spec) => bindOp(actor, slot, spec, pretick)),
      })
      if (net('send')) {
        if (wireOf(slot) === 'ops') network.push(broadcastControl(actor, slot, replica))
        else if (explicit('send')) {
          for (const other of holders(slot)) {
            if (other.id !== id) network.push(sendControl(actor, other, slot))
          }
        }
      }
    }
    if (net('offline')) network.push(toggleControl(actor))
    actors.push({ actor, slots: slotControls, network })
  }

  const network: SandboxControl[] = []
  let anyWire = false
  for (const slot of slots) {
    if (wireOf(slot) === 'ops') {
      anyWire = true
      continue
    }
    if (explicit('send')) anyWire = true
    if (net('sync'))
      for (const [a, b] of pairs(holders(slot))) network.push(syncControl(a, b, slot))
  }
  if (net('send') && (anyWire || world.messages.length > 0)) network.push(deliverAllControl(world))
  if (explicit('drop')) network.push(dropAllControl(world))
  const wallClock = slots.some((s) =>
    actorIds.some((a) => {
      const r = world.replicas[a]?.[s]
      return r !== undefined && usesWallClock(r)
    }),
  )
  if (!tryIt?.network && (world.clock.show || wallClock)) network.push(tickControl)

  const empty =
    network.length === 0 &&
    actors.every((a) => a.network.length === 0 && a.slots.every((s) => s.ops.length === 0))
  return { actors, network, empty }
}
