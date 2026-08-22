/**
 * Canonical strings for `data-value` (DSL §14) and small display formatters shared by the views.
 * `data-value` is what tests and the narration lint read, so it is deterministic and never
 * localized: scalar → String(value); record / list / set / table → compact JSON of the plain value
 * (§4.5 rules, tombstones excluded); counter → total; clock → `alice2 bob1`; bytes → lower-case hex;
 * text → the text; pattern → its source; meter → its value. A `display: 'text'` list reads as the
 * joined string (its §4.5 plain value accepts that too).
 */
import type { Clock, Scalar, Value, VectorClock } from '@/lesson/types'
import { plainValue, toHex } from '@/lesson/path'

export function formatScalar(v: Scalar): string {
  return v === null ? 'null' : String(v)
}

/** `alice2 bob1` — compact clock / version vector (entries keep their given order, DSL §5.2). */
export function compactClock(entries: VectorClock): string {
  return Object.entries(entries)
    .map(([node, n]) => `${node}${n}`)
    .join(' ')
}

/** `alice: 2, bob: 1` — the long form for `title`. */
export function fullClock(entries: VectorClock): string {
  return Object.entries(entries)
    .map(([node, n]) => `${node}: ${n}`)
    .join(', ')
}

export function dataValueOf(v: Value): string {
  switch (v.kind) {
    case 'scalar':
      return formatScalar(v.value)
    case 'list':
      if (v.display === 'text') {
        return v.items
          .filter((it) => !it.value.meta?.tombstone)
          .map((it) => (it.value.kind === 'scalar' ? formatScalar(it.value.value) : ''))
          .join('')
      }
      return JSON.stringify(plainValue(v))
    case 'record':
    case 'set':
    case 'table':
      return JSON.stringify(plainValue(v))
    case 'counter':
      return String(v.total)
    case 'clock':
      return compactClock(v.entries)
    case 'bytes':
      return toHex(v.bytes)
    case 'text':
      return v.text
    case 'pattern':
      return v.tokens.map((t) => t.src).join('')
    case 'meter':
      return String(v.value)
  }
}

export const hex2 = (b: number): string => b.toString(16).padStart(2, '0')
export const bits8 = (b: number): string => b.toString(2).padStart(8, '0')
/** `0111 0100` — the eight bits of a byte, split at the nibble. */
export const bitsGrouped = (b: number): string => `${bits8(b).slice(0, 4)} ${bits8(b).slice(4)}`

/** `hh:mm` for a 'time' clock: `start` plus `minutes`. */
export function clockTime(start: string | undefined, minutes: number): string {
  const [h = '0', m = '0'] = (start ?? '00:00').split(':')
  const total = (((Number(h) * 60 + Number(m) + minutes) % 1440) + 1440) % 1440
  const hh = String(Math.floor(total / 60)).padStart(2, '0')
  const mm = String(total % 60).padStart(2, '0')
  return `${hh}:${mm}`
}

/**
 * A stamp (`meta.ts`, `addTs`, `removeTs`, an HLC wall) in the scene's clock format: `t=3` for a
 * counter clock, `150 ms` for milliseconds, `10:05` for a wall clock. `t()` supplies the first two.
 */
export function formatStamp(
  ts: number,
  clock: Pick<Clock, 'format' | 'start'>,
  t: (key: string, vars?: Record<string, string | number>) => string,
): string {
  switch (clock.format) {
    case 'ms':
      return t('stage.clock.ms', { now: ts })
    case 'time':
      return clockTime(clock.start, ts)
    default:
      return t('stage.clock.counter', { now: ts })
  }
}

/** World actor order first, then unknown nodes by id (DSL §5.2). */
export function orderEntries(vc: VectorClock, actorOrder: readonly string[]): VectorClock {
  const out: VectorClock = {}
  for (const id of actorOrder) if (id in vc) out[id] = vc[id] ?? 0
  for (const id of Object.keys(vc).sort()) if (!(id in out)) out[id] = vc[id] ?? 0
  return out
}
