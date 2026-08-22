/**
 * Same-step send + deliver/drop (DSL §4.3): the message never appears in `world.messages`, so the
 * layer flies a token along the whole arc (0% -> 100%, or -> 70% + poof when dropped) and unmounts
 * it after `ms(TRAVEL_MS)`. Never rendered under reduced motion / instant: the via chip on the landed
 * value is the static record. The arrival sound is timed like a regular exit.
 */
import { useEffect, useState } from 'react'
import { motion } from 'motion/react'
import type { ActorColor, Message } from '@/lesson/types'
import { arcBetween } from '../geometry'
import { useStageMotion } from '../motion'
import { useStageEvents } from '../Stage'
import type { Geometry } from '../marks/useLayerGeometry'
import { TokenPayload } from './TokenPayload'
import { arcEndpoint, bulgeFor, TRAVEL_MS, type ExitOutcome } from './stacks'

export interface TransientFlightProps {
  message: Message
  outcome: ExitOutcome
  /** The sender's hue. */
  color: ActorColor
  geometry: Geometry
}

export function TransientFlight({ message, outcome, color, geometry }: TransientFlightProps) {
  const { tr, ms } = useStageMotion()
  const emit = useStageEvents()
  const [done, setDone] = useState(false)
  useEffect(() => {
    const id = setTimeout(() => {
      emit({ kind: 'message', op: outcome, message })
      setDone(true)
    }, ms(TRAVEL_MS))
    return () => clearTimeout(id)
  }, [message, outcome, emit, ms])

  const from = geometry.get(message.from)
  const to = geometry.get(arcEndpoint(message)) ?? geometry.get(message.to)
  if (done || !from || !to) return null
  const arc = arcBetween(from, to, bulgeFor(message))
  const dropped = outcome === 'dropped'
  return (
    <motion.div
      data-message={message.id}
      data-path={`msg:${message.id}`}
      data-from={message.from}
      data-to={message.to}
      data-state="flying"
      data-transient=""
      data-outcome={outcome}
      className="absolute top-0 left-0 will-change-transform"
      style={{ offsetPath: `path("${arc.d}")`, offsetRotate: '0deg' }}
      initial={{ offsetDistance: '0%', opacity: 0, scale: 0.9 }}
      animate={{
        offsetDistance: dropped ? '70%' : '100%',
        opacity: [0, 1, 1, 0],
        scale: dropped ? [0.9, 1, 1, 1.5] : [0.9, 1, 1, 0.9],
      }}
      transition={{ ...tr('travel'), times: [0, 0.15, 0.85, 1] }}
    >
      <TokenPayload message={message} color={color} />
    </motion.div>
  )
}
