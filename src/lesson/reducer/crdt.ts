/**
 * STUB — the CRDT delivery layer (DSL §5.1) is owned by the CRDT agent, which overwrites this
 * file. The signatures below are the contract the reducer core (`index.ts`, `messages.ts`)
 * compiles against; every function throws until the real implementation lands.
 */
import {
  ReducerError,
  type ActorId,
  type CrdtCommand,
  type Message,
  type MessageData,
  type MessageId,
  type Meta,
  type Path,
  type SlotId,
  type Value,
  type World,
} from '../types'
import type { ReduceCtx } from './context'

/** One message `crdt.send` / `crdt.broadcast` wants created; ids are final (fan-out `${base}@${to}`). */
export type OutgoingSpec = {
  from: ActorId
  to: ActorId
  id: MessageId
  payload: Value
  label?: string
  size?: number
  data: MessageData
}

export type CrdtLocalCommand = Extract<
  CrdtCommand,
  { t: 'crdt.init' | 'crdt.doc' | 'crdt.update' | 'crdt.merge' | 'crdt.sync' | 'crdt.gc' }
>
export type CrdtWireCommand = Extract<CrdtCommand, { t: 'crdt.send' | 'crdt.broadcast' }>

function notImplemented(ctx: ReduceCtx, command?: unknown): ReducerError {
  return new ReducerError('crdt: not implemented', { stepId: ctx.stepId, command })
}

export function reduceCrdt(_w: World, cmd: CrdtLocalCommand, ctx: ReduceCtx): World {
  throw notImplemented(ctx, cmd)
}

export function prepareOutgoing(
  _w: World,
  cmd: CrdtWireCommand,
  ctx: ReduceCtx,
): { world: World; messages: OutgoingSpec[] } {
  throw notImplemented(ctx, cmd)
}

export function applyIncoming(
  _w: World,
  msg: Message,
  _opts: { into?: Path; park?: boolean; recv?: SlotId },
  ctx: ReduceCtx,
): World {
  throw notImplemented(ctx, msg)
}

export function stampForSend(
  _w: World,
  _from: ActorId,
  _slot: SlotId,
  ctx: ReduceCtx,
): { world: World; meta: Meta } {
  throw notImplemented(ctx)
}
