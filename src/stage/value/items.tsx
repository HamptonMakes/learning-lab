/**
 * Shared item list for `list` (row / column) and `set` values: ≤ 8 visible live items (tombstones
 * do not count and stay, struck through), a `+n` chip for the overflow, one `motion.li` per item
 * with `layout` + `layoutId` (the item path) so reorders / inserts glide, and `AnimatePresence
 * mode="popLayout"` so removed items fade out of flow. Item values render through `ValueView` at
 * `${path}[${id}]`.
 */
import { AnimatePresence, motion } from 'motion/react'
import type { Item, Path } from '@/lesson/types'
import { cn } from '@/lib/utils'
import { useStageMotion } from '../motion/StageMotionProvider'
import { OverflowChip } from './chips'
import { visibleItems } from './visible'
import { isTokenPath, itemPath } from './paths'
import { ValueView } from './ValueView'

export interface ItemsViewProps {
  path: Path
  items: readonly Item[]
  depth: number
  orientation: 'row' | 'column'
  /** chip = list item (square corners); pill = set element (round). */
  variant: 'chip' | 'pill'
}

export function ItemsView({ path, items, depth, orientation, variant }: ItemsViewProps) {
  const { off, tr, dir } = useStageMotion()
  const { shown, overflow } = visibleItems(items)
  const shared = !isTokenPath(path)
  return (
    <ul
      data-orientation={orientation}
      className={cn(
        'flex min-w-0 gap-1',
        orientation === 'row' ? 'flex-row flex-wrap items-center' : 'flex-col items-stretch',
      )}
    >
      <AnimatePresence initial={false} mode="popLayout" anchorX={dir === 'rtl' ? 'right' : 'left'}>
        {shown.map((item) => {
          const tomb = item.value.meta?.tombstone === true
          return (
            <motion.li
              key={item.id}
              data-item={item.id}
              layout
              layoutId={shared ? itemPath(path, item.id) : undefined}
              initial={off ? false : { opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9, transition: tr('exit') }}
              transition={{ ...tr('enter'), layout: tr('layout') }}
              style={{ borderRadius: variant === 'pill' ? 999 : 4 }}
              className={cn(
                'flex min-w-0 items-center border bg-card',
                variant === 'pill' ? 'px-1.5' : 'px-1',
                tomb ? 'border-dashed border-line opacity-70' : 'border-line',
              )}
            >
              <ValueView path={itemPath(path, item.id)} value={item.value} depth={depth + 1} />
            </motion.li>
          )
        })}
        {overflow > 0 && (
          <motion.li
            key="+overflow"
            layout
            initial={off ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, transition: tr('exit') }}
            transition={{ ...tr('enter'), layout: tr('layout') }}
            className="flex items-center"
          >
            <OverflowChip count={overflow} />
          </motion.li>
        )}
      </AnimatePresence>
    </ul>
  )
}
