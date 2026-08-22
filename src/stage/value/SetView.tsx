/**
 * Set — unordered elements as pills (order as given: the view contract sorts by canonical key, so
 * Motion never reshuffles on merge). Tombstoned elements stay struck through; OR-Set tags and other
 * sidecar come from each element's own meta badges (`${path}[id]@tags` …).
 */
import type { Path, ValueOf } from '@/lesson/types'
import { cn } from '@/lib/utils'
import { dataValueOf } from './format'
import { ItemsView } from './items'
import { MetaBadges } from './MetaBadges'
import { NodeBox } from './NodeBox'

export function SetView({
  path,
  value,
  depth,
}: {
  path: Path
  value: ValueOf<'set'>
  depth: number
}) {
  return (
    <NodeBox
      path={path}
      kind="set"
      dataValue={dataValueOf(value)}
      tombstone={value.meta?.tombstone}
      className={cn(
        'flex min-w-0 flex-col gap-1 rounded-sm font-mono text-[13px]',
        depth === 0 && 'px-0.5',
      )}
    >
      {value.items.length === 0 && <span className="text-ink-3">{'{ }'}</span>}
      <ItemsView path={path} items={value.items} depth={depth} orientation="row" variant="pill" />
      <MetaBadges path={path} meta={value.meta} />
    </NodeBox>
  )
}
