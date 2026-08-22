/**
 * Shared fixtures for the reducer tests (not a test file itself). Worlds are built with
 * `initWorld` and literal commands only — never with the builders, which are written concurrently.
 */
import type { Command, SceneWorld, Step, Value, ValueOf, World } from '../types'
import { applyStep, makeReduceCtx, reduce, type ReduceCtxX, type StepCtx } from './index'
import { initWorld } from './world'

export const sceneWorld: SceneWorld = {
  layout: 'pair',
  clock: { show: true },
  actors: [
    { id: 'alice', kind: 'person', label: 'Alice', holds: { doc: 'hello', n: 1 } },
    { id: 'bob', kind: 'person', label: 'Bob', holds: { doc: 'hello' } },
    { id: 'server', kind: 'server', label: 'Server' },
  ],
  boards: [{ id: 'rule', value: { kind: 'text', text: 'merge = max', annotations: [] } }],
}

export function fixtureWorld(): World {
  return initWorld(sceneWorld)
}

export function ctx(overrides: Partial<StepCtx> = {}): ReduceCtxX {
  return makeReduceCtx({ sceneId: 'scene', stepId: 's01', ...overrides })
}

export function step(id: string, ...cmds: Command[]): Step {
  return { id, say: '', do: cmds }
}

/** Reduce `cmds` in order with one ctx; returns the world (and the ctx for log inspection). */
export function run(
  w: World,
  cmds: Command[],
  c: ReduceCtxX = ctx(),
): { world: World; ctx: ReduceCtxX } {
  let world = w
  for (const cmd of cmds) world = reduce(world, cmd, c)
  return { world, ctx: c }
}

/** `applyStep` with a default ctx. */
export function apply(w: World, s: Step, overrides: Partial<StepCtx> = {}) {
  return applyStep(w, s, { sceneId: 'scene', stepId: s.id, ...overrides })
}

export const scalar = (value: string | number | boolean | null, meta?: Value['meta']): Value =>
  meta ? { kind: 'scalar', value, meta } : { kind: 'scalar', value }

export const rec = (fields: Record<string, Value>): Value => ({
  kind: 'record',
  fields: Object.entries(fields).map(([key, value]) => ({ key, value })),
})

export const list = (
  items: Array<string | [string, Value]>,
  display?: 'row' | 'column' | 'text',
): Value => ({
  kind: 'list',
  items: items.map((it) =>
    typeof it === 'string' ? { id: it, value: scalar(it) } : { id: it[0], value: it[1] },
  ),
  ...(display ? { display } : {}),
})

export const sset = (items: string[]): Value => ({
  kind: 'set',
  items: items.map((it) => ({ id: it, value: scalar(it) })),
})

export const clockOf = (entries: Record<string, number>): Value => ({ kind: 'clock', entries })

export const counter = (rows: Record<string, number>): Value => ({
  kind: 'counter',
  rows: Object.entries(rows).map(([node, inc]) => ({ node, inc })),
  total: Object.values(rows).reduce((a, b) => a + b, 0),
})

export const bytesOf = (hex: string): ValueOf<'bytes'> => ({
  kind: 'bytes',
  bytes: (hex.match(/../g) ?? []).map((h) => parseInt(h, 16)),
  display: 'hex',
  annotations: [],
})

export const textOf = (text: string): ValueOf<'text'> => ({ kind: 'text', text, annotations: [] })

export const table = (
  columns: string[],
  rows: Array<[string, Record<string, string | number>]>,
): Value => ({
  kind: 'table',
  columns: columns.map((key) => ({ key, label: key })),
  rows: rows.map(([id, cells]) => ({
    id,
    cells: Object.fromEntries(Object.entries(cells).map(([k, v]) => [k, scalar(v)])),
  })),
})

/** Deep-freeze for "never mutates" assertions. */
export function deepFreeze<T>(v: T): T {
  if (typeof v === 'object' && v !== null && !Object.isFrozen(v)) {
    Object.freeze(v)
    for (const k of Object.keys(v)) deepFreeze((v as Record<string, unknown>)[k])
  }
  return v
}
