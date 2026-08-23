/**
 * Record — `display: 'card'` (default) draws key / value rows as one grid of `key | value |
 * sidecar` columns (stage.css), so keys, values and stamps line up across rows ("due / Fri / t=0"
 * read as cells); a nested record keeps the same grid inside its cell. `display: 'tree'` draws an
 * indented tree with connector lines (nested records inherit the tree look). ≤ 6 fields (schema).
 * Each field value is its own node at `${path}.${key}`; rows are keyed by field key so added /
 * removed fields animate in and out and the rest glide.
 */
import { createContext, useContext } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import type { Path, ValueOf } from '@/lesson/types'
import { cn } from '@/lib/utils'
import { useStageMotion } from '../motion/StageMotionProvider'
import { CardRowContext } from './cardRow'
import { dataValueOf } from './format'
import { MetaBadges } from './MetaBadges'
import { NodeBox } from './NodeBox'
import { fieldPath, isTokenPath } from './paths'
import { ValueView } from './ValueView'

/** True inside a `display: 'tree'` record, so nested records without their own display follow it. */
const TreeContext = createContext(false)

export function Record({
  path,
  value,
  depth,
}: {
  path: Path
  value: ValueOf<'record'>
  depth: number
}) {
  const inTree = useContext(TreeContext)
  const tree = (value.display ?? (inTree ? 'tree' : 'card')) === 'tree'
  const { off, tr, dir } = useStageMotion()
  const shared = !isTokenPath(path)
  return (
    <NodeBox
      path={path}
      kind="record"
      dataValue={dataValueOf(value)}
      tombstone={value.meta?.tombstone}
      attrs={{ 'data-display': tree ? 'tree' : 'card' }}
      className={cn(
        'min-w-0 rounded-sm font-mono text-(length:--value-fs) [--value-fs:14px]',
        tree && 'flex flex-col gap-0.5',
        depth === 0 && 'px-0.5',
      )}
    >
      <TreeContext.Provider value={tree}>
        {value.fields.length === 0 && <span className="col-span-full text-ink-3">{'{}'}</span>}
        <AnimatePresence
          initial={false}
          mode="popLayout"
          anchorX={dir === 'rtl' ? 'right' : 'left'}
        >
          {value.fields.map((field) => {
            const nested = field.value.kind === 'record' || field.value.kind === 'table'
            const scalar = field.value.kind === 'scalar'
            const view = (
              <ValueView path={fieldPath(path, field.key)} value={field.value} depth={depth + 1} />
            )
            return (
              <motion.div
                key={field.key}
                data-field={field.key}
                layout={shared ? 'position' : undefined}
                initial={off ? false : { opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0, transition: tr('exit') }}
                transition={{ ...tr('enter'), layout: tr('layout') }}
                className={cn(
                  'min-w-0',
                  tree && 'flex gap-x-2 gap-y-0.5',
                  tree && (nested ? 'flex-col items-start' : 'flex-row flex-wrap items-center'),
                  tree &&
                    'relative ms-1.5 border-s border-line ps-3 before:absolute before:start-0 before:top-2.5 before:h-px before:w-2.5 before:bg-line',
                )}
              >
                <span
                  data-field-key=""
                  className={cn(
                    'shrink-0 font-sans text-[11px] leading-5 text-ink-3',
                    !tree && 'text-end',
                  )}
                >
                  {field.key}
                </span>
                {tree ? (
                  view
                ) : scalar ? (
                  <CardRowContext.Provider value={true}>{view}</CardRowContext.Provider>
                ) : (
                  <div data-field-value="" className="min-w-0">
                    {view}
                  </div>
                )}
              </motion.div>
            )
          })}
        </AnimatePresence>
      </TreeContext.Provider>
      <MetaBadges path={path} meta={value.meta} className={cn(!tree && 'col-span-full')} />
    </NodeBox>
  )
}
