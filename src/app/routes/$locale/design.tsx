import { createFileRoute } from '@tanstack/react-router'
import type { CSSProperties, ReactNode } from 'react'
import { Button } from '@/ui/button'
import { Badge } from '@/ui/badge'
import { Kbd } from '@/ui/kbd'
import { Switch } from '@/ui/switch'
import { Slider } from '@/ui/slider'

export const Route = createFileRoute('/$locale/design')({
  component: DesignPage,
})

const SURFACES = ['paper', 'paper-2', 'paper-3', 'card', 'line', 'line-2'] as const
const HARDWARE = ['bezel', 'key', 'key-line', 'power', 'led', 'led-panel', 'led-amber'] as const
const SCREEN = ['screen', 'window', 'window-ink', 'note'] as const
const INKS = ['ink', 'ink-2', 'ink-3'] as const
const TONES = ['accent', 'ok', 'warn', 'danger'] as const
const ACTORS = ['a', 'b', 'c', 'd', 'server', 'neutral'] as const

const v = (name: string) => `var(--${name})`

/** Living style guide. English-only on purpose: it is an internal reference, not a lesson. */
function DesignPage() {
  return (
    <div className="mx-auto w-full max-w-5xl space-y-12 px-6 py-10" data-testid="design-page">
      <header>
        <p className="font-mono text-xs tracking-wider text-teal uppercase">Design system</p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight">Workbench</h1>
        <p className="mt-2 max-w-2xl text-ink-2">
          A beige computer on a desk, 1991: putty hardware with keycaps and LED readouts around a
          grey screen where every actor is a window. One CRT-cyan accent and a small semantic
          palette for actors. Tokens live in
          <code className="mx-1 rounded bg-paper-3 px-1 font-mono text-sm">
            src/styles/tokens.css
          </code>
          and every component reads from them.
        </p>
      </header>

      <Section title="Surfaces & ink">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 md:grid-cols-7">
          {SURFACES.map((s) => (
            <Swatch key={s} name={s} style={{ background: v(s) }} />
          ))}
        </div>
        <p className="mt-6 mb-2 text-xs font-semibold tracking-wide text-ink-3 uppercase">
          Hardware
        </p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 md:grid-cols-7">
          {HARDWARE.map((s) => (
            <Swatch key={s} name={s} style={{ background: v(s) }} />
          ))}
        </div>
        <p className="mt-6 mb-2 text-xs font-semibold tracking-wide text-ink-3 uppercase">Screen</p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 md:grid-cols-7">
          {SCREEN.map((s) => (
            <Swatch key={s} name={s} style={{ background: v(s) }} />
          ))}
        </div>
        <div className="mt-6 flex flex-wrap items-center gap-4">
          <Button variant="key">Keycap</Button>
          <Button variant="power" size="icon-lg" aria-label="Power">
            ▶
          </Button>
          <span className="led-panel px-2 py-0.5 text-[22px] leading-7 tracking-wide">t=2</span>
          <div className="w-56 window">
            <div className="title-bar">
              <span className="ms-2 bg-window px-1.5 text-[13px] leading-5 font-semibold">
                Alice
              </span>
            </div>
            <div className="p-3 font-mono text-sm">value · t=1</div>
          </div>
          <div className="note p-3 font-mono text-xs">a sticky note</div>
        </div>
        <div className="mt-4 flex flex-wrap gap-6">
          {INKS.map((i) => (
            <p key={i} style={{ color: v(i) }}>
              <span className="font-mono text-xs">{i}</span> — The quick brown fox merges the lazy
              doc.
            </p>
          ))}
        </div>
      </Section>

      <Section title="Tones">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {TONES.map((tn) => (
            <div
              key={tn}
              className="rounded-lg border border-line p-3"
              style={{ background: v(`${tn}-soft`) }}
            >
              <div className="mb-2 h-6 rounded" style={{ background: v(tn) }} />
              <span className="font-mono text-xs" style={{ color: v(tn) }}>
                {tn}
              </span>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Actors">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-6">
          {ACTORS.map((a) => (
            <div
              key={a}
              className="rounded-lg border border-line p-3"
              style={{ background: v(`actor-${a}-soft`) }}
            >
              <div className="mb-2 size-8 rounded-full" style={{ background: v(`actor-${a}`) }} />
              <span className="font-mono text-xs" style={{ color: v(`actor-${a}`) }}>
                actor-{a}
              </span>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Type">
        <div className="space-y-2">
          <p className="text-3xl font-semibold tracking-tight">Heading / 30 semibold</p>
          <p className="text-2xl font-semibold tracking-tight">Heading / 24 semibold</p>
          <p className="text-lg">Lead / 18 regular — one or two short sentences per step.</p>
          <p className="text-base">Body / 16 regular — Simple Technical English.</p>
          <p className="text-sm text-ink-2">Small / 14 — secondary labels.</p>
          <p className="font-mono text-sm">
            mono / 14 — <span className="text-actor-a">alice</span>.doc.title = &quot;Hello&quot; ·
            ts=3
          </p>
          <p className="font-mono text-xs text-ink-3">mono / 12 — sidecar metadata</p>
        </div>
      </Section>

      <Section title="Controls">
        <div className="flex flex-wrap items-center gap-3">
          <Button>Primary</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="outline">Outline</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="destructive">Danger</Button>
          <Badge>Badge</Badge>
          <Badge variant="secondary">Secondary</Badge>
          <Badge variant="outline">Outline</Badge>
          <Kbd>←</Kbd>
          <Kbd>Space</Kbd>
          <Switch defaultChecked aria-label="demo switch" />
          <div className="w-40">
            <Slider defaultValue={[50]} aria-label="demo slider" />
          </div>
        </div>
      </Section>

      <Section title="Stage card">
        <div className="relative h-64 rounded-xl border border-line stage-surface p-6 shadow-xs">
          <div className="flex gap-8">
            <DemoActor name="Alice" tone="a" value="Hello" ts={3} />
            <DemoActor name="Bob" tone="b" value="Howdy" ts={4} />
          </div>
        </div>
      </Section>
    </div>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="mb-3 text-sm font-semibold tracking-wide text-ink-3 uppercase">{title}</h2>
      {children}
    </section>
  )
}

function Swatch({ name, style }: { name: string; style: CSSProperties }) {
  return (
    <div className="space-y-1">
      <div className="h-12 rounded-md border border-line" style={style} />
      <span className="font-mono text-xs text-ink-2">{name}</span>
    </div>
  )
}

function DemoActor({
  name,
  tone,
  value,
  ts,
}: {
  name: string
  tone: string
  value: string
  ts: number
}) {
  const color = v(`actor-${tone}`)
  const soft = v(`actor-${tone}-soft`)
  return (
    <div
      className="w-44 rounded-lg border bg-card shadow-xs"
      style={{ borderColor: `color-mix(in oklch, ${color} 40%, transparent)` }}
    >
      <div
        className="flex items-center gap-2 rounded-t-lg px-3 py-1.5 text-xs font-semibold"
        style={{ background: soft, color }}
      >
        <span className="size-2 rounded-full" style={{ background: color }} /> {name}
      </div>
      <div className="p-3 font-mono text-sm">
        <div className="flex items-baseline justify-between">
          <span className="text-ink-3">title</span>
          <span className="text-ink">&quot;{value}&quot;</span>
        </div>
        <div className="mt-1 text-[0.65rem] text-ink-3">ts={ts}</div>
      </div>
    </div>
  )
}
