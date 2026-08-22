/**
 * Actor and board builders (docs/animation-dsl.md §8.2). The fixed cast (Alice, Bob, Carol, Dana)
 * owns colours a/b/c/d; servers and services take the `server` hue; devices inherit their owner's.
 */
import type { ActorColor, ActorId, ActorSpec, Board, Scalar, SlotId, Tone, Value } from '../types'
import { compact, isScalar } from './internal'
import { toValue, type ValueLike } from './values'

/** Optional fields of an `ActorSpec` a builder call may set. `holds` accepts scalars and ValueLikes. */
export type ActorOpts = {
  label?: string
  subtitle?: string
  icon?: ActorSpec['icon']
  holds?: { readonly [slot: SlotId]: ValueLike }
  online?: boolean
  status?: ActorSpec['status']
  skew?: number
  owner?: ActorId
  color?: ActorColor
}

function holdsOf(holds: ActorOpts['holds']): Record<SlotId, Value | Scalar> | undefined {
  if (!holds) return undefined
  const out: Record<SlotId, Value | Scalar> = {}
  for (const [slot, v] of Object.entries(holds)) out[slot] = isScalar(v) ? v : toValue(v)
  return out
}

function actor(
  id: ActorId,
  kind: ActorSpec['kind'],
  label: string,
  color: ActorColor | undefined,
  opts?: ActorOpts,
): ActorSpec {
  return compact({ id, kind, label, color, ...opts, holds: holdsOf(opts?.holds) })
}

/** Alice: person, colour `a`. opts: `{ label, subtitle, icon, holds, online, status, skew }`. */
export const alice = (opts?: ActorOpts): ActorSpec => actor('alice', 'person', 'Alice', 'a', opts)
/** Bob: person, colour `b`. */
export const bob = (opts?: ActorOpts): ActorSpec => actor('bob', 'person', 'Bob', 'b', opts)
/** Carol: person, colour `c`. */
export const carol = (opts?: ActorOpts): ActorSpec => actor('carol', 'person', 'Carol', 'c', opts)
/** Dana: person, colour `d`. */
export const dana = (opts?: ActorOpts): ActorSpec => actor('dana', 'person', 'Dana', 'd', opts)

/** `server('Server')` — kind server, colour server, id `server` (override with `opts.id`). */
export function server(label = 'Server', opts?: ActorOpts & { id?: ActorId }): ActorSpec {
  const { id = 'server', ...rest } = opts ?? {}
  return actor(id, 'server', label, 'server', rest)
}

/** `service('edge-us', 'US edge', 'a')` — kind service with an explicit colour. */
export function service(
  id: ActorId,
  label: string,
  color: ActorColor,
  opts?: ActorOpts,
): ActorSpec {
  return actor(id, 'service', label, color, opts)
}

/** `device('laptop', 'Laptop', { owner: 'alice' })` — kind device; `owner` links the hue ("Alice's"). */
export function device(id: ActorId, label: string, opts?: ActorOpts): ActorSpec {
  return actor(id, 'device', label, undefined, opts)
}

/** `board('rule', text('merge: newer ts wins'), { label: 'rule' })` — a free-standing card in the scene world. */
export function board(id: string, value: ValueLike, opts?: { label?: string; tone?: Tone }): Board {
  return compact({ id, label: opts?.label, value: toValue(value), tone: opts?.tone })
}
