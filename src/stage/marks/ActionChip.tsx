/**
 * The action chip: the operation that just changed a node (`Change.action`, DSL §14) — `inc 1`,
 * `set Lunch`, `add milk #alice:1`, `insert "h" after alice:1`, `append c`, `delete a`, `merge`,
 * `receive`, `tick` … — a sticky label pinned at the node's top-end corner, hanging above and
 * outward (like the "no change" pill) in the acting actor's hue (the accent when no actor acted:
 * a plain `set`). A tiny icon names the family, so colour is never the only signal. Drawn by the
 * CalloutLayer from the anchor registry, so it sits above cards and boards and never covers the
 * value text; it flips inward (back over the node's top edge) only when hanging outward would leave
 * the stage or run into another card or a board (`chipSide`). Transient by construction: it rides
 * on this step's changes and is gone with the next frame. Under `off` it renders at rest.
 */
import type { CSSProperties } from 'react'
import { motion } from 'motion/react'
import type { ActionLabel, Path } from '@/lesson/types'
import { useT } from '@/i18n'
import type { Rect } from '../geometry'
import { useStageMotion } from '../motion'
import { useStageFrame } from '../StageContext'
import { hueVars } from '../value/tone'
import { ACTION_ICONS, actionFamily } from './actionFamily'
import { chipSide, CHIP_GLYPH_CLEARANCE, CHIP_OVERLAP, estimateChipWidth } from './markGeometry'
import type { Geometry } from './useLayerGeometry'

const ACCENT: CSSProperties = {
  '--hue': 'var(--accent)',
  '--hue-soft': 'var(--accent-soft)',
} as CSSProperties

export interface ActionChipProps {
  path: Path
  label: ActionLabel
  anchor: Rect | undefined
  /** The layer's size, to keep the chip inside the stage (null when unknown). */
  bounds: { w: number; h: number } | null
  /** The layer's rects (cards and boards are looked up to keep the chip off them). */
  geometry: Geometry
  /** A check / cross glyph sits on the same corner. */
  glyph?: boolean
}

export function ActionChip({
  path,
  label,
  anchor,
  bounds,
  geometry,
  glyph = false,
}: ActionChipProps) {
  const t = useT()
  const { world } = useStageFrame()
  const { off, tr, dir } = useStageMotion()
  if (!anchor) return null
  const color = label.by === undefined ? undefined : world.actors[label.by]?.color
  const family = actionFamily(label.key)
  const Icon = ACTION_ICONS[family]
  const text = t(label.key, label.vars)
  const endX = dir === 'rtl' ? anchor.x : anchor.x + anchor.w
  const neighbours = [
    ...Object.keys(world.actors),
    ...Object.keys(world.boards).map((id) => `board.${id}`),
  ]
  const side = chipSide(path, anchor, estimateChipWidth(text), dir, bounds, geometry, neighbours)
  const extendsRight = dir === 'rtl' ? side === 'inward' : side === 'outward'
  const inset = glyph ? -CHIP_GLYPH_CLEARANCE : CHIP_OVERLAP
  const tx = extendsRight ? `${-inset}px` : `calc(-100% + ${inset}px)`
  const ty = `calc(-100% + ${inset}px)`
  return (
    <motion.div
      data-action={family}
      data-action-key={label.key}
      data-action-by={label.by}
      data-action-path={path}
      data-side={side}
      title={text}
      style={{
        left: endX,
        top: anchor.y,
        // The CSS `translate` property, not `transform`: Motion owns `transform` (y / scale).
        translate: `${tx} ${ty}`,
        ...(color ? hueVars(color) : ACCENT),
      }}
      className="absolute inline-flex h-4.5 max-w-56 items-center gap-1 rounded-full bg-(--hue-soft) px-1.5 font-sans text-[12px] leading-none font-medium whitespace-nowrap text-(--hue) shadow-xs ring-1 ring-card"
      initial={off ? false : { opacity: 0, y: 3, scale: 0.92 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, transition: tr('exit') }}
      transition={tr('enter')}
    >
      <Icon className="size-3 shrink-0" aria-hidden />
      <bdi className="truncate">{text}</bdi>
    </motion.div>
  )
}
