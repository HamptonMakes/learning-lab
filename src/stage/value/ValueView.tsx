/**
 * ValueView — renders one Value node (and its children) for a given path.
 * CONTRACT (owned by the value-views task): every node renders data-path / data-kind / data-value,
 * plus data-tombstone / data-highlight when applicable, and registers its element with useAnchor(path).
 * This file is a placeholder until the value views land.
 */
import type { Path, Value } from '@/lesson/types'

export interface ValueViewProps {
  path: Path
  value: Value
  /** Nesting depth (0 = a slot on a card). */
  depth?: number
}

export function ValueView({ path, value }: ValueViewProps) {
  return (
    <div
      data-path={path}
      data-kind={value.kind}
      data-value={JSON.stringify(value)}
      className="font-mono text-xs"
    >
      {JSON.stringify(value)}
    </div>
  )
}
