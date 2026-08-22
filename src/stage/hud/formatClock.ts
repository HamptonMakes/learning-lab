/**
 * Clock formatting shared by the corner HUD and the per-actor clock badge (DSL §2 Clock,
 * stage-architecture §5.6): 'counter' → `t=3`, 'ms' → `150 ms`, 'time' → `hh:mm` = start + value
 * minutes. Pure; the UI strings come in through `t`.
 */
import type { Clock } from '@/lesson/types'

export type ClockFormat = Pick<Clock, 'format' | 'start'>

export type ClockTranslate = (
  key: 'stage.clock.counter' | 'stage.clock.ms',
  vars: { now: number },
) => string

const MINUTES_PER_DAY = 24 * 60

/** Minutes since midnight for an `hh:mm` string; 0 when missing or malformed. */
export function parseHhMm(start: string | undefined): number {
  if (!start) return 0
  const m = /^(\d{1,2}):(\d{2})$/.exec(start.trim())
  if (!m) return 0
  const h = Number(m[1])
  const min = Number(m[2])
  if (h > 23 || min > 59) return 0
  return h * 60 + min
}

const pad = (n: number) => String(n).padStart(2, '0')

/** `start` + `minutes`, wrapped to a 24-hour day, as `hh:mm`. */
export function formatTime(start: string | undefined, minutes: number): string {
  const total =
    ((((parseHhMm(start) + Math.trunc(minutes)) % MINUTES_PER_DAY) + MINUTES_PER_DAY) %
      MINUTES_PER_DAY) |
    0
  return `${pad(Math.floor(total / 60))}:${pad(total % 60)}`
}

/** The clock reading `value` in the scene's format. */
export function formatClock(clock: ClockFormat, value: number, t: ClockTranslate): string {
  switch (clock.format) {
    case 'counter':
      return t('stage.clock.counter', { now: value })
    case 'ms':
      return t('stage.clock.ms', { now: value })
    case 'time':
      return formatTime(clock.start, value)
  }
}

/** A signed skew: `+5`, `−2` (true minus sign), `+0`. */
export function formatDelta(n: number): string {
  return n < 0 ? `−${Math.abs(n)}` : `+${n}`
}
