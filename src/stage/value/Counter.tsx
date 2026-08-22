/**
 * Counter — one row per node (G-Counter: `+inc`; PN-Counter rows also carry `−dec`) and a total.
 * Rows are `${path}[${node}]`, cells `${path}[${node}]@inc` / `@dec`; the pseudo-node `seed` row is
 * labelled "init". The counter's `data-value` is the total; a row's is `{"inc":2,"dec":1}`; a
 * cell's is its number. Rows keep world actor order (the view contract), so merges never reshuffle.
 */
import { AnimatePresence } from 'motion/react'
import type { CounterRow, Path, ValueOf } from '@/lesson/types'
import { useT } from '@/i18n'
import { cn } from '@/lib/utils'
import { useStageMotion } from '../motion/StageMotionProvider'
import { NodeChip } from './chips'
import { MetaBadges } from './MetaBadges'
import { NodeBox } from './NodeBox'
import { itemPath, metaPath } from './paths'

export function Counter({
  path,
  value,
  depth,
}: {
  path: Path
  value: ValueOf<'counter'>
  depth: number
}) {
  const t = useT()
  const { off, tr } = useStageMotion()
  const hasDec = value.rows.some((r) => r.dec !== undefined)
  return (
    <NodeBox
      path={path}
      kind="counter"
      dataValue={String(value.total)}
      tombstone={value.meta?.tombstone}
      className={cn(
        'inline-flex min-w-0 flex-col gap-0.5 rounded-sm font-mono text-[13px]',
        depth === 0 && 'px-0.5',
      )}
    >
      <div
        data-counter-rows=""
        className="grid items-center gap-x-2 gap-y-0.5"
        style={{ gridTemplateColumns: hasDec ? 'auto auto auto' : 'auto auto' }}
      >
        <AnimatePresence initial={false}>
          {value.rows.map((row) => (
            <NodeBox
              key={row.node}
              as="div"
              path={itemPath(path, row.node)}
              kind="row"
              dataValue={rowValue(row)}
              attrs={{ 'data-node': row.node }}
              layout="position"
              initial={off ? false : { opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0, transition: tr('exit') }}
              transition={{ ...tr('enter'), layout: tr('layout') }}
              className="col-span-full grid grid-cols-subgrid items-center rounded-sm"
            >
              <NodeChip node={row.node} />
              <NodeBox
                as="span"
                path={metaPath(itemPath(path, row.node), 'inc')}
                kind="cell"
                dataValue={String(row.inc)}
                className="rounded-sm px-0.5 text-end tabular-nums"
              >
                <bdi dir="ltr">+{row.inc}</bdi>
              </NodeBox>
              {hasDec &&
                (row.dec !== undefined ? (
                  <NodeBox
                    as="span"
                    path={metaPath(itemPath(path, row.node), 'dec')}
                    kind="cell"
                    dataValue={String(row.dec)}
                    className="rounded-sm px-0.5 text-end tabular-nums"
                  >
                    <bdi dir="ltr">−{row.dec}</bdi>
                  </NodeBox>
                ) : (
                  <span className="px-0.5 text-end text-ink-3" aria-hidden>
                    ·
                  </span>
                ))}
            </NodeBox>
          ))}
        </AnimatePresence>
        <div className="col-span-full flex items-baseline justify-end gap-2 border-t border-line pt-0.5">
          <span className="font-sans text-[11px] text-ink-2">{t('stage.counter.total')}</span>
          <span data-total="" className="font-semibold tabular-nums">
            {value.total}
          </span>
        </div>
      </div>
      <MetaBadges path={path} meta={value.meta} />
    </NodeBox>
  )
}

function rowValue(row: CounterRow): string {
  return JSON.stringify(row.dec === undefined ? { inc: row.inc } : { inc: row.inc, dec: row.dec })
}
