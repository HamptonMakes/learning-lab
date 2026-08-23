/**
 * Messages (DSL §4.3): `createMessages` is the one place a token is born (used by `send`,
 * `duplicate`, `relay` and — via `prepareOutgoing` — `crdt.send` / `crdt.broadcast`); `deliver`
 * is the one receiver (plain payloads land, data messages go to the CRDT layer's `applyIncoming`,
 * `park` lands without effect); `drop`, `duplicate`, `relay`. Every birth and death is pushed to
 * the step event log; a message created and consumed in one step is marked transient.
 */
import { formatPath, getAt, parsePath, setAt } from '../path'
import {
  type ActorId,
  type Message,
  type MessageCommand,
  type MessageData,
  type MessageId,
  type Path,
  type SlotId,
  type Value,
  type World,
} from '../types'
import { plainAction, pushAction } from './actions'
import { applyIncoming, stampForSend } from './crdt'
import { mintId } from './ids'
import { fail, type ReduceCtxX } from './scratch'
import { assertPlainTarget } from './values'
import { isScalar } from './world'

/** What a message birth needs. `to` as an array fans out with ids `${id}@${to}`. */
export type CreateSpec = {
  from: ActorId
  to: ActorId | ActorId[]
  payload: Value
  id?: MessageId
  label?: string
  into?: Path
  size?: number
  data?: MessageData
}

/** True when a `sent` event for `id` was logged in this step (the message was born here). */
function sentThisStep(ctx: ReduceCtxX, id: MessageId): boolean {
  return ctx.log.events.some((e) => e.kind === 'message' && e.op === 'sent' && e.message.id === id)
}

/**
 * The live message a command names: by message id, else the bare op id when exactly one live
 * message carries that op (`deliver('alice:3')`). Unknown or ambiguous ids throw.
 */
export function findMessage(w: World, id: MessageId, ctx: ReduceCtxX, cmd: unknown): Message {
  const direct = w.messages.find((m) => m.id === id)
  if (direct) return direct
  const byOp = w.messages.filter((m) => m.data?.kind === 'op' && m.data.op.id === id)
  if (byOp.length === 1) return byOp[0] as Message
  if (byOp.length > 1) {
    throw fail(
      ctx,
      cmd,
      `op id "${id}" is carried by ${byOp.length} live messages (${byOp.map((m) => m.id).join(', ')}); name one`,
      `msg:${id}`,
    )
  }
  throw fail(ctx, cmd, `no message "${id}" is in flight or parked`, `msg:${id}`)
}

function checkInto(w: World, into: Path, to: ActorId, ctx: ReduceCtxX, cmd: unknown): void {
  const parsed = parsePath(into)
  if (parsed.root.kind === 'msg') throw fail(ctx, cmd, `"into" cannot be a message`, into)
  if (parsed.selector !== undefined) throw fail(ctx, cmd, `"into" cannot be a selector`, into)
  if (parsed.root.kind === 'actor') {
    if (parsed.root.id !== to) {
      throw fail(ctx, cmd, `"into" (${into}) must lie on the recipient "${to}"`, into)
    }
    if (parsed.segments.length === 0) throw fail(ctx, cmd, `"into" names a slot, not a card`, into)
  } else if (!w.boards[parsed.root.id]) {
    throw fail(ctx, cmd, `"into" names an unknown board "${parsed.root.id}"`, into)
  }
}

/**
 * Create one message per recipient (§4.3). Generated ids are `m1, m2…`; fan-out (array `to`) ids
 * are `${id}@${to}`; a collision with a live message throws. A recipient that is offline gets the
 * message parked ("waiting at the door": `sent` + `parked` events); else it flies (`sent`).
 */
export function createMessages(w: World, spec: CreateSpec, ctx: ReduceCtxX, cmd?: unknown): World {
  const command = cmd ?? spec
  if (!w.actors[spec.from])
    throw fail(ctx, command, `no actor "${spec.from}" to send from`, spec.from)
  const fanOut = Array.isArray(spec.to)
  const recipients = Array.isArray(spec.to) ? spec.to : [spec.to]
  if (recipients.length === 0) throw fail(ctx, command, `a message needs at least one recipient`)
  let world = w
  let base = spec.id
  if (base === undefined) {
    const minted = mintId(world, 'm')
    world = minted.world
    base = minted.id
  }
  const generated = spec.id === undefined
  const born: Message[] = []
  for (const to of recipients) {
    const recipient = world.actors[to]
    if (!recipient) throw fail(ctx, command, `no actor "${to}" to send to`, to)
    if (to === spec.from) throw fail(ctx, command, `"${to}" cannot send a message to itself`)
    const id = fanOut ? `${base}@${to}` : base
    if (world.messages.some((m) => m.id === id) || born.some((m) => m.id === id)) {
      throw fail(
        ctx,
        command,
        generated
          ? `generated message id "${id}" collides with a live message; give "id" explicitly`
          : `message id "${id}" is already in flight or parked`,
        `msg:${id}`,
      )
    }
    if (spec.into !== undefined) checkInto(world, spec.into, to, ctx, command)
    const message: Message = {
      id,
      from: spec.from,
      to,
      payload: spec.payload,
      state: recipient.online ? 'flying' : 'parked',
    }
    if (spec.label !== undefined) message.label = spec.label
    if (spec.into !== undefined) message.into = spec.into
    if (spec.size !== undefined) message.size = spec.size
    if (spec.data !== undefined) message.data = spec.data
    born.push(message)
    ctx.log.push({ kind: 'message', op: 'sent', message })
    if (message.state === 'parked') ctx.log.push({ kind: 'message', op: 'parked', message })
  }
  return { ...world, messages: [...world.messages, ...born] }
}

/** Move a live message into the recipient's inbox tray without effect (`parked` event). */
function park(w: World, msg: Message, ctx: ReduceCtxX): World {
  if (msg.state === 'parked') return w
  const parked: Message = { ...msg, state: 'parked' }
  ctx.log.push({ kind: 'message', op: 'parked', message: parked })
  return { ...w, messages: w.messages.map((m) => (m.id === msg.id ? parked : m)) }
}

/**
 * Apply a message at its recipient (the message is already out of `w.messages`). Plain payloads
 * land at `into` (creating a missing slot / field / item) with a `via` event on that path, or are
 * consumed with a `via` event on the recipient card; data messages and `recv` go to the CRDT
 * layer. `into` is not allowed for state / op messages.
 */
function land(
  w: World,
  msg: Message,
  intoArg: Path | undefined,
  recv: SlotId | undefined,
  ctx: ReduceCtxX,
  cmd: unknown,
): World {
  const into = intoArg ?? msg.into
  if (
    msg.data !== undefined &&
    (msg.data.kind === 'state' || msg.data.kind === 'op') &&
    into !== undefined
  ) {
    throw fail(ctx, cmd, `"into" is not allowed for a ${msg.data.kind} message ("${msg.id}")`, into)
  }
  if (msg.data !== undefined || recv !== undefined) {
    const opts: { into?: Path; recv?: SlotId } = {}
    if (into !== undefined) opts.into = into
    if (recv !== undefined) opts.recv = recv
    return applyIncoming(w, msg, opts, ctx)
  }
  if (into !== undefined) {
    checkInto(w, into, msg.to, ctx, cmd)
    assertPlainTarget(w, into, ctx, cmd)
    const next = setAt(w, into, msg.payload)
    ctx.log.push({ kind: 'via', path: into, message: msg.id })
    pushAction(ctx, into, plainAction('stage.op.setPlain', undefined, msg.from))
    return next
  }
  ctx.log.push({ kind: 'via', path: msg.to, message: msg.id })
  return w
}

function withoutMessage(w: World, id: MessageId): World {
  return { ...w, messages: w.messages.filter((m) => m.id !== id) }
}

/** Rewrite an `into` hint on the hub for a relay recipient: `icloud.doc` → `phone.doc`. */
function rewriteInto(into: Path | undefined, hub: ActorId, to: ActorId): Path | undefined {
  if (into === undefined) return undefined
  const parsed = parsePath(into)
  if (parsed.root.kind !== 'actor' || parsed.root.id !== hub) return into
  return formatPath({ ...parsed, root: { kind: 'actor', id: to } })
}

function toValue(
  payload: Extract<MessageCommand, { t: 'send' }>['payload'],
  w: World,
  ctx: ReduceCtxX,
  cmd: unknown,
): Value {
  if (isScalar(payload)) return { kind: 'scalar', value: payload }
  if ('ref' in payload) {
    const v = getAt(w, payload.ref)
    if (!v)
      throw fail(ctx, cmd, `send: ref "${payload.ref}" does not resolve to a value`, payload.ref)
    return v
  }
  return payload
}

export function reduceMessages(w: World, cmd: MessageCommand, ctx: ReduceCtxX): World {
  switch (cmd.t) {
    case 'send': {
      let world = w
      let payload = toValue(cmd.payload, world, ctx, cmd)
      let data: MessageData | undefined
      if (cmd.stamp !== undefined) {
        const stamped = stampForSend(world, cmd.from, cmd.stamp, ctx)
        world = stamped.world
        payload = { ...payload, meta: { ...payload.meta, ...stamped.meta } }
        data = { kind: 'stamp', slot: cmd.stamp, stamp: stamped.meta }
      }
      const spec: CreateSpec = { from: cmd.from, to: cmd.to, payload }
      if (cmd.id !== undefined) spec.id = cmd.id
      if (cmd.label !== undefined) spec.label = cmd.label
      if (cmd.into !== undefined) spec.into = cmd.into
      if (data !== undefined) spec.data = data
      return createMessages(world, spec, ctx, cmd)
    }
    case 'deliver': {
      const msg = findMessage(w, cmd.message, ctx, cmd)
      if (cmd.into !== undefined && msg.into !== undefined && cmd.into !== msg.into) {
        throw fail(
          ctx,
          cmd,
          `deliver.into "${cmd.into}" disagrees with send.into "${msg.into}" of message "${msg.id}"`,
          cmd.into,
        )
      }
      const recipient = w.actors[msg.to]
      if (!recipient) throw fail(ctx, cmd, `recipient "${msg.to}" of "${msg.id}" is gone`, msg.to)
      if (cmd.park === true || (msg.state === 'flying' && !recipient.online))
        return park(w, msg, ctx)
      let world = withoutMessage(w, msg.id)
      ctx.log.push({ kind: 'message', op: 'delivered', message: msg })
      world = land(world, msg, cmd.into, cmd.recv, ctx, cmd)
      if (sentThisStep(ctx, msg.id)) ctx.log.markTransient(msg.id)
      return world
    }
    case 'drop': {
      const msg = findMessage(w, cmd.message, ctx, cmd)
      ctx.log.push({ kind: 'message', op: 'dropped', message: msg })
      if (sentThisStep(ctx, msg.id)) ctx.log.markTransient(msg.id)
      return withoutMessage(w, msg.id)
    }
    case 'duplicate': {
      const msg = findMessage(w, cmd.message, ctx, cmd)
      const spec: CreateSpec = { from: msg.from, to: msg.to, payload: msg.payload, id: cmd.id }
      if (msg.label !== undefined) spec.label = msg.label
      if (msg.into !== undefined) spec.into = msg.into
      if (msg.size !== undefined) spec.size = msg.size
      if (msg.data !== undefined) spec.data = msg.data
      return createMessages(w, spec, ctx, cmd)
    }
    case 'relay': {
      const msg = findMessage(w, cmd.message, ctx, cmd)
      const hub = w.actors[msg.to]
      if (!hub) throw fail(ctx, cmd, `recipient "${msg.to}" of "${msg.id}" is gone`, msg.to)
      if (!hub.online) throw fail(ctx, cmd, `"${hub.id}" is offline and cannot relay "${msg.id}"`)
      let world = withoutMessage(w, msg.id)
      ctx.log.push({ kind: 'message', op: 'delivered', message: msg })
      world = land(world, msg, undefined, undefined, ctx, cmd)
      if (sentThisStep(ctx, msg.id)) ctx.log.markTransient(msg.id)
      const suffix = `@${msg.to}`
      const base = msg.id.endsWith(suffix) ? msg.id.slice(0, -suffix.length) : msg.id
      const recipients = Array.isArray(cmd.to) ? cmd.to : [cmd.to]
      for (const to of recipients) {
        const spec: CreateSpec = { from: msg.to, to, payload: msg.payload, id: `${base}@${to}` }
        if (msg.label !== undefined) spec.label = msg.label
        const into = cmd.into ?? rewriteInto(msg.into, msg.to, to)
        if (into !== undefined) spec.into = into
        if (msg.size !== undefined) spec.size = msg.size
        if (msg.data !== undefined) spec.data = msg.data
        world = createMessages(world, spec, ctx, cmd)
      }
      return world
    }
  }
}
