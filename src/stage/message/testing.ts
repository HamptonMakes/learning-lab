/**
 * Fixtures for the overlay-layer tests: hand-built worlds, frames and a fake geometry map (jsdom
 * rects are all zero, so layers take `geometry` explicitly). Not part of the app bundle.
 */
import type {
  Actor,
  ActorColor,
  ActorId,
  Change,
  Frame,
  Mark,
  Message,
  Meta,
  Path,
  Scalar,
  Value,
  World,
} from '@/lesson/types'
import type { Rect } from '../geometry'

export const scalar = (value: Scalar, meta?: Meta): Value =>
  meta ? { kind: 'scalar', value, meta } : { kind: 'scalar', value }

export function actor(id: ActorId, color: ActorColor, holds: Record<string, Value> = {}): Actor {
  return { id, kind: 'person', label: id, color, online: true, holds, outbox: [] }
}

export function msg(
  id: string,
  from: ActorId,
  to: ActorId,
  payload: Value = scalar('hi'),
  extra: Partial<Message> = {},
): Message {
  return { id, from, to, payload, state: 'flying', ...extra }
}

export function world(p: { actors?: Actor[]; messages?: Message[]; marks?: Mark[] }): World {
  const actors = p.actors ?? [
    actor('alice', 'a', { doc: scalar('A') }),
    actor('bob', 'b', { doc: scalar('B') }),
    actor('carol', 'c', { doc: scalar('C') }),
  ]
  return {
    layout: { preset: 'row' },
    clock: { now: 0, show: false, format: 'counter' },
    actors: Object.fromEntries(actors.map((a) => [a.id, a])),
    boards: {},
    messages: p.messages ?? [],
    marks: p.marks ?? [],
    replicas: {},
    engines: {},
    ids: 0,
  }
}

export function frame(w: World, changes: Change[] = [], index = 0, prev?: World): Frame {
  return {
    index,
    sceneId: 's1',
    sceneIndex: 0,
    step: { id: `step-${index}`, say: 'Test.', do: [] },
    world: w,
    prev: prev ?? world({ actors: Object.values(w.actors) }),
    changes,
  }
}

/** Three cards in a row (alice | bob | carol), each with an inbox tray and a `doc` slot. */
export const GEO: ReadonlyMap<Path, Rect> = new Map<Path, Rect>([
  ['alice', { x: 0, y: 0, w: 200, h: 140 }],
  ['bob', { x: 400, y: 0, w: 200, h: 140 }],
  ['carol', { x: 800, y: 0, w: 200, h: 140 }],
  ['alice@inbox', { x: 10, y: 40, w: 180, h: 32 }],
  ['bob@inbox', { x: 410, y: 40, w: 180, h: 32 }],
  ['carol@inbox', { x: 810, y: 40, w: 180, h: 32 }],
  ['alice.doc', { x: 10, y: 90, w: 180, h: 36 }],
  ['bob.doc', { x: 410, y: 90, w: 180, h: 36 }],
  ['carol.doc', { x: 810, y: 90, w: 180, h: 36 }],
  ['alice.top', { x: 10, y: 0, w: 180, h: 20 }],
])

/** Parse Motion's `transform` string into its translate components. */
export function translateOf(style: CSSStyleDeclaration): { x: number; y: number } {
  const x = /translateX\((-?[\d.]+)px\)/.exec(style.transform)?.[1]
  const y = /translateY\((-?[\d.]+)px\)/.exec(style.transform)?.[1]
  return { x: x ? Number(x) : 0, y: y ? Number(y) : 0 }
}
