/**
 * The stage clock, drawn at the top-end corner when `world.clock.show` (DSL §2, stage-architecture
 * §5.6): the caption "now" over an LED readout (Workbench: dot-matrix digits on a dark panel) —
 * `t=2`, `10:05`, `150 ms` — formatted by formatClock(). On time-based screens "now" is the thing the learner keeps
 * comparing stamps against, so it reads at a glance rather than hiding in a corner pill; the
 * stage reserves headroom for it (stage.css). A change of `clock.now` flashes behind the readout
 * (tr('flash'); at rest under `off`). An LTR island (`<bdi dir="ltr">`) because clock readings read
 * left-to-right in every locale. The HUD is chrome, not an addressable node: no data-path, no anchor.
 */
import { motion } from 'motion/react'
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
      className="pointer-events-none absolute end-(--stage-pad) top-(--stage-pad) z-10 flex flex-col items-end gap-0.5 text-ink"
    >
      <span className="font-sans text-[10px] leading-3 font-semibold tracking-wider text-ink-3 uppercase">
        {t('stage.clock.now')}
      </span>
      <span className="relative isolate led-panel px-2 py-0.5">
        <bdi dir="ltr" data-reading="" className="text-[22px] leading-7 tracking-wide tabular-nums">
          {reading}
        </bdi>
        {ticked && !off && (
          <motion.span
            key={`tick-${frame.index}`}
            aria-hidden
            data-flash=""
            className="pointer-events-none absolute inset-0 z-10 rounded-[inherit] bg-led/35"
            initial={{ opacity: 0 }}
            animate={{ opacity: [0, 1, 0] }}
            transition={tr('flash')}
          />
        )}
      </span>
    </div>
  )
}
