/**
 * The flow autopilot (docs/animation-dsl.md §11.4 "Flow"). A seeded planner that turns a world into
 * the next sandbox step — a local update on some copy, a sync between two copies, a delivery of
 * what is in flight, now and then a copy going offline and coming back — using exactly the
 * controls the sandbox derives for that world (`deriveControls`). So every step is one the learner
 * could have pressed, and every value on the stage is computed by the real CRDT code. Pure and
 * deterministic for a seed; the page runs it on a timer (`useFlow`) so the learner can watch the
 * system "flow" without filling in each update.
 *
 * The rhythm (per bar of ten beats): updates with syncs on beats 2, 5, 7 and 9; on beat 3 a copy
 * sometimes goes offline (it keeps taking updates — the copies drift), and it is back online by
 * beat 8, so the next syncs show the drift heal. Op-wired slots alternate broadcast and delivery.
 */
import type { ActorId, Command, SlotId, Value, World } from '../types'
import { deriveControls, type SandboxControl, type SandboxInput, type UiText } from '../sandbox'

/** A unit-interval random source. */
export type Rng = () => number

/** mulberry32 — tiny, fast, and seedable, so tests and "Shuffle" are reproducible. */
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** A stable seed from a string (FNV-1a), so a topic's flow opens the same way every time. */
export function seedOf(s: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

export type FlowBeat = 'update' | 'sync' | 'offline' | 'online'

export type FlowPlan = {
  beat: FlowBeat
  /** The sandbox control the plan presses (its `id` is the same the sandbox UI uses). */
  control: SandboxControl
  input?: SandboxInput
  commands: Command[]
  say: UiText
  /** The actor the beat is about (the copy updated or toggled; undefined for global delivery). */
  actor?: ActorId
}

const WORDS = ['milk', 'eggs', 'tea', 'jam', 'bread', 'rice', 'figs', 'oats', 'salt', 'soap']
const SHORT = ['ok', 'hi', 'yes', 'go', 'hey', 'ab']
/** Ops that grow or change data; the planner prefers these to removals (4:1). */
const CONSTRUCTIVE = new Set(['set', 'inc', 'add', 'type', 'setField', 'tick'])

/** Which beat the bar asks for; falls back to `update` when the world cannot do it. */
export function beatFor(world: World, rng: Rng, n: number): FlowBeat {
  const actors = Object.values(world.actors)
  const anyOffline = actors.some((a) => !a.online)
  const tenth = n % 10
  if (anyOffline && tenth >= 8) return 'online'
  if (!anyOffline && tenth === 3 && actors.length >= 3 && rng() < 0.5) return 'offline'
  if (tenth === 2 || tenth === 5 || tenth === 7 || tenth === 9) return 'sync'
  return 'update'
}

/** The next step for `world`, or undefined when there is nothing at all to press. */
export function planFlowStep(world: World, rng: Rng, n: number): FlowPlan | undefined {
  const controls = deriveControls(world)
  const pick = <T>(xs: readonly T[]): T | undefined =>
    xs.length === 0 ? undefined : xs[Math.floor(rng() * xs.length)]
  const enabled = (c: SandboxControl): boolean => c.disabled === undefined
  const plan = (
    beat: FlowBeat,
    control: SandboxControl,
    actor?: ActorId,
    input?: SandboxInput,
  ): FlowPlan | undefined => {
    const commands = control.commands(input)
    if (commands.length === 0) return undefined
    const p: FlowPlan = { beat, control, commands, say: control.say(input) }
    if (input !== undefined) p.input = input
    if (actor !== undefined) p.actor = actor
    return p
  }

  const beat = beatFor(world, rng, n)

  if (beat === 'online') {
    const c = controls.actors
      .flatMap((a) => a.network.map((ctl) => ({ actor: a.actor.id, ctl })))
      .find((x) => x.ctl.action === 'online' && enabled(x.ctl))
    if (c) return plan('online', c.ctl, c.actor)
  }
  if (beat === 'offline') {
    const online = controls.actors.filter((a) => a.actor.online)
    if (online.length >= 3) {
      const victim = pick(online)
      const ctl = victim?.network.find((x) => x.action === 'offline' && enabled(x))
      if (victim && ctl) return plan('offline', ctl, victim.actor.id)
    }
  }
  if (beat === 'sync') {
    const global = controls.network.filter(enabled)
    const deliver = global.find((c) => c.action === 'deliverAll')
    const broadcasts = controls.actors
      .flatMap((a) => a.network.map((ctl) => ({ actor: a.actor.id, ctl })))
      .filter((x) => x.ctl.action === 'broadcast' && enabled(x.ctl))
    const syncs = global.filter((c) => c.action === 'sync')
    if (broadcasts.length > 0 && (!deliver || rng() < 0.6)) {
      const b = pick(broadcasts)
      if (b) return plan('sync', b.ctl, b.actor)
    }
    if (deliver) return plan('sync', deliver)
    const s = pick(syncs)
    if (s) return plan('sync', s)
    // nothing to sync (all offline, nothing in flight): poke instead
  }

  // update
  const ops = controls.actors.flatMap((a) =>
    a.slots.flatMap((s) =>
      s.ops.filter(enabled).map((ctl) => ({ actor: a.actor.id, slot: s.slot, ctl })),
    ),
  )
  if (ops.length === 0) return undefined
  const constructive = ops.filter((o) => CONSTRUCTIVE.has(o.ctl.action))
  const pool = constructive.length > 0 && rng() < 0.8 ? constructive : ops
  const chosen = pick(pool)
  if (!chosen) return undefined
  const input = inputFor(chosen.ctl, world, chosen.actor, chosen.slot, rng)
  return plan('update', chosen.ctl, chosen.actor, input)
}

/** Fills a control's prompt the way a curious learner would: small numbers, short words, real keys. */
export function inputFor(
  control: SandboxControl,
  world: World,
  actor: ActorId,
  slot: SlotId,
  rng: Rng,
): SandboxInput | undefined {
  const prompt = control.prompt
  if (!prompt) return undefined
  const pick = <T>(xs: readonly T[]): T | undefined =>
    xs.length === 0 ? undefined : xs[Math.floor(rng() * xs.length)]
  const held: Value | undefined = world.actors[actor]?.holds[slot]
  switch (prompt.kind) {
    case 'number': {
      const current = held?.kind === 'scalar' && typeof held.value === 'number' ? held.value : 0
      // mostly up, sometimes down — a max register then shows "no change", which is the lesson
      const delta = pick([1, 2, 3, 1, 2, -1, -2]) ?? 1
      return { value: String(Math.max(0, current + delta)) }
    }
    case 'text':
      return { value: pick(control.action === 'type' ? SHORT : WORDS) ?? 'ok' }
    case 'field': {
      const fields =
        held?.kind === 'record' ? held.fields.filter((f) => f.value.meta?.tombstone !== true) : []
      const f = pick(fields)
      const key = f?.key ?? pick(['note', 'tag']) ?? 'note'
      const numeric = f?.value.kind === 'scalar' && typeof f.value.value === 'number'
      const value = numeric
        ? String(Number((f.value as { value: number }).value) + ((pick([1, 2]) ?? 1) as number))
        : (pick(WORDS) ?? 'milk')
      return { key, value }
    }
    case 'choice': {
      const o = pick(prompt.options)
      return o ? { choice: o.id } : undefined
    }
  }
}
