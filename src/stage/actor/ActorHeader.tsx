/**
 * ActorHeader — icon (by ActorIcon / kind), owner caption ("Alice's"), label, subtitle, and the
 * badge cluster: via tag (a control message landed on this card), clock badge (skew defined),
 * status badge, offline badge.
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
      <span
        aria-hidden
        className={cn(
          'grid size-7 shrink-0 place-items-center rounded-md bg-(--card-hue-soft) text-(--card-hue)',
          dim && 'opacity-60',
        )}
      >
        {createElement(actorIcon(actor), { className: 'size-4' })}
      </span>
      <div className={cn('min-w-0 flex-1 leading-tight', dim && 'opacity-60')}>
        {ownerLabel !== undefined && (
          <div data-owner={actor.owner} className="truncate text-xs text-ink-3">
            {t('stage.ownerOf', { owner: ownerLabel })}
          </div>
        )}
        <div data-label className="truncate text-sm font-medium text-ink">
          {actor.label}
        </div>
        {actor.subtitle && (
          <div data-subtitle className="truncate text-xs text-ink-2">
            {actor.subtitle}
          </div>
        )}
      </div>
      <div className="flex shrink-0 flex-wrap items-center justify-end gap-1">
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
