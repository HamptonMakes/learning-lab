/**
 * Corner clock HUD, drawn when `world.clock.show` (DSL §2, stage-architecture §5.6). Formats via
 * formatClock(); an LTR island (`<bdi dir="ltr">`) because clock readings read left-to-right in
 * every locale. The HUD is chrome, not an addressable node: no data-path, no anchor.
 */
import { Clock3 } from 'lucide-react'
import { useT } from '@/i18n'
import { useStageFrame } from '../StageContext'
import { formatClock } from './formatClock'

export function ClockHud() {
  const { world } = useStageFrame()
  const t = useT()
  const { clock } = world
  if (!clock.show) return null
  const reading = formatClock(clock, clock.now, t)
  return (
    <div
      data-clock={clock.format}
      data-now={clock.now}
      aria-label={`${t('stage.clock.label')}: ${reading}`}
      title={t('stage.clock.label')}
      className="pointer-events-none absolute end-3 top-3 z-10 inline-flex items-center gap-1.5 rounded-full bg-paper-2 px-2.5 py-1 font-mono text-[11px] leading-none text-ink-3"
    >
      <Clock3 className="size-3 text-ink-3" aria-hidden />
      <bdi dir="ltr" className="tabular-nums">
        {reading}
      </bdi>
    </div>
  )
}
