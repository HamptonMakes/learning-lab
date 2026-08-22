/**
 * OutboxChips — one chip per `Actor.outbox` entry (ops created here, not yet broadcast): the
 * opLabel text plus the op id, in the actor's hue. Anchored and addressable as `<actor>@outbox`.
 * The region is always in the DOM (zero-height when empty) so the anchor keeps a position; beyond
 * three chips a `+n` pill takes over so the card grows at most once (stage-architecture §10).
 */
import { AnimatePresence, motion } from 'motion/react'
import type { Actor } from '@/lesson/types'
import { useI18n } from '@/i18n'
import { cn } from '@/lib/utils'
import { useAnchor } from '../geometry/AnchorRegistry'
import { useStageMotion } from '../motion/StageMotionProvider'

/** Chips drawn before the `+n` pill takes over. */
export const OUTBOX_VISIBLE = 3

export function OutboxChips({ actor, className }: { actor: Actor; className?: string }) {
  const { t, tn } = useI18n()
  const { tr, instant } = useStageMotion()
  const path = `${actor.id}@outbox`
  const ref = useAnchor(path)
  const chips = actor.outbox
  const shown = chips.slice(0, OUTBOX_VISIBLE)
  const overflow = chips.length - shown.length
  const empty = chips.length === 0
  return (
    <div
      ref={ref}
      data-outbox={actor.id}
      data-path={path}
      data-pending={chips.length}
      aria-label={empty ? t('stage.outbox') : tn('stage.pending', chips.length)}
      title={empty ? undefined : tn('stage.pending', chips.length)}
      className={cn(
        'flex flex-wrap items-center gap-1',
        empty ? 'h-0 overflow-hidden' : 'mt-2',
        className,
      )}
    >
      <AnimatePresence initial={false}>
        {shown.map((chip) => (
          <motion.span
            key={chip.id}
            layout
            initial={instant ? false : { opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9, transition: tr('exit') }}
            transition={{ ...tr('enter'), layout: tr('layout') }}
            style={{ borderRadius: 6 }}
            data-outbox-chip={chip.id}
            data-hold={chip.slot}
            title={`${chip.label} ${chip.id}`}
            className="inline-flex max-w-full items-center gap-1 border border-(--card-hue) bg-(--card-hue-soft) px-1.5 py-0.5 font-mono text-xs leading-none text-ink"
          >
            <span className="truncate">{chip.label}</span>
            <bdi dir="ltr" className="shrink-0 text-ink-3">
              {chip.id}
            </bdi>
          </motion.span>
        ))}
      </AnimatePresence>
      {overflow > 0 && (
        <span
          data-outbox-more={overflow}
          className="rounded-full bg-paper-3 px-1.5 py-0.5 font-mono text-xs leading-none text-ink-2"
        >
          {t('stage.more', { count: overflow })}
        </span>
      )}
    </div>
  )
}
