/**
 * ActorHeader — a hue dot + the label (the actor's identity), a small muted kind icon (by
 * ActorIcon / kind), the owner caption ("Alice's") and subtitle as quiet captions, and the badge
 * cluster: via tag (a control message landed on this card), clock badge (skew defined), status
 * badge, offline badge.
 */
import { createElement, type CSSProperties } from 'react'
import type { Actor } from '@/lesson/types'
import { useT } from '@/i18n'
import { cn } from '@/lib/utils'
import { useStageFrame, type ViaInfo } from '../StageContext'
import { actorIcon } from './actorIcon'
import { ClockBadge } from './ClockBadge'
import { OfflineBadge } from './OfflineBadge'
import { StatusBadge } from './StatusBadge'

export function ActorHeader({ actor, dim }: { actor: Actor; dim: boolean }) {
  const { world, via } = useStageFrame()
  const t = useT()
  const ownerLabel =
    actor.owner === undefined ? undefined : (world.actors[actor.owner]?.label ?? actor.owner)
  const landed = via.get(actor.id)
  return (
    <div className="flex items-start gap-2">
      <div className={cn('min-w-0 flex-1 leading-tight', dim && 'opacity-60')}>
        {ownerLabel !== undefined && (
          <div data-owner={actor.owner} className="truncate text-[11px] leading-4 text-ink-3">
            {t('stage.ownerOf', { owner: ownerLabel })}
          </div>
        )}
        <div className="flex min-w-0 items-center gap-2">
          <span
            aria-hidden
            data-hue-dot=""
            className="size-2.5 shrink-0 rounded-full bg-(--card-hue)"
          />
          <div data-label className="truncate text-[15px] leading-6 font-medium text-ink">
            {actor.label}
          </div>
          {createElement(actorIcon(actor), {
            className: 'size-3.5 shrink-0 text-ink-3',
            'aria-hidden': true,
          })}
        </div>
        {actor.subtitle && (
          <div data-subtitle className="truncate ps-4.5 text-[11px] leading-4 text-ink-3">
            {actor.subtitle}
          </div>
        )}
      </div>
      <div className="flex shrink-0 flex-wrap items-center justify-end gap-1 pt-0.5">
        {landed && <ViaTag via={landed} />}
        {actor.skew !== undefined && <ClockBadge actor={actor} skew={actor.skew} />}
        {actor.status && <StatusBadge actor={actor} status={actor.status} />}
        {!actor.online && <OfflineBadge />}
      </div>
    </div>
  )
}

/** Sender initial in the sender's hue: the value that landed on this card came from `via.from`. */
function ViaTag({ via }: { via: ViaInfo }) {
  const { world } = useStageFrame()
  const t = useT()
  const fromLabel = world.actors[via.from]?.label ?? via.from
  const vars = {
    '--via-hue': `var(--actor-${via.color})`,
    '--via-hue-soft': `var(--actor-${via.color}-soft)`,
  } as CSSProperties
  return (
    <span
      data-via={via.message}
      data-via-from={via.from}
      style={vars}
      title={t('stage.via', { actor: fromLabel })}
      aria-label={t('stage.via', { actor: fromLabel })}
      className="grid size-5 place-items-center rounded-full border border-(--via-hue) bg-(--via-hue-soft) font-mono text-xs leading-none font-medium text-(--via-hue) uppercase"
    >
      {fromLabel.slice(0, 1)}
    </span>
  )
}
