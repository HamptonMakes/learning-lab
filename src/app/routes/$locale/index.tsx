/**
 * The landing page — the shop window of the lab. A hero with the pitch and a live, real demo
 * (HeroDemo: the LWW-register world on the flow autopilot), the modules as a shelf of labeled
 * floppy disks, a "tech specs" plate, and the open-source footer. Workbench through and through:
 * keycap CTAs (the power key is literally "press play"), LED tags, putty plates.
 */
import { createFileRoute, Link } from '@tanstack/react-router'
import { ArrowRight, Play } from 'lucide-react'
import { Button } from '@/ui/button'
import { Kbd } from '@/ui/kbd'
import { modules } from '@/content/catalog'
import { flattenTopics } from '@/lesson/catalog'
import type { ModuleMeta } from '@/lesson/catalog'
import { useI18n } from '@/i18n'
import { useProgress, topicKey } from '@/settings'
import { cn } from '@/lib/utils'
import { HeroDemo } from '@/app/components/landing/HeroDemo'
import portrait from '@/app/components/landing/hampton.jpg'

export const Route = createFileRoute('/$locale/')({
  component: HomePage,
})

const REPO_URL = 'https://github.com/HamptonMakes/learning-lab'

/** Floppy body hue per module; falls back to the neutral putty key colour. */
const DISK_HUES: Record<string, string> = {
  crdts: 'var(--accent)',
  uuids: 'var(--actor-c)',
  regex: 'var(--actor-a)',
  'columnar-stores': 'var(--actor-d)',
}

function HomePage() {
  const { t, locale } = useI18n()
  const live = modules.find((m) => m.status === 'live') ?? modules[0]
  const first = live ? flattenTopics(live)[0] : undefined

  return (
    <div className="mx-auto w-full max-w-6xl px-6 py-10 md:py-14" data-testid="home">
      {/* ── hero: the pitch + the proof ─────────────────────────────────────────────── */}
      <section className="grid items-center gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,560px)]">
        <div>
          <p className="mb-3 font-mono text-xs tracking-wider text-teal uppercase">
            {t('app.title')}
          </p>
          <h1 className="text-4xl font-bold tracking-tight text-balance text-ink md:text-5xl">
            {t('landing.headline')}
          </h1>
          <p className="mt-4 max-w-xl text-lg text-balance text-ink-2">{t('landing.sub')}</p>
          {live && first && (
            <div className="mt-7 flex flex-wrap items-center gap-3">
              <Button asChild variant="power" size="lg" className="px-4">
                <Link
                  to="/$locale/$module/$unit/$topic"
                  params={{ locale, module: live.id, unit: first.unit.id, topic: first.topic.id }}
                  data-testid="cta-start"
                >
                  <Play data-icon="inline-start" className="fill-current" />
                  {t('landing.start', { module: live.short })}
                </Link>
              </Button>
              <Button asChild variant="key" size="lg" className="px-4">
                <Link to="/$locale/$module" params={{ locale, module: live.id }}>
                  {t('landing.browse')} <ArrowRight data-icon="inline-end" />
                </Link>
              </Button>
            </div>
          )}
          <p className="mt-5 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-ink-3">
            <Kbd>Space</Kbd> {t('landing.hintPlay')} · <Kbd>←</Kbd>
            <Kbd>→</Kbd> {t('landing.hintStep')} · {t('landing.hintSandbox')}
          </p>
        </div>
        <HeroDemo />
      </section>

      {/* ── the disk shelf ──────────────────────────────────────────────────────────── */}
      <section className="mt-16">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-sm font-semibold tracking-widest text-ink-3 uppercase">
            {t('landing.shelf')}
          </h2>
          <p className="font-mono text-xs text-ink-3">{t('landing.shelfNote')}</p>
        </div>
        <ul className="mt-5 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {modules.map((m) => (
            <DiskItem key={m.id} module={m} locale={locale} />
          ))}
        </ul>
      </section>

      {/* ── tech specs plate ────────────────────────────────────────────────────────── */}
      <section className="mt-16 rounded-lg border border-line-2 bg-paper-2 p-6 shadow-[inset_0_1px_0_var(--key)] md:p-8">
        <h2 className="font-mono text-xs font-semibold tracking-widest text-ink-3 uppercase">
          {t('landing.specs')}
        </h2>
        <dl className="mt-5 grid gap-8 md:grid-cols-3">
          {(['real', 'read', 'hands'] as const).map((k) => (
            <div key={k}>
              <dt className="text-base font-semibold text-ink">{t(`landing.spec.${k}`)}</dt>
              <dd className="mt-1.5 text-sm leading-relaxed text-ink-2">
                {t(`landing.spec.${k}Text`)}
              </dd>
            </div>
          ))}
        </dl>
      </section>

      {/* ── the person behind it ────────────────────────────────────────────────────── */}
      <section
        className="mt-16 grid items-center gap-8 md:grid-cols-[auto_minmax(0,1fr)]"
        data-testid="landing-about"
      >
        <div className="w-44 -rotate-1 justify-self-center window p-0 md:justify-self-start rtl:rotate-1">
          <div className="title-bar" data-photo-title="">
            <span className="ms-2 bg-window px-1.5 font-mono text-[11px] leading-4 text-ink">
              hampton.jpg
            </span>
          </div>
          <img
            src={portrait}
            alt={t('landing.about.name')}
            width={460}
            height={460}
            className="block w-full"
          />
        </div>
        <div className="max-w-2xl">
          <h2 className="text-2xl font-bold tracking-tight text-ink">
            {t('landing.about.heading')}
          </h2>
          <p className="mt-3 text-base leading-relaxed text-ink-2">{t('landing.about.body')}</p>
          <p className="mt-3 font-mono text-xs text-ink-3">
            {t('landing.about.name')} · {t('landing.about.role')}
          </p>
        </div>
      </section>

      {/* ── open source footer ──────────────────────────────────────────────────────── */}
      <section className="mt-16 flex flex-wrap items-center justify-between gap-4 border-t border-line pt-6">
        <p className="max-w-xl text-sm text-ink-2">{t('landing.openSource')}</p>
        <div className="flex items-center gap-2">
          <Button asChild variant="key" size="sm">
            <a href={REPO_URL} target="_blank" rel="noreferrer" data-testid="landing-github">
              {t('landing.github')}
            </a>
          </Button>
          <Button asChild variant="key" size="sm">
            <a href="https://hamptonmakes.com" target="_blank" rel="noreferrer">
              {t('footer.madeBy')}
            </a>
          </Button>
        </div>
      </section>
    </div>
  )
}

/** One module as a 3.5″ floppy: colored body, metal shutter, ruled label, progress on the label. */
function DiskItem({ module: m, locale }: { module: ModuleMeta; locale: string }) {
  const { t, tn } = useI18n()
  const progress = useProgress()
  const topics = flattenTopics(m)
  const done = topics.filter(
    (r) => progress.topics[topicKey(m.id, r.unit.id, r.topic.id)]?.completed,
  ).length
  const disabled = m.status === 'coming-soon'
  const disk = (
    <div
      className={cn(
        'group relative aspect-[10/9] rounded-md border border-window-ink/60 p-3 shadow-(--shadow-card)',
        disabled && 'opacity-70 saturate-50',
      )}
      style={{ background: DISK_HUES[m.id] ?? 'var(--key-2)' }}
    >
      {/* the metal shutter, read window offset to one side */}
      <div className="absolute start-1/2 top-0 h-11 w-24 -translate-x-1/2 rounded-b-[3px] bg-linear-to-b from-metal to-metal-2 shadow-[inset_0_-1px_0_rgba(0,0,0,0.25)] transition-transform duration-200 motion-safe:group-hover:translate-y-[-6px] rtl:translate-x-1/2">
        <div className="absolute inset-y-2 start-3.5 w-6 rounded-[2px] bg-ink/70" />
      </div>
      {/* the label */}
      <div className="absolute inset-x-3 top-[42%] bottom-3 overflow-hidden rounded-[3px] border border-ink/15 bg-card [background-image:repeating-linear-gradient(to_bottom,transparent_0_1.24rem,var(--line)_1.24rem_calc(1.24rem+1px))] px-2.5 py-2">
        <div className="flex items-start justify-between gap-2">
          <h3 className="truncate text-[15px] leading-5 font-bold text-ink">{m.short}</h3>
          {m.status !== 'live' && (
            <span className="shrink-0 rounded-[2px] border border-danger/50 px-1 py-px font-mono text-[9px] tracking-wider text-danger uppercase">
              {m.status === 'prototype' ? t('nav.prototype') : t('nav.comingSoon')}
            </span>
          )}
        </div>
        <p className="mt-[3px] line-clamp-2 text-[11.5px] leading-[1.24rem] text-ink-2">
          {m.summary}
        </p>
        <p className="absolute inset-x-2.5 bottom-1.5 font-mono text-[10px] text-ink-3">
          {tn('home.topicCount', topics.length)}
          {done > 0 && (
            <span className="ms-2 text-ok">
              {done}/{topics.length} ✓
            </span>
          )}
        </p>
      </div>
    </div>
  )
  return (
    <li data-testid={`module-card-${m.id}`}>
      {disabled ? (
        disk
      ) : (
        <Link
          to="/$locale/$module"
          params={{ locale, module: m.id }}
          aria-label={m.title}
          className="block rounded-md outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          {disk}
        </Link>
      )}
    </li>
  )
}
