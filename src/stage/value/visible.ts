/**
 * Which list / set items are drawn (DSL §2 legibility): every tombstone (struck through, not
 * counted) and the first `maxVisibleItems` live items; the rest is reported as `overflow` (`+n`).
 */
import { LIMITS, type Item } from '@/lesson/types'

/** The items to draw: every tombstone, and the first `maxVisibleItems` live items; the rest is `overflow`. */
export function visibleItems(items: readonly Item[]): { shown: Item[]; overflow: number } {
  const shown: Item[] = []
  let live = 0
  let overflow = 0
  for (const item of items) {
    if (item.value.meta?.tombstone) {
      shown.push(item)
    } else if (live < LIMITS.maxVisibleItems) {
      shown.push(item)
      live++
    } else {
      overflow++
    }
  }
  return { shown, overflow }
}
