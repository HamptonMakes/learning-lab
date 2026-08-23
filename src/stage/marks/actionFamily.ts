/**
 * The icon family of an action label (`Change.action`, `stage.op.*` keys): which tiny lucide icon the
 * action chip draws so colour is never the only signal (CLAUDE.md §6). Pure data.
 */
import {
  ArrowDownToLine,
  ArrowUpDown,
  Ban,
  Clock3,
  Merge,
  Minus,
  Pencil,
  Plus,
  Trash2,
  type LucideIcon,
} from 'lucide-react'

export type ActionFamily =
  | 'inc'
  | 'dec'
  | 'set'
  | 'add'
  | 'remove'
  | 'insert'
  | 'delete'
  | 'move'
  | 'merge'
  | 'receive'
  | 'tick'
  | 'noop'

const FAMILIES: Record<string, ActionFamily> = {
  'stage.op.inc': 'inc',
  'stage.op.dec': 'dec',
  'stage.op.set': 'set',
  'stage.op.setField': 'set',
  'stage.op.setPlain': 'set',
  'stage.op.add': 'add',
  'stage.op.addTag': 'add',
  'stage.op.docAdd': 'add',
  'stage.op.docAddEmpty': 'add',
  'stage.op.remove': 'remove',
  'stage.op.removeTags': 'remove',
  'stage.op.removeField': 'remove',
  'stage.op.docRemove': 'remove',
  'stage.op.insert': 'insert',
  'stage.op.insertPlain': 'insert',
  'stage.op.append': 'insert',
  'stage.op.docInsert': 'insert',
  'stage.op.docInsertEmpty': 'insert',
  'stage.op.delete': 'delete',
  'stage.op.deletePlain': 'delete',
  'stage.op.deleteRange': 'delete',
  'stage.op.move': 'move',
  'stage.op.sort': 'move',
  'stage.op.merge': 'merge',
  'stage.op.receive': 'receive',
  'stage.op.tick': 'tick',
  'stage.op.noop': 'noop',
}

export const ACTION_ICONS: Record<ActionFamily, LucideIcon> = {
  inc: Plus,
  dec: Minus,
  set: Pencil,
  add: Plus,
  remove: Minus,
  insert: Plus,
  delete: Trash2,
  move: ArrowUpDown,
  merge: Merge,
  receive: ArrowDownToLine,
  tick: Clock3,
  noop: Ban,
}

/** The icon family of a `stage.op.*` key (unknown keys read as a plain write). */
export function actionFamily(key: string): ActionFamily {
  return FAMILIES[key] ?? 'set'
}
