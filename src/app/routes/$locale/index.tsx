import { createFileRoute, Link } from '@tanstack/react-router'
import { ArrowRight } from 'lucide-react'
import { Button } from '@/ui/button'
import { modules } from '@/content/catalog'
import { flattenTopics } from '@/lesson/catalog'
import { useI18n } from '@/i18n'
import { useProgress, topicKey } from '@/settings'
import { cn } from '@/lib/utils'

export const Route = createFileRoute('/$locale/')({
  component: HomePage,
})

function HomePage() {
  const { t, tn, locale } = useI18n()
  const progress = useProgress()
  const live = modules.find((m) => m.status === 'live') ?? modules[0]
  const first = live ? flattenTopics(live)[0] : undefined

  return (
    <div className="mx-auto w-full max-w-5xl px-6 py-10 md:py-16" data-testid="home">
      <section className="max-w-2xl">
        <p className="mb-3 font-mono text-xs tracking-wider text-teal uppercase">
          {t('app.eyebrow')}
        </p>
        <h1 className="text-3xl font-semibold tracking-tight text-balance text-ink md:text-4xl">
          {t('app.title')}
        </h1>
        <p className="mt-4 text-lg text-balance text-ink-2">{t('app.tagline')}</p>
        {live && first && (
          <div className="mt-6 flex flex-wrap items-center gap-3">
            <Button asChild size="lg">
              <Link
                to="/$locale/$module/$unit/$topic"
                params={{ locale, module: live.id, unit: first.unit.id, topic: first.topic.id }}
                data-testid="cta-start"
              >
                {t('home.start', { module: live.short })} <ArrowRight />
              </Link>
            </Button>
            <Button asChild variant="ghost" size="lg">
              <Link to="/$locale/$module" params={{ locale, module: live.id }}>
                {t('home.browse')}
              </Link>
            </Button>
          </div>
        )}
      </section>

      <section className="mt-14">
        <h2 className="mb-4 text-sm font-semibold tracking-wide text-ink-3 uppercase">
          {t('nav.modules')}
        </h2>
        <ul className="grid gap-4 sm:grid-cols-2">
          {modules.map((m) => {
            const topics = flattenTopics(m)
            const done = topics.filter(
              (r) => progress.topics[topicKey(m.id, r.unit.id, r.topic.id)]?.completed,
            ).length
            const disabled = m.status === 'coming-soon'
            const card = (
              <div
                className={cn(
                  'flex h-full flex-col rounded-xl border border-line bg-card p-5 transition-colors',
                  disabled ? 'opacity-70' : 'hover:border-line-2 hover:bg-paper-3/40',
                )}
              >
                <div className="flex items-start justify-between gap-3">
                  <h3 className="text-base font-semibold text-ink">{m.title}</h3>
                  <StatusBadge status={m.status} t={t} />
                </div>
                <p className="mt-2 text-sm text-ink-2">{m.summary}</p>
                <div className="mt-auto pt-4 font-mono text-xs text-ink-3">
                  {tn('home.topicCount', topics.length)}
                  {done > 0 && (
                    <span className="ms-2 text-ok">
                      · {done}/{topics.length} ✓
                    </span>
                  )}
                </div>
              </div>
            )
            return (
              <li key={m.id} data-testid={`module-card-${m.id}`}>
                {disabled ? (
                  card
                ) : (
                  <Link
                    to="/$locale/$module"
                    params={{ locale, module: m.id }}
                    className="block h-full rounded-xl outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                  >
                    {card}
                  </Link>
                )}
              </li>
            )
          })}
        </ul>
      </section>
    </div>
  )
}

export function StatusBadge({
  status,
  t,
}: {
  status: 'live' | 'prototype' | 'coming-soon'
  t: (k: string) => string
}) {
  if (status === 'live') return null
  return (
    <span className="shrink-0 rounded-sm bg-paper-3 px-1.5 py-0.5 font-mono text-[0.65rem] tracking-wide text-ink-3 uppercase">
      {status === 'prototype' ? t('nav.prototype') : t('nav.comingSoon')}
    </span>
  )
}
