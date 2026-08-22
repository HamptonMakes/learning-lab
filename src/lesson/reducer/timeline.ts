/**
 * `buildTimeline(topic)` (DSL §6, §13, §14; stage-architecture §7.4): fold every scene's steps
 * through `applyStep` into `Frame`s with a global index. A scene starts from `initWorld(scene.world)`
 * or from the end world of an earlier scene (`startFrom`: marks cleared; the parent must have no
 * messages in flight). Memoized per (topic, assertMode) in a WeakMap — frames are a pure function
 * of the topic module. Because every command runs for real, this is also the dry-run of §13: it
 * throws `ReducerError` on any authoring mistake the reducer can see.
 */
import {
  ReducerError,
  type Frame,
  type SceneId,
  type StepId,
  type Topic,
  type World,
} from '../types'
import type { AssertMode } from './context'
import { applyStep } from './index'
import { initWorld } from './world'

export type TimelineOptions = { assertMode?: AssertMode }

const cache = new WeakMap<Topic, Map<AssertMode, Frame[]>>()

function build(topic: Topic, assertMode: AssertMode): Frame[] {
  const frames: Frame[] = []
  const ends = new Map<SceneId, World>()
  topic.scenes.forEach((scene, sceneIndex) => {
    if (ends.has(scene.id)) {
      throw new ReducerError(`topic "${topic.id}": scene id "${scene.id}" is used twice`)
    }
    if ((scene.world === undefined) === (scene.startFrom === undefined)) {
      throw new ReducerError(
        `topic "${topic.id}", scene "${scene.id}": declare exactly one of "world" / "startFrom"`,
      )
    }
    let world0: World
    if (scene.startFrom !== undefined) {
      const parent = ends.get(scene.startFrom)
      if (!parent) {
        throw new ReducerError(
          `topic "${topic.id}", scene "${scene.id}": startFrom "${scene.startFrom}" is not an earlier scene`,
        )
      }
      if (parent.messages.length > 0) {
        throw new ReducerError(
          `topic "${topic.id}", scene "${scene.id}": startFrom "${scene.startFrom}" ends with ${parent.messages.length} message(s) in flight or parked (${parent.messages.map((m) => m.id).join(', ')})`,
        )
      }
      world0 = parent.marks.length === 0 ? parent : { ...parent, marks: [] }
    } else {
      try {
        world0 = initWorld(scene.world as NonNullable<typeof scene.world>)
      } catch (e) {
        if (e instanceof ReducerError) {
          throw new ReducerError(`topic "${topic.id}", scene "${scene.id}": ${e.message}`, e.ctx)
        }
        throw e
      }
    }
    const seenSteps = new Set<StepId>()
    let world = world0
    for (const step of scene.steps) {
      if (seenSteps.has(step.id)) {
        throw new ReducerError(
          `topic "${topic.id}", scene "${scene.id}": step id "${step.id}" is used twice`,
          { stepId: step.id },
        )
      }
      seenSteps.add(step.id)
      const { world: next, changes } = applyStep(world, step, {
        topicId: topic.id,
        sceneId: scene.id,
        stepId: step.id,
        assertMode,
      })
      frames.push({
        index: frames.length,
        sceneId: scene.id,
        sceneIndex,
        step,
        world: next,
        prev: world,
        changes,
      })
      world = next
    }
    ends.set(scene.id, world)
  })
  return frames
}

/** Every frame of a topic, in order. Memoized per (topic object, assertMode). */
export function buildTimeline(topic: Topic, opts: TimelineOptions = {}): Frame[] {
  const mode = opts.assertMode ?? 'throw'
  let byMode = cache.get(topic)
  if (!byMode) {
    byMode = new Map()
    cache.set(topic, byMode)
  }
  const hit = byMode.get(mode)
  if (hit) return hit
  const frames = build(topic, mode)
  byMode.set(mode, frames)
  return frames
}

/** The frame of `stepId` in `sceneId`, or undefined. */
export function frameAt(
  frames: readonly Frame[],
  sceneId: SceneId,
  stepId: StepId,
): Frame | undefined {
  return frames.find((f) => f.sceneId === sceneId && f.step.id === stepId)
}
