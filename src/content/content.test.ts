/**
 * Every registered topic must: pass the Zod schema, build a full timeline through the real reducer
 * with `expect`s enforced, and be lint-clean (no errors). This is the gate content authors run.
 */
import { describe, expect, it } from 'vitest'
import { modules } from './catalog'
import { registeredTopicKeys, topicLoaders } from './registry'
import { validateTopic } from '@/lesson/schema'
import { buildTimeline } from '@/lesson/reducer/timeline'
import { lintTopic, formatLint } from '@/lesson/lint'

const keys = registeredTopicKeys()

describe('content registry', () => {
  it('has at least one topic', () => {
    expect(keys.length).toBeGreaterThan(0)
  })
  it('only registers topics that exist in the catalog', () => {
    const catalogKeys = new Set(
      modules.flatMap((m) =>
        m.units.flatMap((u) => u.topics.map((t) => `${m.id}/${u.id}/${t.id}`)),
      ),
    )
    for (const k of keys)
      expect(catalogKeys.has(k), `${k} is not in src/content/catalog.ts`).toBe(true)
  })
})

describe.each(keys)('%s', (key) => {
  it('validates, builds, and lints clean', async () => {
    const loader = topicLoaders[key]
    expect(loader).toBeDefined()
    const topic = (await loader!()).default
    const [, , topicId] = key.split('/')
    expect(topic.id).toBe(topicId)
    const v = validateTopic(topic)
    expect(v.ok, v.ok ? '' : v.issues.join('\n')).toBe(true)
    const frames = buildTimeline(topic, { assertMode: 'throw' })
    expect(frames.length).toBeGreaterThan(0)
    const issues = lintTopic(topic, frames)
    const errors = issues.filter((i) => i.level === 'error')
    expect(errors, formatLint(errors)).toEqual([])
    const warnings = issues.filter((i) => i.level === 'warning')
    if (warnings.length) console.warn(`[lint] ${key}\n${formatLint(warnings)}`)
  })
})
