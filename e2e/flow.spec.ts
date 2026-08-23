/**
 * The flow frame: on a CRDT topic, the "Flow" scene runs the autopilot by itself (real browser, real
 * timers) — beats land, the status line fills, the stage changes — and Pause stops it.
 */
import { expect, test } from '@playwright/test'

test.describe('flow', () => {
  test('runs by itself on the Flow scene and pauses on demand', async ({ page }) => {
    // No `motion=off`: the autopilot only starts when the stage animates.
    await page.goto('/en/crdts/state-based/g-counter?step=1&lab=1')
    await page.waitForFunction(() => Boolean(window.__lab?.ready), null, { timeout: 15_000 })
    await page.getByTestId('scene-tab-flow').click()
    const hud = page.locator('[data-flow-hud]')
    await expect(hud).toBeVisible()
    await expect(hud).toHaveAttribute('data-flow-running', '')
    // Two beats at 1× take ≈ 3–4 s.
    await expect
      .poll(async () => Number(await hud.getAttribute('data-flow-n')), { timeout: 15_000 })
      .toBeGreaterThanOrEqual(2)
    await expect(page.getByTestId('flow-status')).not.toContainText('Press Run')
    await page.getByTestId('flow-toggle').click()
    await expect(hud).not.toHaveAttribute('data-flow-running', '')
    const n = Number(await hud.getAttribute('data-flow-n'))
    await page.waitForTimeout(2500)
    expect(Number(await hud.getAttribute('data-flow-n'))).toBe(n)
    // The lesson itself is untouched: next goes on to the summary.
    await page.getByTestId('transport-next').click()
    await expect(page.locator('[data-slide="summary"]')).toBeVisible()
  })
})
