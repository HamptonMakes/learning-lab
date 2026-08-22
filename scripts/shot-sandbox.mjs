import { chromium } from '@playwright/test'
const [url, out] = process.argv.slice(2)
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
await page.goto(url)
await page.waitForTimeout(1500)
await page.getByTestId('try-it-open').click()
await page.waitForTimeout(2500)
const sheet = page.locator('[role=dialog]')
const inc = sheet.getByRole('button', { name: /inc|\+1/i }).first()
if (await inc.count()) {
  await inc.click()
  await page.waitForTimeout(2000)
}
await page.screenshot({ path: out })
await browser.close()
