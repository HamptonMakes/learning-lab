import { chromium } from '@playwright/test'
const [url, w = '900'] = process.argv.slice(2)
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: Number(w), height: 1000 } })
await page.goto(url)
await page.waitForTimeout(2000)
const info = await page.evaluate(() => {
  const r = (el) => {
    const b = el.getBoundingClientRect()
    return {
      x: Math.round(b.x),
      y: Math.round(b.y),
      w: Math.round(b.width),
      h: Math.round(b.height),
    }
  }
  const cs = (el, p) => getComputedStyle(el)[p]
  const actors = document.querySelector('.stage-actors')
  return {
    stage: r(document.querySelector('[data-stage]')),
    layout: { dir: cs(document.querySelector('.stage-layout'), 'flex-direction') },
    actors: {
      rect: r(actors),
      gtc: cs(actors, 'grid-template-columns'),
      gta: cs(actors, 'grid-template-areas'),
      flow: cs(actors, 'grid-auto-flow'),
      layout: actors.getAttribute('data-layout'),
    },
    cards: [...document.querySelectorAll('[data-actor]')].map((el) => ({
      id: el.getAttribute('data-actor'),
      slot: el.getAttribute('data-slot'),
      rect: r(el),
      area: cs(el, 'grid-area'),
      display: cs(el, 'display'),
      opacity: cs(el, 'opacity'),
      transform: cs(el, 'transform'),
      visibility: cs(el, 'visibility'),
    })),
  }
})
console.log(JSON.stringify(info, null, 1))
await browser.close()
