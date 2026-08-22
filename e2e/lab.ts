/**
 * Shared helpers for walking lessons through `window.__lab` (installed by the player when the page
 * is opened with `?lab=1`). Used by topics.spec.ts (behaviour) and verify/*.spec.ts (storyboards).
 */
import type { Page } from '@playwright/test'
import { modules } from '../src/content/catalog'

export interface LabCurrent {
  index: number
  stepId: string
  sceneId: string
  say: string
  changes: unknown[]
}

export interface TopicTarget {
  module: string
  unit: string
  topic: string
  unitNumeral: string
  unitTitle: string
  topicTitle: string
  firstInUnit: boolean
}

/** Every topic in catalog order (lessons may or may not exist yet — the walker skips missing ones). */
export function catalogTopics(): TopicTarget[] {
  const out: TopicTarget[] = []
  for (const m of modules) {
    for (const u of m.units) {
      u.topics.forEach((t, i) => {
        out.push({
          module: m.id,
          unit: u.id,
          topic: t.id,
          unitNumeral: u.numeral,
          unitTitle: u.title,
          topicTitle: t.title,
          firstInUnit: i === 0,
        })
      })
    }
  }
  return out
}

export function topicUrl(t: TopicTarget, locale = 'en', extra = ''): string {
  return `/${locale}/${t.module}/${t.unit}/${t.topic}?step=1&lab=1&motion=off${extra}`
}

/** Waits for the lab hook; returns false when the topic has no lesson yet (coming soon). */
export async function openLesson(
  page: Page,
  t: TopicTarget,
  locale = 'en',
  extra = '',
): Promise<boolean> {
  await page.goto(topicUrl(t, locale, extra))
  const result = await Promise.race([
    page
      .waitForFunction(() => Boolean(window.__lab?.ready), null, { timeout: 15_000 })
      .then(() => 'lab' as const),
    page
      .getByText(/coming soon/i)
      .waitFor({ timeout: 15_000 })
      .then(() => 'soon' as const),
    page
      .locator('[data-testid=stage][data-error]')
      .waitFor({ timeout: 15_000 })
      .then(() => 'error' as const),
  ]).catch(() => 'timeout' as const)
  if (result === 'error') {
    const msg = await page.locator('[data-testid=stage][data-error]').innerText()
    throw new Error(`Lesson failed to build: ${msg}`)
  }
  if (result === 'timeout') throw new Error(`Timed out opening ${topicUrl(t, locale)}`)
  return result === 'lab'
}

export async function labTotal(page: Page): Promise<number> {
  return page.evaluate(() => window.__lab?.total ?? 0)
}
export async function labCurrent(page: Page): Promise<LabCurrent> {
  return page.evaluate(() => window.__lab!.current() as LabCurrent)
}
export async function labGoto(page: Page, index: number): Promise<void> {
  await page.evaluate((i) => window.__lab!.goto(i), index)
  await page.evaluate(() => window.__lab!.settle())
}
export async function labNext(page: Page): Promise<void> {
  await page.evaluate(() => window.__lab!.next())
  await page.evaluate(() => window.__lab!.settle())
}

declare global {
  interface Window {
    __lab?: {
      ready: true
      total: number
      current(): LabCurrent
      goto(index: number): Promise<void>
      next(): Promise<void>
      prev(): Promise<void>
      settle(): Promise<void>
    }
  }
}
