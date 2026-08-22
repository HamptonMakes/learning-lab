import { createFileRoute, Link, notFound } from '@tanstack/react-router'
import { Check, Circle, CircleDot } from 'lucide-react'
import { findModule } from '@/content/catalog'
import { useI18n } from '@/i18n'
import { useProgress, topicKey } from '@/settings'
import { cn } from '@/lib/utils'

export const Route = createFileRoute('/$locale/$module/')({
  loader: ({ params }) => {
    const module = findModule(params.module)
    if (!module) throw notFound()
    return { module }
  },
  component: ModulePage,
})

function ModulePage() {
  const { module } = Route.useLoaderData()
  const { locale } = Route.useParams()
  const { t } = useI18n()
  const progress = useProgress()

  return (
    <div className="mx-auto w-full max-w-4xl px-6 py-10" data-testid="module-page">
      <header className="max-w-2xl">
        <h1 className="text-3xl font-semibold tracking-tight text-ink">{module.title}</h1>
        <p className="mt-3 text-lg text-ink-2">{module.summary}</p>
        {module.status === 'coming-soon' && (
          <p className="mt-3 font-mono text-xs text-ink-3 uppercase">{t('nav.comingSoon')}</p>
        )}
      </header>
      <ol className="mt-10 space-y-8">
        {module.units.map((unit) => (
          <li key={unit.id} data-testid={`unit-${unit.id}`}>
            <div className="flex items-baseline gap-3">
              <span className="font-mono text-sm text-teal">{unit.numeral}</span>
              <h2 className="text-lg font-semibold text-ink">{unit.title}</h2>
            </div>
            {unit.summary && <p className="mt-1 ps-8 text-sm text-ink-2">{unit.summary}</p>}
            <ol className="mt-3 divide-y divide-line overflow-hidden rounded-lg border border-line bg-card">
              {unit.topics.map((topic, i) => {
                const p = progress.topics[topicKey(module.id, unit.id, topic.id)]
                const done = p?.completed ?? false
                const started = !done && (p?.lastStep ?? 0) > 0
                return (
                  <li key={topic.id}>
                    <Link
                      to="/$locale/$module/$unit/$topic"
                      params={{ locale, module: module.id, unit: unit.id, topic: topic.id }}
                      className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-paper-3/50"
                      data-testid={`topic-link-${topic.id}`}
                    >
                      {done ? (
                        <Check className="size-4 shrink-0 text-ok" />
                      ) : started ? (
                        <CircleDot className="size-4 shrink-0 text-teal" />
                      ) : (
                        <Circle className="size-4 shrink-0 text-ink-3/60" />
                      )}
                      <span className="w-6 font-mono text-xs text-ink-3">{i + 1}</span>
                      <span className={cn('font-medium text-ink')}>{topic.title}</span>
                      <span className="ms-auto hidden truncate text-sm text-ink-3 sm:inline">
                        {topic.summary}
                      </span>
                    </Link>
                  </li>
                )
              })}
            </ol>
          </li>
        ))}
      </ol>
    </div>
  )
}
