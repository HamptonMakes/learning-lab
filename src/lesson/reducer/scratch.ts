/**
 * Step-scoped scratch the reducer core keeps next to the contract `ReduceCtx` (context.ts).
 *
 * `ReduceCtx` is the cross-agent contract and stays untouched; the core needs two more things for
 * one step that no world diff can see: which paths were written by `quiet` commands (§4.2, §6 step
 * 4) and which marks were added in this step (resolved against the end-of-step world in §6 step 3,
 * with their `compare.expect`). `applyStep` creates a `StepScratch` and passes a `ReduceCtxX`; a
 * caller that drives `reduce` directly (tests, the sandbox) may omit it — the helpers below are
 * no-ops without a scratch. Document: any module that needs per-step memory reads it from here
 * and nowhere else.
 */
import { ReducerError, type Command, type MarkId, type Path, type Verdict } from '../types'
import type { ReduceCtx } from './context'

export type NewMark = { command: Command; expect?: Verdict }

export type StepScratch = {
  /** Paths (prefixes) written by commands that carried `quiet: true`; auto-highlight skips them. */
  quiet: Path[]
  /** Marks added in this step, by id — resolved at the end of the step (`resolveMarks`). */
  newMarks: Map<MarkId, NewMark>
}

/** `ReduceCtx` plus the optional step scratch. Everything in the reducer core accepts this. */
export type ReduceCtxX = ReduceCtx & { scratch?: StepScratch }

export function createScratch(): StepScratch {
  return { quiet: [], newMarks: new Map() }
}

/** Remember that `path` (and everything under it) was written quietly. No-op without a scratch. */
export function markQuiet(ctx: ReduceCtxX, path: Path): void {
  ctx.scratch?.quiet.push(path)
}

/** Remember a mark added by `command` in this step. No-op without a scratch. */
export function rememberMark(ctx: ReduceCtxX, id: MarkId, mark: NewMark): void {
  ctx.scratch?.newMarks.set(id, mark)
}

/** True when `path` equals `prefix` or lies under it (`a.b` covers `a.b.c`, `a.b[x]`, `a.b@ts`). */
export function isUnder(path: Path, prefix: Path): boolean {
  if (path === prefix) return true
  if (!path.startsWith(prefix)) return false
  const c = path.charAt(prefix.length)
  return c === '.' || c === '[' || c === '@'
}

/** A `ReducerError` carrying the step id, the command and (optionally) the path. */
export function fail(ctx: ReduceCtx, command: unknown, message: string, path?: Path): ReducerError {
  return new ReducerError(
    message,
    path === undefined ? { stepId: ctx.stepId, command } : { stepId: ctx.stepId, command, path },
  )
}
