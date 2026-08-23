/**
 * Autoplay timing (DSL §7, stage-architecture §8): how long the player rests on a frame before
 * advancing. The hold covers the frame's animations (`animBudget`) plus reading time for the
 * narration (`HOLD[step.hold]`), both scaled by the speed multiplier. Under reduced motion nothing
 * animates, so only the reading time remains.
 */
import type { Change, Frame, Hold } from '@/lesson/types'

export const HOLD: Record<Hold, number> = { short: 1200, normal: 2200, long: 3600 }

/** Milliseconds reserved for the animations a frame's changes will play. */
export const ANIM_BUDGET = { message: 600, value: 350, none: 0 } as const

const MESSAGE_KINDS: ReadonlySet<Change['kind']> = new Set(['message', 'sync'])
const VALUE_KINDS: ReadonlySet<Change['kind']> = new Set(['value', 'actor', 'board', 'layout'])

export function animBudget(changes: readonly Change[]): number {
  let budget: number = ANIM_BUDGET.none
  for (const c of changes) {
    if (MESSAGE_KINDS.has(c.kind)) return ANIM_BUDGET.message
    if (VALUE_KINDS.has(c.kind)) budget = ANIM_BUDGET.value
  }
  return budget
}

/**
 * `(animBudget(changes) + HOLD[step.hold ?? 'normal']) / speed`; `reduced` zeroes the animation
 * budget (holds are unchanged, DSL §7). `speed` must be > 0.
 */
/** The flow frame dwells long enough to watch a few bars before autoplay moves on (at 1×). */
export const FLOW_DWELL_MS = 24_000

export function holdMs(frame: Frame, speed: number, reduced: boolean): number {
  if (frame.slide?.kind === 'flow') return FLOW_DWELL_MS / speed
  const anim = reduced ? 0 : animBudget(frame.changes)
  return (anim + HOLD[frame.step.hold ?? 'normal']) / speed
}
