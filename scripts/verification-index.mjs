// Builds verification/index.html from the per-topic steps.json files written by `pnpm verify`.
import { readdirSync, readFileSync, statSync, writeFileSync, existsSync } from 'node:fs'
import { join, relative } from 'node:path'

const ROOT = join(process.cwd(), 'verification')
if (!existsSync(ROOT)) {
  console.error('verification/ does not exist — run `pnpm verify` first')
  process.exit(1)
}
const topics = []
for (const mod of readdirSync(ROOT)) {
  const mp = join(ROOT, mod)
  if (!statSync(mp).isDirectory()) continue
  for (const unit of readdirSync(mp)) {
    const up = join(mp, unit)
    if (!statSync(up).isDirectory()) continue
    for (const topic of readdirSync(up)) {
      const tp = join(up, topic)
      const sj = join(tp, 'steps.json')
      if (!existsSync(sj)) continue
      const data = JSON.parse(readFileSync(sj, 'utf8'))
      topics.push({
        ...data,
        dir: relative(ROOT, tp),
        hasDark: existsSync(join(tp, 'contact-dark.jpg')),
      })
    }
  }
}
topics.sort((a, b) =>
  `${a.module}/${a.unitNumeral}/${a.topicTitle}`.localeCompare(
    `${b.module}/${b.unitNumeral}/${b.topicTitle}`,
  ),
)
const esc = (s) =>
  String(s).replace(
    /[&<>"]/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c],
  )
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Verification storyboards</title>
<style>body{margin:0;padding:32px;background:#faf8f3;color:#2a2620;font:15px/1.5 -apple-system,Inter,system-ui,sans-serif;max-width:1100px}
h1{font-size:22px;margin:0 0 6px}.sub{color:#6b655c;margin:0 0 24px}h2{font-size:16px;margin:28px 0 10px;color:#1d5d66}
.t{display:flex;gap:16px;align-items:flex-start;border:1px solid #e4dfd5;border-radius:10px;background:#fff;padding:12px;margin-bottom:12px}
.t img{width:320px;height:auto;border-radius:6px;border:1px solid #e4dfd5}.t h3{margin:0 0 4px;font-size:15px}.t p{margin:0 0 6px;color:#6b655c;font-size:13px}
.t a{color:#1d5d66}.steps{columns:2;font-size:12px;color:#2a2620;margin:8px 0 0;padding-left:18px}</style></head><body>
<h1>Verification storyboards</h1><p class="sub">${topics.length} topics · ${topics.reduce((n, t) => n + t.total, 0)} steps · generated ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC. Every frame below was rendered by the real app in Chromium (reduced motion) and walked step by step through <code>window.__lab</code>.</p>
${topics
  .map(
    (t) =>
      `<div class="t"><a href="${t.dir}/contact.jpg"><img src="${t.dir}/contact.jpg" alt="contact sheet"></a><div><h3>${esc(t.module)} › ${esc(t.unitNumeral)} ${esc(t.unitTitle)} › ${esc(t.topicTitle)}</h3><p>${t.total} steps · <a href="${t.dir}/contact.jpg">light</a>${t.hasDark ? ` · <a href="${t.dir}/contact-dark.jpg">dark</a>` : ''} · <a href="${t.dir}/steps.json">steps.json</a></p><ol class="steps">${t.steps.map((s) => `<li><a href="${t.dir}/${s.file}">${esc(s.sceneId)}/${esc(s.stepId)}</a> — ${esc(s.say)}</li>`).join('')}</ol></div></div>`,
  )
  .join('\n')}
</body></html>`
writeFileSync(join(ROOT, 'index.html'), html)
console.log(`verification/index.html: ${topics.length} topics`)
