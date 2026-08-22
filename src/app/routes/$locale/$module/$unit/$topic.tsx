import { useMemo } from 'react'
import { createFileRoute, Link, notFound } from '@tanstack/react-router'
import { AnimatePresence, motion } from 'motion/react'
import { ArrowLeft, ArrowRight, CheckCircle2, TriangleAlert } from 'lucide-react'
import { z } from 'zod'
import { findModule } from '@/content/catalog'
import { loadTopic } from '@/content/registry'
import { findTopic, neighbors } from '@/lesson/catalog'
import type { Frame, Topic } from '@/lesson/types'
import { buildTimeline } from '@/lesson/reducer/timeline'
import { usePlayer, useKeyboardTransport, useLabHook } from '@/lesson/player'
import { Stage } from '@/stage'
import { Button } from '@/ui/button'
import { useI18n } from '@/i18n'
import { useSetting } from '@/settings'
import { TransportBar } from '@/app/components/transport-bar'
import { Narration } from '@/app/components/narration'
import { TopicPanels } from '@/app/components/topic-panels'
import { TryIt } from '@/app/components/try-it/TryIt'

// TanStack Router JSON-parses search values, so `?lab=1` arrives as the number 1; normalise.
const flag = (on: string) =>
  z.preprocess(
    (v) => (v === undefined || v === null ? undefined : String(v)),
    z.literal(on).optional(),
  )
const SearchSchema = z.object({
  step: z.coerce.number().int().min(1).optional(),
  lab: flag('1'),
  motion: flag('off'),
})

export const Route = createFileRoute('/$locale/$module/$unit/$topic')({
  validateSearch: (search: Record<string, unknown>) => SearchSchema.parse(search),
  loader: async ({ params }) => {
    const module = findModule(params.module)
    const ref = module && findTopic(module, params.unit, params.topic)
    if (!module || !ref) throw notFound()
    const topic = await loadTopic(params.module, params.unit, params.topic)
    return { module, ref, nav: neighbors(module, ref), topic }
  },
  component: TopicPage,
})

function TopicPage() {
  const { module, ref, nav, topic } = Route.useLoaderData()
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
          <p className="mt-1 text-ink-2">{topic?.goal ?? ref.topic.summary}</p>
        </header>

        {topic ? (
          <LessonPlayer
            key={`${module.id}/${ref.unit.id}/${ref.topic.id}`}
            topic={topic}
            moduleId={module.id}
            unitId={ref.unit.id}
            topicId={ref.topic.id}
            locale={locale}
          />
        ) : (
          <section
            aria-label={t('a11y.stage')}
            className="relative min-h-(--stage-min-h) flex-1 rounded-xl border border-line stage-grid shadow-xs"
            data-testid="stage"
          >
            <div className="absolute inset-0 grid place-items-center text-sm text-ink-3">
              {t('topic.comingSoon')}
            </div>
          </section>
        )}

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

function LessonPlayer({
  topic,
  moduleId,
  unitId,
  topicId,
  locale,
}: {
  topic: Topic
  moduleId: string
  unitId: string
  topicId: string
  locale: string
}) {
  const { t, dir } = useI18n()
  const search = Route.useSearch()
  const navigate = Route.useNavigate()
  const [reducedPref] = useSetting('reducedMotion')

  const built = useMemo<{ frames: Frame[]; error?: string }>(() => {
    try {
      return { frames: buildTimeline(topic, { assertMode: 'warn' }) }
    } catch (e) {
      return { frames: [], error: e instanceof Error ? e.message : String(e) }
    }
  }, [topic])

  const player = usePlayer(built.frames, {
    initialIndex: (search.step ?? 1) - 1,
    topic: { module: moduleId, unit: unitId, topic: topicId },
    locale,
    forceInstant: search.motion === 'off',
    onIndexChange: (index) => {
      void navigate({ search: (s) => ({ ...s, step: index + 1 }), replace: true })
    },
  })
  useKeyboardTransport(player, { enabled: true, dir })
  useLabHook(player, { enabled: search.lab === '1' })

  const frame = player.frame
  if (built.error || built.frames.length === 0 || !frame) {
    return (
      <section
        className="relative min-h-(--stage-min-h) flex-1 rounded-xl border border-danger/40 stage-grid shadow-xs"
        data-testid="stage"
        data-error
      >
        <div className="absolute inset-0 grid place-items-center p-6 text-center">
          <div className="max-w-md rounded-lg border border-danger/40 bg-danger-soft p-4 text-sm text-ink">
            <TriangleAlert className="mx-auto mb-2 size-5 text-danger" />
            <p className="font-medium">This lesson failed to build.</p>
            <p className="mt-1 font-mono text-xs break-words text-ink-2">
              {built.error ?? 'No steps'}
            </p>
          </div>
        </div>
      </section>
    )
  }

  const instant = player.instant
  const scene = topic.scenes.find((s) => s.id === frame.sceneId)
  const multiScene = topic.scenes.length > 1
  const ended = player.state.status === 'ended'

  return (
    <div
      className="flex flex-1 flex-col gap-3"
      data-testid="lesson-player"
      data-scene={frame.sceneId}
      data-step={frame.step.id}
    >
      {multiScene && (
        <ol className="flex flex-wrap gap-1.5" aria-label={t('topic.scenes')}>
          {topic.scenes.map((s, i) => {
            const first = built.frames.findIndex((f) => f.sceneId === s.id)
            const active = s.id === frame.sceneId
            return (
              <li key={s.id}>
                <button
                  type="button"
                  onClick={() => player.seek(first)}
                  aria-current={active ? 'true' : undefined}
                  data-testid={`scene-tab-${s.id}`}
                  className={
                    active
                      ? 'rounded-full bg-teal px-3 py-1 text-xs font-medium text-teal-ink'
                      : 'rounded-full border border-line px-3 py-1 text-xs text-ink-2 hover:bg-paper-3'
                  }
                >
                  {i + 1}. {s.title ?? s.id}
                </button>
              </li>
            )
          })}
        </ol>
      )}

      <div className="flex flex-1 flex-col gap-3" data-testid="lesson-frame">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={frame.sceneId}
            initial={instant ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={instant ? undefined : { opacity: 0 }}
            transition={{ duration: instant ? 0 : 0.2 / player.state.speed }}
            className="flex flex-1 flex-col"
          >
            <Stage
              frame={frame}
              speed={player.state.speed}
              reducedSetting={reducedPref === 'on'}
              instant={instant}
              dir={dir}
              className="flex-1"
            />
          </motion.div>
        </AnimatePresence>

        <Narration say={frame.step.say} stepId={frame.step.id} />

        <TransportBar
          index={player.state.index}
          total={player.state.total}
          status={player.state.status}
          speed={player.state.speed}
          onPrev={player.prev}
          onNext={player.next}
          onToggle={player.toggle}
          onRestart={player.restart}
          onSeek={player.seek}
          onSpeed={player.setSpeed}
          stepIds={built.frames.map((f) => `${f.sceneId}/${f.step.id}`)}
        />
      </div>

      {ended && (
        <output
          className="flex items-center gap-2 rounded-xl border border-ok/40 bg-ok-soft px-4 py-2 text-sm text-ink"
          data-testid="topic-complete"
          aria-live="polite"
        >
          <CheckCircle2 className="size-4 text-ok" /> {t('topic.complete')}
        </output>
      )}

      <TopicPanels
        whenToUse={topic.whenToUse}
        whenNotToUse={topic.whenNotToUse}
        realWorld={topic.realWorld}
        tryIt={
          Object.values(frame.world.replicas).some((slots) => Object.keys(slots).length > 0) ? (
            <TryIt
              frame={frame}
              topicRef={{ module: moduleId, unit: unitId, topic: topicId }}
              sceneId={frame.sceneId}
              tryIt={scene?.tryIt}
            />
          ) : undefined
        }
        className="mt-2"
      />
    </div>
  )
}
