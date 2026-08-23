/**
 * Scalar — one value in JetBrains Mono: strings plain (no quotes), numbers tabular, booleans and
 * null italic and quieter. Display ≤ 24 characters with a middle ellipsis; the full value stays in
 * `title` and `data-value` (DSL §2). A tombstoned scalar is struck through and dimmed. Meta badges
 * follow the text; as the value of a record-card row (CardRowContext) the node is a subgrid over
 * the record's value + sidecar columns, so its stamp lines up with the other rows'.
 */
import { useContext } from 'react'
import type { Path, ValueOf } from '@/lesson/types'
import { cn } from '@/lib/utils'
import { CardRowContext } from './cardRow'
import { formatScalar } from './format'
import { MetaBadges } from './MetaBadges'
import { NodeBox } from './NodeBox'
import { middleEllipsis } from './truncate'

export function Scalar({
  path,
  value,
  depth,
}: {
  path: Path
  value: ValueOf<'scalar'>
  depth: number
}) {
  const inRow = useContext(CardRowContext)
  const full = formatScalar(value.value)
  const shown = middleEllipsis(full)
  const truncated = shown !== full
  const tomb = value.meta?.tombstone === true
  const type = value.value === null ? 'null' : typeof value.value
  const empty = full === ''
  return (
    <NodeBox
      as="span"
      path={path}
      kind="scalar"
      dataValue={full}
      tombstone={tomb}
      title={truncated ? full : undefined}
      attrs={{ 'data-scalar-type': type, 'data-cell': inRow ? '' : undefined }}
      className={cn(
        'rounded-sm font-mono text-(length:--value-fs) leading-normal text-ink',
        inRow
          ? 'col-span-2 grid min-w-0 grid-cols-subgrid items-baseline'
          : 'inline-flex max-w-full flex-wrap items-baseline gap-x-2 gap-y-0.5',
        depth === 0 && 'px-0.5',
      )}
    >
      <bdi
        className={cn(
          'min-w-0 wrap-break-word',
          type === 'number' && 'tabular-nums',
          (type === 'boolean' || type === 'null') && 'text-ink-2 italic',
          empty && 'text-ink-3',
          tomb && 'text-ink-3 line-through decoration-ink-3',
        )}
      >
        {empty ? '""' : shown}
      </bdi>
      <MetaBadges path={path} meta={value.meta} />
    </NodeBox>
  )
}
