/**
 * `diffWorld(prev, next): Change[]` (DSL §14, stage-architecture §7.3). Value changes are emitted
 * at the deepest changed path: holds per actor, then record fields by key, list/set items by id,
 * counter rows by node, clock entries by node, table rows by id and cells by column; bytes, text,
 * pattern and meter compare as a whole; a node whose only difference is its `meta` yields
 * `op: 'meta'`. A reorder of surviving items yields `changed` on the container. `<actor>@outbox`
 * and `<actor>@inbox` are value changes when the chips / parked set changed. Then actors
 * (spawned / removed / online / offline / status / skew), boards (added / changed / removed),
 * layout, clock and marks (added / removed). Order is deterministic: actors in `next` insertion
 * order (removed ones after, in `prev` order), then boards, layout, clock, marks.
 */
import {
  type Actor,
  type ActorId,
  type Change,
  type Item,
  type Mark,
  type Message,
  type Path,
  type TableRow,
  type Value,
  type World,
} from '../types'
import { deepEqual } from './equal'

type ValueOp = Extract<Change, { kind: 'value' }>['op']

function change(path: Path, op: ValueOp): Change {
  return { kind: 'value', path, op }
}

function sameOrder(a: readonly string[], b: readonly string[]): boolean {
  const inB = new Set(b)
  const inA = new Set(a)
  const fa = a.filter((x) => inB.has(x))
  const fb = b.filter((x) => inA.has(x))
  if (fa.length !== fb.length) return false
  for (let i = 0; i < fa.length; i += 1) if (fa[i] !== fb[i]) return false
  return true
}

function diffItems(
  prev: readonly Item[],
  next: readonly Item[],
  path: Path,
  out: Change[],
): boolean {
  const prevById = new Map(prev.map((it) => [it.id, it]))
  const nextIds = new Set(next.map((it) => it.id))
  for (const it of next) {
    const before = prevById.get(it.id)
    const itemPath = `${path}[${it.id}]`
    if (!before) out.push(change(itemPath, 'added'))
    else diffValue(before.value, it.value, itemPath, out)
  }
  for (const it of prev) if (!nextIds.has(it.id)) out.push(change(`${path}[${it.id}]`, 'removed'))
  return sameOrder(
    prev.map((it) => it.id),
    next.map((it) => it.id),
  )
}

function diffRows(
  prev: readonly TableRow[],
  next: readonly TableRow[],
  path: Path,
  out: Change[],
): boolean {
  const prevById = new Map(prev.map((r) => [r.id, r]))
  const nextIds = new Set(next.map((r) => r.id))
  for (const row of next) {
    const before = prevById.get(row.id)
    const rowPath = `${path}[${row.id}]`
    if (!before) {
      out.push(change(rowPath, 'added'))
      continue
    }
    for (const [key, cell] of Object.entries(row.cells)) {
      const cellBefore = before.cells[key]
      const cellPath = `${rowPath}.${key}`
      if (!cellBefore) out.push(change(cellPath, 'added'))
      else diffValue(cellBefore, cell, cellPath, out)
    }
    for (const key of Object.keys(before.cells)) {
      if (!(key in row.cells)) out.push(change(`${rowPath}.${key}`, 'removed'))
    }
  }
  for (const row of prev)
    if (!nextIds.has(row.id)) out.push(change(`${path}[${row.id}]`, 'removed'))
  return sameOrder(
    prev.map((r) => r.id),
    next.map((r) => r.id),
  )
}

/** Append the value changes between `prev` and `next` at `path` to `out` (exported for tests). */
export function diffValue(prev: Value, next: Value, path: Path, out: Change[]): void {
  if (prev === next) return
  if (prev.kind !== next.kind) {
    out.push(change(path, 'changed'))
    return
  }
  let changed = false
  switch (next.kind) {
    case 'scalar':
      changed = prev.kind === 'scalar' && prev.value !== next.value
      break
    case 'record': {
      if (prev.kind !== 'record') break
      const prevByKey = new Map(prev.fields.map((f) => [f.key, f.value]))
      const nextKeys = new Set(next.fields.map((f) => f.key))
      for (const f of next.fields) {
        const before = prevByKey.get(f.key)
        const fieldPath = `${path}.${f.key}`
        if (before === undefined) out.push(change(fieldPath, 'added'))
        else diffValue(before, f.value, fieldPath, out)
      }
      for (const f of prev.fields)
        if (!nextKeys.has(f.key)) out.push(change(`${path}.${f.key}`, 'removed'))
      changed =
        prev.display !== next.display ||
        !sameOrder(
          prev.fields.map((f) => f.key),
          next.fields.map((f) => f.key),
        )
      break
    }
    case 'list':
    case 'set': {
      if (prev.kind !== next.kind) break
      const ordered = diffItems(prev.items, next.items, path, out)
      const prevDisplay = prev.kind === 'list' ? prev.display : undefined
      const nextDisplay = next.kind === 'list' ? next.display : undefined
      changed = !ordered || prevDisplay !== nextDisplay
      break
    }
    case 'counter': {
      if (prev.kind !== 'counter') break
      const prevByNode = new Map(prev.rows.map((r) => [r.node, r]))
      const nextNodes = new Set(next.rows.map((r) => r.node))
      for (const row of next.rows) {
        const before = prevByNode.get(row.node)
        const rowPath = `${path}[${row.node}]`
        if (!before) out.push(change(rowPath, 'added'))
        else if (before.inc !== row.inc || before.dec !== row.dec)
          out.push(change(rowPath, 'changed'))
      }
      for (const row of prev.rows)
        if (!nextNodes.has(row.node)) out.push(change(`${path}[${row.node}]`, 'removed'))
      break
    }
    case 'clock': {
      if (prev.kind !== 'clock') break
      for (const [node, n] of Object.entries(next.entries)) {
        const before = prev.entries[node]
        const entryPath = `${path}.${node}`
        if (before === undefined) out.push(change(entryPath, 'added'))
        else if (before !== n) out.push(change(entryPath, 'changed'))
      }
      for (const node of Object.keys(prev.entries)) {
        if (!(node in next.entries)) out.push(change(`${path}.${node}`, 'removed'))
      }
      break
    }
    case 'table': {
      if (prev.kind !== 'table') break
      const ordered = diffRows(prev.rows, next.rows, path, out)
      changed = !ordered || !deepEqual(prev.columns, next.columns)
      break
    }
    case 'bytes':
      changed =
        prev.kind === 'bytes' &&
        (!deepEqual(prev.bytes, next.bytes) ||
          prev.display !== next.display ||
          !deepEqual(prev.range, next.range) ||
          !deepEqual(prev.annotations, next.annotations))
      break
    case 'text':
      changed =
        prev.kind === 'text' &&
        (prev.text !== next.text ||
          prev.cursor !== next.cursor ||
          !deepEqual(prev.annotations, next.annotations))
      break
    case 'pattern':
      changed =
        prev.kind === 'pattern' &&
        (prev.cursor !== next.cursor || !deepEqual(prev.tokens, next.tokens))
      break
    case 'meter':
      changed =
        prev.kind === 'meter' &&
        (prev.value !== next.value ||
          prev.max !== next.max ||
          prev.label !== next.label ||
          prev.tone !== next.tone)
      break
  }
  if (changed) out.push(change(path, 'changed'))
  else if (!deepEqual(prev.meta, next.meta)) out.push(change(path, 'meta'))
}

function parkedIds(messages: readonly Message[], actor: ActorId): string[] {
  return messages.filter((m) => m.state === 'parked' && m.to === actor).map((m) => m.id)
}

function diffActor(
  prev: Actor,
  next: Actor,
  prevWorld: World,
  nextWorld: World,
  out: Change[],
): void {
  if (prev.online !== next.online) {
    out.push({ kind: 'actor', id: next.id, op: next.online ? 'online' : 'offline' })
  }
  if (prev.status !== next.status) out.push({ kind: 'actor', id: next.id, op: 'status' })
  if (prev.skew !== next.skew) out.push({ kind: 'actor', id: next.id, op: 'skew' })
  for (const [slot, value] of Object.entries(next.holds)) {
    const before = prev.holds[slot]
    const slotPath = `${next.id}.${slot}`
    if (before === undefined) out.push(change(slotPath, 'added'))
    else diffValue(before, value, slotPath, out)
  }
  for (const slot of Object.keys(prev.holds)) {
    if (!(slot in next.holds)) out.push(change(`${next.id}.${slot}`, 'removed'))
  }
  if (!deepEqual(prev.outbox, next.outbox)) out.push(change(`${next.id}@outbox`, 'changed'))
  if (!deepEqual(parkedIds(prevWorld.messages, next.id), parkedIds(nextWorld.messages, next.id))) {
    out.push(change(`${next.id}@inbox`, 'changed'))
  }
}

/** The typed change list between two worlds (§14). Marks are diffed by id; see the module doc. */
export function diffWorld(prev: World, next: World): Change[] {
  const out: Change[] = []
  for (const actor of Object.values(next.actors)) {
    const before = prev.actors[actor.id]
    if (!before) out.push({ kind: 'actor', id: actor.id, op: 'spawned' })
    else diffActor(before, actor, prev, next, out)
  }
  for (const id of Object.keys(prev.actors)) {
    if (!(id in next.actors)) out.push({ kind: 'actor', id, op: 'removed' })
  }
  for (const board of Object.values(next.boards)) {
    const before = prev.boards[board.id]
    if (!before) {
      out.push({ kind: 'board', id: board.id, op: 'added' })
      continue
    }
    if (before.label !== board.label || before.tone !== board.tone) {
      out.push({ kind: 'board', id: board.id, op: 'changed' })
    }
    diffValue(before.value, board.value, `board.${board.id}`, out)
  }
  for (const id of Object.keys(prev.boards)) {
    if (!(id in next.boards)) out.push({ kind: 'board', id, op: 'removed' })
  }
  if (prev.layout.preset !== next.layout.preset || prev.layout.hub !== next.layout.hub) {
    out.push({ kind: 'layout', from: prev.layout, to: next.layout })
  }
  if (prev.clock.now !== next.clock.now) {
    out.push({ kind: 'clock', from: prev.clock.now, to: next.clock.now })
  }
  const prevMarks = new Map<string, Mark>(prev.marks.map((m) => [m.id, m]))
  const nextMarks = new Map<string, Mark>(next.marks.map((m) => [m.id, m]))
  const removed: Change[] = []
  for (const m of prev.marks) {
    const after = nextMarks.get(m.id)
    if (!after || !deepEqual(after, m)) removed.push({ kind: 'mark', id: m.id, op: 'removed' })
  }
  out.push(...removed)
  for (const m of next.marks) {
    const before = prevMarks.get(m.id)
    if (!before || !deepEqual(before, m)) out.push({ kind: 'mark', id: m.id, op: 'added' })
  }
  return out
}
