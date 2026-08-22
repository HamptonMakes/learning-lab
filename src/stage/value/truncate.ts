/**
 * Middle ellipsis for scalar display (DSL §2 legibility: ≤ 24 characters; the full value stays in
 * `title` / `data-value`). Counts code points so an emoji is never cut in half.
 */
import { LIMITS } from '@/lesson/types'

export const SCALAR_MAX = LIMITS.maxScalarChars

export function middleEllipsis(s: string, max: number = SCALAR_MAX): string {
  const chars = Array.from(s)
  if (chars.length <= max) return s
  if (max <= 1) return '…'
  const keep = max - 1
  const head = Math.ceil(keep / 2)
  const tail = keep - head
  return `${chars.slice(0, head).join('')}…${tail > 0 ? chars.slice(chars.length - tail).join('') : ''}`
}

export function isTruncated(s: string, max: number = SCALAR_MAX): boolean {
  return Array.from(s).length > max
}
