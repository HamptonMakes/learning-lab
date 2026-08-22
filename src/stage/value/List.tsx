/**
 * List — `display: 'row'` (chips in a wrapping row), `'column'` (stacked), or `'text'` (one
 * character per item on a line, with the element id beneath each: the RGA view, DSL §5.1).
 * In `text` display each item's `data-value` is its id and the list's `data-value` is the joined
 * string; the whole line is an LTR island (DSL §9). Tombstoned items stay struck through and dimmed;
 * ≤ 8 live items are visible, the rest is a `+n` chip.
 */
import { AnimatePresence, motion } from 'motion/react'
import type { Path, ValueOf } from '@/lesson/types'
import { cn } from '@/lib/utils'
import { useStageMotion } from '../motion/StageMotionProvider'
import { useStageFrame } from '../StageContext'
import { Ltr, OverflowChip } from './chips'
import { dataValueOf, formatScalar } from './format'
import { ItemsView } from './items'
import { visibleItems } from './visible'
import { MetaBadges } from './MetaBadges'
import { NodeBox } from './NodeBox'
import { isTokenPath, itemPath } from './paths'
import { hueVars } from './tone'

export function List({
  path,
  value,
  depth,
}: {
  path: Path
  value: ValueOf<'list'>
  depth: number
}) {
  const display = value.display ?? 'row'
  return (
    <NodeBox
      path={path}
      kind="list"
      dataValue={dataValueOf(value)}
      tombstone={value.meta?.tombstone}
      attrs={{ 'data-display': display }}
      className={cn(
        'flex min-w-0 flex-col gap-1.5 rounded-sm font-mono text-(length:--value-fs)',
        depth === 0 && 'px-0.5',
      )}
    >
      {value.items.length === 0 && <span className="text-ink-3">[]</span>}
      {display === 'text' ? (
        <TextItems path={path} value={value} />
      ) : (
        <ItemsView
          path={path}
          items={value.items}
          depth={depth}
          orientation={display}
          variant="chip"
        />
      )}
      <MetaBadges path={path} meta={value.meta} />
    </NodeBox>
  )
}

/** One character per item, id beneath, writer hue on the id; a space shows as `␣`. */
function TextItems({ path, value }: { path: Path; value: ValueOf<'list'> }) {
  const { off, tr, dir } = useStageMotion()
  const { world } = useStageFrame()
  const { shown, overflow } = visibleItems(value.items)
  const shared = !isTokenPath(path)
  return (
    <Ltr className="inline-flex max-w-full">
      <ul className="flex flex-wrap items-end">
        <AnimatePresence
          initial={false}
          mode="popLayout"
          anchorX={dir === 'rtl' ? 'right' : 'left'}
        >
          {shown.map((item) => {
            const tomb = item.value.meta?.tombstone === true
            const text = item.value.kind === 'scalar' ? formatScalar(item.value.value) : ''
            const glyph = text === ' ' ? '␣' : text === '' ? '·' : text
            const node = item.value.meta?.node
            const color = node ? world.actors[node]?.color : undefined
            return (
              <motion.li
                key={item.id}
                data-item={item.id}
                layout
                layoutId={shared ? itemPath(path, item.id) : undefined}
                initial={off ? false : { opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, transition: tr('exit') }}
                transition={{ ...tr('enter'), layout: tr('layout') }}
                className="flex flex-col items-center px-0.5"
                style={color ? hueVars(color) : undefined}
              >
                <NodeBox
                  as="span"
                  path={itemPath(path, item.id)}
                  kind="scalar"
                  dataValue={item.id}
                  tombstone={tomb}
                  title={`${text} · ${item.id}`}
                  attrs={{ 'data-char': text }}
                  className={cn(
                    'grid min-w-[1ch] place-items-center rounded-sm px-0.5 leading-6',
                    tomb && 'text-ink-3 line-through',
                    (text === ' ' || text === '') && !tomb && 'text-ink-3',
                  )}
                >
                  {glyph}
                </NodeBox>
                <span
                  className={cn('text-[10px] leading-3 text-ink-3', color && 'text-(--hue)')}
                  aria-hidden
                >
                  {item.id}
                </span>
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
              className="flex items-center self-center px-0.5"
            >
              <OverflowChip count={overflow} />
            </motion.li>
          )}
        </AnimatePresence>
      </ul>
    </Ltr>
  )
}
