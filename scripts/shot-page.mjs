// Usage: node scripts/shot-page.mjs <url> <out.png> [width=1280] [stepIndex=6]
// Appends `?step=1&lab=1&motion=off` when the url has no query (the walker needs `lab=1`).
// Screenshots a lesson page (full page) at a given width after seeking the player to a step.
import { chromium } from '@playwright/test'
const [url, out, w = '1280', step = '6'] = process.argv.slice(2)
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: Number(w), height: 900 } })
await page.goto(url.includes('?') ? url : `${url}?step=1&lab=1&motion=off`)
await page.waitForFunction(() => window.__lab?.ready, null, { timeout: 20000 })
await page.evaluate((i) => window.__lab.goto(i), Number(step))
await page.waitForTimeout(1200)
await page.screenshot({ path: out, fullPage: true })
await browser.close()
