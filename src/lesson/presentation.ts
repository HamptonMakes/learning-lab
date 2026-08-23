/**
 * A topic as a presentation: a title screen, the lesson frames, and a closing summary
 * (when to use / when not to use / in the real world). The extra frames are `Frame`s with a
 * `slide` instead of actors, so the player, walker and storyboards treat them like any step.
 * Pure and memoized per (topic, labels).
 */
import { initWorld } from './reducer/world'
import { buildTimeline } from './reducer/timeline'
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
  const frames = [intro, ...rules, ...lesson, ...summary].map((f, index) => ({ ...f, index }))
  byKey.set(key, frames)
  return frames
}

/** Scene ids in presentation order (intro, the topic's scenes, summary). */
export function presentationScenes(
  topic: Topic,
): Array<{ id: string; title?: string; synthetic?: 'intro' | 'summary' }> {
  return [
    { id: INTRO_SCENE, synthetic: 'intro' },
    ...topic.scenes.map((s) => ({ id: s.id, title: s.title })),
    { id: SUMMARY_SCENE, synthetic: 'summary' },
  ]
}
