/**
 * Primitive command builders (docs/animation-dsl.md §8.3): one helper per command, named like its
 * `t` (`del` for `delete`), plus the readable aliases `bad`, `good`, `tomb`, `apply`, `merge`,
 * `ref` and the identity path helper `p`. Every helper returns the plain command literal.
 */
import type {
  ActorId,
  ActorSpec,
  ActorStatus,
  BoardId,
  Item,
  LayoutPreset,
  MarkId,
  MessageId,
  Meta,
  Path,
  Payload,
  Scalar,
  SortKey,
  TableRow,
  Tone,
  Value,
  Verdict,
} from '../types'
import { compact, type Cmd } from './internal'
import { bytes } from './values'

// ─── 4.1 Stage, actors, time ──────────────────────────────────────────────────────────────────

/** `spawn(carol())` — add an actor mid-scene. */
export const spawn = (actor: ActorSpec): Cmd<'spawn'> => ({ t: 'spawn', actor })
/** `remove('carol')` — the actor animates out; its in-flight messages are dropped. */
export const remove = (actor: ActorId): Cmd<'remove'> => ({ t: 'remove', actor })
/** `removeBoard('rule')`. */
export const removeBoard = (board: BoardId): Cmd<'removeBoard'> => ({ t: 'removeBoard', board })
/** `layout('ring', { hub: 'client' })`. */
export const layout = (preset: LayoutPreset, opts?: { hub?: ActorId }): Cmd<'layout'> =>
  compact({ t: 'layout', preset, hub: opts?.hub })
/** `tick()` / `tick(150)` — the only way time moves. */
export const tick = (by?: number): Cmd<'tick'> => compact({ t: 'tick', by })
/** `skew('alice', 5)` — Alice's wall clock reads `now + 5`. */
export const skew = (actor: ActorId, by: number): Cmd<'skew'> => ({ t: 'skew', actor, by })
export const offline = (actor: ActorId): Cmd<'offline'> => ({ t: 'offline', actor })
export const online = (actor: ActorId): Cmd<'online'> => ({ t: 'online', actor })
/** `status('alice', 'lock')` / `status('alice', null)`. */
export const status = (actor: ActorId, value: ActorStatus | null): Cmd<'status'> => ({
  t: 'status',
  actor,
  status: value,
})
export type NoteOpts = { tone?: Tone; label?: string; textId?: string }
/** `note('rule', 'merge(a, b) = max(a, b)')` — upsert a free-standing text card. */
export const note = (id: BoardId, text: string, opts?: NoteOpts): Cmd<'note'> =>
  compact({ t: 'note', id, text, tone: opts?.tone, label: opts?.label, textId: opts?.textId })

// ─── 4.2 Values ───────────────────────────────────────────────────────────────────────────────

export type QuietOpts = { quiet?: boolean }

/**
 * `set('alice.doc.title', 'Q3 plan v2')`. A `number[]` value is a byte range write
 * (`set('laptop.id[0..6]', [0x01, …])`): the schema only admits `Value | Scalar`, so the array is
 * wrapped into a `bytes` Value and the reducer reads its `bytes`. Use `list()` for list values.
 */
export const set = (
  path: Path,
  value: Value | Scalar | ReadonlyArray<number>,
  opts?: QuietOpts,
): Cmd<'set'> =>
  compact({ t: 'set', path, value: isByteArray(value) ? bytes(value) : value, quiet: opts?.quiet })

const isByteArray = (v: unknown): v is ReadonlyArray<number> => Array.isArray(v)
/** `patch('bob.likes', { tag: 'alice:1' })` — sidecar only. */
export const patch = (path: Path, meta: Partial<Meta>, opts?: QuietOpts): Cmd<'patch'> =>
  compact({ t: 'patch', path, meta, quiet: opts?.quiet })
/** `insert('alice.list', 'milk', { index: 1 })` — list/set items and table rows; default append. */
export const insert = (
  path: Path,
  item: Item | TableRow | Scalar,
  opts?: QuietOpts & { index?: number },
): Cmd<'insert'> => compact({ t: 'insert', path, item, index: opts?.index, quiet: opts?.quiet })
/** `del('alice.list[milk]')` — `t: 'delete'`; `{ tombstone: true }` keeps it struck-through. */
export const del = (path: Path, opts?: QuietOpts & { tombstone?: boolean }): Cmd<'delete'> =>
  compact({ t: 'delete', path, tombstone: opts?.tombstone, quiet: opts?.quiet })
/** `move('bob.inbox[alice:2]', 1)` — reorder one item. */
export const move = (path: Path, to: number, opts?: QuietOpts): Cmd<'move'> =>
  compact({ t: 'move', path, to, quiet: opts?.quiet })
/** `sort('server.chat', ['@ts', '@node'])` — lists and tables. */
export const sort = (path: Path, by: ReadonlyArray<SortKey>): Cmd<'sort'> => ({
  t: 'sort',
  path,
  by: [...by],
})
export type AnnotateOpts = { unit?: 'byte' | 'bit'; tone?: Tone; id?: string }
/** `annotate('laptop.id', 48, 52, 'version = 4', { unit: 'bit', tone: 'change' })`. */
export const annotate = (
  path: Path,
  from: number,
  to: number,
  label?: string,
  opts?: AnnotateOpts,
): Cmd<'annotate'> =>
  compact({
    t: 'annotate',
    path,
    from,
    to,
    unit: opts?.unit,
    label,
    tone: opts?.tone,
    id: opts?.id,
  })
/** `unannotate('laptop.id')` (all) / `unannotate('laptop.id', 'rand')` (every annotation with that id). */
export const unannotate = (path: Path, id?: string): Cmd<'unannotate'> =>
  compact({ t: 'unannotate', path, id })
/** `view('laptop.id', 'bits', [6, 9])` — bytes display mode; no range clears it. */
export const view = (
  path: Path,
  display: 'hex' | 'bits' | 'canonical' | 'dec',
  range?: [number, number],
): Cmd<'view'> => compact({ t: 'view', path, display, range })

// ─── 4.3 Messages ─────────────────────────────────────────────────────────────────────────────

export type SendOpts = {
  id?: MessageId
  label?: string
  into?: Path
  stamp?: string
  textId?: string
}
/** `send('alice', 'server', ref('alice.doc'), { id: 'm3', label: 'save', into: 'server.doc' })`. */
export const send = (
  from: ActorId,
  to: ActorId | ReadonlyArray<ActorId>,
  payload: Payload,
  opts?: SendOpts,
): Cmd<'send'> =>
  compact({
    t: 'send',
    from,
    to: typeof to === 'string' ? to : [...to],
    payload,
    id: opts?.id,
    label: opts?.label,
    into: opts?.into,
    stamp: opts?.stamp,
    textId: opts?.textId,
  })
export type DeliverOpts = { into?: Path; park?: boolean; recv?: string }
/** `deliver('m3')` / `deliver('op4', { park: true })` — the one receiver. */
export const deliver = (message: MessageId, opts?: DeliverOpts): Cmd<'deliver'> =>
  compact({ t: 'deliver', message, into: opts?.into, park: opts?.park, recv: opts?.recv })
/** `drop('m1')` — lost (poof). */
export const drop = (message: MessageId): Cmd<'drop'> => ({ t: 'drop', message })
/** `duplicate('op1', 'op1-retry')` — a retry splits off an in-flight message. */
export const duplicate = (message: MessageId, id: MessageId): Cmd<'duplicate'> => ({
  t: 'duplicate',
  message,
  id,
})
/** `relay('m-l@icloud', ['phone'])` — deliver at the hub, then forward copies `${base}@${to}`. */
export const relay = (
  message: MessageId,
  to: ActorId | ReadonlyArray<ActorId>,
  opts?: { into?: Path },
): Cmd<'relay'> =>
  compact({ t: 'relay', message, to: typeof to === 'string' ? to : [...to], into: opts?.into })

// ─── 4.4 Marks ────────────────────────────────────────────────────────────────────────────────

export type MarkOpts = { sticky?: boolean; id?: MarkId }
/** `highlight('bob.status@ts')` / `highlight(['a', 'b'], { tone: 'warn', sticky: true })`. */
export const highlight = (
  path: Path | ReadonlyArray<Path>,
  opts?: MarkOpts & { tone?: Tone },
): Cmd<'highlight'> =>
  compact({
    t: 'highlight',
    path: typeof path === 'string' ? path : [...path],
    tone: opts?.tone,
    sticky: opts?.sticky,
    id: opts?.id,
  })
/** `callout('server.doc.title', 'last write silently won', { tone: 'warn', sticky: true, id: 'c1' })`. */
export const callout = (
  at: Path,
  text: string,
  opts?: MarkOpts & { tone?: Tone; textId?: string },
): Cmd<'callout'> =>
  compact({
    t: 'callout',
    at,
    text,
    tone: opts?.tone,
    sticky: opts?.sticky,
    id: opts?.id,
    textId: opts?.textId,
  })
/** `conflict('alice.doc.title', 'bob.doc.title')` — a ⚡ bolt between two values. */
export const conflict = (a: Path, b: Path, opts?: MarkOpts): Cmd<'conflict'> =>
  compact({ t: 'conflict', a, b, sticky: opts?.sticky, id: opts?.id })
/** `compare(['alice.A', 'bob.B'], { expect: 'concurrent' })` — verdict computed by the reducer. */
export const compare = (
  paths: ReadonlyArray<Path>,
  opts?: MarkOpts & { expect?: Verdict },
): Cmd<'compare'> =>
  compact({
    t: 'compare',
    paths: [...paths],
    expect: opts?.expect,
    sticky: opts?.sticky,
    id: opts?.id,
  })
/** `same('alice.tags', 'bob.tags', 'carol.tags')` = `compare(paths, { expect: 'equal' })`. */
export const same = (...paths: Path[]): Cmd<'compare'> => ({
  t: 'compare',
  paths,
  expect: 'equal',
})
export const check = (path: Path, opts?: MarkOpts): Cmd<'check'> =>
  compact({ t: 'check', path, sticky: opts?.sticky, id: opts?.id })
export const cross = (path: Path, opts?: MarkOpts): Cmd<'cross'> =>
  compact({ t: 'cross', path, sticky: opts?.sticky, id: opts?.id })
/** `clearMarks()` — every mark, transient and sticky; boards stay. */
export const clearMarks = (): Cmd<'clearMarks'> => ({ t: 'clearMarks' })
export const unmark = (id: MarkId): Cmd<'unmark'> => ({ t: 'unmark', id })

// ─── 4.5 Assertions ───────────────────────────────────────────────────────────────────────────

/**
 * `expect('alice.likes', 2)` — a DSL assertion (never drawn). Test files that also use Vitest
 * import it as `import { expect as expectEq } from '@/lesson/builders'`.
 */
export const expect = (path: Path, equals: unknown): Cmd<'expect'> => ({
  t: 'expect',
  path,
  equals,
})

// ─── Aliases ──────────────────────────────────────────────────────────────────────────────────

/** `bad(path, text?)` = highlight `danger` (+ a `danger` callout when `text` is given). */
export const bad = (path: Path, text?: string): Array<Cmd<'highlight'> | Cmd<'callout'>> =>
  text === undefined
    ? [highlight(path, { tone: 'danger' })]
    : [highlight(path, { tone: 'danger' }), callout(path, text, { tone: 'danger' })]
/** `good(path)` = highlight `ok`. */
export const good = (path: Path): Cmd<'highlight'> => highlight(path, { tone: 'ok' })
/** `tomb(path)` = highlight `path@tomb` with tone `warn`. */
export const tomb = (path: Path): Cmd<'highlight'> => highlight(`${path}@tomb`, { tone: 'warn' })
/** `apply('alice:1@bob')` = `deliver(message)` — readable for op messages. */
export const apply = (message: MessageId, opts?: DeliverOpts): Cmd<'deliver'> =>
  deliver(message, opts)
/** `merge('m1')` = `deliver(message)` — readable for state messages. */
export const merge = (message: MessageId, opts?: DeliverOpts): Cmd<'deliver'> =>
  deliver(message, opts)
/** `ref('alice.doc')` — a payload that snapshots the value at send time. */
export const ref = (path: Path): { ref: Path } => ({ ref: path })
/** `p('alice.list.items[alice:1].qty')` — identity; the test suite resolves it against the dry-run world. */
export const p = (path: Path): Path => path
