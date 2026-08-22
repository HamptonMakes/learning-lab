/**
 * Conflict mark: a zig-zag bolt between the facing edges of two anchors, danger tone, drawn on
 * with `pathLength` (instant under reduced motion / instant commits), plus a bolt badge at the midpoint
 * so colour is not the only signal.
 */
import { motion } from 'motion/react'
import type { Mark } from '@/lesson/types'
import { useStageMotion } from '../motion'
import { boltPath, BOLT_GLYPH_D } from './markGeometry'
import type { Geometry } from './useLayerGeometry'

export function ConflictBolt({
  mark,
  geometry,
}: {
  mark: Extract<Mark, { kind: 'conflict' }>
  geometry: Geometry
}) {
  const { tr, off } = useStageMotion()
  const a = geometry.get(mark.a)
  const b = geometry.get(mark.b)
  if (!a || !b) return null
  const { d, mid } = boltPath(a, b)
  const draw = tr('draw')
  const badgeIn = {
    ...tr('enter'),
    delay: typeof draw.duration === 'number' ? draw.duration * 0.6 : 0,
  }
  return (
    <motion.g
      data-mark={mark.id}
      data-mark-kind="conflict"
      data-a={mark.a}
      data-b={mark.b}
      exit={{ opacity: 0, transition: tr('exit') }}
    >
      <motion.path
        d={d}
        fill="none"
        stroke="var(--danger)"
        strokeWidth={2.5}
        strokeLinejoin="round"
        strokeLinecap="round"
        initial={off ? false : { pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={draw}
      />
      <motion.g
        transform={`translate(${mid.x} ${mid.y})`}
        initial={off ? false : { opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={badgeIn}
      >
        <circle r={10} fill="var(--danger-soft)" stroke="var(--danger)" strokeWidth={1.5} />
        <path d={BOLT_GLYPH_D} fill="var(--danger)" />
      </motion.g>
    </motion.g>
  )
}
