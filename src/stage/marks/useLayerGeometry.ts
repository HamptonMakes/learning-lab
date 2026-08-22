/**
 * Rects for the overlay layers: the anchor registry's measured snapshot, or an explicit map a test
 * hands in (jsdom rects are all zero). Works outside <AnchorRegistryProvider> too (empty map), so
 * layers can be rendered alone in tests with a fake geometry.
 */
import { useSyncExternalStore } from 'react'
import type { Path } from '@/lesson/types'
import { useAnchorRegistry, type Rect } from '../geometry'

export type Geometry = ReadonlyMap<Path, Rect>

const EMPTY: Geometry = new Map()
const noSubscribe = () => () => {}
const emptySnapshot = () => EMPTY

export function useLayerGeometry(override?: Geometry): Geometry {
  const reg = useAnchorRegistry()
  const measured = useSyncExternalStore(
    reg ? reg.subscribe : noSubscribe,
    reg ? reg.snapshot : emptySnapshot,
    reg ? reg.snapshot : emptySnapshot,
  )
  return override ?? measured
}
