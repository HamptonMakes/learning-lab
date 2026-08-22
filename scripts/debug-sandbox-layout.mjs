import { chromium } from '@playwright/test'
const url = process.argv[2]
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
await page.goto(url)
await page.waitForTimeout(1500)
await page.getByTestId('try-it-open').click()
await page.waitForTimeout(2500)
const info = await page.evaluate(() => {
  const dlg = document.querySelector('[role=dialog]')
  const q = (sel) => dlg.querySelector(sel)
  const r = (el) => {
    if (!el) return null
    const b = el.getBoundingClientRect()
    return {
      x: Math.round(b.x),
      y: Math.round(b.y),
      w: Math.round(b.width),
      h: Math.round(b.height),
    }
  }
  const cs = (el, p) => (el ? getComputedStyle(el)[p] : null)
  const stage = q('[data-stage]'),
    layout = q('.stage-layout'),
    actors = q('.stage-actors')
  return {
    stage: r(stage),
    layout: {
      rect: r(layout),
      display: cs(layout, 'display'),
      containerType: cs(layout, 'container-type'),
    },
    actors: {
      rect: r(actors),
      display: cs(actors, 'display'),
      gtc: cs(actors, 'grid-template-columns'),
      gta: cs(actors, 'grid-template-areas'),
      layoutAttr: actors?.getAttribute('data-layout'),
    },
    cards: [...dlg.querySelectorAll('[data-actor]')].map((el) => ({
      id: el.getAttribute('data-actor'),
      slot: el.getAttribute('data-slot'),
      rect: r(el),
      gridArea: cs(el, 'grid-area'),
      transform: cs(el, 'transform'),
    })),
    boards: [...dlg.querySelectorAll('[data-board]')].map((el) => ({
      id: el.getAttribute('data-board'),
      rect: r(el),
    })),
    gutter: {
      rect: r(q('.stage-boards')),
      display: cs(q('.stage-boards'), 'display'),
      position: cs(q('.stage-boards'), 'position'),
      flex: cs(q('.stage-boards'), 'flex'),
      width: cs(q('.stage-boards'), 'inline-size'),
    },
    layoutFlex: {
      dir: cs(layout, 'flex-direction'),
      alignItems: cs(layout, 'align-items'),
      width: cs(layout, 'inline-size'),
    },
    actorsFlex: {
      flex: cs(actors, 'flex'),
      alignSelf: cs(actors, 'align-self'),
      minInline: cs(actors, 'min-inline-size'),
      inline: cs(actors, 'inline-size'),
    },
  }
})
console.log(JSON.stringify(info, null, 1))
await browser.close()
