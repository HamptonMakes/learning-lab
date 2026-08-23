import { describe, expect, it } from 'vitest'
import { lwwRegisterTopic } from './fixtures/lww-register'
import { buildTimeline } from './reducer/timeline'
import { buildPresentation, INTRO_SCENE, SUMMARY_SCENE, presentationScenes } from './presentation'

const labels = { use: 'When to use it.', avoid: 'When not to use it.', world: 'In the real world.' }

describe('buildPresentation', () => {
  it('wraps the lesson in a title screen and a three-part summary, re-indexed', () => {
    const lesson = buildTimeline(lwwRegisterTopic)
    const frames = buildPresentation(lwwRegisterTopic, {
      title: 'LWW Register',
      subtitle: 'One value, one timestamp.',
      labels,
    })
    expect(frames).toHaveLength(lesson.length + 4)
    expect(frames.map((f) => f.index)).toEqual(frames.map((_, i) => i))
    expect(frames[0]?.slide).toMatchObject({
      kind: 'intro',
      title: 'LWW Register',
      subtitle: 'One value, one timestamp.',
    })
    expect(frames[0]?.sceneId).toBe(INTRO_SCENE)
    expect(frames[0]?.step.say).toBe('One value, one timestamp.')
    expect(frames[1]?.step.id).toBe(lesson[0]?.step.id)
    expect(frames[1]?.world).toBe(lesson[0]?.world)
    const tail = frames.slice(-3)
    expect(tail.map((f) => f.sceneId)).toEqual([SUMMARY_SCENE, SUMMARY_SCENE, SUMMARY_SCENE])
    expect(tail[0]?.slide).toMatchObject({
      kind: 'summary',
      tone: 'ok',
      bullets: lwwRegisterTopic.whenToUse,
    })
    expect(tail[1]?.slide).toMatchObject({
      kind: 'summary',
      tone: 'danger',
      bullets: lwwRegisterTopic.whenNotToUse,
    })
    expect(tail[2]?.slide).toMatchObject({
      kind: 'summary',
      tone: 'info',
      text: lwwRegisterTopic.realWorld,
    })
  })
  it('adds a rules slide after the title screen when the topic has rules', () => {
    const topic = {
      ...lwwRegisterTopic,
      rules: ['On every update, write down a new time.', 'On merge, keep the larger time.'],
      shape: {
        name: 'LWW register',
        fields: [
          { key: 'value', example: 'Lunch', role: 'value' as const },
          { key: 'time', example: '2' },
        ],
      },
    }
    const frames = buildPresentation(topic, {
      title: 'T',
      subtitle: 'S',
      labels: { ...labels, howItWorks: 'How it works', letsSee: "Let's see it work." },
    })
    expect(frames[1]?.slide).toMatchObject({
      kind: 'rules',
      heading: 'How it works',
      rules: topic.rules,
      cta: "Let's see it work.",
    })
    expect(frames[1]?.slide?.kind === 'rules' && frames[1].slide.shape?.name).toBe('LWW register')
    expect(frames[1]?.sceneId).toBe(INTRO_SCENE)
    expect(frames[2]?.step.id).toBe(lwwRegisterTopic.scenes[0]?.steps[0]?.id)
  })
  it('is memoized per topic + options', () => {
    const a = buildPresentation(lwwRegisterTopic, { title: 'T', subtitle: 'S', labels })
    const b = buildPresentation(lwwRegisterTopic, { title: 'T', subtitle: 'S', labels })
    expect(a).toBe(b)
    expect(buildPresentation(lwwRegisterTopic, { title: 'T2', subtitle: 'S', labels })).not.toBe(a)
  })
  it('lists scenes in presentation order', () => {
    expect(presentationScenes(lwwRegisterTopic).map((s) => s.id)).toEqual([
      INTRO_SCENE,
      ...lwwRegisterTopic.scenes.map((s) => s.id),
      SUMMARY_SCENE,
    ])
  })
})
