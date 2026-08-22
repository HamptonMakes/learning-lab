import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { test, expect } from '@playwright/test'
import { catalogTopics, labCurrent, labNext, labTotal, openLesson, type TopicTarget } from '../lab'

/**
 * Durable proof of the animations: for every authored topic, screenshot every step (the stage
 * plus the narration) into verification/<module>/<unit>/<topic>/NN-<stepId>.png, write steps.json,
 * and render a contact sheet (contact.png) from an HTML grid of those frames. The first topic of
 * each unit also gets a dark-theme contact sheet. `scripts/verification-index.mjs` builds the
 * top-level index.html afterwards.
 */
const ROOT = join(process.cwd(), 'verification')

test.describe.configure({ mode: 'serial' })

for (const t of catalogTopics()) {
  test(`storyboard ${t.module}/${t.unit}/${t.topic}`, async ({ page }, testInfo) => {
    const hasLesson = await openLesson(page, t)
    test.skip(!hasLesson, 'no lesson yet')
    const dir = join(ROOT, t.module, t.unit, t.topic)
    rmSync(dir, { recursive: true, force: true })
    mkdirSync(dir, { recursive: true })
    const total = await labTotal(page)
    const steps: Array<{
      index: number
      stepId: string
      sceneId: string
      say: string
      file: string
    }> = []
    for (let i = 0; i < total; i++) {
      if (i > 0) await labNext(page)
      const cur = await labCurrent(page)
      const file = `${String(i + 1).padStart(2, '0')}-${cur.sceneId}-${cur.stepId}.png`
      await page
        .locator('[data-testid=lesson-frame]')
        .screenshot({ path: join(dir, file), animations: 'disabled' })
      steps.push({ index: i, stepId: cur.stepId, sceneId: cur.sceneId, say: cur.say, file })
    }
    writeFileSync(
      join(dir, 'steps.json'),
      JSON.stringify({ ...t, total, steps, generatedAt: new Date().toISOString() }, null, 2),
    )
    await contactSheet(page, t, dir, steps, 'light')
    if (t.firstInUnit) {
      await page.emulateMedia({ colorScheme: 'dark' })
      await page.evaluate(() => {
        localStorage.setItem('cs-lab:settings', JSON.stringify({ theme: 'dark' }))
      })
      await openLesson(page, t)
      const darkDir = join(dir, 'dark')
      mkdirSync(darkDir, { recursive: true })
      const darkSteps: typeof steps = []
      for (let i = 0; i < total; i++) {
        if (i > 0) await labNext(page)
        const cur = await labCurrent(page)
        const file = `${String(i + 1).padStart(2, '0')}-${cur.sceneId}-${cur.stepId}.png`
        await page.locator('[data-testid=lesson-frame]').screenshot({
          path: join(darkDir, file),
          animations: 'disabled',
          type: 'jpeg',
          quality: 85,
        })
        darkSteps.push({
          index: i,
          stepId: cur.stepId,
          sceneId: cur.sceneId,
          say: cur.say,
          file: `dark/${file}`,
        })
      }
      await contactSheet(page, t, dir, darkSteps, 'dark')
      await page.evaluate(() => localStorage.removeItem('cs-lab:settings'))
      await page.emulateMedia({ colorScheme: 'light' })
    }
    expect(steps.length).toBe(total)
    testInfo.annotations.push({ type: 'storyboard', description: `${total} steps → ${dir}` })
  })
}

async function contactSheet(
  page: import('@playwright/test').Page,
  t: TopicTarget,
  dir: string,
  steps: Array<{ index: number; stepId: string; sceneId: string; say: string; file: string }>,
  theme: 'light' | 'dark',
) {
  const bg = theme === 'dark' ? '#1f1d1a' : '#faf8f3'
  const fg = theme === 'dark' ? '#f2efe8' : '#2a2620'
  const muted = theme === 'dark' ? '#b9b2a6' : '#6b655c'
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
    body{margin:0;background:${bg};color:${fg};font:14px/1.4 -apple-system,Inter,system-ui,sans-serif;padding:24px}
    h1{font-size:18px;margin:0 0 4px} .sub{color:${muted};margin:0 0 16px;font-size:12px}
    .grid{display:grid;grid-template-columns:repeat(3,1fr);gap:16px}
    figure{margin:0;border:1px solid ${theme === 'dark' ? '#3a3631' : '#e4dfd5'};border-radius:10px;overflow:hidden;background:${theme === 'dark' ? '#26231f' : '#fff'}}
    img{display:block;width:100%;height:auto}
    figcaption{padding:8px 10px;font-size:12px} .n{color:${muted};font-family:ui-monospace,Menlo,monospace;margin-right:6px}
  </style></head><body>
  <h1>${esc(t.module)} › ${esc(t.unitNumeral)} ${esc(t.unitTitle)} › ${esc(t.topicTitle)}</h1>
  <p class="sub">${steps.length} steps · ${theme} theme · generated ${new Date().toISOString().slice(0, 10)}</p>
  <div class="grid">${steps
    .map(
      (s) =>
        `<figure><img src="file://${dir}/${s.file}"><figcaption><span class="n">${String(s.index + 1).padStart(2, '0')} ${esc(s.sceneId)}/${esc(s.stepId)}</span>${esc(s.say)}</figcaption></figure>`,
    )
    .join('')}</div></body></html>`
  const sheetPath = join(dir, theme === 'dark' ? 'contact-dark.html' : 'contact.html')
  writeFileSync(sheetPath, html)
  const sheet = await page.context().newPage()
  await sheet.setViewportSize({ width: 1280, height: 900 })
  await sheet.goto(`file://${sheetPath}`)
  await sheet.waitForLoadState('load')
  await sheet.screenshot({
    path: join(dir, theme === 'dark' ? 'contact-dark.png' : 'contact.png'),
    fullPage: true,
  })
  await sheet.close()
  if (existsSync(sheetPath)) rmSync(sheetPath)
}

function esc(s: string): string {
  return s.replace(
    /[&<>"]/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c,
  )
}
