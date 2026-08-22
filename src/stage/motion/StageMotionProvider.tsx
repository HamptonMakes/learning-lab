/**
 * One provider for everything time-related on the stage:
 *  - MotionConfig supplies the default transition (speed-scaled) and reducedMotion to every
 *    motion element, layout animations included;
 *  - StageMotionContext supplies `tr(kind)` / `ms(base)` for explicit transitions and timers,
 *    plus the `instant`, `reduced`, `speed`, `dir` flags primitives branch on.
 * reducedMotion is read by Motion at mount, so the subtree is keyed on it (cheap: a few cards).
 */
import { createContext, useContext, useMemo, type ReactNode } from 'react'
import { MotionConfig, useReducedMotion, type Transition } from 'motion/react'
import { BASE_TRANSITIONS, INSTANT, scaleTransition, type TransitionKind } from './transitions'

export interface StageMotion {
  speed: number
  /** Reduced motion from the user setting or the OS. */
  reduced: boolean
  /** This commit must not animate (prev / seek / load / verify mode). */
  instant: boolean
  /** Convenience: reduced || instant. */
  off: boolean
  dir: 'ltr' | 'rtl'
  tr: (kind: TransitionKind) => Transition
  ms: (baseMs: number) => number
}

const Ctx = createContext<StageMotion | null>(null)

export function useStageMotion(): StageMotion {
  const v = useContext(Ctx)
  if (!v) throw new Error('useStageMotion must be used inside <StageMotionProvider>')
  return v
}

export interface StageMotionProviderProps {
  speed: number
  /** The user's reduced-motion setting (OS preference is read live here). */
  reducedSetting: boolean
  instant: boolean
  dir: 'ltr' | 'rtl'
  children: ReactNode
}

export function StageMotionProvider({
  speed,
  reducedSetting,
  instant,
  dir,
  children,
}: StageMotionProviderProps) {
  const prefers = useReducedMotion() ?? false
  const reduced = reducedSetting || prefers
  const off = reduced || instant
  const value = useMemo<StageMotion>(
    () => ({
      speed,
      reduced,
      instant,
      off,
      dir,
      tr: (kind) => (off ? INSTANT : scaleTransition(BASE_TRANSITIONS[kind], speed)),
      ms: (base) => (off ? 0 : base / speed),
    }),
    [speed, reduced, instant, off, dir],
  )
  const transition = useMemo<Transition>(
    () =>
      off
        ? INSTANT
        : {
            ...scaleTransition(BASE_TRANSITIONS.settle, speed),
            layout: scaleTransition(BASE_TRANSITIONS.layout, speed),
          },
    [off, speed],
  )
  return (
    <Ctx.Provider value={value}>
      <MotionConfig
        key={String(reduced)}
        reducedMotion={reduced ? 'always' : 'user'}
        transition={transition}
      >
        {children}
      </MotionConfig>
    </Ctx.Provider>
  )
}
