/**
 * Scalar — one value in JetBrains Mono: strings plain (no quotes), numbers tabular, booleans and
 * null italic and quieter. Display ≤ 24 characters with a middle ellipsis; the full value stays in
 * `title` and `data-value` (DSL §2). A tombstoned scalar is struck through and dimmed. Meta badges
 * follow the text.
 */
import type { Path, ValueOf } from '@/lesson/types'
import { cn } from '@/lib/utils'
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
      attrs={{ 'data-scalar-type': type }}
      className={cn(
        'inline-flex max-w-full flex-wrap items-center gap-x-1.5 gap-y-0.5 rounded-sm font-mono text-[13px] leading-5 text-ink',
        depth === 0 && 'px-0.5',
      )}
    >
      <bdi
        className={cn(
          'min-w-0 break-all',
          type === 'number' && 'tabular-nums',
          (type === 'boolean' || type === 'null') && 'text-ink-2 italic',
          empty && 'text-ink-3',
          tomb && 'text-ink-3 line-through',
        )}
      >
        {empty ? '""' : shown}
      </bdi>
      <MetaBadges path={path} meta={value.meta} />
    </NodeBox>
  )
}
