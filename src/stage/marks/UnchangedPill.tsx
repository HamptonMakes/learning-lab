/**
 * "no change" pill (reducer-generated `unchanged` mark): sits on the slot's top-end corner for one
 * step. Icon + word, neutral tone.
 */
import { motion } from 'motion/react'
import { Equal } from 'lucide-react'
import type { Mark } from '@/lesson/types'
import { useT } from '@/i18n'
import type { Rect } from '../geometry'
import { useStageMotion } from '../motion'
import { Pill } from '../actor/Pill'

export function UnchangedPill({
  mark,
  anchor,
}: {
  mark: Extract<Mark, { kind: 'unchanged' }>
  anchor: Rect | undefined
}) {
  const t = useT()
  const { tr, off, dir } = useStageMotion()
  if (!anchor) return null
  const endX = dir === 'rtl' ? anchor.x : anchor.x + anchor.w
  return (
    <motion.div
      data-mark={mark.id}
      data-mark-kind="unchanged"
      data-path={mark.path}
      className="absolute top-0 left-0 -translate-x-1/2 -translate-y-1/2"
      style={{ left: endX, top: anchor.y }}
      initial={off ? false : { opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, transition: tr('exit') }}
      transition={tr('enter')}
    >
      <Pill tone="neutral" icon={Equal} className="border border-line-2 shadow-sm">
        {t('stage.noChange')}
      </Pill>
    </motion.div>
  )
}
