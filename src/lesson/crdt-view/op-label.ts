/**
 * Op labels (DSL §5.2): the caption of an outbox chip and of an op token, in fixed formats —
 * `inc 1` · `dec 2` · `set Lunch` · `set title = Q3` · `remove title` · `add milk #alice:1` ·
 * `remove milk {alice:1}` · `insert "h" after alice:1` · `delete alice:1` · `tick` · doc parts
 * `add {name: milk} #alice:1` · `remove alice:1` · `items[alice:1].qty: inc 1`.
 *
 * Every format is a `t()` key (`stage.op.*`) with `{name}` placeholders, so the renderer can ask
 * for the localized caption: `opLabelParts(type, op, before)` returns `{ key, vars }` (nested for
 * doc parts: `stage.op.at` wraps an `inner`), `opLabel(...)` renders the English string from the
 * same templates. The reducer stores the English label in `OpRecord.label` / `OutboxChip.label`.
 *
 * `before` is the state the op was prepared against. G-/PN-Counter ops carry the node's NEW total,
 * so the delta (`inc 1`) needs it; a composed document needs it for the leaf type at `op.path`.
 * Without `before` the label falls back to what the op alone says (the total as delta; a leaf op
 * labelled by its shape).
 */
import type { DocOp, DocState } from '../../crdt/doc'
import { docSchemaAt } from '../../crdt/doc'
import type { GCounterState } from '../../crdt/g-counter'
import type { PNCounterState } from '../../crdt/pn-counter'
import { fmtQuoted, fmtValue } from './format'
import type { CrdtName, CrdtSchema } from '../types'

export type OpLabelVars = Readonly<Record<string, string | number>>
export type OpLabelKey = keyof typeof OP_LABEL_TEMPLATES
export type OpLabelParts = { key: OpLabelKey; vars: OpLabelVars; inner?: OpLabelParts }

/** English templates, keyed like `src/locales/en/ui.json` (`{name}` placeholders). */
export const OP_LABEL_TEMPLATES = {
  'stage.op.inc': 'inc {n}',
  'stage.op.dec': 'dec {n}',
  'stage.op.set': 'set {value}',
  'stage.op.setField': 'set {key} = {value}',
  'stage.op.removeField': 'remove {key}',
  'stage.op.add': 'add {value}',
  'stage.op.addTag': 'add {value} #{tag}',
  'stage.op.remove': 'remove {value}',
  'stage.op.removeTags': 'remove {value} {{tags}}',
  'stage.op.insert': 'insert {value} after {anchor}',
  'stage.op.delete': 'delete {id}',
  'stage.op.tick': 'tick',
  'stage.op.noop': 'no-op',
  'stage.op.docAdd': 'add {init} #{tag}',
  'stage.op.docAddEmpty': 'add #{tag}',
  'stage.op.docRemove': 'remove {id}',
  'stage.op.docInsert': 'insert {init} after {anchor}',
  'stage.op.docInsertEmpty': 'insert after {anchor}',
  'stage.op.at': '{path}: {label}',
} as const

const PLACEHOLDER = /\{(\w+)\}/g

/** Same contract as `interpolate` in src/i18n/t.ts (kept local so the view layer has no UI dependency). */
function interpolate(template: string, vars: OpLabelVars): string {
  return template.replace(PLACEHOLDER, (match: string, name: string) => {
    const v = vars[name]
    return v === undefined ? match : String(v)
  })
}

/** The English string for `parts` (nested `stage.op.at` renders its `inner` first). */
export function renderOpLabel(parts: OpLabelParts): string {
  const vars =
    parts.inner === undefined ? parts.vars : { ...parts.vars, label: renderOpLabel(parts.inner) }
  return interpolate(OP_LABEL_TEMPLATES[parts.key], vars)
}

type Rec = Record<string, unknown>
const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v)
const parts = (key: OpLabelKey, vars: OpLabelVars = {}): OpLabelParts => ({ key, vars })

function counterDelta(op: Rec, before: number | undefined): number {
  const count = typeof op.count === 'number' ? op.count : 0
  return count - (before ?? 0)
}

function rgaParts(op: Rec): OpLabelParts {
  if ('noop' in op) return parts('stage.op.noop')
  if (isRec(op.insert)) {
    return parts('stage.op.insert', {
      value: fmtQuoted(op.insert.value),
      anchor: String(op.insert.after),
    })
  }
  return parts('stage.op.delete', { id: String(op.delete) })
}

function orSetParts(op: Rec): OpLabelParts {
  if ('tag' in op) return parts('stage.op.addTag', { value: fmtValue(op.add), tag: String(op.tag) })
  const tags = Array.isArray(op.tags) ? op.tags.map(String) : []
  return parts('stage.op.removeTags', { value: fmtValue(op.remove), tags: tags.join(', ') })
}

function setParts(op: Rec): OpLabelParts {
  if ('add' in op) return parts('stage.op.add', { value: fmtValue(op.add) })
  return parts('stage.op.remove', { value: fmtValue(op.remove) })
}

/** A leaf op labelled by its shape alone (used for doc leaves when no schema is at hand). */
function sniffParts(op: unknown): OpLabelParts {
  if (typeof op === 'number') return parts('stage.op.tick')
  if (!isRec(op)) return parts('stage.op.set', { value: fmtValue(op) })
  if ('noop' in op || 'insert' in op) return rgaParts(op)
  if ('tag' in op || 'tags' in op) return orSetParts(op)
  if ('key' in op) return lwwMapParts(op)
  if (isRec(op.version)) return parts('stage.op.set', { value: fmtValue(op.version.value) })
  if ('stamp' in op || 'clock' in op) return parts('stage.op.tick')
  if ('id' in op && typeof op.add === 'number') return opCounterParts(op)
  if ('side' in op) return pnParts(op, undefined)
  if ('count' in op) return parts('stage.op.inc', { n: counterDelta(op, undefined) })
  if ('delete' in op && typeof op.delete === 'string') return rgaParts(op)
  if ('add' in op || 'remove' in op) return setParts(op)
  if ('set' in op) return parts('stage.op.set', { value: fmtValue(op.set) })
  return parts('stage.op.set', { value: fmtValue(op) })
}

function lwwMapParts(op: Rec): OpLabelParts {
  if ('remove' in op) return parts('stage.op.removeField', { key: String(op.key) })
  return parts('stage.op.setField', { key: String(op.key), value: fmtValue(op.set) })
}

function opCounterParts(op: Rec): OpLabelParts {
  const add = typeof op.add === 'number' ? op.add : 0
  return add < 0 ? parts('stage.op.dec', { n: -add }) : parts('stage.op.inc', { n: add })
}

function pnParts(op: Rec, before: PNCounterState | undefined): OpLabelParts {
  const node = String(op.node)
  const side = op.side === 'n' ? 'n' : 'p'
  const n = counterDelta(op, before?.[side].counts[node])
  return side === 'n' ? parts('stage.op.dec', { n }) : parts('stage.op.inc', { n })
}

function docParts(op: DocOp, before: DocState | undefined): OpLabelParts {
  let inner: OpLabelParts
  switch (op.kind) {
    case 'leaf': {
      const leafType = before === undefined ? undefined : leafTypeAt(before.schema, op.path)
      inner = leafType === undefined ? sniffParts(op.op) : opLabelParts(leafType, op.op)
      break
    }
    case 'set': {
      const o = op.op
      if ('add' in o) {
        const init = op.sub?.init ?? {}
        inner =
          Object.keys(init).length === 0
            ? parts('stage.op.docAddEmpty', { tag: o.tag })
            : parts('stage.op.docAdd', { init: fmtValue(init), tag: o.tag })
      } else {
        inner = parts('stage.op.docRemove', { id: o.remove })
      }
      break
    }
    case 'list': {
      const o = op.op
      if ('insert' in o) {
        const init = op.sub?.init ?? {}
        inner =
          Object.keys(init).length === 0
            ? parts('stage.op.docInsertEmpty', { anchor: o.insert.after })
            : parts('stage.op.docInsert', { init: fmtValue(init), anchor: o.insert.after })
      } else if ('delete' in o) {
        inner = parts('stage.op.delete', { id: o.delete })
      } else {
        inner = parts('stage.op.noop')
      }
      break
    }
  }
  return op.path === '' ? inner : { key: 'stage.op.at', vars: { path: op.path }, inner }
}

/** The leaf type name at `path` of a doc schema, or undefined for const/map/set/list or a bad path. */
export function leafTypeAt(schema: unknown, path: string): CrdtName | undefined {
  try {
    const s = docSchemaAt(schema as CrdtSchema, path)
    if (typeof s === 'string') return s
    return 'type' in s ? s.type : undefined
  } catch {
    return undefined
  }
}

/**
 * `{ key, vars }` for the op of a `type` (a `CrdtName` or `'doc'`); `before` is the state it was
 * prepared against (needed by counters for the delta and by docs for the leaf type at `op.path`).
 */
export function opLabelParts(type: CrdtName | 'doc', op: unknown, before?: unknown): OpLabelParts {
  switch (type) {
    case 'doc':
      return docParts(op as DocOp, before as DocState | undefined)
    case 'max-register':
    case 'lww-register':
      return parts('stage.op.set', { value: fmtValue(isRec(op) ? op.set : op) })
    case 'mv-register':
      return parts('stage.op.set', {
        value: fmtValue(isRec(op) && isRec(op.version) ? op.version.value : op),
      })
    case 'lww-map':
      return lwwMapParts(isRec(op) ? op : {})
    case 'g-counter': {
      const o = isRec(op) ? op : {}
      const b = before as GCounterState | undefined
      return parts('stage.op.inc', { n: counterDelta(o, b?.counts[String(o.node)]) })
    }
    case 'pn-counter':
      return pnParts(isRec(op) ? op : {}, before as PNCounterState | undefined)
    case 'op-counter':
      return opCounterParts(isRec(op) ? op : {})
    case 'g-set':
    case 'two-phase-set':
    case 'lww-element-set':
      return setParts(isRec(op) ? op : {})
    case 'or-set':
      return orSetParts(isRec(op) ? op : {})
    case 'rga':
      return rgaParts(isRec(op) ? op : {})
    case 'lamport-clock':
    case 'vector-clock':
    case 'hlc':
      return parts('stage.op.tick')
  }
}

/** The English label (DSL §5.2 formats) of an op. */
export function opLabel(type: CrdtName | 'doc', op: unknown, before?: unknown): string {
  return renderOpLabel(opLabelParts(type, op, before))
}
