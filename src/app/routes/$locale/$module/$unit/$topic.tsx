import { createFileRoute, Link, notFound } from '@tanstack/react-router'
import { ArrowLeft, ArrowRight } from 'lucide-react'
import { findModule } from '@/content/catalog'
import { findTopic, neighbors } from '@/lesson/catalog'
import { Button } from '@/ui/button'
import { useI18n } from '@/i18n'

export const Route = createFileRoute('/$locale/$module/$unit/$topic')({
  loader: ({ params }) => {
    const module = findModule(params.module)
    const ref = module && findTopic(module, params.unit, params.topic)
    if (!module || !ref) throw notFound()
    return { module, ref, nav: neighbors(module, ref) }
  },
  component: TopicPage,
})

function TopicPage() {
  const { module, ref, nav } = Route.useLoaderData()
  const { locale } = Route.useParams()
  const { t } = useI18n()

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="topic-page">
      <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col px-4 py-5 md:px-6">
        <header className="mb-4">
          <p className="font-mono text-xs text-ink-3">
            <span className="text-teal">{ref.unit.numeral}</span> · {ref.unit.title}
          </p>
          <h1
            className="mt-1 text-2xl font-semibold tracking-tight text-ink"
            data-testid="topic-title"
          >
            {ref.topic.title}
          </h1>
          <p className="mt-1 text-ink-2">{ref.topic.summary}</p>
        </header>

        {/* Stage + transport are mounted here once the lesson player lands. */}
        <section
          aria-label={t('a11y.stage')}
          className="relative min-h-(--stage-min-h) flex-1 rounded-xl border border-line stage-grid shadow-xs"
          data-testid="stage"
        >
          <div className="absolute inset-0 grid place-items-center text-sm text-ink-3">
            {t('topic.comingSoon')}
          </div>
        </section>

        <footer className="mt-6 flex items-center justify-between gap-3 border-t border-line pt-4">
          {nav.prev ? (
            <Button asChild variant="ghost">
              <Link
                to="/$locale/$module/$unit/$topic"
                params={{
                  locale,
                  module: module.id,
                  unit: nav.prev.unit.id,
                  topic: nav.prev.topic.id,
                }}
                data-testid="prev-topic"
              >
                <ArrowLeft className="rtl:rotate-180" /> {nav.prev.topic.title}
              </Link>
            </Button>
          ) : (
            <span />
          )}
          {nav.next && (
            <Button asChild variant="outline">
              <Link
                to="/$locale/$module/$unit/$topic"
                params={{
                  locale,
                  module: module.id,
                  unit: nav.next.unit.id,
                  topic: nav.next.topic.id,
                }}
                data-testid="next-topic"
              >
                {nav.next.topic.title} <ArrowRight className="rtl:rotate-180" />
              </Link>
            </Button>
          )}
        </footer>
      </div>
    </div>
  )
}
