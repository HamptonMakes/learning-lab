/**
 * ActorCard — one card per actor. A `motion.div layout="position"` keyed by the actor id so cards
 * glide between slots when the layout changes and stay crisp when they grow; spawn/remove animate
 * through the grid's AnimatePresence. The whole card is the anchor for the actor's root path and
 * carries the DSL §14 attributes. Header → outbox chips → inbox tray → holds (insertion order),
 * each slot drawn by ValueView under a quiet caption. The card is a plain paper card that floats by
 * shadow; the actor's hue is a dot beside the name (ActorHeader), never a border around the card.
 */
import type { CSSProperties } from 'react'
import { motion } from 'motion/react'
import type { Actor, ActorColor, Tone } from '@/lesson/types'
import { cn } from '@/lib/utils'
import { useAnchor, useLayoutInFlight } from '../geometry/AnchorRegistry'
import { useStageMotion } from '../motion/StageMotionProvider'
import { useStageFrame } from '../StageContext'
import { useStageEvents } from '../Stage'
import { ValueView } from '../value/ValueView'
import type { Slot } from '../layout/presets'
import { ActorHeader } from './ActorHeader'
import { InboxTray } from './InboxTray'
import { OutboxChips } from './OutboxChips'
import { actorHueStyle, toneVar } from './tone'

export interface ActorCardProps {
  actor: Actor
  slot: Slot
}

export function ActorCard({ actor, slot }: ActorCardProps) {
  const { frame, highlightOf, via } = useStageFrame()
  const { tr, instant } = useStageMotion()
  const anchorRef = useAnchor(actor.id)
  const inFlight = useLayoutInFlight()
  const emit = useStageEvents()
  const highlight = highlightOf(actor.id)
  const landed = via.get(actor.id)
  const dim = !actor.online
  const holds = Object.entries(actor.holds)

  return (
    <motion.article
      ref={anchorRef}
      layout="position"
      layoutId={actor.id}
      layoutDependency={frame.index}
      onLayoutAnimationStart={() => {
        inFlight.onLayoutAnimationStart()
        emit({ kind: 'layout', op: 'start', actor: actor.id })
      }}
      onLayoutAnimationComplete={() => {
        inFlight.onLayoutAnimationComplete()
        emit({ kind: 'layout', op: 'complete', actor: actor.id })
      }}
      initial={instant ? false : { opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.96, transition: tr('exit') }}
      transition={{ ...tr('enter'), layout: tr('layout') }}
      aria-label={actor.label}
      data-path={actor.id}
      data-actor={actor.id}
      data-kind={actor.kind}
      data-online={actor.online}
      data-slot={slot}
      data-color={actor.color}
      data-status={actor.status}
      data-highlight={highlight?.tone}
      style={actorHueStyle(actor.color)}
      className="relative flex min-w-48 flex-col rounded-xl bg-card p-4 text-sm text-ink shadow-(--shadow-card) ring-1 ring-(--stage-card-ring)"
    >
      {highlight && <HighlightRing key={highlight.id} tone={highlight.tone} />}
      {landed && <ViaFlash key={landed.message} color={landed.color} />}
      <ActorHeader actor={actor} dim={dim} />
      <OutboxChips actor={actor} className={cn(dim && 'opacity-60')} />
      <InboxTray actor={actor} className={cn(dim && 'opacity-60')} />
      {holds.length > 0 && (
        <div data-holds className={cn('mt-3 flex flex-col gap-3', dim && 'opacity-60')}>
          {holds.map(([slotId, value]) => (
            <div key={slotId} data-hold={slotId} className="flex min-w-0 flex-col gap-0.5">
              <div className="font-sans text-[11px] leading-4 text-ink-3">{slotId}</div>
              <ValueView path={`${actor.id}.${slotId}`} value={value} depth={0} />
            </div>
          ))}
        </div>
      )}
    </motion.article>
  )
}

/** Ring in the tone colour around the whole card; pulses in with tr('flash') and rests visible. */
function HighlightRing({ tone }: { tone: Tone }) {
  const { tr, instant } = useStageMotion()
  return (
    <motion.span
      aria-hidden
      data-highlight-ring={tone}
      style={{ '--tone': toneVar(tone) } as CSSProperties}
      className="pointer-events-none absolute -inset-px rounded-xl ring-2 ring-(--tone)"
      initial={instant ? false : { opacity: 0 }}
      animate={{ opacity: [0, 1, 0.75] }}
      transition={tr('flash')}
    />
  )
}

/** A flash in the sender's hue when a control message landed on this card; the ViaTag stays. */
function ViaFlash({ color }: { color: ActorColor }) {
  const { tr, instant } = useStageMotion()
  return (
    <motion.span
      aria-hidden
      data-via-flash={color}
      style={{ '--via-hue': `var(--actor-${color})` } as CSSProperties}
      className="pointer-events-none absolute -inset-px rounded-xl ring-2 ring-(--via-hue)"
      initial={instant ? false : { opacity: 0 }}
      animate={{ opacity: [0, 1, 0] }}
      transition={tr('flash')}
    />
  )
}
