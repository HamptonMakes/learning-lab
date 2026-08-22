/**
 * One message token on its arc (flying) or in the recipient's inbox tray (parked).
 * Position = CSS `offset-path` (the arc) + Motion `offsetDistance`: rest at `stackOffset(i)%`,
 * enter 0% -> rest, deliver exit rest -> 100% + fade, drop exit rest -> 70% + poof; parking is a
 * two-phase move (arc end, then a translate into the tray slot). Registers the anchor `msg:<id>` so
 * marks can attach to the token at rest. The static frame never depends on an animation: under
 * instant / reduced motion the token renders at its rest position.
 */
import { useEffect, useMemo, useRef } from 'react'
import {
  motion,
  useIsPresent,
  usePresenceData,
  type TargetAndTransition,
  type Variants,
} from 'motion/react'
import type { ActorColor, Message } from '@/lesson/types'
import { arcBetween, stackOffset, useAnchor, useAnchorRegistry } from '../geometry'
import { useStageMotion } from '../motion'
import { useStageEvents } from '../Stage'
import type { Geometry } from '../marks/useLayerGeometry'
import { TokenPayload } from './TokenPayload'
import { arcEndpoint, bulgeFor, parkedDelta, TRAVEL_MS, type ExitInfo } from './stacks'

const PARKED_SCALE = 0.92

export interface MessageTokenProps {
  message: Message
  /** The sender's hue. */
  color: ActorColor
  /** Creation-order index on its arc (rest offset = stackOffset(stack)). */
  stack: number
  /** Creation-order index among the recipient's parked messages (tray slot). */
  traySlot: number
  geometry: Geometry
  /** `sent` this frame: enters from the arc start. */
  isNew: boolean
  /** `parked` this frame: glides along the arc, then into the tray. */
  justParked: boolean
}

export function MessageToken({
  message,
  color,
  stack,
  traySlot,
  geometry,
  isNew,
  justParked,
}: MessageTokenProps) {
  const { tr, ms, off, dir } = useStageMotion()
  const emit = useStageEvents()
  const anchor = useAnchor(`msg:${message.id}`)
  const registry = useAnchorRegistry()
  const isPresent = useIsPresent()
  const presence = usePresenceData() as ExitInfo | undefined
  const outcome = presence?.[message.id]
  const parked = message.state === 'parked'

  // The arrival / poof sound is timed by contract: when the exit animation would end. Fired once,
  // and not cancelled on unmount: under instant commits the token is gone before the timer ticks.
  const reported = useRef(false)
  useEffect(() => {
    if (isPresent || !outcome || reported.current) return
    reported.current = true
    setTimeout(() => emit({ kind: 'message', op: outcome, message }), ms(TRAVEL_MS))
  }, [isPresent, outcome, emit, message, ms])

  // `exit` can only be a label; the per-message outcome is a dynamic variant fed by AnimatePresence `custom`.
  const variants = useMemo<Variants>(
    () => ({
      gone: (ex?: ExitInfo) => {
        const o = ex?.[message.id]
        if (o === 'dropped') {
          return parked
            ? { opacity: 0, scale: 1.5, transition: tr('travel') }
            : { offsetDistance: '70%', opacity: 0, scale: 1.5, transition: tr('travel') }
        }
        if (o === 'delivered') {
          return parked
            ? { x: 0, y: 0, opacity: 0, scale: 0.9, transition: tr('travel') }
            : { offsetDistance: '100%', opacity: 0, scale: 0.9, transition: tr('travel') }
        }
        // Still in the world (re-grouped into a deck): just fade.
        return { opacity: 0, transition: tr('exit') }
      },
    }),
    [message.id, parked, tr],
  )

  const from = geometry.get(message.from)
  const to = geometry.get(arcEndpoint(message)) ?? geometry.get(message.to)
  const tray = geometry.get(`${message.to}@inbox`)
  if (!from || !to) return null // first paint before measurement; the settle frame fixes it

  const arc = arcBetween(from, to, bulgeFor(message))
  const rest = `${stackOffset(stack)}%`
  const delta = parked && tray ? parkedDelta(arc.p1, tray, traySlot, dir) : { x: 0, y: 0 }
  const travel = tr('travel')

  let animate: TargetAndTransition
  if (!parked) {
    animate = { offsetDistance: rest, x: 0, y: 0, opacity: 1, scale: 1 }
  } else if (justParked && !off) {
    // Two phases in one tween: along the arc to its end, then across into the tray slot.
    animate = {
      offsetDistance: [null, '100%', '100%'],
      x: [null, 0, delta.x],
      y: [null, 0, delta.y],
      opacity: 1,
      scale: PARKED_SCALE,
      transition: { ...travel, times: [0, 0.55, 1] },
    }
  } else {
    animate = { offsetDistance: '100%', x: delta.x, y: delta.y, opacity: 1, scale: PARKED_SCALE }
  }

  return (
    <motion.div
      ref={anchor}
      data-message={message.id}
      data-path={`msg:${message.id}`}
      data-from={message.from}
      data-to={message.to}
      data-state={message.state}
      data-stack={parked ? undefined : stack}
      data-tray-slot={parked ? traySlot : undefined}
      // Physical left/top on purpose: overlay coordinates are measured (stage-architecture §11).
      className="absolute top-0 left-0 will-change-transform"
      style={{ offsetPath: `path("${arc.d}")`, offsetRotate: '0deg' }}
      initial={isNew && !off ? { offsetDistance: '0%', x: 0, y: 0, opacity: 0, scale: 0.9 } : false}
      animate={animate}
      exit="gone"
      variants={variants}
      transition={travel}
      onAnimationComplete={() => registry?.measure()}
    >
      <TokenPayload message={message} color={color} parked={parked} />
    </motion.div>
  )
}
