/** Minimal Frame fixtures for the player tests (the player only reads step, sceneId, changes). */
import type { Change, Frame, Hold, Message, World } from '@/lesson/types'

export const EMPTY_WORLD: World = {
  layout: { preset: 'row' },
  clock: { now: 0, show: false, format: 'counter' },
  actors: {},
  boards: {},
  messages: [],
  marks: [],
  replicas: {},
  engines: {},
  ids: 0,
}

export function message(id: string, from = 'alice', to = 'bob'): Message {
  return { id, from, to, payload: { kind: 'scalar', value: 1 }, state: 'flying' }
}

export const CHANGES = {
  value: { kind: 'value', path: 'alice.doc.title', op: 'changed' } satisfies Change,
  actor: { kind: 'actor', id: 'alice', op: 'online' } satisfies Change,
  board: { kind: 'board', id: 'b1', op: 'changed' } satisfies Change,
  layout: { kind: 'layout', from: { preset: 'row' }, to: { preset: 'pair' } } satisfies Change,
  mark: { kind: 'mark', id: 'k1', op: 'added' } satisfies Change,
  clock: { kind: 'clock', from: 0, to: 1 } satisfies Change,
  sent: { kind: 'message', op: 'sent', message: message('m1') } satisfies Change,
  parked: { kind: 'message', op: 'parked', message: message('m1') } satisfies Change,
  delivered: { kind: 'message', op: 'delivered', message: message('m1') } satisfies Change,
  transientDelivered: {
    kind: 'message',
    op: 'delivered',
    message: message('m2'),
    transient: true,
  } satisfies Change,
  dropped: { kind: 'message', op: 'dropped', message: message('m3') } satisfies Change,
  sync: { kind: 'sync', slot: 'doc', from: 'alice', to: 'bob', both: true } satisfies Change,
} as const

export interface FrameSpec {
  id?: string
  sceneId?: string
  hold?: Hold
  changes?: Change[]
  say?: string
}

export function frame(index: number, spec: FrameSpec = {}): Frame {
  const step: Frame['step'] = {
    id: spec.id ?? `s${index + 1}`,
    say: spec.say ?? `Step ${index + 1}.`,
    do: [],
  }
  if (spec.hold) step.hold = spec.hold
  return {
    index,
    sceneId: spec.sceneId ?? 'scene-1',
    sceneIndex: 0,
    step,
    world: EMPTY_WORLD,
    prev: EMPTY_WORLD,
    changes: spec.changes ?? [],
  }
}

/** `n` frames; `spec(i)` customises each. */
export function frames(n: number, spec: (i: number) => FrameSpec = () => ({})): Frame[] {
  return Array.from({ length: n }, (_, i) => frame(i, spec(i)))
}
