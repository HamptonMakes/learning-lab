/**
 * Renders public/og.png (1200x630, the social card) from an inline Workbench-styled HTML page.
 * Run manually when the branding changes: node scripts/generate-og.mjs
 */
import { chromium } from '@playwright/test'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'

const out = resolve(fileURLToPath(new URL('..', import.meta.url)), 'public/og.png')
const html = `<!doctype html><meta charset="utf-8">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wght@500;700&family=JetBrains+Mono:wght@500;700&display=swap">
<style>
  * { margin: 0; box-sizing: border-box; }
  body { width: 1200px; height: 630px; background: #e9e3d6; font-family: Archivo, sans-serif;
         display: flex; align-items: center; gap: 56px; padding: 64px; color: #2b2721; }
  .copy { flex: 1; }
  .eyebrow { font-family: 'JetBrains Mono', monospace; font-size: 20px; letter-spacing: 3px;
             color: #1d7480; text-transform: uppercase; margin-bottom: 18px; }
  h1 { font-size: 76px; line-height: 1.02; font-weight: 700; letter-spacing: -2px; }
  .sub { margin-top: 22px; font-size: 26px; color: #5f584e; max-width: 520px; line-height: 1.35; }
  .monitor { width: 430px; background: #dcd6c6; border-radius: 18px; padding: 16px;
             box-shadow: inset 0 0 0 2px #b9b19f, 0 6px 0 #b3ab99; }
  .screen { background: #e2e5e9; border-radius: 4px; padding: 22px; position: relative; }
  .win { background: #fff; border: 2px solid #22242a; box-shadow: 4px 4px 0 #22242a; margin-bottom: 18px; }
  .bar { border-bottom: 2px solid #22242a; padding: 6px 10px; display: flex; align-items: center; gap: 8px;
         background: repeating-linear-gradient(to bottom, #fff 0 3px, #22242a 3px 5px); }
  .bar b { background: #fff; padding: 0 8px; font-size: 17px; display: flex; align-items: center; gap: 7px; }
  .dot { width: 11px; height: 11px; border-radius: 50%; display: inline-block; }
  .body { padding: 12px 14px; font-family: 'JetBrains Mono', monospace; font-size: 19px; }
  .side { color: #8a8274; font-size: 15px; margin-left: 10px; }
  .hl { box-shadow: inset 0 0 0 2px #1d7480; border-radius: 3px; padding: 1px 6px; }
  .led { position: absolute; top: 14px; right: 16px; background: #211f1b; color: #ff5722;
         font-family: 'JetBrains Mono', monospace; font-weight: 700; font-size: 22px;
         padding: 4px 12px; border-radius: 4px; letter-spacing: 2px; }
</style>
<body>
  <div class="copy">
    <div class="eyebrow">Hampton's CS Concept Lab</div>
    <h1>Press play on computer science.</h1>
    <div class="sub">Animated lessons on CRDTs &amp; friends — every value computed by real code.</div>
  </div>
  <div class="monitor"><div class="screen">
    <div class="led">t=2</div>
    <div class="win"><div class="bar"><b><span class="dot" style="background:#e5484d"></span>Alice</b></div>
      <div class="body">status&nbsp; <span class="hl">Lunch</span><span class="side">t=2 · alice</span></div></div>
    <div class="win" style="margin-bottom:0"><div class="bar"><b><span class="dot" style="background:#3b82f6"></span>Bob</b></div>
      <div class="body">status&nbsp; Lunch<span class="side">t=2 · alice</span></div></div>
  </div></div>
</body>`
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 })
await page.setContent(html, { waitUntil: 'networkidle' })
await page.waitForTimeout(600)
await page.screenshot({ path: out })
await browser.close()
console.log('og:', out)
