/**
 * A callout bubble anchored near a path's rect: above by default, below when there is no room,
 * clamped inside the stage. Tone border + icon (colour is never the only signal); the text is
 * content and renders as-is. On `msg:<id>` it mounts once the token is at rest (after its travel;
 * instantly under reduced motion / instant).
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { motion } from 'motion/react'
import { CircleCheck, CircleX, Info, Sparkles, TriangleAlert, type LucideIcon } from 'lucide-react'
import type { Mark, Tone } from '@/lesson/types'
import { cn } from '@/lib/utils'
import type { Rect } from '../geometry'
import { useStageMotion } from '../motion'
import { TRAVEL_MS } from '../message/stacks'
import { placeCallout } from './markGeometry'
import { toneVar } from './tone'

const TONE_ICON: Record<Tone, LucideIcon> = {
  change: Sparkles,
  info: Info,
  ok: CircleCheck,
  warn: TriangleAlert,
  danger: CircleX,
}

export function Callout({
  mark,
  anchor,
  bounds,
}: {
  mark: Extract<Mark, { kind: 'callout' }>
  anchor: Rect | undefined
  bounds: { w: number; h: number } | null
}) {
  const { tr, off, ms } = useStageMotion()
  const onToken = mark.at.startsWith('msg:')
  const [ready, setReady] = useState(!onToken || off)
  useEffect(() => {
    if (ready) return
    const id = setTimeout(() => setReady(true), ms(TRAVEL_MS))
    return () => clearTimeout(id)
  }, [ready, ms])

  // Measure the bubble once it exists (and whenever it resizes) so it can be centred and clamped.
  // A callback ref: it runs when the bubble mounts, which may be after the `msg:` delay. 0×0 in jsdom.
  const [box, setBox] = useState({ w: 0, h: 0 })
  const observer = useRef<ResizeObserver | null>(null)
  const measure = useCallback((node: HTMLDivElement | null) => {
    observer.current?.disconnect()
    observer.current = null
    if (!node) return
    const read = () =>
      setBox((prev) =>
        prev.w === node.offsetWidth && prev.h === node.offsetHeight
          ? prev
          : { w: node.offsetWidth, h: node.offsetHeight },
      )
    read()
    if (typeof ResizeObserver !== 'undefined') {
      observer.current = new ResizeObserver(read)
      observer.current.observe(node)
    }
  }, [])

  if (!anchor || !ready) return null
  const place = placeCallout(anchor, box, bounds)
  const color = toneVar(mark.tone)
  const Icon = TONE_ICON[mark.tone]
  const above = place.side === 'above'
  return (
    <motion.div
      ref={measure}
      data-mark={mark.id}
      data-mark-kind="callout"
      data-tone={mark.tone}
      data-at={mark.at}
      data-side={place.side}
      className="absolute top-0 left-0 flex max-w-64 items-start gap-1.5 rounded-lg border bg-card px-3 py-2 text-xs leading-snug text-ink shadow-(--shadow-pop)"
      style={{ left: place.x, top: place.y, borderColor: color }}
      initial={off ? false : { opacity: 0, y: above ? 4 : -4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, transition: tr('exit') }}
      transition={tr('enter')}
    >
      <Icon className="mt-px size-3.5 shrink-0" style={{ color }} aria-hidden />
      <span>{mark.text}</span>
      {/* Tail: a rotated square on the edge facing the anchor, showing only its two outer sides. */}
      <span
        aria-hidden
        className={cn(
          'absolute size-2 rotate-45 bg-card',
          above ? '-bottom-[4.5px] border-r border-b' : '-top-[4.5px] border-t border-l',
        )}
        style={{ left: place.tailX - 4, borderColor: color }}
      />
    </motion.div>
  )
}
