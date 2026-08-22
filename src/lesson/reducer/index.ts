/**
 * The reducer core (DSL §6, stage-architecture §7): `reduce(world, cmd, ctx)` is the exhaustive
 * switch over the 43 commands; `applyStep(prev, step, ctx)` adds the step-level behaviour (clear
 * transients → commands → resolve marks → auto-highlights → reconcile log + diff into `changes`);
 * `makeAssert(mode)` is the `expect` policy. `buildTimeline` lives in ./timeline.ts (imported
 * from there — this module does not re-export it, to keep the import graph acyclic).
 */
import { plainValue, plainValueAt, resolvePath } from '../path'
import {
  ReducerError,
  type AssertCommand,
  type Change,
  type Command,
  type Mark,
  type MessageId,
  type Path,
  type Step,
  type World,
} from '../types'
import type { AssertMode, ReduceCtx, StepCtx } from './context'
import { prepareOutgoing, reduceCrdt } from './crdt'
import { diffWorld } from './diff'
import { deepEqual } from './equal'
import { createEventLog, type ReducerEvent } from './events'
import { mintId } from './ids'
import { clearTransientMarks, markAnchors, reduceMarks, resolveMarks } from './marks'
import { createMessages, reduceMessages } from './messages'
import { reduceRegex } from './regex'
import { createScratch, isUnder, markQuiet, type ReduceCtxX } from './scratch'
import { reduceStage } from './stage'
import { reduceValues } from './values'

export type { AssertMode, ReduceCtx, StepCtx } from './context'
export type { EventLog, ReducerEvent } from './events'
export { createEventLog } from './events'
export { mintId } from './ids'
export type { ReduceCtxX, StepScratch } from './scratch'
export { createScratch, isUnder } from './scratch'
export { initWorld, actorFromSpec, defaultHub } from './world'
export { reduceStage } from './stage'
export { reduceValues, assertPlainTarget, isCrdtSlot, isEngineSlot } from './values'
export { reduceMessages, createMessages, findMessage, type CreateSpec } from './messages'
export {
  reduceMarks,
  resolveMarks,
  clearTransientMarks,
  computeVerdict,
  markAnchors,
} from './marks'
export { reduceRegex } from './regex'
export { diffWorld, diffValue } from './diff'
export { deepEqual } from './equal'

// ─── expect ──────────────────────────────────────────────────────────────────────────────────

/** §4.5 equality: plain values deep-equal; a `display: 'text'` list also accepts the joined string. */
export function plainEquals(world: World, path: Path, actual: unknown, expected: unknown): boolean {
  if (deepEqual(actual, expected)) return true
  if (typeof expected === 'string' && Array.isArray(actual)) {
    const r = resolvePath(world, path)
    const v = r.kind === 'value' ? r.value : r.kind === 'board' ? r.board.value : undefined
    if (v?.kind === 'list' && v.display === 'text') {
      return (
        v.items
          .filter((it) => it.value.meta?.tombstone !== true)
          .map((it) => String(plainValue(it.value)))
          .join('') === expected
      )
    }
  }
  return false
}

/** The `expect` policy: 'throw' (tests, the dry-run), 'warn' (the app), 'ignore' (skip). */
export function makeAssert(mode: AssertMode = 'throw', stepId?: string): ReduceCtx['assert'] {
  return (world: World, cmd: AssertCommand): World => {
    if (mode === 'ignore') return world
    try {
      const actual = plainValueAt(world, cmd.path)
      if (!plainEquals(world, cmd.path, actual, cmd.equals)) {
        throw new ReducerError(
          `expect failed at "${cmd.path}": expected ${JSON.stringify(cmd.equals)}, got ${JSON.stringify(actual)}`,
          { stepId, command: cmd, path: cmd.path },
        )
      }
    } catch (e) {
      if (mode === 'throw') {
        if (e instanceof ReducerError) {
          throw new ReducerError(e.message, { stepId, command: cmd, path: e.ctx?.path ?? cmd.path })
        }
        throw e
      }
      console.warn(`[lesson] ${e instanceof Error ? e.message : String(e)}`)
    }
    return world
  }
}

/** A `ReduceCtxX` for callers that drive `reduce` directly (tests, the sandbox). */
export function makeReduceCtx(step: StepCtx, withScratch = true): ReduceCtxX {
  const ctx: ReduceCtxX = {
    ...step,
    log: createEventLog(),
    assert: makeAssert(step.assertMode, step.stepId),
  }
  if (withScratch) ctx.scratch = createScratch()
  return ctx
}

// ─── reduce ──────────────────────────────────────────────────────────────────────────────────

function withContext(e: unknown, ctx: ReduceCtx, cmd: Command): unknown {
  if (!(e instanceof ReducerError)) return e
  const has = e.ctx ?? {}
  if (has.stepId !== undefined && has.command !== undefined) return e
  const merged: { stepId?: string; command?: unknown; path?: string } = {
    stepId: has.stepId ?? ctx.stepId,
    command: has.command ?? cmd,
  }
  if (has.path !== undefined) merged.path = has.path
  const out = new ReducerError(e.message, merged)
  out.stack = e.stack
  return out
}

function reduceUnwrapped(w: World, cmd: Command, ctx: ReduceCtxX): World {
  switch (cmd.t) {
    case 'spawn':
    case 'remove':
    case 'removeBoard':
    case 'layout':
    case 'tick':
    case 'skew':
    case 'offline':
    case 'online':
    case 'status':
    case 'note':
      return reduceStage(w, cmd, ctx)
    case 'set':
    case 'patch':
    case 'insert':
    case 'delete':
    case 'move':
    case 'sort':
    case 'annotate':
    case 'unannotate':
    case 'view':
      return reduceValues(w, cmd, ctx)
    case 'send':
    case 'deliver':
    case 'drop':
    case 'duplicate':
    case 'relay':
      return reduceMessages(w, cmd, ctx)
    case 'highlight':
    case 'callout':
    case 'conflict':
    case 'compare':
    case 'check':
    case 'cross':
    case 'clearMarks':
    case 'unmark':
      return reduceMarks(w, cmd, ctx)
    case 'expect':
      return ctx.assert(w, cmd)
    case 'crdt.init':
    case 'crdt.doc':
    case 'crdt.merge':
    case 'crdt.sync':
    case 'crdt.gc':
      return reduceCrdt(w, cmd, ctx)
    case 'crdt.update': {
      if (cmd.quiet) markQuiet(ctx, `${cmd.actor}.${cmd.slot}`)
      return reduceCrdt(w, cmd, ctx)
    }
    case 'crdt.send':
    case 'crdt.broadcast': {
      const { world, messages } = prepareOutgoing(w, cmd, ctx)
      let next = world
      for (const m of messages) {
        const spec = {
          from: m.from,
          to: m.to,
          payload: m.payload,
          id: m.id,
          data: m.data,
        } as Parameters<typeof createMessages>[1]
        if (m.label !== undefined) spec.label = m.label
        if (m.size !== undefined) spec.size = m.size
        next = createMessages(next, spec, ctx, cmd)
      }
      return next
    }
    case 'regex.init':
    case 'regex.advance':
      return reduceRegex(w, cmd, ctx)
  }
}

/**
 * Apply one command. Pure and total: a `ReducerError` carrying `{ stepId, command, path }` on
 * misuse. `ctx.scratch` (optional) collects quiet paths and new marks for `applyStep`.
 */
export function reduce(w: World, cmd: Command, ctx: ReduceCtxX): World {
  try {
    return reduceUnwrapped(w, cmd, ctx)
  } catch (e) {
    throw withContext(e, ctx, cmd)
  }
}

// ─── applyStep ───────────────────────────────────────────────────────────────────────────────

export type StepResult = { world: World; changes: Change[] }

const USER_MARK_KINDS: ReadonlySet<Mark['kind']> = new Set([
  'highlight',
  'check',
  'cross',
  'conflict',
  'compare',
])

/** True when a user mark (highlight / check / cross / conflict / compare) sits on `path`'s branch. */
function markedByStep(path: Path, marks: readonly Mark[]): boolean {
  for (const m of marks) {
    if (!USER_MARK_KINDS.has(m.kind)) continue
    if (m.kind === 'highlight' && m.auto) continue
    for (const anchor of markAnchors(m)) {
      if (isUnder(path, anchor) || isUnder(anchor, path)) return true
    }
  }
  return false
}

function isSelectorPath(path: Path): boolean {
  return path.endsWith('@outbox') || path.endsWith('@inbox')
}

/** §6 step 4: one transient `highlight` (tone 'change', auto) per changed value path. */
function addAutoHighlights(w: World, prev: World, step: Step, ctx: ReduceCtxX): World {
  if (step.autoHighlight === false) return w
  const quiet = ctx.scratch?.quiet ?? []
  const seen = new Set<Path>()
  let world = w
  for (const c of diffWorld(prev, w)) {
    if (c.kind !== 'value' || c.op === 'removed') continue
    const path = c.path
    if (seen.has(path)) continue
    seen.add(path)
    if (isSelectorPath(path)) continue
    if (quiet.some((q) => isUnder(path, q))) continue
    if (markedByStep(path, world.marks)) continue
    const minted = mintId(world, 'k')
    world = {
      ...minted.world,
      marks: [
        ...minted.world.marks,
        { id: minted.id, kind: 'highlight', paths: [path], tone: 'change', auto: true },
      ],
    }
  }
  return world
}

/** §6 step 5: message and sync events in log order, then the diff with `via` folded in. */
function reconcile(events: readonly ReducerEvent[], diff: readonly Change[]): Change[] {
  const out: Change[] = []
  const vias: Array<{ path: Path; message: MessageId }> = []
  for (const e of events) {
    if (e.kind === 'via') vias.push(e)
    else out.push(e)
  }
  for (const c of diff) {
    if (c.kind !== 'value') {
      out.push(c)
      continue
    }
    let via: MessageId | undefined
    for (const v of vias) {
      // An actor-root via (a consumed control message) names no slot and folds into nothing.
      if (!v.path.includes('.') && !v.path.includes('[')) continue
      if (isUnder(c.path, v.path)) via = v.message
    }
    out.push(via === undefined ? c : { ...c, via })
  }
  return out
}

/** Apply a step (§6): returns the end-of-step world and the ordered `changes` (§14). */
export function applyStep(prev: World, step: Step, ctx: StepCtx): StepResult {
  const rctx: ReduceCtxX = {
    ...ctx,
    stepId: step.id,
    log: createEventLog(),
    assert: makeAssert(ctx.assertMode, step.id),
    scratch: createScratch(),
  }
  const prevCleared = clearTransientMarks(prev)
  let w = prevCleared
  for (const cmd of step.do) w = reduce(w, cmd, rctx)
  w = resolveMarks(w, step, rctx)
  w = addAutoHighlights(w, prevCleared, step, rctx)
  const changes = reconcile(rctx.log.events, diffWorld(prevCleared, w))
  return { world: w, changes }
}
