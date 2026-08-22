/**
 * useSandbox — the "Try it" state (docs/animation-dsl.md §11, stage-architecture §8 "Sandbox").
 * Starts from a lesson frame and runs user-generated command lists through the real reducer
 * (`applyStep`, assert mode 'warn'), one synthetic step per run (`x1`, `x2` …). Frames get
 * increasing indexes so the stage animates forward; undo / reset rewind the history (the stage
 * commits those instantly). A `ReducerError` (unknown op, causally unready apply, offline sync …)
 * never reaches React: it is caught and surfaced as `lastError`.
 */
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { applyStep } from '../reducer'
import type { Command, Frame, SceneId, Step } from '../types'

export type SandboxCtx = { sceneId: SceneId; topicId?: string }

/** How the current frame was reached; the stage animates only `run`. */
export type SandboxMove = 'start' | 'run' | 'undo' | 'reset'

export type RunResult = { ok: true; frame: Frame } | { ok: false; error: string }

export interface SandboxApi {
  /** The frame to draw: the start frame, or the result of the last run. */
  frame: Frame
  /** `history[0]` is the start frame; the last entry is `frame`. */
  history: Frame[]
  move: SandboxMove
  /** The message of the last failed run; cleared by the next successful run, undo or reset. */
  lastError: string | undefined
  canUndo: boolean
  /** Apply `commands` as one step narrated by `say`. Never throws. */
  run: (commands: Command[], say: string) => RunResult
  undo: () => void
  reset: () => void
  clearError: () => void
}

type State = {
  start: Frame
  history: Frame[]
  n: number
  move: SandboxMove
  lastError: string | undefined
}

const fresh = (start: Frame): State => ({
  start,
  history: [start],
  n: 0,
  move: 'start',
  lastError: undefined,
})

const last = (s: State): Frame => s.history[s.history.length - 1] ?? s.start

export function useSandbox(startFrame: Frame, ctx: SandboxCtx): SandboxApi {
  const [state, setState] = useState<State>(() => fresh(startFrame))
  // A new start frame (the lesson moved on) resets the sandbox: derived state, adjusted in render.
  if (state.start !== startFrame) setState(fresh(startFrame))
  const view = state.start === startFrame ? state : fresh(startFrame)
  // Shadow of the committed state for the handlers, advanced eagerly in `commit` so two runs in
  // one tick (a prompt submit, a key repeat) build on each other.
  const latest = useRef(view)
  useLayoutEffect(() => {
    latest.current = view
  })
  const { sceneId, topicId } = ctx

  const commit = useCallback((next: State) => {
    latest.current = next
    setState(next)
  }, [])

  const run = useCallback(
    (commands: Command[], say: string): RunResult => {
      const s = latest.current
      const current = last(s)
      const n = s.n + 1
      const step: Step = { id: `x${n}`, say, do: commands }
      try {
        const stepCtx: Parameters<typeof applyStep>[2] = {
          sceneId,
          stepId: step.id,
          assertMode: 'warn',
        }
        if (topicId !== undefined) stepCtx.topicId = topicId
        const { world, changes } = applyStep(current.world, step, stepCtx)
        const frame: Frame = {
          index: current.index + 1,
          sceneId: current.sceneId,
          sceneIndex: current.sceneIndex,
          step,
          world,
          prev: current.world,
          changes,
        }
        commit({ ...s, history: [...s.history, frame], n, move: 'run', lastError: undefined })
        return { ok: true, frame }
      } catch (e) {
        const error = e instanceof Error ? e.message : String(e)
        commit({ ...s, n, lastError: error })
        return { ok: false, error }
      }
    },
    [commit, sceneId, topicId],
  )

  const undo = useCallback(() => {
    const s = latest.current
    if (s.history.length <= 1) return
    commit({ ...s, history: s.history.slice(0, -1), move: 'undo', lastError: undefined })
  }, [commit])

  const reset = useCallback(() => {
    const s = latest.current
    commit({ ...fresh(s.start), n: s.n, move: 'reset' })
  }, [commit])

  const clearError = useCallback(() => {
    const s = latest.current
    if (s.lastError !== undefined) commit({ ...s, lastError: undefined })
  }, [commit])

  const frame = last(view)
  return useMemo<SandboxApi>(
    () => ({
      frame,
      history: view.history,
      move: view.move,
      lastError: view.lastError,
      canUndo: view.history.length > 1,
      run,
      undo,
      reset,
      clearError,
    }),
    [frame, view.history, view.move, view.lastError, run, undo, reset, clearError],
  )
}
