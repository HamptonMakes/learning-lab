/**
 * ValueView — renders one Value node (and its children) for a given path. Dispatches on
 * `value.kind`; every node (and every addressable sub-node) is wrapped by NodeBox, which renders
 * the DOM contract (`data-path` / `data-kind` / `data-value` / `data-tombstone` / `data-highlight`),
 * registers the anchor, and draws highlight rings, via chips and check / cross glyphs on the node.
 * Forward steps animate the diff (enter / exit / layout / flash via `tr()`); under reduced motion or
 * an instant commit everything renders at rest. A slot root that is a composed document opens a
 * DocContext, so the sidecar below it is gated (see MetaBadges).
 */
import type { Path, Value } from '@/lesson/types'
import { Bytes } from './Bytes'
import { Clock } from './Clock'
import { Counter } from './Counter'
import { DocContext, isDocValue } from './doc'
import { List } from './List'
import { Meter } from './Meter'
import { Pattern } from './Pattern'
import { Record } from './Record'
import { Scalar } from './Scalar'
import { SetView } from './SetView'
import { Table } from './Table'
import { Text } from './Text'

export interface ValueViewProps {
  path: Path
  value: Value
  /** Nesting depth (0 = a slot on a card / a board's value). */
  depth?: number
}

export function ValueView({ path, value, depth = 0 }: ValueViewProps) {
  if (depth === 0 && isDocValue(value)) {
    return (
      <DocContext.Provider value={path}>
        <ValueNode path={path} value={value} depth={0} />
      </DocContext.Provider>
    )
  }
  return <ValueNode path={path} value={value} depth={depth} />
}

function ValueNode({ path, value, depth }: { path: Path; value: Value; depth: number }) {
  switch (value.kind) {
    case 'scalar':
      return <Scalar path={path} value={value} depth={depth} />
    case 'record':
      return <Record path={path} value={value} depth={depth} />
    case 'list':
      return <List path={path} value={value} depth={depth} />
    case 'set':
      return <SetView path={path} value={value} depth={depth} />
    case 'counter':
      return <Counter path={path} value={value} depth={depth} />
    case 'clock':
      return <Clock path={path} value={value} depth={depth} />
    case 'table':
      return <Table path={path} value={value} depth={depth} />
    case 'bytes':
      return <Bytes path={path} value={value} depth={depth} />
    case 'text':
      return <Text path={path} value={value} depth={depth} />
    case 'pattern':
      return <Pattern path={path} value={value} depth={depth} />
    case 'meter':
      return <Meter path={path} value={value} depth={depth} />
  }
}
