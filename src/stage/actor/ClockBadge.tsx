/**
 * ClockBadge — drawn when `Actor.skew` is defined: this actor's wall clock (`clock.now + skew`) in
 * the scene's format plus a `+5` / `−2` delta chip (stage-architecture §5.6). Anchored and
 * addressable as `<actor>@clock`. An LTR island.
 */
import { Clock3 } from 'lucide-react'
import type { Actor } from '@/lesson/types'
import { useT } from '@/i18n'
import { useAnchor } from '../geometry/AnchorRegistry'
import { useStageFrame } from '../StageContext'
import { formatClock, formatDelta } from '../hud/formatClock'
import { Pill } from './Pill'

export function ClockBadge({ actor, skew }: { actor: Actor; skew: number }) {
  const { world } = useStageFrame()
  const t = useT()
  const path = `${actor.id}@clock`
  const ref = useAnchor(path)
  const reading = formatClock(world.clock, world.clock.now + skew, t)
  const delta = formatDelta(skew)
  return (
    <Pill
      ref={ref}
      data-path={path}
      data-skew={skew}
      tone={skew === 0 ? 'neutral' : 'warn'}
      icon={Clock3}
      className="font-mono"
      title={t('stage.clock.skew', { delta })}
      aria-label={`${t('stage.clock.actor', { actor: actor.label })}: ${reading} (${delta})`}
    >
      <bdi dir="ltr" className="tabular-nums">
        {reading}
      </bdi>
      <bdi dir="ltr" data-delta className="rounded-sm bg-card/70 px-1 text-ink-2 tabular-nums">
        {delta}
      </bdi>
    </Pill>
  )
}
