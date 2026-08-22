/**
 * usePlayer — the lesson player (stage-architecture §8, DSL §7).
 *
 * Owns: the current frame index, play/pause/ended, the speed (mirrored to the settings store), the
 * autoplay timer, and the side effects of moving: progress, analytics, sound. It never touches the
 * DOM. Moves that are not `next` (prev / seek / load / restart / play-from-the-end) are committed
 * through `useInstantCommit()` so the stage never animates backwards; the stage also receives
 * `instant` from `move.kind`.
 *
 * Sounds (DSL §7): a tick on every user/auto step (not on load); on a forward step, a bloop when
 * the new frame delivered a message (transient flights included) and a soft pop when one was
 * dropped (nothing for parked); the success chord when the topic ends.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef } from 'react'
import { track, type PlayerAction, type TopicRef } from '@/analytics'
import { DEFAULT_LOCALE, isLocale } from '@/i18n'
import type { Frame } from '@/lesson/types'
import { recordStep, topicKey, useReducedMotion, useSetting, type Speed } from '@/settings'
import { useSound } from '@/sound'
import { useInstantCommit } from '@/stage/motion'
import { holdMs } from './hold'
import {
  clamp,
  createInitialState,
  transition,
  type MoveKind,
  type PlayerEvent,
  type PlayerState,
} from './machine'

export interface UsePlayerOptions {
  /**
   * 0-based frame to start on (`?step=n` → `n - 1`). When it changes later (Back/Forward changed
   * the URL) the player seeks to it; values echoed back from `onIndexChange` are no-ops.
   */
  initialIndex?: number
  topic: TopicRef
  /** The page locale (any string; unknown values are reported as the default locale). */
  locale: string
  /**
   * Called after every index change with the new index and how we got there — wire the URL
   * (`?step=index+1`, replace) here. Also called on mount when `initialIndex` had to be clamped.
   */
  onIndexChange?: (index: number, move: MoveKind) => void
  /**
   * Default true. When false the player is inert: playback pauses, autoplay is suspended and the
   * automatic side effects (sound, `step_view`, `topic_complete`, progress) do not fire. Explicit
   * calls still transition state and are tracked as `player` actions.
   */
  enabled?: boolean
  /** `?motion=off`: every commit is instant; the stage never animates. */
  forceInstant?: boolean
}

export interface PlayerApi {
  state: PlayerState
  /** `frames[state.index]`; undefined only for an empty timeline. */
  frame: Frame | undefined
  /** The stage must commit this frame without animating (`move.kind !== 'next' || forceInstant`). */
  instant: boolean
  next(): void
  prev(): void
  toggle(): void
  play(): void
  pause(): void
  seek(index: number): void
  /** Back to frame 0; keeps playing if it was playing. */
  restart(): void
  /** Writes the speed setting (shared with the settings menu) and tracks `speed_change`. */
  setSpeed(speed: Speed): void
  /** Routed raw dispatch (instant commit for every move that is not `next`). Tracks nothing. */
  dispatch(e: PlayerEvent): void
}

const SOFT = { volume: 0.5 } as const

export function usePlayer(frames: readonly Frame[], opts: UsePlayerOptions): PlayerApi {
  const { initialIndex, onIndexChange, enabled = true, forceInstant = false } = opts
  const { module, unit, topic: topicId } = opts.topic
  const topic = useMemo<TopicRef>(() => ({ module, unit, topic: topicId }), [module, unit, topicId])
  const locale = isLocale(opts.locale) ? opts.locale : DEFAULT_LOCALE

  const [speedSetting, setSpeedSetting] = useSetting('speed')
  const reduced = useReducedMotion()
  const { play: sound } = useSound()
  const instantCommit = useInstantCommit()

  const [state, rawDispatch] = useReducer(
    transition,
    { total: frames.length, index: initialIndex, speed: speedSetting },
    createInitialState,
  )

  // Shadow of the reducer state, advanced eagerly in `dispatch` (every update goes through it and
  // `transition` is pure, so the fold matches React's) and re-synced on each commit. Handlers and
  // effects read it instead of a possibly stale closure.
  const stateRef = useRef(state)
  useLayoutEffect(() => {
    stateRef.current = state
  }, [state])
  // Values from the latest commit, for effects and handlers (`state` here is the committed one).
  const snapshot = {
    state,
    frames,
    topic,
    locale,
    initialIndex,
    onIndexChange,
    enabled,
    sound,
    instantCommit,
  }
  const latest = useRef(snapshot)
  useLayoutEffect(() => {
    latest.current = snapshot
  })
  /** The event that caused the latest move (effects tell `load` from a user/auto step by it). */
  const lastMoveEventRef = useRef<PlayerEvent | null>(null)

  const dispatch = useCallback((e: PlayerEvent) => {
    const cur = stateRef.current
    const nxt = transition(cur, e)
    const moved = nxt.move.seq !== cur.move.seq
    stateRef.current = nxt
    if (moved) lastMoveEventRef.current = e
    if (moved && nxt.move.kind !== 'next') {
      // prev / seek / load / play-from-the-end: never animate. Motion's instant transition skips
      // its callback when no projection node has mounted yet (no stage, or jsdom), so make sure
      // the dispatch happens regardless — the stage's `instant` flag still collapses transitions.
      let committed = false
      latest.current.instantCommit(() => {
        committed = true
        rawDispatch(e)
      })
      if (!committed) rawDispatch(e)
    } else {
      rawDispatch(e)
    }
  }, [])

  // ── Public actions (user intent: tracked as `player` events) ─────────────────────────────────
  const act = useCallback(
    (action: PlayerAction, e: PlayerEvent) => {
      const nxt = transition(stateRef.current, e)
      track('player', { ...latest.current.topic, action, index: nxt.index })
      dispatch(e)
    },
    [dispatch],
  )
  const next = useCallback(() => act('next', { t: 'next', source: 'user' }), [act])
  const prev = useCallback(() => act('prev', { t: 'prev' }), [act])
  const play = useCallback(() => act('play', { t: 'play' }), [act])
  const pause = useCallback(() => act('pause', { t: 'pause' }), [act])
  const toggle = useCallback(
    () => act(stateRef.current.status === 'playing' ? 'pause' : 'play', { t: 'toggle' }),
    [act],
  )
  const seek = useCallback((index: number) => act('seek', { t: 'seek', index }), [act])
  const restart = useCallback(() => {
    const wasPlaying = stateRef.current.status === 'playing'
    act('restart', { t: 'seek', index: 0 })
    if (wasPlaying) dispatch({ t: 'play' })
  }, [act, dispatch])
  const setSpeed = useCallback(
    (speed: Speed) => {
      setSpeedSetting(speed)
      dispatch({ t: 'setSpeed', speed })
      track('speed_change', { speed })
    },
    [dispatch, setSpeedSetting],
  )

  // ── Settings → state: the speed setting is the source of truth (the settings menu writes it too)
  useEffect(() => {
    if (stateRef.current.speed !== speedSetting) dispatch({ t: 'setSpeed', speed: speedSetting })
  }, [speedSetting, dispatch])

  // ── Frames changed (HMR, locale overlay): reload, keeping the index when possible ─────────────
  // `frames` must be memoized by the page (a timeline is immutable); a fresh but identical array
  // is tolerated, a fresh array of fresh frames on every render would reload every render.
  const framesRef = useRef(frames)
  useEffect(() => {
    const prevFrames = framesRef.current
    if (prevFrames === frames) return
    framesRef.current = frames
    if (prevFrames.length === frames.length && frames.every((f, i) => f === prevFrames[i])) return
    dispatch({ t: 'load', total: frames.length, index: stateRef.current.index })
  }, [frames, dispatch])

  // ── URL → state: an external `?step` change (Back/Forward) seeks; our own echo is a no-op ────
  useEffect(() => {
    if (initialIndex === undefined) return
    const { index, total } = stateRef.current
    const target = clamp(initialIndex, 0, total - 1)
    if (target !== index) dispatch({ t: 'seek', index: target })
  }, [initialIndex, dispatch])

  // ── Disabled players do not run ──────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!enabled && stateRef.current.status === 'playing') dispatch({ t: 'pause' })
  }, [enabled, dispatch])

  // ── Autoplay: rest on the frame for holdMs, then advance. Any state change re-arms it. ───────
  useEffect(() => {
    if (!enabled || state.status !== 'playing') return
    const frame = frames[state.index]
    if (!frame) return
    const id = window.setTimeout(
      () => dispatch({ t: 'next', source: 'auto' }),
      holdMs(frame, state.speed, reduced),
    )
    return () => window.clearTimeout(id)
  }, [state, frames, reduced, enabled, dispatch])

  // ── After every move: progress, step_view, sounds, URL ───────────────────────────────────────
  const seenIndexRef = useRef<number | null>(null)
  const { seq } = state.move
  useEffect(() => {
    const { state: committed, frames: fs, topic: tp, enabled: on, sound: playS } = latest.current
    const { index, total, move } = committed
    if (move.seq !== seq) return // a newer commit already ran this effect
    const first = seenIndexRef.current === null
    if (!first && seenIndexRef.current === index) return // a `load` that kept the index
    seenIndexRef.current = index
    const viaLoad = first || lastMoveEventRef.current?.t === 'load'
    const frame = fs[index]

    if (on && frame) {
      recordStep(topicKey(tp.module, tp.unit, tp.topic), index, total)
      track('step_view', { ...tp, scene: frame.sceneId, step: frame.step.id, index, total })
      if (!viaLoad) playS('tick')
      if (!first && move.kind === 'next') {
        const msgs = frame.changes.filter((c) => c.kind === 'message')
        if (msgs.some((c) => c.op === 'delivered')) playS('bloop')
        if (msgs.some((c) => c.op === 'dropped')) playS('pop', SOFT)
      }
    }
    const clampedStart = latest.current.initialIndex ?? 0
    if (!first || index !== clampedStart) latest.current.onIndexChange?.(index, move.kind)
  }, [seq])

  // ── Topic complete ───────────────────────────────────────────────────────────────────────────
  const mountedAtRef = useRef<number | null>(null)
  const completedRef = useRef(false)
  const endedHandledRef = useRef(false)
  useEffect(() => {
    mountedAtRef.current ??= Date.now()
  }, [])
  useEffect(() => {
    if (state.status !== 'ended') {
      endedHandledRef.current = false
      return
    }
    if (endedHandledRef.current) return
    endedHandledRef.current = true
    const { topic: tp, locale: loc, enabled: on, sound: playS } = latest.current
    if (!on) return
    playS('success')
    if (completedRef.current) return
    completedRef.current = true
    const since = mountedAtRef.current ?? Date.now()
    const seconds = Math.max(0, Math.round((Date.now() - since) / 1000))
    track('topic_complete', { ...tp, locale: loc, seconds })
  }, [state.status])

  const frame = frames[state.index]
  const instant = state.move.kind !== 'next' || forceInstant
  return useMemo<PlayerApi>(
    () => ({
      state,
      frame,
      instant,
      next,
      prev,
      toggle,
      play,
      pause,
      seek,
      restart,
      setSpeed,
      dispatch,
    }),
    [state, frame, instant, next, prev, toggle, play, pause, seek, restart, setSpeed, dispatch],
  )
}
