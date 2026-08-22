import { chromium } from '@playwright/test'
const url = process.argv[2]
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
page.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warning')
    console.log(`[console.${m.type()}]`, m.text().slice(0, 600))
})
page.on('pageerror', (e) => console.log('[pageerror]', String(e.stack || e).slice(0, 1200)))
await page.goto(url)
await page.waitForTimeout(3000)
const showErr = page.getByRole('button', { name: /show error/i })
if (await showErr.count()) {
  await showErr.click()
  await page.waitForTimeout(300)
  console.log('[error-ui]', (await page.locator('body').innerText()).slice(0, 1500))
}
console.log(
  '[lab]',
  await page.evaluate(() => ({ ready: !!window.__lab?.ready, total: window.__lab?.total })),
)
await browser.close()
