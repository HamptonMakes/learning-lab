/**
 * InboxTray — the region at the top of a card where parked messages rest. The tokens themselves are
 * overlay-owned (MessageLayer positions them over this tray via the `<actor>@inbox` anchor). The
 * region is always in the DOM so the anchor resolves: zero-height while nothing is parked (no empty
 * chrome), one token row while messages are parked so a parking token never resizes the card, and a
 * `+n` pill when more than three messages are parked here.
 */
import { Inbox } from 'lucide-react'
import type { Actor } from '@/lesson/types'
import { useI18n } from '@/i18n'
import { cn } from '@/lib/utils'
import { useAnchor } from '../geometry/AnchorRegistry'
import { useStageFrame } from '../StageContext'

/** Parked tokens drawn in the tray before the count pill takes over. */
export const INBOX_VISIBLE = 3

export function InboxTray({ actor, className }: { actor: Actor; className?: string }) {
  const { world } = useStageFrame()
  const { t, tn } = useI18n()
  const path = `${actor.id}@inbox`
  const ref = useAnchor(path)
  const parked = world.messages.filter((m) => m.to === actor.id && m.state === 'parked').length
  const overflow = Math.max(0, parked - INBOX_VISIBLE)
  const empty = parked === 0
  return (
    <div
      ref={ref}
      data-inbox={actor.id}
      data-path={path}
      data-parked={parked}
      aria-label={parked > 0 ? tn('stage.parked', parked) : t('stage.inbox')}
      title={parked > 0 ? tn('stage.parked', parked) : t('stage.inbox')}
      className={cn(
        'relative flex items-center justify-between gap-1',
        empty ? 'h-0 overflow-hidden' : 'mt-3 min-h-(--stage-token-h) rounded-lg bg-paper-2 px-2',
        className,
      )}
    >
      {!empty && <Inbox className="size-3 shrink-0 text-ink-3" aria-hidden />}
      {overflow > 0 && (
        <span data-inbox-more={overflow} className="font-mono text-[11px] leading-none text-ink-3">
          {t('stage.more', { count: overflow })}
        </span>
      )}
    </div>
  )
}
