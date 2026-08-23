/**
 * ActorHeader — the window's title bar (Workbench): horizontal stripes with the title tab at the
 * start — a hue dot + the label (the actor's identity) + a small muted kind icon (by ActorIcon /
 * kind) — and the badge cluster on its own tab at the end: via tag (a control message landed on
 * this card), clock badge (skew defined), status badge, offline badge. The owner caption
 * ("Alice's") and subtitle follow as quiet captions under the bar.
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
  const badges = landed !== undefined || actor.skew !== undefined || actor.status || !actor.online
  return (
    <>
      <div className="title-bar gap-2" data-title-bar="">
        <div
          className={cn(
            'ms-2 flex min-w-0 items-center gap-1.5 bg-window px-1.5',
            dim && 'opacity-60',
          )}
        >
          <span
            aria-hidden
            data-hue-dot=""
            className="size-2.5 shrink-0 rounded-full bg-(--card-hue)"
          />
          <div data-label className="truncate text-[13px] leading-5 font-semibold text-ink">
            {actor.label}
          </div>
          {createElement(actorIcon(actor), {
            className: 'size-3.5 shrink-0 text-ink-3',
            'aria-hidden': true,
          })}
        </div>
        {badges && (
          <div className="ms-auto me-2 flex shrink-0 flex-wrap items-center justify-end gap-1 bg-window px-1">
            {landed && <ViaTag via={landed} />}
            {actor.skew !== undefined && <ClockBadge actor={actor} skew={actor.skew} />}
            {actor.status && <StatusBadge actor={actor} status={actor.status} />}
            {!actor.online && <OfflineBadge />}
          </div>
        )}
      </div>
      {(ownerLabel !== undefined || actor.subtitle) && (
        <div className={cn('px-3 pt-2 leading-tight', dim && 'opacity-60')}>
          {ownerLabel !== undefined && (
            <div data-owner={actor.owner} className="truncate text-[11px] leading-4 text-ink-3">
              {t('stage.ownerOf', { owner: ownerLabel })}
            </div>
          )}
          {actor.subtitle && (
            <div data-subtitle className="truncate text-[11px] leading-4 text-ink-3">
              {actor.subtitle}
            </div>
          )}
        </div>
      )}
    </>
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
