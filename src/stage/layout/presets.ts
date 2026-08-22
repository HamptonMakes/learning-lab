/**
 * Layout presets (DSL §9, stage-architecture §3.1). Presets are CSS-grid hints, never pixels:
 * cards are assigned to named slots in insertion order and `stage.css` maps slots to grid areas
 * per preset. In `hub` and `ring` the hub actor (`layout.hub`, else the first server/service, else
 * the first actor) takes the `hub` slot; everyone else takes `s1…` in insertion order.
 */
import type { Actor, ActorId, Layout, LayoutPreset } from '@/lesson/types'

export type Slot = 'hub' | `s${number}`

/** Presets with a centre slot. */
export const HUB_PRESETS: ReadonlySet<LayoutPreset> = new Set<LayoutPreset>(['hub', 'ring'])

/** The named areas each preset lays out explicitly; cards beyond them auto-place. */
export const PRESET_SLOTS: Record<LayoutPreset, readonly Slot[]> = {
  row: [],
  pair: ['s1', 's2'],
  triangle: ['s1', 's2', 's3'],
  hub: ['hub', 's1', 's2', 's3', 's4'],
  ring: ['hub', 's1', 's2', 's3', 's4'],
  grid: [],
}

/** The actor that takes the `hub` slot: `layout.hub` if it exists, else the first server/service, else the first actor. */
export function hubOf(actors: readonly Actor[], layout: Layout): ActorId | undefined {
  if (layout.hub !== undefined && actors.some((a) => a.id === layout.hub)) return layout.hub
  const server = actors.find((a) => a.kind === 'server' || a.kind === 'service')
  return (server ?? actors[0])?.id
}

export interface Placement {
  actor: Actor
  slot: Slot
}

/** Slots in insertion order; only `hub`/`ring` use the `hub` slot. */
export function placeActors(actors: readonly Actor[], layout: Layout): Placement[] {
  const hub = HUB_PRESETS.has(layout.preset) ? hubOf(actors, layout) : undefined
  let next = 0
  return actors.map((actor) => {
    if (actor.id === hub) return { actor, slot: 'hub' }
    next += 1
    return { actor, slot: `s${next}` }
  })
}
