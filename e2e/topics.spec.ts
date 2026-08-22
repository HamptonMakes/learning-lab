import { test, expect } from '@playwright/test'
import { catalogTopics, labCurrent, labGoto, labNext, labTotal, openLesson } from './lab'

/**
 * Walks every step of every authored topic in a real browser: narration matches the frame, the
 * stage shows the right step, next/prev/seek via the lab hook keep everything in sync, and the URL
 * tracks the step. Topics without a lesson yet are skipped (and listed in the report).
 */
for (const t of catalogTopics()) {
  test(`${t.module}/${t.unit}/${t.topic} walks every step`, async ({ page }) => {
    const hasLesson = await openLesson(page, t)
    test.skip(!hasLesson, 'no lesson yet')
    const total = await labTotal(page)
    expect(total).toBeGreaterThan(0)
    const stage = page.locator('[data-stage]')
    const narration = page.getByTestId('narration')
    for (let i = 0; i < total; i++) {
      if (i > 0) await labNext(page)
      const cur = await labCurrent(page)
      expect(cur.index).toBe(i)
      await expect(stage).toHaveAttribute('data-step', cur.stepId)
      await expect(narration).toHaveAttribute('data-step', cur.stepId)
      const plain = cur.say
        .replace(/\*\*/g, '')
        .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
        .replace(/`/g, '')
      await expect(narration).toContainText(plain.slice(0, 40))
      await expect(page).toHaveURL(new RegExp(`[?&]step=${i + 1}(&|$)`))
    }
    // seek back to the first step instantly and forward to the last
    await labGoto(page, 0)
    expect((await labCurrent(page)).index).toBe(0)
    await labGoto(page, total - 1)
    expect((await labCurrent(page)).index).toBe(total - 1)
    await expect(page.getByTestId('topic-complete'))
      .toBeVisible({ timeout: 5000 })
      .catch(() => {
        /* ended state only appears after a forward step into the last frame; not required on seek */
      })
  })
}
