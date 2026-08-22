/**
 * Regex engine commands (DSL §5.3): `regex.init` compiles the pattern, stores the VM state in
 * `world.engines[actor]` and writes the five engine slots (`pattern`, `text`, `stack`, `captures`,
 * `tries`) onto the actor; `regex.advance` runs the VM to the next event and refreshes the slots.
 * Value commands on those slots throw (values.ts `isEngineSlot`).
 */
import { engineSlots, regexAdvance, regexInit, SLOT_NAMES, type EngineState } from '../../regex'
import { type Actor, type RegexCommand, type SlotId, type Value, type World } from '../types'
import { fail, type ReduceCtxX } from './scratch'
import { isCrdtSlot } from './values'

function writeSlots(w: World, actor: Actor, state: EngineState): World {
  const slots = engineSlots(state)
  const holds: Record<SlotId, Value> = { ...actor.holds }
  for (const name of SLOT_NAMES) holds[name] = slots[name]
  return {
    ...w,
    actors: { ...w.actors, [actor.id]: { ...actor, holds } },
    engines: { ...w.engines, [actor.id]: state },
  }
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

export function reduceRegex(w: World, cmd: RegexCommand, ctx: ReduceCtxX): World {
  const actor = w.actors[cmd.actor]
  if (!actor) throw fail(ctx, cmd, `no actor "${cmd.actor}" on stage`, cmd.actor)
  switch (cmd.t) {
    case 'regex.init': {
      for (const name of SLOT_NAMES) {
        if (isCrdtSlot(w, actor.id, name)) {
          throw fail(
            ctx,
            cmd,
            `slot "${name}" of "${actor.id}" is CRDT-managed; the regex engine needs it`,
            `${actor.id}.${name}`,
          )
        }
      }
      let state: EngineState
      try {
        state = regexInit(cmd.pattern, cmd.input, cmd.flags ?? '')
      } catch (e) {
        throw fail(ctx, cmd, `regex.init: ${errorMessage(e)}`)
      }
      return writeSlots(w, actor, state)
    }
    case 'regex.advance': {
      const state = w.engines[actor.id] as EngineState | undefined
      if (!state) {
        throw fail(ctx, cmd, `actor "${actor.id}" has no regex engine (run regex.init first)`)
      }
      let next: EngineState
      try {
        next = regexAdvance(state, cmd.until)
      } catch (e) {
        throw fail(ctx, cmd, `regex.advance: ${errorMessage(e)}`)
      }
      return next === state ? w : writeSlots(w, actor, next)
    }
  }
}
