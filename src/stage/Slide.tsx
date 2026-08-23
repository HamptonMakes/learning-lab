/**
 * Keynote-style slides the stage draws for presentation frames: the title screen ("what is this?")
 * and the closing summary (when to use / when not to use / in the real world).
 */
import { ArrowRight, Check, Globe, X } from 'lucide-react'
import { motion } from 'motion/react'
import type { Slide } from '@/lesson/types'
import { useStageMotion } from './motion'
import { cn } from '@/lib/utils'
import { useT } from '@/i18n'

export function SlideView({ slide }: { slide: Slide }) {
  const { tr, off } = useStageMotion()
  const enter = off ? undefined : { opacity: 0, y: 8 }
  return (
    <div
      className="flex min-h-(--stage-min-h) items-center justify-center px-10 py-10"
      data-slide={slide.kind}
    >
      <motion.div
        key={slide.kind === 'intro' ? 'intro' : slide.kind === 'rules' ? 'rules' : slide.heading}
        initial={enter ?? false}
        animate={{ opacity: 1, y: 0 }}
        transition={tr('enter')}
        className="w-full max-w-3xl"
      >
        {slide.kind === 'intro' ? (
          <Intro slide={slide} />
        ) : slide.kind === 'rules' ? (
          <Rules slide={slide} />
        ) : (
          <Summary slide={slide} />
        )}
      </motion.div>
    </div>
  )
}

function Intro({ slide }: { slide: Extract<Slide, { kind: 'intro' }> }) {
  return (
    <div className="text-center">
      <h2
        className="text-4xl font-semibold tracking-tight text-balance text-ink md:text-5xl"
        data-slide-title
      >
        {slide.title}
      </h2>
      <p
        className="mx-auto mt-5 max-w-2xl text-xl leading-snug text-balance text-ink-2"
        data-slide-subtitle
      >
        {slide.subtitle}
      </p>
      {slide.goal && (
        <p className="mx-auto mt-6 max-w-xl text-base text-balance text-ink-3" data-slide-goal>
          {slide.goal}
        </p>
      )}
    </div>
  )
}

function Summary({ slide }: { slide: Extract<Slide, { kind: 'summary' }> }) {
  const tone = slide.tone ?? 'info'
  const Icon = tone === 'ok' ? Check : tone === 'danger' ? X : Globe
  const color = tone === 'ok' ? 'text-ok' : tone === 'danger' ? 'text-danger' : 'text-teal'
  return (
    <div className="mx-auto max-w-2xl">
      <h2
        className={cn('flex items-center gap-3 text-3xl font-semibold tracking-tight text-ink')}
        data-slide-heading
      >
        <Icon className={cn('size-7 shrink-0', color)} aria-hidden="true" />
        {slide.heading}
      </h2>
      {slide.bullets && (
        <ul className="mt-6 space-y-3 text-lg leading-snug text-ink-2" data-slide-bullets>
          {slide.bullets.map((b, i) => (
            <li key={i} className="flex gap-3">
              <span
                className={cn(
                  'mt-2.5 size-2 shrink-0 rounded-full',
                  tone === 'ok' ? 'bg-ok' : tone === 'danger' ? 'bg-danger' : 'bg-teal',
                )}
                aria-hidden="true"
              />
              <span>{b}</span>
            </li>
          ))}
        </ul>
      )}
      {slide.text && (
        <p className="mt-6 text-xl leading-snug text-ink-2" data-slide-text>
          {slide.text}
        </p>
      )}
    </div>
  )
}

/** "How it works": the data structure as an object with its sub-attributes, the rules, and a call to action. */
function Rules({ slide }: { slide: Extract<Slide, { kind: 'rules' }> }) {
  const t = useT()
  return (
    <div className="mx-auto w-full max-w-3xl" data-slide-rules>
      <h2 className="text-3xl font-semibold tracking-tight text-ink">{slide.heading}</h2>
      <div
        className={cn(
          'mt-6 grid gap-8',
          slide.shape ? 'md:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]' : '',
        )}
      >
        {slide.shape && (
          <div data-slide-shape>
            <p className="mb-2 text-xs font-semibold tracking-wide text-ink-3 uppercase">
              {t('slide.shape')}
            </p>
            <div className="window">
              <div className="title-bar" data-shape-title="">
                <span className="ms-2 bg-window px-1.5 font-mono text-[13px] leading-5 text-ink">
                  {slide.shape.name}
                </span>
              </div>
              <div className="p-4">
                <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2">
                  {slide.shape.fields.map((f) => {
                    const isValue =
                      f.role === 'value' || (f.role === undefined && f.key === 'value')
                    return (
                      <div key={f.key} className="contents" data-shape-field={f.key}>
                        <dt className="pt-0.5 text-end font-sans text-sm text-ink-3">{f.key}</dt>
                        <dd className="min-w-0">
                          <span
                            className={cn(
                              'font-mono',
                              isValue ? 'text-lg text-ink' : 'text-[15px] text-ink-2',
                            )}
                          >
                            {f.example}
                          </span>
                          {f.note && (
                            <span className="ms-2 font-sans text-sm text-ink-3">— {f.note}</span>
                          )}
                        </dd>
                      </div>
                    )
                  })}
                </dl>
                {slide.shape.note && <p className="mt-3 text-sm text-ink-3">{slide.shape.note}</p>}
              </div>
            </div>
          </div>
        )}
        <div>
          <p className="mb-2 text-xs font-semibold tracking-wide text-ink-3 uppercase">
            {t('slide.rules')}
          </p>
          <ol className="space-y-3" data-slide-rule-list>
            {slide.rules.map((r, i) => (
              <li key={i} className="flex gap-3 text-lg leading-snug text-ink">
                <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full bg-teal-soft font-mono text-xs font-semibold text-teal">
                  {i + 1}
                </span>
                <span>{r}</span>
              </li>
            ))}
          </ol>
          {slide.cta && (
            <p
              className="mt-6 flex items-center gap-2 text-lg font-medium text-teal"
              data-slide-cta
            >
              {slide.cta} <ArrowRight className="size-5" aria-hidden="true" />
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
