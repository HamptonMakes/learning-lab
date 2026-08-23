/**
 * <Stage> — renders one Frame (DSL §14) as a static, animatable picture. The stage is a pure
 * function of the frame plus a motion context: Motion animates the difference between consecutive
 * frames; nothing visible depends on an animation having played.
 *
 * Composition (stage-architecture §3): StageMotionProvider (speed, reduced motion, instant) →
 * StageFrameProvider (changed paths, via, marks by path) → AnchorRegistryProvider (measured rects by
 * DSL path) → the root `[data-stage]` div → LayoutGroup → actor grid + board gutter, clock HUD and
 * the overlay layers (messages, marks, callouts), which position themselves over the root.
 *
 * The root is `position: relative`, `overflow: visible` and never transformed, so overlays can be
 * measured in its coordinates. AnchorRegistryProvider wraps the root (not the reverse) so its layout
 * effects run after the root's ref is attached.
 */
import { createContext, useCallback, useContext, useRef } from 'react'
import { LayoutGroup } from 'motion/react'
import { SlideView } from './Slide'
import type { ActorId, Frame, Message } from '@/lesson/types'
import { cn } from '@/lib/utils'
import { AnchorRegistryProvider } from './geometry/AnchorRegistry'
import { StageMotionProvider } from './motion/StageMotionProvider'
import { StageFrameProvider } from './StageContext'
import { StageGrid } from './layout/StageGrid'
import { BoardGutter } from './board/BoardGutter'
import { ClockHud } from './hud/ClockHud'
import { MessageLayer } from './message/MessageLayer'
import { MarkLayer } from './marks/MarkLayer'
import { CalloutLayer } from './marks/CalloutLayer'
import './layout/stage.css'

/** Things the stage reports back to the page (sounds, analytics, tests) as animations land. */
export type StageEvent =
  | { kind: 'message'; op: 'sent' | 'parked' | 'delivered' | 'dropped'; message: Message }
  | { kind: 'layout'; op: 'start' | 'complete'; actor: ActorId }

export type StageEventHandler = (event: StageEvent) => void

const StageEventContext = createContext<StageEventHandler>(() => {})

/** Layers and cards call this to report an event; a no-op when the page passed no `onEvent`. */
export function useStageEvents(): StageEventHandler {
  return useContext(StageEventContext)
}

export interface StageProps {
  frame: Frame
  /** Player speed multiplier (0.5 … 3). */
  speed: number
  /** The user's reduced-motion setting (the OS preference is read live). */
  reducedSetting: boolean
  /** Commit without animating: prev / seek / load / verify mode. */
  instant: boolean
  dir: 'ltr' | 'rtl'
  onEvent?: StageEventHandler
  className?: string
}

export function Stage({
  frame,
  speed,
  reducedSetting,
  instant,
  dir,
  onEvent,
  className,
}: StageProps) {
  const container = useRef<HTMLDivElement>(null)
  const emit = useCallback<StageEventHandler>((event) => onEvent?.(event), [onEvent])
  return (
    <StageMotionProvider speed={speed} reducedSetting={reducedSetting} instant={instant} dir={dir}>
      <StageFrameProvider frame={frame}>
        <StageEventContext.Provider value={emit}>
          <AnchorRegistryProvider container={container}>
            {/* The bezel wraps the root (never the reverse): overlays measure against the root's
                border-box, so the root itself carries no border. */}
            <div className="bezel" data-stage-bezel="">
              <div
                ref={container}
                dir={dir}
                data-stage=""
                data-step={frame.step.id}
                data-step-index={frame.index}
                data-scene={frame.sceneId}
                data-layout={frame.world.layout.preset}
                data-instant={instant ? '' : undefined}
                className={cn(
                  'relative min-h-(--stage-min-h) overflow-visible rounded-[2px] stage-surface text-ink',
                  className,
                )}
              >
                {frame.slide ? (
                  <SlideView slide={frame.slide} />
                ) : (
                  <LayoutGroup id={frame.sceneId}>
                    <div className="stage-layout">
                      <StageGrid />
                      <BoardGutter />
                    </div>
                    <ClockHud />
                    <MessageLayer />
                    <MarkLayer />
                    <CalloutLayer />
                  </LayoutGroup>
                )}
              </div>
            </div>
          </AnchorRegistryProvider>
        </StageEventContext.Provider>
      </StageFrameProvider>
    </StageMotionProvider>
  )
}
