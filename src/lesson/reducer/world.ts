/**
 * World construction (DSL §2, §8.1): `initWorld(sceneWorld)` turns the authoring shape into the
 * first immutable `World` of a scene, and `actorFromSpec` fills `ActorSpec` defaults (shared with
 * `spawn` in stage.ts).
 *
 * Defaults: actor colour = the owner's colour; else server/service → 'server'; else the next free
 * of a, b, c, d in insertion order ('neutral' once those are taken); `online` true; scalar holds
 * wrapped as `{ kind: 'scalar' }`; `outbox` []. Layout `{ preset: 'row', hub }` with hub = the
 * first server/service, else the first actor. Clock `{ now: 0, show: false, format: 'counter' }`.
 */
import { parsePath, RESERVED_IDS } from '../path'
import {
  LIMITS,
  ReducerError,
  type Actor,
  type ActorColor,
  type ActorId,
  type ActorSpec,
  type Board,
  type BoardId,
  type Clock,
  type Layout,
  type SceneWorld,
  type Scalar,
  type SlotId,
  type Value,
  type World,
} from '../types'

const PERSON_COLORS: readonly ActorColor[] = ['a', 'b', 'c', 'd']

/** True for the authored scalar form of a slot value (`holds: { n: 3 }`). */
export function isScalar(v: unknown): v is Scalar {
  return v === null || typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean'
}

/** Wrap an authored scalar as a `Value`; a `Value` passes through. */
export function toValue(v: Value | Scalar): Value {
  return isScalar(v) ? { kind: 'scalar', value: v } : v
}

/** Throws unless `id` is a legal actor id: a bare path root, not `board` / `msg`. */
export function checkActorId(id: string, command?: unknown): void {
  const bad = (why: string): ReducerError =>
    new ReducerError(`bad actor id "${id}": ${why}`, { command, path: id })
  if (typeof id !== 'string' || id.length === 0) throw bad('empty')
  if (RESERVED_IDS.includes(id)) throw bad('reserved root')
  let parsed
  try {
    parsed = parsePath(id)
  } catch {
    throw bad('not a path root')
  }
  if (parsed.root.kind !== 'actor' || parsed.segments.length > 0 || parsed.selector !== undefined) {
    throw bad('an actor id is one bare key (letters, digits, "-", "_")')
  }
}

/** Throws unless `id` is a legal board id (`board.<id>` must parse). */
export function checkBoardId(id: string, command?: unknown): void {
  const bad = (why: string): ReducerError =>
    new ReducerError(`bad board id "${id}": ${why}`, { command, path: `board.${id}` })
  if (typeof id !== 'string' || id.length === 0) throw bad('empty')
  let parsed
  try {
    parsed = parsePath(`board.${id}`)
  } catch {
    throw bad('not a board path')
  }
  if (parsed.root.kind !== 'board' || parsed.root.id !== id || parsed.segments.length > 0) {
    throw bad('a board id is one bare key (letters, digits, "-", "_")')
  }
}

/** The hub default: the first server/service, else the first actor, else none. */
export function defaultHub(actors: Record<ActorId, Actor>): ActorId | undefined {
  const all = Object.values(actors)
  return (all.find((a) => a.kind === 'server' || a.kind === 'service') ?? all[0])?.id
}

function deriveColor(
  spec: ActorSpec,
  existing: Record<ActorId, Actor>,
  command?: unknown,
): ActorColor {
  if (spec.color !== undefined) return spec.color
  if (spec.owner !== undefined) {
    const owner = existing[spec.owner]
    if (!owner) {
      throw new ReducerError(
        `actor "${spec.id}" names owner "${spec.owner}", which is not on stage (declare the owner first)`,
        { command },
      )
    }
    return owner.color
  }
  if (spec.kind === 'server' || spec.kind === 'service') return 'server'
  const used = new Set(Object.values(existing).map((a) => a.color))
  return PERSON_COLORS.find((c) => !used.has(c)) ?? 'neutral'
}

/**
 * An `Actor` from its authoring spec, with defaults derived against the actors already on stage
 * (`existing`, insertion-ordered). Only defined optional fields are copied, so worlds stay clean
 * for deep equality.
 */
export function actorFromSpec(
  spec: ActorSpec,
  existing: Record<ActorId, Actor>,
  command?: unknown,
): Actor {
  checkActorId(spec.id, command)
  if (existing[spec.id]) {
    throw new ReducerError(`actor "${spec.id}" is already on stage`, { command, path: spec.id })
  }
  if (Object.keys(existing).length >= LIMITS.maxActors) {
    throw new ReducerError(
      `too many actors: the stage holds at most ${LIMITS.maxActors} (adding "${spec.id}")`,
      { command },
    )
  }
  const holds: Record<SlotId, Value> = {}
  for (const [slot, v] of Object.entries(spec.holds ?? {})) {
    const slotPath = `${spec.id}.${slot}`
    try {
      parsePath(slotPath)
    } catch {
      throw new ReducerError(`bad slot id "${slot}" on actor "${spec.id}"`, {
        command,
        path: slotPath,
      })
    }
    holds[slot] = toValue(v)
  }
  const actor: Actor = {
    id: spec.id,
    kind: spec.kind,
    label: spec.label,
    color: deriveColor(spec, existing, command),
    online: spec.online ?? true,
    holds,
    outbox: [],
  }
  if (spec.subtitle !== undefined) actor.subtitle = spec.subtitle
  if (spec.icon !== undefined) actor.icon = spec.icon
  if (spec.owner !== undefined) actor.owner = spec.owner
  if (spec.status !== undefined) actor.status = spec.status
  if (spec.skew !== undefined) actor.skew = spec.skew
  return actor
}

function initClock(partial: Partial<Clock> | undefined): Clock {
  const clock: Clock = { now: 0, show: false, format: 'counter' }
  if (!partial) return clock
  if (partial.now !== undefined) clock.now = partial.now
  if (partial.show !== undefined) clock.show = partial.show
  if (partial.format !== undefined) clock.format = partial.format
  if (partial.start !== undefined) clock.start = partial.start
  if (partial.autoTick !== undefined) clock.autoTick = partial.autoTick
  if (clock.format === 'time' && clock.start === undefined) {
    throw new ReducerError(`clock format "time" needs a start ("hh:mm")`)
  }
  return clock
}

/** The first world of a scene (DSL §8.1 `SceneWorld`): actor defaults, boards, layout, clock. */
export function initWorld(sceneWorld: SceneWorld): World {
  const actors: Record<ActorId, Actor> = {}
  for (const spec of sceneWorld.actors) {
    actors[spec.id] = actorFromSpec(spec, actors)
  }
  const boards: Record<BoardId, Board> = {}
  for (const board of sceneWorld.boards ?? []) {
    checkBoardId(board.id)
    if (boards[board.id]) {
      throw new ReducerError(`board "${board.id}" is declared twice`, { path: `board.${board.id}` })
    }
    boards[board.id] = board
  }
  const layout: Layout = { preset: sceneWorld.layout ?? 'row' }
  const hub = sceneWorld.hub ?? defaultHub(actors)
  if (sceneWorld.hub !== undefined && !actors[sceneWorld.hub]) {
    throw new ReducerError(`layout hub "${sceneWorld.hub}" is not an actor of the scene`, {
      path: sceneWorld.hub,
    })
  }
  if (hub !== undefined) layout.hub = hub
  return {
    layout,
    clock: initClock(sceneWorld.clock),
    actors,
    boards,
    messages: [],
    marks: [],
    replicas: {},
    engines: {},
    ids: 0,
  }
}
