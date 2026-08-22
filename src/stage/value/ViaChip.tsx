/**
 * The via chip: the sender's initial in the sender's hue, drawn on a value that landed through a
 * message this step (DSL §4.3, §6). It is the durable record of a same-step send + deliver (the
 * transient flight is not drawn under reduced motion). With motion on it softens after a moment;
 * under `off` (reduced motion / instant commit) it renders at rest so screenshots show it.
 */
import { useEffect, useState } from 'react'
import { motion } from 'motion/react'
import { useT } from '@/i18n'
import { useStageFrame, type ViaInfo } from '../StageContext'
import { useStageMotion } from '../motion/StageMotionProvider'
import { BASE_MS } from '../motion/transitions'
import { hueVars } from './tone'

export function ViaChip({ via }: { via: ViaInfo }) {
  const t = useT()
  const { world } = useStageFrame()
  const { off, ms, tr } = useStageMotion()
  const label = world.actors[via.from]?.label ?? via.from
  const initial = Array.from(label)[0]?.toUpperCase() ?? '?'
  const [faded, setFaded] = useState(false)
  useEffect(() => {
    if (off) return
    const id = setTimeout(() => setFaded(true), ms(BASE_MS.chip))
    return () => clearTimeout(id)
  }, [off, ms])
  const text = t('stage.via', { actor: label })
  return (
    <motion.span
      data-via={via.from}
      data-via-message={via.message}
      aria-label={text}
      title={text}
      style={hueVars(via.color)}
      className="pointer-events-none absolute -start-2 -top-2 z-20 grid size-4 place-items-center rounded-full bg-(--hue) font-sans text-[10px] leading-none font-semibold text-paper shadow-xs ring-1 ring-card"
      initial={off ? false : { opacity: 0, scale: 0.6 }}
      animate={{ opacity: faded ? 0.45 : 1, scale: 1 }}
      transition={tr(faded ? 'exit' : 'enter')}
    >
      {initial}
    </motion.span>
  )
}
