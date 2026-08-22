/**
 * Marks (DSL §4.4, §10): highlight / callout / conflict / compare / check / cross / clearMarks /
 * unmark append or drop marks in command order; `resolveMarks` runs at the END of the step and
 * checks every anchor against the end-of-step world, computes `compare` verdicts (rule order:
 * clock → stamp → number → value) and removes older marks whose anchors vanished.
 * `clearTransientMarks` is step 1 of `applyStep`.
 */
import { compareStamp } from '../../crdt/types'
import { vcCompare } from '../../crdt/vector-clock'
import { plainValueAt, resolvePath, type Resolved } from '../path'
import {
  ReducerError,
  type CompareRule,
  type Mark,
  type MarkCommand,
  type Path,
  type Step,
  type VectorClock,
  type Verdict,
  type World,
} from '../types'
import { deepEqual } from './equal'
import { mintId } from './ids'
import { fail, rememberMark, type ReduceCtxX } from './scratch'

/** Every path a mark is anchored at. */
export function markAnchors(mark: Mark): Path[] {
  switch (mark.kind) {
    case 'highlight':
    case 'compare':
      return mark.paths
    case 'callout':
      return [mark.at]
    case 'conflict':
      return [mark.a, mark.b]
    case 'check':
    case 'cross':
    case 'unchanged':
      return [mark.path]
    case 'flow':
      return [mark.from, mark.to]
  }
}

/** Marks that survive a step boundary: only those flagged `sticky` (§6 step 1). */
export function clearTransientMarks(w: World): World {
  const marks = w.marks.filter((m) => 'sticky' in m && m.sticky === true)
  return marks.length === w.marks.length ? w : { ...w, marks }
}

// ─── Compare verdicts (§10) ────────────────────────────────────────────────────────────────────

function clockOf(r: Resolved): VectorClock | undefined {
  if (r.kind === 'value' && r.value.kind === 'clock') return r.value.entries
  if (r.kind === 'board' && r.board.value.kind === 'clock') return r.board.value.entries
  if (r.kind === 'meta' && r.key === 'vc') return r.value as VectorClock
  return undefined
}

function stampOf(r: Resolved): { ts: number; node: string } | undefined {
  const v = r.kind === 'value' ? r.value : r.kind === 'board' ? r.board.value : undefined
  const meta = v?.meta
  if (meta?.ts !== undefined && meta.node !== undefined) return { ts: meta.ts, node: meta.node }
  return undefined
}

function comparePair(w: World, a: Path, b: Path): { verdict: Verdict; rule: CompareRule } {
  const ra = resolvePath(w, a)
  const rb = resolvePath(w, b)
  const ca = clockOf(ra)
  const cb = clockOf(rb)
  if (ca !== undefined && cb !== undefined) return { verdict: vcCompare(ca, cb), rule: 'clock' }
  const sa = stampOf(ra)
  const sb = stampOf(rb)
  if (sa !== undefined && sb !== undefined) {
    const c = compareStamp(sa, sb)
    return { verdict: c < 0 ? 'less' : c > 0 ? 'greater' : 'equal', rule: 'stamp' }
  }
  const pa = plainValueAt(w, a)
  const pb = plainValueAt(w, b)
  if (typeof pa === 'number' && typeof pb === 'number') {
    return { verdict: pa < pb ? 'less' : pa > pb ? 'greater' : 'equal', rule: 'number' }
  }
  return { verdict: deepEqual(pa, pb) ? 'equal' : 'different', rule: 'value' }
}

/**
 * The verdict of a `compare` over `paths` in `w` (§10): two paths → the first matching rule; more
 * paths → 'equal' when every adjacent pair is equal under its rule, else 'different' (the rule of
 * the first pair is recorded). Throws `ReducerError` when a path does not resolve or has no
 * plain value (a whole card, a message).
 */
export function computeVerdict(w: World, paths: Path[]): { verdict: Verdict; rule: CompareRule } {
  const [first, second] = paths
  if (first === undefined || second === undefined) {
    throw new ReducerError('compare needs at least two paths')
  }
  if (paths.length === 2) return comparePair(w, first, second)
  let rule: CompareRule | undefined
  let allEqual = true
  for (let i = 0; i + 1 < paths.length; i += 1) {
    const r = comparePair(w, paths[i] as Path, paths[i + 1] as Path)
    rule ??= r.rule
    if (r.verdict !== 'equal') allEqual = false
  }
  return { verdict: allEqual ? 'equal' : 'different', rule: rule ?? 'value' }
}

// ─── Commands ────────────────────────────────────────────────────────────────────────────────

function addMark(
  w: World,
  ctx: ReduceCtxX,
  cmd: MarkCommand,
  explicitId: string | undefined,
  build: (id: string) => Mark,
  expect?: Verdict,
): World {
  let world = w
  let id = explicitId
  if (id === undefined) {
    const minted = mintId(w, 'k')
    world = minted.world
    id = minted.id
  }
  const mark = build(id)
  rememberMark(ctx, id, expect === undefined ? { command: cmd } : { command: cmd, expect })
  const marks = world.marks.filter((m) => m.id !== id)
  marks.push(mark)
  return { ...world, marks }
}

function sticky(flag: boolean | undefined): { sticky: true } | Record<string, never> {
  return flag === true ? { sticky: true } : {}
}

export function reduceMarks(w: World, cmd: MarkCommand, ctx: ReduceCtxX): World {
  switch (cmd.t) {
    case 'highlight': {
      const paths = Array.isArray(cmd.path) ? cmd.path : [cmd.path]
      if (paths.length === 0) throw fail(ctx, cmd, 'highlight needs at least one path')
      return addMark(w, ctx, cmd, cmd.id, (id) => ({
        id,
        kind: 'highlight',
        paths,
        tone: cmd.tone ?? 'change',
        ...sticky(cmd.sticky),
      }))
    }
    case 'callout':
      return addMark(w, ctx, cmd, cmd.id, (id) => ({
        id,
        kind: 'callout',
        at: cmd.at,
        text: cmd.text,
        tone: cmd.tone ?? 'info',
        ...sticky(cmd.sticky),
      }))
    case 'conflict':
      return addMark(w, ctx, cmd, cmd.id, (id) => ({
        id,
        kind: 'conflict',
        a: cmd.a,
        b: cmd.b,
        ...sticky(cmd.sticky),
      }))
    case 'compare': {
      if (cmd.paths.length < 2) throw fail(ctx, cmd, 'compare needs at least two paths')
      // Provisional verdict against the current world; the real one is computed by resolveMarks
      // against the end-of-step world (§4.4). Paths that do not exist yet are fine here.
      let provisional: { verdict: Verdict; rule: CompareRule } = {
        verdict: 'different',
        rule: 'value',
      }
      try {
        provisional = computeVerdict(w, cmd.paths)
      } catch {
        /* resolved at the end of the step */
      }
      return addMark(
        w,
        ctx,
        cmd,
        cmd.id,
        (id) => ({
          id,
          kind: 'compare',
          paths: cmd.paths,
          verdict: provisional.verdict,
          rule: provisional.rule,
          ...sticky(cmd.sticky),
        }),
        cmd.expect,
      )
    }
    case 'check':
    case 'cross':
      return addMark(w, ctx, cmd, cmd.id, (id) => ({
        id,
        kind: cmd.t,
        path: cmd.path,
        ...sticky(cmd.sticky),
      }))
    case 'clearMarks':
      return w.marks.length === 0 ? w : { ...w, marks: [] }
    case 'unmark': {
      if (!w.marks.some((m) => m.id === cmd.id))
        throw fail(ctx, cmd, `no mark "${cmd.id}" to unmark`)
      return { ...w, marks: w.marks.filter((m) => m.id !== cmd.id) }
    }
  }
}

// ─── End-of-step resolution ──────────────────────────────────────────────────────────────────

function resolves(w: World, p: Path): boolean {
  try {
    resolvePath(w, p)
    return true
  } catch {
    return false
  }
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

/**
 * §6 step 3. Marks added in this step (known from the step scratch) must resolve in `w`, the
 * end-of-step world — otherwise `ReducerError`; their `compare` verdicts are computed here and
 * checked against `expect` per `ctx.assertMode` ('throw' default, 'warn' logs, 'ignore'). Marks
 * from earlier steps (sticky) and reducer-generated ones lose their place when an anchor
 * vanished; a sticky compare is re-verdicted so the frame never shows a stale `=`.
 */
export function resolveMarks(w: World, step: Step, ctx: ReduceCtxX): World {
  const news = ctx.scratch?.newMarks
  const out: Mark[] = []
  let changed = false
  for (const mark of w.marks) {
    const info = news?.get(mark.id)
    if (info) {
      for (const p of markAnchors(mark)) {
        try {
          resolvePath(w, p)
        } catch (e) {
          throw fail(
            ctx,
            info.command,
            `mark "${mark.id}" (${mark.kind}) anchors at "${p}", which does not resolve at the end of step "${step.id}": ${errorMessage(e)}`,
            p,
          )
        }
      }
      if (mark.kind === 'compare') {
        let result: { verdict: Verdict; rule: CompareRule }
        try {
          result = computeVerdict(w, mark.paths)
        } catch (e) {
          throw fail(ctx, info.command, `compare "${mark.id}": ${errorMessage(e)}`)
        }
        if (info.expect !== undefined && info.expect !== result.verdict) {
          const message = `compare expected "${info.expect}" but the ${result.rule} rule says "${result.verdict}" (${mark.paths.join(' vs ')}) in step "${step.id}"`
          const mode = ctx.assertMode ?? 'throw'
          if (mode === 'throw') throw fail(ctx, info.command, message)
          if (mode === 'warn') console.warn(`[lesson] ${message}`)
        }
        if (result.verdict !== mark.verdict || result.rule !== mark.rule) {
          changed = true
          out.push({ ...mark, verdict: result.verdict, rule: result.rule })
          continue
        }
      }
      out.push(mark)
      continue
    }
    if (!markAnchors(mark).every((p) => resolves(w, p))) {
      changed = true
      continue
    }
    if (mark.kind === 'compare') {
      let result: { verdict: Verdict; rule: CompareRule } | undefined
      try {
        result = computeVerdict(w, mark.paths)
      } catch {
        result = undefined
      }
      if (result === undefined) {
        changed = true
        continue
      }
      if (result.verdict !== mark.verdict || result.rule !== mark.rule) {
        changed = true
        out.push({ ...mark, verdict: result.verdict, rule: result.rule })
        continue
      }
    }
    out.push(mark)
  }
  return changed ? { ...w, marks: out } : w
}
