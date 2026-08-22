/**
 * Macros (docs/animation-dsl.md §8.5): expand at build time to the command list a human would
 * write, so goldens and the verify walker see plain commands. Each returns `Command[]`; `step()`
 * flattens it in place.
 */
import type { ActorId, Command, MessageId, Payload, Path, SlotId } from '../types'
import { compare, deliver, send, type SendOpts } from './commands'
import { crdt, type CrdtSendOpts } from './crdt'

/** `syncAll('card', ['alice', 'server'], ['bob', 'server'])` — ordered pair syncs (state mode). */
export function syncAll(
  slot: SlotId,
  ...pairs: ReadonlyArray<readonly [ActorId, ActorId]>
): Command[] {
  return pairs.map(([a, b]) => crdt.sync(a, b, slot))
}

/**
 * `broadcastState('carol', ['alice', 'bob'], 'views', 'm3')` — one `crdt.send` fan-out plus a
 * `deliver` per recipient (transient flights). An array `to` is always a fan-out, so the copies
 * are `${id}@${to}`; the id is required because generated ids are not known at build time.
 */
export function broadcastState(
  from: ActorId,
  to: ReadonlyArray<ActorId>,
  slot: SlotId,
  id: MessageId,
  opts?: Omit<CrdtSendOpts, 'id'>,
): Command[] {
  return [crdt.send(from, to, slot, { ...opts, id }), ...to.map((t) => deliver(`${id}@${t}`))]
}

/** `allSame('views', ['alice', 'bob', 'carol'])` — `compare` expect `equal` over `<actor>.<slot>`. */
export function allSame(slot: SlotId, actors: ReadonlyArray<ActorId>): Command[] {
  return [
    compare(
      actors.map((a): Path => `${a}.${slot}`),
      { expect: 'equal' },
    ),
  ]
}

/** `applyAll(['alice:6', 'alice:7', 'alice:8'])` — N delivers in one step. */
export function applyAll(ids: ReadonlyArray<MessageId>): Command[] {
  return ids.map((id) => deliver(id))
}

/**
 * `sendAndDeliver('alice', 'server', ref('alice.doc'), { id: 'm3', into: 'server.doc' })` — a
 * `send` plus the matching `deliver`(s) in one step (a transient flight). `id` is required; an
 * array `to` delivers each `${id}@${to}` copy.
 */
export function sendAndDeliver(
  from: ActorId,
  to: ActorId | ReadonlyArray<ActorId>,
  payload: Payload,
  opts: SendOpts & { id: MessageId },
): Command[] {
  const ids = typeof to === 'string' ? [opts.id] : to.map((t) => `${opts.id}@${t}`)
  return [send(from, to, payload, opts), ...ids.map((id) => deliver(id))]
}
