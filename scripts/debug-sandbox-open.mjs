import { chromium } from '@playwright/test'
const url = process.argv[2]
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
page.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 300)))
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log(`[${m.type()}]`, m.text().slice(0, 700)) })
await page.goto(url); await page.waitForTimeout(1500)
await page.getByTestId('try-it-open').first().click()
for (const ms of [300, 1000, 2500]) { await page.waitForTimeout(ms); console.log(`after +${ms}ms dialog:`, await page.locator('[role=dialog]').count()) }
await browser.close()
