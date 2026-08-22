/**
 * Deterministic id minting for reducer-generated ids: messages `m1, m2…` and marks `k1, k2…`.
 * Ids come from `World.ids` so two runs of a topic produce identical worlds.
 */
import type { World } from '../types'

export function mintId(world: World, prefix: 'm' | 'k'): { world: World; id: string } {
  const n = world.ids + 1
  return { world: { ...world, ids: n }, id: `${prefix}${n}` }
}
