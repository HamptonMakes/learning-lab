/**
 * Keynote-style slides the stage draws for presentation frames: the title screen ("what is this?")
 * and the closing summary (when to use / when not to use / in the real world).
 */
import { Check, Globe, X } from 'lucide-react'
import { motion } from 'motion/react'
import type { Slide } from '@/lesson/types'
import { useStageMotion } from './motion'
import { cn } from '@/lib/utils'

export function SlideView({ slide }: { slide: Slide }) {
  const { tr, off } = useStageMotion()
  const enter = off ? undefined : { opacity: 0, y: 8 }
  return (
    <div
      className="flex min-h-(--stage-min-h) items-center justify-center px-10 py-10"
      data-slide={slide.kind}
    >
      <motion.div
        key={slide.kind === 'intro' ? 'intro' : slide.heading}
        initial={enter ?? false}
        animate={{ opacity: 1, y: 0 }}
        transition={tr('enter')}
        className="w-full max-w-3xl"
      >
        {slide.kind === 'intro' ? <Intro slide={slide} /> : <Summary slide={slide} />}
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
