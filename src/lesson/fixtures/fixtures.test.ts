import { describe, expect, it } from 'vitest'
import { lintTopic, formatLint } from '../lint'
import { COMMAND_TS, validateTopic } from '../schema'
import type { CommandT } from '../types'
import {
  fixtureTopics,
  kitchenSinkTopic,
  lwwRegisterTopic,
  orSetTagsTopic,
  uuidV7Topic,
} from './index'

describe('fixtures', () => {
  it.each(fixtureTopics.map((t) => [t.id, t] as const))('%s passes validateTopic', (_id, t) => {
    const r = validateTopic(t)
    expect(r.ok, r.ok ? '' : r.issues.join('\n')).toBe(true)
  })

  it('have the ids and scene ids of the spec', () => {
    expect(lwwRegisterTopic.id).toBe('lww-register')
    expect(lwwRegisterTopic.scenes.map((s) => s.id)).toEqual(['update-and-merge'])
    expect(lwwRegisterTopic.scenes[0]?.steps.map((s) => s.id)).toEqual([
      's01',
      's02',
      's03',
      's04',
      's05',
      's06',
      's07',
      's08',
      's09',
    ])
    expect(orSetTagsTopic.id).toBe('or-set')
    expect(orSetTagsTopic.scenes.map((s) => s.id)).toEqual(['tags'])
    expect(uuidV7Topic.id).toBe('uuid-v7')
    expect(uuidV7Topic.scenes.map((s) => s.id)).toEqual(['time-first'])
    expect(kitchenSinkTopic.id).toBe('kitchen-sink')
  })

  it('the kitchen sink uses every one of the 43 commands at least once', () => {
    const used = new Set<CommandT>()
    for (const scene of kitchenSinkTopic.scenes)
      for (const step of scene.steps) for (const c of step.do) used.add(c.t)
    expect(COMMAND_TS.filter((t) => !used.has(t))).toEqual([])
  })

  it('are plain JSON data (no functions, survive a round trip)', () => {
    for (const t of fixtureTopics) expect(JSON.parse(JSON.stringify(t))).toEqual(t)
  })

  it('produce no lint errors or warnings (static rules)', () => {
    for (const t of fixtureTopics) {
      const issues = lintTopic(t).filter((i) => i.level !== 'info')
      expect(issues, formatLint(issues)).toEqual([])
    }
  })
})
