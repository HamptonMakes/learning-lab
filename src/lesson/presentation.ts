/**
 * A topic as a presentation: a title screen, the lesson frames, a "Flow" frame when the lesson
 * has CRDT replicas (the page runs the autopilot on the lesson's last world — see `lesson/flow`),
 * and a closing summary (when to use / when not to use / in the real world). The extra frames are
 * `Frame`s with a `slide`, so the player, walker and storyboards treat them like any step.
 * Pure and memoized per (topic, labels).
 */
import { initWorld } from './reducer/world'
import { buildTimeline } from './reducer/timeline'
import { deriveControls } from './sandbox/derive'
import type { AssertMode } from './reducer/context'
import type { Frame, Slide, Topic, World } from './types'

export interface PresentationLabels {
  /** Narration for the title screen; defaults to `subtitle`. */
  intro?: string
  /** "How it works" — heading + narration of the rules slide (rendered only when the topic has `rules`). */
  howItWorks?: string
  /** "Let's see it work." — the call to action under the rules. */
  letsSee?: string
  /** e.g. "When to use it." */
  use: string
  /** e.g. "When not to use it." */
  avoid: string
  /** e.g. "In the real world." */
  world: string
  /** "Watch it flow" — heading of the flow frame (rendered only when the lesson has replicas). */
  flow?: string
  /** Narration of the flow frame; defaults to `flow`. */
  flowSay?: string
}

export interface PresentationOptions {
  /** Display title (from the catalog). */
  title: string
  /** One-sentence "what it is" (the catalog summary). */
  subtitle: string
  labels: PresentationLabels
  assertMode?: AssertMode
}

export const INTRO_SCENE = 'intro'
export const FLOW_SCENE = 'flow'
export const SUMMARY_SCENE = 'summary'

const memo = new WeakMap<Topic, Map<string, Frame[]>>()

export function buildPresentation(topic: Topic, opts: PresentationOptions): Frame[] {
  const key = JSON.stringify([opts.title, opts.subtitle, opts.labels, opts.assertMode ?? 'throw'])
  let byKey = memo.get(topic)
  if (!byKey) {
    byKey = new Map()
    memo.set(topic, byKey)
  }
  const hit = byKey.get(key)
  if (hit) return hit

  const lesson = buildTimeline(topic, opts.assertMode ? { assertMode: opts.assertMode } : {})
  const blank: World = initWorld({ actors: [] })
  const slideFrame = (
    sceneId: string,
    sceneIndex: number,
    id: string,
    say: string,
    slide: Slide,
  ): Frame => ({
    index: 0,
    sceneId,
    sceneIndex,
    step: { id, say, do: [] },
    world: blank,
    prev: blank,
    changes: [],
    slide,
  })

  const intro = slideFrame(INTRO_SCENE, -1, 'intro', opts.labels.intro ?? opts.subtitle, {
    kind: 'intro',
    title: opts.title,
    subtitle: opts.subtitle,
    goal: topic.goal,
  })
  const rules: Frame[] =
    topic.rules && topic.rules.length > 0
      ? [
          slideFrame(INTRO_SCENE, -1, 'rules', opts.labels.howItWorks ?? 'How it works', {
            kind: 'rules',
            heading: opts.labels.howItWorks ?? 'How it works',
            rules: topic.rules,
            ...(topic.shape ? { shape: topic.shape } : {}),
            ...(opts.labels.letsSee ? { cta: opts.labels.letsSee } : {}),
          }),
        ]
      : []
  const n = topic.scenes.length
  // The flow frame: a lesson world kept live (no blank world) so the stage draws the cast and the
  // page's autopilot can run it. Only when there is a CRDT to run, and then
  // …from the last lesson frame with something to press (a topic may end on a notes-only scene).
  const lastLesson = [...lesson].reverse().find((f) => canFlow(f.world))
  const flowHeading = opts.labels.flow ?? 'Watch it flow'
  const flow: Frame[] =
    lastLesson !== undefined
      ? [
          {
            ...slideFrame(FLOW_SCENE, n, 'flow', opts.labels.flowSay ?? flowHeading, {
              kind: 'flow',
              heading: flowHeading,
            }),
            // the lesson's marks (callouts, highlights) belong to its last step, not to the flow
            world: { ...lastLesson.world, marks: [] },
            prev: { ...lastLesson.world, marks: [] },
          },
        ]
      : []
  const summary: Frame[] = [
    slideFrame(SUMMARY_SCENE, n, 'use', opts.labels.use, {
      kind: 'summary',
      heading: opts.labels.use,
      bullets: topic.whenToUse,
      tone: 'ok',
    }),
    slideFrame(SUMMARY_SCENE, n, 'avoid', opts.labels.avoid, {
      kind: 'summary',
      heading: opts.labels.avoid,
      bullets: topic.whenNotToUse,
      tone: 'danger',
    }),
    slideFrame(SUMMARY_SCENE, n, 'world', opts.labels.world, {
      kind: 'summary',
      heading: opts.labels.world,
      text: topic.realWorld,
      tone: 'info',
    }),
  ]
  const frames = [intro, ...rules, ...lesson, ...flow, ...summary].map((f, index) => ({
    ...f,
    index,
  }))
  byKey.set(key, frames)
  return frames
}

/** A world can flow when the sandbox would offer at least one local op to press on some copy. */
export function canFlow(world: World): boolean {
  const controls = deriveControls(world)
  return (
    !controls.empty &&
    controls.actors.some((a) => a.slots.some((s) => s.ops.some((o) => o.disabled === undefined)))
  )
}

/** Scene ids in presentation order (intro, the topic's scenes, flow when built, summary). */
export function presentationScenes(
  topic: Topic,
  frames?: readonly Frame[],
): Array<{ id: string; title?: string; synthetic?: 'intro' | 'flow' | 'summary' }> {
  const hasFlow = frames?.some((f) => f.sceneId === FLOW_SCENE) ?? false
  return [
    { id: INTRO_SCENE, synthetic: 'intro' },
    ...topic.scenes.map((s) => ({ id: s.id, title: s.title })),
    ...(hasFlow ? [{ id: FLOW_SCENE, synthetic: 'flow' as const }] : []),
    { id: SUMMARY_SCENE, synthetic: 'summary' },
  ]
}
