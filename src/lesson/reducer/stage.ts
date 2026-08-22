/**
 * Stage, actors and time (DSL §4.1): spawn / remove / removeBoard / layout / tick / skew / offline
 * / online / status / note. Pure; structural sharing; `ReducerError` on misuse.
 */
import {
  type Actor,
  type ActorId,
  type Board,
  type EngineState,
  type Replica,
  type SlotId,
  type StageCommand,
  type World,
} from '../types'
import type { ReduceCtxX } from './scratch'
import { fail } from './scratch'
import { actorFromSpec, checkBoardId, defaultHub } from './world'

function requireActor(w: World, id: ActorId, ctx: ReduceCtxX, cmd: StageCommand): Actor {
  const actor = w.actors[id]
  if (!actor) throw fail(ctx, cmd, `no actor "${id}" on stage`, id)
  return actor
}

function withActor(w: World, actor: Actor): World {
  return { ...w, actors: { ...w.actors, [actor.id]: actor } }
}

function omit<T>(record: Record<string, T>, key: string): Record<string, T> {
  const out: Record<string, T> = {}
  for (const [k, v] of Object.entries(record)) if (k !== key) out[k] = v
  return out
}

export function reduceStage(w: World, cmd: StageCommand, ctx: ReduceCtxX): World {
  switch (cmd.t) {
    case 'spawn': {
      const actor = actorFromSpec(cmd.actor, w.actors, cmd)
      const actors = { ...w.actors, [actor.id]: actor }
      const layout =
        w.layout.hub === undefined ? { ...w.layout, hub: defaultHub(actors) } : w.layout
      if (layout.hub === undefined) delete layout.hub
      return { ...w, actors, layout }
    }
    case 'remove': {
      requireActor(w, cmd.actor, ctx, cmd)
      const kept = []
      for (const m of w.messages) {
        if (m.from === cmd.actor || m.to === cmd.actor) {
          ctx.log.push({ kind: 'message', op: 'dropped', message: m })
          if (
            ctx.log.events.some(
              (e) => e.kind === 'message' && e.op === 'sent' && e.message.id === m.id,
            )
          ) {
            ctx.log.markTransient(m.id)
          }
        } else kept.push(m)
      }
      const actors = omit(w.actors, cmd.actor)
      const replicas: Record<ActorId, Record<SlotId, Replica>> = omit(w.replicas, cmd.actor)
      const engines: Record<ActorId, EngineState> = omit(w.engines, cmd.actor)
      let layout = w.layout
      if (layout.hub === cmd.actor) {
        const hub = defaultHub(actors)
        layout = hub === undefined ? { preset: layout.preset } : { preset: layout.preset, hub }
      }
      return { ...w, actors, messages: kept, replicas, engines, layout }
    }
    case 'removeBoard': {
      if (!w.boards[cmd.board])
        throw fail(ctx, cmd, `no board "${cmd.board}"`, `board.${cmd.board}`)
      return { ...w, boards: omit(w.boards, cmd.board) }
    }
    case 'layout': {
      const hub = cmd.hub ?? w.layout.hub ?? defaultHub(w.actors)
      if (cmd.hub !== undefined) requireActor(w, cmd.hub, ctx, cmd)
      const layout = hub === undefined ? { preset: cmd.preset } : { preset: cmd.preset, hub }
      return { ...w, layout }
    }
    case 'tick': {
      const by = cmd.by ?? 1
      if (typeof by !== 'number' || !Number.isFinite(by)) {
        throw fail(ctx, cmd, `tick: "by" must be a finite number`)
      }
      return { ...w, clock: { ...w.clock, now: w.clock.now + by } }
    }
    case 'skew': {
      const actor = requireActor(w, cmd.actor, ctx, cmd)
      if (typeof cmd.by !== 'number' || !Number.isFinite(cmd.by)) {
        throw fail(ctx, cmd, `skew: "by" must be a finite number`)
      }
      return withActor(w, { ...actor, skew: cmd.by })
    }
    case 'offline': {
      const actor = requireActor(w, cmd.actor, ctx, cmd)
      return actor.online ? withActor(w, { ...actor, online: false }) : w
    }
    case 'online': {
      const actor = requireActor(w, cmd.actor, ctx, cmd)
      return actor.online ? w : withActor(w, { ...actor, online: true })
    }
    case 'status': {
      const actor = requireActor(w, cmd.actor, ctx, cmd)
      if (cmd.status === null) {
        if (actor.status === undefined) return w
        const next = { ...actor }
        delete next.status
        return withActor(w, next)
      }
      return withActor(w, { ...actor, status: cmd.status })
    }
    case 'note': {
      checkBoardId(cmd.id, cmd)
      const board: Board = {
        id: cmd.id,
        value: { kind: 'text', text: cmd.text, annotations: [] },
      }
      if (cmd.label !== undefined) board.label = cmd.label
      if (cmd.tone !== undefined) board.tone = cmd.tone
      return { ...w, boards: { ...w.boards, [cmd.id]: board } }
    }
  }
}
