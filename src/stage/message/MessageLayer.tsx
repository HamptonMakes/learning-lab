/**
 * MessageLayer: the HTML overlay that draws every message of the frame.
 *   - flying messages sit on the arc sender card -> `into` node (or the recipient card), stacked by
 *     creation order; from 4 on one arc they collapse into a DeckToken;
 *   - parked messages sit in the recipient's inbox tray (`<to>@inbox`), slotted by creation order;
 *   - a faint dashed underlay shows each arc in the static frame;
 *   - exits read their outcome from `frame.changes` (delivered -> 100% + fade, dropped -> poof);
 *   - same-step send + deliver fly a TransientFlight (skipped under reduced motion / instant).
 * Rects come from the anchor registry, or from the `geometry` prop in tests (jsdom rects are zero).
 */
import { useMemo, type ReactElement } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import type { ActorColor, ActorId } from '@/lesson/types'
import { arcBetween } from '../geometry'
import { useStageMotion } from '../motion'
import { useStageFrame } from '../StageContext'
import { useLayerGeometry, type Geometry } from '../marks/useLayerGeometry'
import { DeckToken } from './DeckToken'
import { MessageToken } from './MessageToken'
import { TransientFlight } from './TransientFlight'
import {
  bulgeFor,
  DECK_THRESHOLD,
  exitOutcomes,
  groupFlying,
  messageIds,
  transientFlights,
  traySlots,
} from './stacks'

export interface MessageLayerProps {
  /** Test seam: rects by DSL path instead of the measured registry snapshot. */
  geometry?: Geometry
}

export function MessageLayer({ geometry }: MessageLayerProps) {
  const { frame, world, changes } = useStageFrame()
  const { instant, off, tr } = useStageMotion()
  const geo = useLayerGeometry(geometry)

  const exitInfo = useMemo(() => exitOutcomes(changes), [changes])
  const sent = useMemo(() => messageIds(changes, 'sent'), [changes])
  const parkedNow = useMemo(() => messageIds(changes, 'parked'), [changes])
  const groups = useMemo(() => groupFlying(world.messages), [world.messages])
  const slots = useMemo(() => traySlots(world.messages), [world.messages])
  const flights = useMemo(() => transientFlights(changes), [changes])
  const colorOf = (id: ActorId): ActorColor => world.actors[id]?.color ?? 'neutral'

  const tokens: ReactElement[] = []
  for (const g of groups) {
    if (g.messages.length >= DECK_THRESHOLD) {
      tokens.push(
        <DeckToken
          key={`deck:${g.key}`}
          group={g}
          color={colorOf(g.from)}
          geometry={geo}
          isNew={g.messages.every((m) => sent.has(m.id))}
        />,
      )
    } else {
      g.messages.forEach((m, i) =>
        tokens.push(
          <MessageToken
            key={m.id}
            message={m}
            color={colorOf(m.from)}
            stack={i}
            traySlot={0}
            geometry={geo}
            isNew={sent.has(m.id)}
            justParked={false}
          />,
        ),
      )
    }
  }
  for (const m of world.messages) {
    if (m.state !== 'parked') continue
    tokens.push(
      <MessageToken
        key={m.id}
        message={m}
        color={colorOf(m.from)}
        stack={0}
        traySlot={slots.get(m.id) ?? 0}
        geometry={geo}
        isNew={sent.has(m.id)}
        justParked={parkedNow.has(m.id)}
      />,
    )
  }

  return (
    <div className="pointer-events-none absolute inset-0" aria-hidden data-layer="messages">
      {/* Arc underlay: where each flying token travels (visible in the static frame). */}
      <svg className="absolute inset-0 h-full w-full overflow-visible">
        <AnimatePresence initial={!instant}>
          {groups.map((g) => {
            const from = geo.get(g.from)
            const to = geo.get(g.endpoint) ?? geo.get(g.to)
            const first = g.messages[0]
            if (!from || !to || !first) return null
            return (
              <motion.path
                key={g.key}
                data-arc={g.key}
                d={arcBetween(from, to, bulgeFor(first)).d}
                fill="none"
                stroke="var(--line-2)"
                strokeWidth={1.5}
                strokeDasharray="3 5"
                strokeLinecap="round"
                initial={off ? false : { opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={tr('enter')}
              />
            )
          })}
        </AnimatePresence>
      </svg>
      <AnimatePresence custom={exitInfo} initial={!instant}>
        {tokens}
      </AnimatePresence>
      {off
        ? null
        : flights.map((f) => (
            <TransientFlight
              key={`${frame.index}:${f.message.id}`}
              message={f.message}
              outcome={f.outcome}
              color={colorOf(f.message.from)}
              geometry={geo}
            />
          ))}
    </div>
  )
}
