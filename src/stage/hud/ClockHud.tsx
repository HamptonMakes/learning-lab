/**
 * The stage clock, drawn at the top-end corner when `world.clock.show` (DSL §2, stage-architecture
 * §5.6): a small clock icon, the caption "now" and a clear mono readout — `t=2`, `10:05`, `150 ms`
 * — formatted by formatClock(). On time-based screens "now" is the thing the learner keeps
 * comparing stamps against, so it reads at a glance rather than hiding in a corner pill; the
 * stage reserves headroom for it (stage.css). A change of `clock.now` flashes behind the readout
 * (tr('flash'); at rest under `off`). An LTR island (`<bdi dir="ltr">`) because clock readings read
 * left-to-right in every locale. The HUD is chrome, not an addressable node: no data-path, no anchor.
 */
import { motion } from 'motion/react'
import { Clock3 } from 'lucide-react'
import { useT } from '@/i18n'
import { useStageFrame } from '../StageContext'
import { useStageMotion } from '../motion/StageMotionProvider'
import { formatClock } from './formatClock'

export function ClockHud() {
  const { world, frame, changes } = useStageFrame()
  const { off, tr } = useStageMotion()
  const t = useT()
  const { clock } = world
  if (!clock.show) return null
  const reading = formatClock(clock, clock.now, t)
  const ticked = changes.some((c) => c.kind === 'clock')
  return (
    <div
      data-clock={clock.format}
      data-now={clock.now}
      aria-label={`${t('stage.clock.label')}: ${reading}`}
      title={t('stage.clock.label')}
      className="pointer-events-none absolute end-(--stage-pad) top-(--stage-pad) z-10 flex items-center gap-2 text-ink"
    >
      <Clock3 className="size-4 shrink-0 text-ink-3" aria-hidden />
      <div className="flex flex-col items-start">
        <span className="font-sans text-[10px] leading-3 font-medium tracking-wider text-ink-3 uppercase">
          {t('stage.clock.now')}
        </span>
        <span className="relative isolate -mx-1 rounded-sm px-1">
          <bdi
            dir="ltr"
            data-reading=""
            className="font-mono text-[19px] leading-6 font-medium tracking-tight tabular-nums"
          >
            {reading}
          </bdi>
          {ticked && !off && (
            <motion.span
              key={`tick-${frame.index}`}
              aria-hidden
              data-flash=""
              className="pointer-events-none absolute inset-0 -z-10 rounded-[inherit] bg-teal-soft"
              initial={{ opacity: 0 }}
              animate={{ opacity: [0, 0.9, 0] }}
              transition={tr('flash')}
            />
          )}
        </span>
      </div>
    </div>
  )
}
