import { chromium } from '@playwright/test'
const url = process.argv[2]
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
await page.goto(url)
await page.waitForTimeout(2500)
const rows = await page.evaluate(() => [...document.querySelectorAll('[data-annotation]')].map((e) => ({ id: e.dataset.annotation, lane: e.dataset.lane, from: e.dataset.from, to: e.dataset.to, unit: e.dataset.unit, text: e.textContent?.trim().slice(0, 30) })))
console.table(rows)
await browser.close()
