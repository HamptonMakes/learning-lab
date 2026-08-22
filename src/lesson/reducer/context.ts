/**
 * Reducer context. `StepCtx` identifies where we are (for error messages and ids); `ReduceCtx` adds
 * the per-step event log and the `expect` policy. The timeline builder creates both.
 */
import type { AssertCommand, SceneId, StepId, World } from '../types'
import type { EventLog } from './events'

export type AssertMode = 'throw' | 'warn' | 'ignore'

export interface StepCtx {
  topicId?: string
  sceneId: SceneId
  stepId: StepId
  /** What to do when an `expect` fails. Tests use 'throw' (default); the app uses 'warn'. */
  assertMode?: AssertMode
}

export interface ReduceCtx extends StepCtx {
  log: EventLog
  /** Runs an `expect` command against the world per `assertMode`; returns the world unchanged. */
  assert: (world: World, cmd: AssertCommand) => World
}
