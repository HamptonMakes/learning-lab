/**
 * Compare mark. Two paths: one slightly curved link with a verdict chip at its midpoint (glyph +
 * word, `= equal`, `≺ before`, `∥ concurrent`; plus the reason for the `stamp` rule, `ts 1 < 2`).
 * More paths: `=` / `≠` links chained between consecutive anchors. Links draw on with `pathLength`;
 * the chip is HTML inside a <foreignObject> so it keeps the design system's typography and bidi
 * handling (the directional glyphs are mirrored characters).
 */
import { motion } from 'motion/react'
import type { Mark, World } from '@/lesson/types'
import { useT } from '@/i18n'
import { arcBetween, type Point, type Rect } from '../geometry'
import { useStageMotion } from '../motion'
import { Pill } from '../actor/Pill'
import { stampReason } from './stampReason'
import { pillTone, toneVar, VERDICT_GLYPH, verdictTone } from './tone'
import type { Geometry } from './useLayerGeometry'

const LINK_BULGE = 0.1
const CHIP_BOX = { w: 240, h: 40 }

export function CompareLinks({
  mark,
  geometry,
  world,
}: {
  mark: Extract<Mark, { kind: 'compare' }>
  geometry: Geometry
  world: World
}) {
  const t = useT()
  const { tr, off } = useStageMotion()
  const rects: Rect[] = []
  for (const p of mark.paths) {
    const r = geometry.get(p)
    if (!r) return null
    rects.push(r)
  }
  if (rects.length < 2) return null
  const tone = verdictTone(mark.verdict)
  const color = toneVar(tone)
  const draw = tr('draw')
  const chipIn = {
    ...tr('enter'),
    delay: typeof draw.duration === 'number' ? draw.duration * 0.7 : 0,
  }
  const links = rects.slice(1).map((r, i) => {
    const prev = rects[i]
    return prev ? arcBetween(prev, r, LINK_BULGE) : null
  })
  const two = rects.length === 2
  const word = t(`stage.verdict.${mark.verdict}`)
  const reason =
    mark.rule === 'stamp' && two ? stampReason(world, mark.paths, mark.verdict) : undefined

  return (
    <motion.g
      data-mark={mark.id}
      data-mark-kind="compare"
      data-verdict={mark.verdict}
      data-rule={mark.rule}
      exit={{ opacity: 0, transition: tr('exit') }}
    >
      {links.map((arc, i) =>
        arc ? (
          <motion.path
            key={i}
            d={arc.d}
            fill="none"
            stroke={color}
            strokeWidth={1.5}
            strokeLinecap="round"
            initial={off ? false : { pathLength: 0 }}
            animate={{ pathLength: 1 }}
            transition={draw}
          />
        ) : null,
      )}
      {links.map((arc, i) =>
        arc ? (
          <Chip key={`c${i}`} at={arc.at(0.5)} transition={chipIn} off={off}>
            <Pill tone={pillTone(tone)} data-verdict-chip="" className="shadow-sm">
              <span className="font-mono font-semibold text-(--pill-fg)">
                {two ? VERDICT_GLYPH[mark.verdict] : mark.verdict === 'equal' ? '=' : '≠'}
              </span>
              {two ? (
                <>
                  {' '}
                  <span>{word}</span>
                </>
              ) : null}
              {two && reason ? (
                <>
                  {' '}
                  <span className="font-mono text-ink-2">{reason}</span>
                </>
              ) : null}
            </Pill>
          </Chip>
        ) : null,
      )}
    </motion.g>
  )
}

/** An HTML chip centred on an SVG point. */
function Chip({
  at,
  transition,
  off,
  children,
}: {
  at: Point
  transition: ReturnType<ReturnType<typeof useStageMotion>['tr']>
  off: boolean
  children: React.ReactNode
}) {
  return (
    <foreignObject
      x={at.x - CHIP_BOX.w / 2}
      y={at.y - CHIP_BOX.h / 2}
      width={CHIP_BOX.w}
      height={CHIP_BOX.h}
      style={{ overflow: 'visible' }}
    >
      <div className="flex h-full w-full items-center justify-center">
        <motion.div
          initial={off ? false : { opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={transition}
        >
          {children}
        </motion.div>
      </div>
    </foreignObject>
  )
}
