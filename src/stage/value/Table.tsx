/**
 * Table — a header row of column labels (localizable), rows by id, cells by column key.
 * Nodes: the column band `${path}.${col}` (anchored on the header cell), rows `${path}[${rowId}]`,
 * cells `${path}[${rowId}].${col}` (each cell value is a ValueView). Rows carry `layout` +
 * `layoutId` so `sort` / `insert` glide; a row is a `tr`, so its highlight is an outline.
 */
import { AnimatePresence } from 'motion/react'
import type { Path, TableRow, ValueOf } from '@/lesson/types'
import { plainValue } from '@/lesson/path'
import { cn } from '@/lib/utils'
import { useStageMotion } from '../motion/StageMotionProvider'
import { dataValueOf } from './format'
import { MetaBadges } from './MetaBadges'
import { NodeBox } from './NodeBox'
import { fieldPath, isTokenPath, itemPath } from './paths'
import { ValueView } from './ValueView'

export function Table({
  path,
  value,
  depth,
}: {
  path: Path
  value: ValueOf<'table'>
  depth: number
}) {
  const { off, tr } = useStageMotion()
  const shared = !isTokenPath(path)
  return (
    <NodeBox
      path={path}
      kind="table"
      dataValue={dataValueOf(value)}
      tombstone={value.meta?.tombstone}
      className={cn(
        'flex min-w-0 flex-col gap-1 overflow-x-auto rounded-sm font-mono text-(length:--value-fs) [--value-fs:13px]',
        depth === 0 && 'px-0.5',
      )}
    >
      <table className="border-collapse">
        <thead>
          <tr>
            {value.columns.map((col) => (
              <th key={col.key} scope="col" className="px-1.5 py-0.5 text-start align-bottom">
                <NodeBox
                  as="span"
                  path={fieldPath(path, col.key)}
                  kind="column"
                  dataValue={JSON.stringify(value.rows.map((r) => cellPlain(r, col.key)))}
                  attrs={{ 'data-column': col.key }}
                  className="block rounded-sm border-b border-line pb-1 font-sans text-[11px] leading-4 font-medium text-ink-3"
                >
                  {col.label}
                </NodeBox>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          <AnimatePresence initial={false}>
            {value.rows.map((row) => (
              <NodeBox
                key={row.id}
                as="tr"
                path={itemPath(path, row.id)}
                kind="row"
                dataValue={JSON.stringify(rowPlain(row))}
                attrs={{ 'data-row': row.id }}
                layout
                layoutId={shared ? itemPath(path, row.id) : undefined}
                initial={off ? false : { opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0, transition: tr('exit') }}
                transition={{ ...tr('enter'), layout: tr('layout') }}
                className="rounded-sm border-b border-line last:border-b-0"
              >
                {value.columns.map((col) => {
                  const cell = row.cells[col.key]
                  return (
                    <td key={col.key} className="px-1.5 py-0.5 align-top">
                      {cell ? (
                        <ValueView
                          path={fieldPath(itemPath(path, row.id), col.key)}
                          value={cell}
                          depth={depth + 1}
                        />
                      ) : (
                        <span className="text-ink-3" aria-hidden>
                          –
                        </span>
                      )}
                    </td>
                  )
                })}
              </NodeBox>
            ))}
          </AnimatePresence>
        </tbody>
      </table>
      <MetaBadges path={path} meta={value.meta} />
    </NodeBox>
  )
}

function rowPlain(row: TableRow): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, cell] of Object.entries(row.cells)) out[key] = plainValue(cell)
  return out
}

function cellPlain(row: TableRow, key: string): unknown {
  const cell = row.cells[key]
  return cell ? plainValue(cell) : null
}
