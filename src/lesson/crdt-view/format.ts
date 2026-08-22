/**
 * Formatting helpers shared by the views: how a JSON value reads inside an op label or a token
 * summary, and how long strings are fitted into the ≤ 24-character token budget (DSL §2 legibility
 * limits; §5.1 "the token is drawn compact: type chip + a ≤ 24-character value summary (+n)").
 */
import { LIMITS } from '../types'

/** The scalar display budget: summaries and labels are fitted to this many characters. */
export const SUMMARY_MAX: number = LIMITS.maxScalarChars

/** A JSON value as it reads in a label: strings bare, `{k: v}` for objects, `[a, b]` for arrays. */
export function fmtValue(v: unknown): string {
  if (v === null || v === undefined) return 'null'
  if (typeof v === 'string') return v
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  if (Array.isArray(v)) return `[${v.map(fmtValue).join(', ')}]`
  if (typeof v === 'object') {
    const rec = v as Record<string, unknown>
    return `{${Object.keys(rec)
      .map((k) => `${k}: ${fmtValue(rec[k])}`)
      .join(', ')}}`
  }
  return String(v)
}

/** Strings quoted (`"h"`), everything else as `fmtValue` — the RGA insert label format. */
export function fmtQuoted(v: unknown): string {
  return typeof v === 'string' ? JSON.stringify(v) : fmtValue(v)
}

/** Middle-ellipsis to `max` characters (the renderer keeps the full text in `title`). */
export function truncate(s: string, max: number = SUMMARY_MAX): string {
  if (s.length <= max) return s
  if (max <= 1) return '…'
  const head = Math.ceil((max - 1) / 2)
  const tail = max - 1 - head
  return `${s.slice(0, head)}…${s.slice(s.length - tail)}`
}

/** Join as many `parts` as fit in `max` characters; the rest becomes a ` +n` suffix. */
export function joinFit(parts: readonly string[], sep = ', ', max: number = SUMMARY_MAX): string {
  if (parts.length === 0) return ''
  for (let k = parts.length; k >= 1; k -= 1) {
    const rest = parts.length - k
    const s = parts.slice(0, k).join(sep) + (rest > 0 ? ` +${rest}` : '')
    if (s.length <= max) return s
  }
  const rest = parts.length - 1
  const suffix = rest > 0 ? ` +${rest}` : ''
  return truncate(parts[0] ?? '', max - suffix.length) + suffix
}

/** Nodes in world `actors` order first, then unknown nodes (incl. the pseudo-node `seed`) by id. */
export function orderNodes(nodes: Iterable<string>, actors: readonly string[]): string[] {
  const set = new Set(nodes)
  const known = actors.filter((a) => set.has(a))
  const rest = [...set].filter((n) => !actors.includes(n)).sort()
  return [...known, ...rest]
}
