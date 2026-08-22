/**
 * MarkLayer: one absolutely positioned SVG over the stage for the cross-node marks — conflict
 * bolts, compare links + verdict chips, flow arrows. Highlight rings and check/cross glyphs are
 * drawn by the value nodes themselves (they decorate their own box), callouts and unchanged pills
 * by CalloutLayer (HTML). Rects come from the anchor registry, or from the `geometry` prop in tests.
 */
import { AnimatePresence } from 'motion/react'
import { useStageMotion } from '../motion'
import { useStageFrame } from '../StageContext'
import { CompareLinks } from './CompareLinks'
import { ConflictBolt } from './ConflictBolt'
import { FlowArrow } from './FlowArrow'
import { useLayerGeometry, type Geometry } from './useLayerGeometry'

export interface MarkLayerProps {
  /** Test seam: rects by DSL path instead of the measured registry snapshot. */
  geometry?: Geometry
}

export function MarkLayer({ geometry }: MarkLayerProps) {
  const { world } = useStageFrame()
  const { instant } = useStageMotion()
  const geo = useLayerGeometry(geometry)
  return (
    <svg
      className="pointer-events-none absolute inset-0 h-full w-full overflow-visible"
      aria-hidden
      data-layer="marks"
    >
      <AnimatePresence initial={!instant}>
        {world.marks.map((m) => {
          switch (m.kind) {
            case 'conflict':
              return <ConflictBolt key={m.id} mark={m} geometry={geo} />
            case 'compare':
              return <CompareLinks key={m.id} mark={m} geometry={geo} world={world} />
            case 'flow':
              return <FlowArrow key={m.id} mark={m} geometry={geo} />
            default:
              return null
          }
        })}
      </AnimatePresence>
    </svg>
  )
}
