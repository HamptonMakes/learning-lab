/**
 * Transition presets for the stage. Primitives never write a literal `transition`: they call
 * `tr(kind)` from the StageMotion context, which scales by speed and collapses to instant under
 * reduced motion or an instant commit (prev / seek / load).
 */
import type { Transition } from 'motion/react'

export type TransitionKind = 'travel' | 'settle' | 'layout' | 'flash' | 'draw' | 'enter' | 'exit'

export const BASE_TRANSITIONS: Record<TransitionKind, Transition> = {
  travel: { type: 'tween', duration: 0.6, ease: [0.2, 0.8, 0.2, 1] },
  settle: { type: 'spring', visualDuration: 0.32, bounce: 0.15 },
  layout: { type: 'spring', visualDuration: 0.36, bounce: 0.1 },
  flash: { type: 'tween', duration: 0.5, times: [0, 0.3, 1] },
  draw: { type: 'tween', duration: 0.45, ease: 'easeOut' },
  enter: { type: 'tween', duration: 0.25, ease: 'easeOut' },
  exit: { type: 'tween', duration: 0.18, ease: 'easeIn' },
}

/** Motion: `type: false` means "instant". */
export const INSTANT: Transition = { type: false }

export function scaleTransition(t: Transition, speed: number): Transition {
  const s = 1 / speed
  const out: Transition = { ...t }
  if (typeof out.duration === 'number') out.duration *= s
  if ('visualDuration' in out && typeof out.visualDuration === 'number') out.visualDuration *= s
  if (typeof out.delay === 'number') out.delay *= s
  return out
}

/** Base milliseconds for timers outside Motion (via chips, pulses). */
export const BASE_MS = { flash: 500, pulse: 700, chip: 1400 } as const
