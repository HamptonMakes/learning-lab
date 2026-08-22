/**
 * The player state machine — a pure function of (state, event). Transcribed from
 * `docs/stage-architecture.md` §8; the comments there are the contract.
 *
 * Invariants:
 *  - `index` is always within `[0, total - 1]` (or 0 when `total` is 0).
 *  - `move` records how we got to `index`: `kind` is what the stage branches on (`next` animates,
 *    `prev`/`seek` commit instantly) and `seq` bumps once per move so effects can key on it.
 *  - `next` at the last frame while playing → `ended`; `play` from the end restarts at frame 0.
 */
import type { Speed } from '@/settings'

export type { Speed }

export type MoveKind = 'next' | 'prev' | 'seek'
export type PlayerStatus = 'paused' | 'playing' | 'ended'
export type PlayerMode = 'lesson' | 'sandbox'

export type PlayerState = {
  index: number
  total: number
  status: PlayerStatus
  speed: Speed
  /** sandbox: Try-it drives the same reducer from the scene's final world (DSL §11). */
  mode: PlayerMode
  /** How we got to `index`; `seq` bumps per move (effects key on it). */
  move: { kind: MoveKind; seq: number }
}

export type PlayerEvent =
  | { t: 'next'; source: 'user' | 'auto' }
  | { t: 'prev' }
  | { t: 'seek'; index: number }
  | { t: 'play' }
  | { t: 'pause' }
  | { t: 'toggle' }
  | { t: 'setSpeed'; speed: Speed }
  | { t: 'load'; total: number; index: number }

/** Clamp `v` into `[lo, hi]`; when `hi < lo` (an empty timeline) the result is `lo`. */
export function clamp(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), Math.max(lo, hi))
}

export interface InitialStateOptions {
  total: number
  index?: number
  speed?: Speed
  mode?: PlayerMode
}

export function createInitialState({
  total,
  index = 0,
  speed = 1,
  mode = 'lesson',
}: InitialStateOptions): PlayerState {
  return {
    index: clamp(index, 0, total - 1),
    total,
    status: 'paused',
    speed,
    mode,
    move: { kind: 'seek', seq: 0 },
  }
}

export function transition(s: PlayerState, e: PlayerEvent): PlayerState {
  const last = s.total - 1
  const go = (index: number, kind: MoveKind): PlayerState => ({
    ...s,
    index,
    move: { kind, seq: s.move.seq + 1 },
  })
  switch (e.t) {
    case 'load':
      return {
        ...s,
        total: e.total,
        index: clamp(e.index, 0, e.total - 1),
        status: 'paused',
        move: { kind: 'seek', seq: s.move.seq + 1 },
      }
    case 'next':
      if (s.index >= last) return s.status === 'playing' ? { ...s, status: 'ended' } : s
      return go(s.index + 1, 'next')
    case 'prev':
      return s.index === 0
        ? s
        : { ...go(s.index - 1, 'prev'), status: s.status === 'ended' ? 'paused' : s.status }
    case 'seek':
      return e.index === s.index ? s : { ...go(clamp(e.index, 0, last), 'seek'), status: 'paused' }
    case 'play':
      return s.index >= last ? { ...go(0, 'seek'), status: 'playing' } : { ...s, status: 'playing' }
    case 'pause':
      return { ...s, status: 'paused' }
    case 'toggle':
      return transition(s, { t: s.status === 'playing' ? 'pause' : 'play' })
    case 'setSpeed':
      return s.speed === e.speed ? s : { ...s, speed: e.speed }
  }
}

/** True when applying `e` to `s` moves the player (the stage will re-render a different frame). */
export function moves(s: PlayerState, e: PlayerEvent): boolean {
  return transition(s, e).move.seq !== s.move.seq
}
