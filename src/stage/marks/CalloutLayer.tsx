/**
 * CalloutLayer: the HTML overlay for marks that are words — callout bubbles near a path's rect,
 * "no change" pills on a slot's corner and action chips (the operation that just changed a node)
 * on a node's corner. Rects come from the anchor registry, or from the `geometry` prop in tests.
 * The layer measures its own size so bubbles and chips can be kept inside the stage.
 */
import { useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { AnimatePresence } from 'motion/react'
import type { Path } from '@/lesson/types'
import { useStageMotion } from '../motion'
import { useStageFrame } from '../StageContext'
import { ActionChip } from './ActionChip'
import { Callout } from './Callout'
import { UnchangedPill } from './UnchangedPill'
import { useLayerGeometry, type Geometry } from './useLayerGeometry'

export interface CalloutLayerProps {
  /** Test seam: rects by DSL path instead of the measured registry snapshot. */
  geometry?: Geometry
}

export function CalloutLayer({ geometry }: CalloutLayerProps) {
  const { world, frame, actions, marksByPath } = useStageFrame()
  const { instant } = useStageMotion()
  const geo = useLayerGeometry(geometry)
  const root = useRef<HTMLDivElement>(null)
  const bounds = useBounds(root)
  const hasGlyph = (path: Path) =>
    (marksByPath.get(path) ?? []).some((m) => m.kind === 'check' || m.kind === 'cross')
  return (
    <div
      ref={root}
      className="pointer-events-none absolute inset-0"
      aria-hidden
      data-layer="callouts"
    >
      <AnimatePresence initial={!instant}>
        {world.marks.map((m) => {
          switch (m.kind) {
            case 'callout':
              return <Callout key={m.id} mark={m} anchor={geo.get(m.at)} bounds={bounds} />
            case 'unchanged':
              return <UnchangedPill key={m.id} mark={m} anchor={geo.get(m.path)} />
            default:
              return null
          }
        })}
        {Array.from(actions, ([path, label]) => (
          <ActionChip
            key={`${frame.index}:${path}`}
            path={path}
            label={label}
            anchor={geo.get(path)}
            bounds={bounds}
            geometry={geo}
            glyph={hasGlyph(path)}
          />
        ))}
      </AnimatePresence>
    </div>
  )
}

/** The layer's own size (= the stage container's), or null when unknown (jsdom). */
function useBounds(ref: RefObject<HTMLElement | null>): { w: number; h: number } | null {
  const [bounds, setBounds] = useState<{ w: number; h: number } | null>(null)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const read = () => {
      const w = el.clientWidth
      const h = el.clientHeight
      setBounds((prev) =>
        w === 0 && h === 0 ? null : prev && prev.w === w && prev.h === h ? prev : { w, h },
      )
    }
    read()
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(read) : null
    ro?.observe(el)
    return () => ro?.disconnect()
  }, [ref])
  return bounds
}
