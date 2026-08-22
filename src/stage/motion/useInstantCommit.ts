/**
 * Commit a state change without playing any Motion animation (layout glides, token flights,
 * exits). Used for prev / seek / load / scene change: "never animate backwards".
 * Wraps Motion's `useInstantTransition` so it can be swapped for `commitInstantly` if needed.
 */
import { useInstantTransition, MotionGlobalConfig, frame } from 'motion/react'
import { flushSync } from 'react-dom'

export function useInstantCommit(): (commit: () => void) => void {
  const instant = useInstantTransition()
  return (commit) => instant(commit)
}

/** Hook-free fallback with the same effect. */
export function commitInstantly(commit: () => void): void {
  MotionGlobalConfig.instantAnimations = true
  flushSync(commit)
  frame.postRender(() =>
    frame.postRender(() => {
      MotionGlobalConfig.instantAnimations = false
    }),
  )
}
