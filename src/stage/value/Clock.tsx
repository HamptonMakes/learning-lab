/**
 * Clock — a vector clock as compact `node n` entries (one pill per node, the node chip in its hue,
 * the count tabular). Entries are `${path}.${node}` with `data-value` = the count; the clock's
 * `data-value` is `alice2 bob1` (full form in `title`). The line is an LTR island (DSL §9).
 */
import { AnimatePresence } from 'motion/react'
import type { Path, ValueOf } from '@/lesson/types'
import { cn } from '@/lib/utils'
import { useStageMotion } from '../motion/StageMotionProvider'
import { Ltr, NodeChip } from './chips'
import { compactClock, fullClock } from './format'
import { MetaBadges } from './MetaBadges'
import { NodeBox } from './NodeBox'
import { fieldPath } from './paths'

export function Clock({
  path,
  value,
  depth,
}: {
  path: Path
  value: ValueOf<'clock'>
  depth: number
}) {
  const { off, tr } = useStageMotion()
  const entries = Object.entries(value.entries)
  return (
    <NodeBox
      path={path}
      kind="clock"
      dataValue={compactClock(value.entries)}
      title={fullClock(value.entries)}
      tombstone={value.meta?.tombstone}
      className={cn(
        'inline-flex min-w-0 flex-wrap items-center gap-1 rounded-sm font-mono text-[13px]',
        depth === 0 && 'px-0.5',
      )}
    >
      {entries.length === 0 && <span className="text-ink-3">{'{ }'}</span>}
      <Ltr className="inline-flex flex-wrap items-center gap-1">
        <AnimatePresence initial={false}>
          {entries.map(([node, n]) => (
            <NodeBox
              key={node}
              as="span"
              path={fieldPath(path, node)}
              kind="entry"
              dataValue={String(n)}
              attrs={{ 'data-entry': node }}
              layout="position"
              initial={off ? false : { opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9, transition: tr('exit') }}
              transition={{ ...tr('enter'), layout: tr('layout') }}
              className="inline-flex items-center gap-1 rounded-sm border border-line bg-card px-1"
            >
              <NodeChip node={node} />
              <span className="tabular-nums">{n}</span>
            </NodeBox>
          ))}
        </AnimatePresence>
      </Ltr>
      <MetaBadges path={path} meta={value.meta} />
    </NodeBox>
  )
}
