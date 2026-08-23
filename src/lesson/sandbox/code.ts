/**
 * "Show the code" support for the sandbox (docs/animation-dsl.md §11). Two pure pieces:
 *
 *  - `whatRan(frame)`: which real `src/crdt/` functions a sandbox step called, derived from the
 *    step's commands and the frame's change log (`crdt.update` → `prepare` + `effect`, `crdt.sync` /
 *    `crdt.merge` / a delivered state message → `merge`, a delivered op → `effect`). Delivery-layer
 *    commands (`broadcast`, `send`, `offline`, `tick`, `drop`) call nothing in the CRDT;
 *    `whyNothingRan(frame)` names the reason.
 *  - `extractFunction(source, name)`: pull one function's text out of a CRDT source file. It is a
 *    tolerant line scanner, not a parser: it finds the declaration (`function name(`, a `name(...) {`
 *    method, a `name: (...) =>` arrow, or a `name: otherFn,` reference that it follows once), keeps
 *    the doc comment above it, and balances braces to the end. The panel falls back to the whole
 *    file when this returns `undefined`.
 *
 * No React, no i18n: text is `{ key, vars }` for `t()`.
 */
import type { ActorId, Command, Frame, Replica, SlotId } from '../types'
import type { UiText } from './derive'

// ─── What ran ─────────────────────────────────────────────────────────────────────────────────

/** The `CrdtType` methods the sandbox can show. */
export type CrdtFn = 'prepare' | 'effect' | 'merge' | 'value'

export type ReplicaType = Replica['type']

export type RanCall = {
  type: ReplicaType
  fn: CrdtFn
  slot: SlotId
  /** One short line per call site, in order ("Alice built op alice:3", "Bob ← Alice"). */
  details: UiText[]
}

const D = (name: string, vars: Record<string, string | number>): UiText => ({
  key: `tryIt.code.detail.${name}`,
  vars,
})

function typeOf(frame: Frame, actor: ActorId, slot: SlotId): ReplicaType | undefined {
  return frame.world.replicas[actor]?.[slot]?.type ?? frame.prev.replicas[actor]?.[slot]?.type
}

function labelOf(frame: Frame, actor: ActorId): string {
  return frame.world.actors[actor]?.label ?? actor
}

/** The op id an update minted: the last log entry of the updated replica. */
function lastOpId(frame: Frame, actor: ActorId, slot: SlotId): string {
  const log = frame.world.replicas[actor]?.[slot]?.log
  return log?.[log.length - 1]?.id ?? `${actor}:?`
}

/**
 * The CRDT functions the step of `frame` ran, in order, deduped by (type, fn, slot) with their
 * call sites merged. Empty when nothing in `src/crdt/` ran.
 */
export function whatRan(frame: Frame): RanCall[] {
  const out: RanCall[] = []
  const push = (type: ReplicaType | undefined, fn: CrdtFn, slot: SlotId, detail: UiText) => {
    if (!type) return
    const found = out.find((c) => c.type === type && c.fn === fn && c.slot === slot)
    if (found) found.details.push(detail)
    else out.push({ type, fn, slot, details: [detail] })
  }
  const delivered = frame.changes.flatMap((c) =>
    c.kind === 'message' && c.op === 'delivered' ? [c.message] : [],
  )
  for (const cmd of frame.step.do as Command[]) {
    switch (cmd.t) {
      case 'crdt.update': {
        const type = typeOf(frame, cmd.actor, cmd.slot)
        const vars = { actor: labelOf(frame, cmd.actor), id: lastOpId(frame, cmd.actor, cmd.slot) }
        push(type, 'prepare', cmd.slot, D('prepared', vars))
        push(type, 'effect', cmd.slot, D('applied', vars))
        break
      }
      case 'crdt.merge':
        push(
          typeOf(frame, cmd.into, cmd.slot),
          'merge',
          cmd.slot,
          D('merged', { into: labelOf(frame, cmd.into), from: labelOf(frame, cmd.from) }),
        )
        break
      case 'crdt.sync': {
        const type = typeOf(frame, cmd.a, cmd.slot)
        const a = labelOf(frame, cmd.a)
        const b = labelOf(frame, cmd.b)
        const fn: CrdtFn = cmd.mode === 'ops' ? 'effect' : 'merge'
        push(type, fn, cmd.slot, D('merged', { into: a, from: b }))
        push(type, fn, cmd.slot, D('merged', { into: b, from: a }))
        break
      }
      case 'deliver': {
        const msg = delivered.find((m) => m.id === cmd.message)
        const data = msg?.data
        if (!msg || !data) break
        if (data.kind === 'op') {
          push(
            typeOf(frame, msg.to, data.slot),
            'effect',
            data.slot,
            D('applied', { actor: labelOf(frame, msg.to), id: data.op.id }),
          )
        } else if (data.kind === 'state') {
          push(
            typeOf(frame, msg.to, data.slot),
            'merge',
            data.slot,
            D('merged', { into: labelOf(frame, msg.to), from: labelOf(frame, msg.from) }),
          )
        }
        break
      }
      default:
        break
    }
  }
  return out
}

/** Why a step called nothing in the CRDT (only meaningful when `whatRan` is empty). */
export function whyNothingRan(frame: Frame): UiText {
  const kinds = new Set((frame.step.do as Command[]).map((c) => c.t))
  if (kinds.has('crdt.broadcast') || kinds.has('crdt.send')) return { key: 'tryIt.code.none.sent' }
  if (kinds.has('deliver')) return { key: 'tryIt.code.none.parked' }
  if (kinds.has('drop')) return { key: 'tryIt.code.none.dropped' }
  if (kinds.has('offline') || kinds.has('online')) return { key: 'tryIt.code.none.network' }
  if (kinds.has('tick')) return { key: 'tryIt.code.none.tick' }
  return { key: 'tryIt.code.none' }
}

/**
 * The function a replica's wire will call next: `effect` for an ops-wired slot (every delivered
 * op), `merge` for a state-wired one (every sync / delivered state). Used as the reference block
 * before anything ran and after steps that ran nothing.
 */
export function wireFn(replica: Replica | undefined): CrdtFn {
  return replica?.args.wire === 'ops' ? 'effect' : 'merge'
}

// ─── Extract ──────────────────────────────────────────────────────────────────────────────────

export type ExtractedFn = {
  name: string
  /** 1-based, inclusive: the first line shown (a doc comment when there is one). */
  start: number
  /** 1-based: the line the declaration itself starts on. `start..bodyStart-1` is its comment. */
  bodyStart: number
  /** 1-based, inclusive: the last line of the function. */
  end: number
  /** Lines `start..end`, dedented; a trailing `,` after the closing brace of a method is dropped. */
  text: string
}

type DeclKind = 'function' | 'method' | 'arrow'

const ident = (name: string) => name.replace(/[$]/g, '\\$')

/** A line that is (the start of) a comment, never a declaration. */
const isCommentLine = (line: string): boolean => /^\s*(\/\/|\/\*|\*)/.test(line)

/**
 * Strip string literals and comments from one line so braces inside them are not counted.
 * Tolerant: template literals and block comments are handled only within the line.
 */
function bare(line: string): string {
  return line
    .replace(/\/\*.*?\*\//g, '')
    .replace(/'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"|`(?:\\.|[^`\\])*`/g, '""')
    .replace(/\/\/.*$/, '')
}

function count(line: string, open: string, close: string): number {
  let n = 0
  for (const ch of line) {
    if (ch === open) n++
    else if (ch === close) n--
  }
  return n
}

/** Find the declaration line of `name` (0-based), following one `name: ref,` indirection. */
function findDecl(
  lines: string[],
  name: string,
  depth = 0,
): { line: number; kind: DeclKind } | undefined {
  const n = ident(name)
  const reFunction = new RegExp(`^\\s*(?:export\\s+)?(?:async\\s+)?function\\s+${n}\\s*[<(]`)
  const reMethod = new RegExp(`^\\s*(?:async\\s+)?${n}\\s*(?:<[^>]*>)?\\s*\\(`)
  const reProp = new RegExp(`^\\s*${n}\\s*:\\s*(.*)$`)
  const reConst = new RegExp(`^\\s*(?:export\\s+)?const\\s+${n}\\s*(?::[^=]*)?=\\s*(.*)$`)
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? ''
    if (isCommentLine(line)) continue
    if (reFunction.test(line)) return { line: i, kind: 'function' }
    if (reMethod.test(line) && headerOpensBody(lines, i)) return { line: i, kind: 'method' }
    const prop = reProp.exec(line)
    if (prop) {
      const rest = (prop[1] ?? '').trim()
      if (/^(?:async\s*)?[(<]/.test(rest)) return { line: i, kind: 'arrow' }
      const ref = /^([A-Za-z_$][\w$]*)\s*,?\s*$/.exec(rest)
      if (ref && depth === 0) {
        const target = findDecl(lines, ref[1] ?? '', 1)
        if (target) return target
      }
      continue
    }
    const cst = reConst.exec(line)
    if (cst && /^(?:async\s*)?(?:[(<]|function\b)/.test((cst[1] ?? '').trim())) {
      return { line: i, kind: 'arrow' }
    }
  }
  return undefined
}

/**
 * A method header (`name(...)`, possibly over several lines) ends with `{`; an interface
 * signature (`name(...): T`) does not, and neither does a bare call statement.
 */
function headerOpensBody(lines: string[], from: number): boolean {
  let parens = 0
  let opened = false
  for (let i = from; i < Math.min(lines.length, from + 12); i++) {
    const line = bare(lines[i] ?? '')
    for (const ch of line) {
      if (ch === '(') {
        parens++
        opened = true
      } else if (ch === ')') parens--
    }
    if (opened && parens <= 0) return /\{\s*$/.test(line)
  }
  return false
}

/** The last line (0-based) of a declaration that starts at `from`, by brace / paren balance. */
function findEnd(lines: string[], from: number): number {
  let braces = 0
  let parens = 0
  let sawBrace = false
  for (let i = from; i < lines.length; i++) {
    const line = bare(lines[i] ?? '')
    braces += count(line, '{', '}')
    parens += count(line, '(', ')')
    if (braces > 0) sawBrace = true
    if (braces <= 0 && parens <= 0) {
      if (sawBrace) return i
      // A one-line arrow (`merge: (a, b) => Math.max(a, b),`) has no braces at all.
      if (line.includes('=>')) return i
    }
  }
  return lines.length - 1
}

/** The first line (0-based) of the comment block directly above `line`, or `line` itself. */
function commentStart(lines: string[], line: number): number {
  let i = line - 1
  const prev = (lines[i] ?? '').trim()
  if (prev.endsWith('*/')) {
    while (i >= 0 && !/^\s*\/\*/.test(lines[i] ?? '')) i--
    return Math.max(0, i)
  }
  while (i >= 0 && /^\s*\/\//.test(lines[i] ?? '')) i--
  return i + 1
}

function dedent(lines: string[]): string[] {
  const indents = lines.filter((l) => l.trim() !== '').map((l) => /^\s*/.exec(l)?.[0].length ?? 0)
  const min = indents.length ? Math.min(...indents) : 0
  return lines.map((l) => l.slice(min))
}

/** Extract `name` from `source`; `undefined` when no declaration with a body is found. */
export function extractFunction(source: string, name: string): ExtractedFn | undefined {
  const lines = source.split('\n')
  const decl = findDecl(lines, name)
  if (!decl) return undefined
  const end = findEnd(lines, decl.line)
  const start = commentStart(lines, decl.line)
  const body = dedent(lines.slice(start, end + 1))
  const last = body.length - 1
  const tail = body[last]
  if (tail !== undefined) body[last] = tail.replace(/,\s*$/, '')
  return {
    name,
    start: start + 1,
    bodyStart: decl.line + 1,
    end: end + 1,
    text: body.join('\n'),
  }
}
