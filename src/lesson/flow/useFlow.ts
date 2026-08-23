/**
 * useFlow — the autopilot on a timer. Owns a sandbox started from the flow frame's world and, while
 * running, plans one beat (`planFlowStep`), runs it through the real reducer (`useSandbox.run`),
 * waits a beat scaled by the player speed, and goes again. Pausing keeps the world; "Shuffle"
 * reseeds and restarts from the lesson's state. Errors from the real code never stop the flow: the
 * beat is logged and the next one is planned from the unchanged world.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ActorId, Frame } from '../types'
import { useSandbox, type SandboxCtx, type SandboxMove, type UiText } from '../sandbox'
import { mulberry32, planFlowStep, seedOf, type FlowBeat, type Rng } from './autopilot'

export type FlowEvent = { n: number; beat: FlowBeat; text: string; actor?: ActorId; error?: string }

export interface FlowApi {
  /** The frame to draw: the start, or the result of the last beat. */
  frame: Frame
  move: SandboxMove
  running: boolean
  /** Beats played since the last (re)start. */
  n: number
  /** The last few beats, oldest first. */
  log: FlowEvent[]
  toggle: () => void
  shuffle: () => void
}

export interface FlowOptions {
  ctx: SandboxCtx
  /** Player speed multiplier; beats are `BEAT_MS / speed` apart. */
  speed: number
  /** Start running on mount (false under verify / instant / reduced motion — the Run key still works). */
  autoStart: boolean
  /** Resolves a sandbox `UiText` (the beat's narration) to a string. */
  text: (ui: UiText) => string
  /** Override the seed (tests); defaults to a hash of the topic id. */
  seed?: number
}

/** Milliseconds between beats at 1×: a sync beat gets a little longer so the token can land. */
export const BEAT_MS = { update: 1500, sync: 2100, offline: 1800, online: 1800 } as const
const LOG_MAX = 5

export function useFlow(start: Frame, opts: FlowOptions): FlowApi {
  const { ctx, speed, autoStart, text, seed } = opts
  const sandbox = useSandbox(start, ctx)
  const [running, setRunning] = useState(autoStart)
  const [log, setLog] = useState<FlowEvent[]>([])
  const [n, setN] = useState(0)
  const baseSeed = seed ?? seedOf(ctx.topicId ?? ctx.sceneId)
  const rng = useRef<Rng>(mulberry32(baseSeed))
  const startRef = useRef(start)

  // A new start frame (the lesson moved) restarts the flow from scratch.
  useEffect(() => {
    if (startRef.current === start) return
    startRef.current = start
    rng.current = mulberry32(baseSeed)
    setN(0)
    setLog([])
  }, [start, baseSeed])

  const frame = sandbox.frame
  const last = log[log.length - 1]
  const beatMs = BEAT_MS[last?.beat ?? 'update'] / Math.max(0.25, speed)
  const { run, reset } = sandbox

  useEffect(() => {
    if (!running) return
    const id = setTimeout(() => {
      const plan = planFlowStep(frame.world, rng.current, n)
      if (!plan) {
        setRunning(false)
        return
      }
      const say = text(plan.say)
      const r = run(plan.commands, say)
      const ev: FlowEvent = { n, beat: plan.beat, text: say }
      if (plan.actor !== undefined) ev.actor = plan.actor
      if (!r.ok) ev.error = r.error
      setLog((l) => [...l.slice(-(LOG_MAX - 1)), ev])
      setN(n + 1)
    }, beatMs)
    return () => clearTimeout(id)
  }, [running, frame, n, beatMs, run, text])

  const toggle = useCallback(() => setRunning((r) => !r), [])
  const shuffle = useCallback(() => {
    rng.current = mulberry32((baseSeed + (n + 1) * 0x9e3779b1) >>> 0)
    reset()
    setN(0)
    setLog([])
    setRunning(true)
  }, [baseSeed, n, reset])

  return useMemo<FlowApi>(
    () => ({ frame, move: sandbox.move, running, n, log, toggle, shuffle }),
    [frame, sandbox.move, running, n, log, toggle, shuffle],
  )
}
