/**
 * From 4 tokens on one arc the stack collapses into one deck token at 50% with a count (`6 ops`).
 * The covered messages still render as hidden `[data-message]` elements inside it (DOM contract),
 * and every `msg:<id>` anchor of the deck points at the deck, so a callout on one of them attaches
 * to the deck. Exit: delivered if any covered message was delivered this frame, dropped if any was
 * dropped, else a plain fade (the stack just shrank below the threshold).
 */
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { motion, useIsPresent, usePresenceData, type Variants } from 'motion/react'
import type { ActorColor, MessageId } from '@/lesson/types'
import { useI18n } from '@/i18n'
import { arcBetween, useAnchorRegistry } from '../geometry'
import { useStageMotion } from '../motion'
import { useStageEvents } from '../Stage'
import { actorVar } from '../marks/tone'
import type { Geometry } from '../marks/useLayerGeometry'
import { CRDT_SHORT } from './summarize'
import { bulgeFor, TRAVEL_MS, type ArcGroup, type ExitInfo, type ExitOutcome } from './stacks'

export interface DeckTokenProps {
  group: ArcGroup
  /** The sender's hue. */
  color: ActorColor
  geometry: Geometry
  /** Every covered message was `sent` this frame: the deck enters from the arc start. */
  isNew: boolean
}

export function DeckToken({ group, color, geometry, isNew }: DeckTokenProps) {
  const { tn } = useI18n()
  const { tr, ms, off } = useStageMotion()
  const emit = useStageEvents()
  const registry = useAnchorRegistry()
  const isPresent = useIsPresent()
  const presence = usePresenceData() as ExitInfo | undefined
  const ref = useRef<HTMLDivElement>(null)
  const idKey = group.messages.map((m) => m.id).join(' ')

  // One element, many anchors: `msg:<id>` of every covered message resolves to the deck.
  useLayoutEffect(() => {
    const el = ref.current
    if (!registry || !el) return
    const keys = idKey.split(' ')
    for (const id of keys) registry.register(`msg:${id}`, el)
    return () => {
      for (const id of keys) registry.register(`msg:${id}`, null)
    }
  }, [registry, idKey])

  // Sounds for the covered messages that left this frame, timed like a single token's exit.
  const outcome = deckOutcome(idKey.split(' '), presence)
  const reported = useRef(false)
  useEffect(() => {
    if (isPresent || !outcome || !presence || reported.current) return
    reported.current = true
    setTimeout(() => {
      for (const m of group.messages) {
        const o = presence[m.id]
        if (o) emit({ kind: 'message', op: o, message: m })
      }
    }, ms(TRAVEL_MS))
  }, [isPresent, outcome, presence, emit, ms, group.messages])

  const variants = useMemo<Variants>(
    () => ({
      gone: (ex?: ExitInfo) => {
        const o = deckOutcome(idKey.split(' '), ex)
        if (o === 'dropped')
          return { offsetDistance: '70%', opacity: 0, scale: 1.5, transition: tr('travel') }
        if (o === 'delivered')
          return { offsetDistance: '100%', opacity: 0, scale: 0.9, transition: tr('travel') }
        return { opacity: 0, transition: tr('exit') }
      },
    }),
    [idKey, tr],
  )

  const first = group.messages[0]
  const from = geometry.get(group.from)
  const to = geometry.get(group.endpoint) ?? geometry.get(group.to)
  if (!first || !from || !to) return null
  const arc = arcBetween(from, to, bulgeFor(first))
  const count = group.messages.length
  const allOps = group.messages.every((m) => m.data?.kind === 'op')
  const type = first.payload.meta?.type
  const sameType = type !== undefined && group.messages.every((m) => m.payload.meta?.type === type)
  const hue = actorVar(color)

  return (
    <motion.div
      ref={ref}
      data-deck=""
      data-count={count}
      data-from={group.from}
      data-to={group.to}
      className="absolute top-0 left-0 will-change-transform"
      style={{ offsetPath: `path("${arc.d}")`, offsetRotate: '0deg' }}
      initial={isNew && !off ? { offsetDistance: '0%', opacity: 0, scale: 0.9 } : false}
      animate={{ offsetDistance: '50%', opacity: 1, scale: 1 }}
      exit="gone"
      variants={variants}
      transition={tr('travel')}
      onAnimationComplete={() => registry?.measure()}
    >
      <div
        className="relative flex items-center gap-1.5 rounded-lg border bg-card px-2.5 py-1.5 text-ink shadow-(--shadow-pop)"
        style={{ borderColor: hue }}
      >
        {/* A ghost card behind reads as "a stack"; the count says it in words too. */}
        <span
          aria-hidden
          className="absolute inset-0 -z-10 translate-x-1 translate-y-1 rounded-lg border bg-card"
          style={{ borderColor: hue }}
        />
        {sameType && type ? (
          <span
            className="text-[10px] leading-none font-semibold tracking-wide uppercase"
            style={{ color: hue }}
            data-type-chip
          >
            {CRDT_SHORT[type]}
          </span>
        ) : null}
        <span className="font-mono text-[13px] leading-tight whitespace-nowrap" data-deck-label>
          {allOps ? tn('stage.nOps', count) : tn('stage.nMessages', count)}
        </span>
      </div>
      <div hidden>
        {group.messages.map((m) => (
          <span
            key={m.id}
            data-message={m.id}
            data-path={`msg:${m.id}`}
            data-from={m.from}
            data-to={m.to}
            data-state={m.state}
            data-decked=""
          />
        ))}
      </div>
    </motion.div>
  )
}

function deckOutcome(ids: readonly MessageId[], ex: ExitInfo | undefined): ExitOutcome | undefined {
  if (!ex) return undefined
  let out: ExitOutcome | undefined
  for (const id of ids) {
    const o = ex[id]
    if (o === 'delivered') return 'delivered'
    if (o === 'dropped') out = 'dropped'
  }
  return out
}
