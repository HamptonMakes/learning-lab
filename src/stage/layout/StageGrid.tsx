/**
 * StageGrid — the actor grid. One CSS grid per layout preset (`data-layout`, see stage.css); cards
 * take named slots in insertion order (presets.ts). Spawn/remove animate through AnimatePresence;
 * `initial={false}` under an instant commit so a seek renders at rest.
 */
import { AnimatePresence } from 'motion/react'
import { ActorCard } from '../actor/ActorCard'
import { useStageMotion } from '../motion/StageMotionProvider'
import { useStageFrame } from '../StageContext'
import { hubOf, HUB_PRESETS, placeActors } from './presets'

export function StageGrid() {
  const { world } = useStageFrame()
  const { instant } = useStageMotion()
  const actors = Object.values(world.actors)
  const placements = placeActors(actors, world.layout)
  const hub = HUB_PRESETS.has(world.layout.preset) ? hubOf(actors, world.layout) : undefined
  return (
    <div className="stage-actors" data-layout={world.layout.preset} data-hub={hub}>
      <AnimatePresence initial={!instant}>
        {placements.map(({ actor, slot }) => (
          <ActorCard key={actor.id} actor={actor} slot={slot} />
        ))}
      </AnimatePresence>
    </div>
  )
}
