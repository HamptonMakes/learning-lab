/**
 * Path builders for the sub-nodes a value view renders (DSL §3). Kept in one place so every view
 * and every test spells a child path the same way.
 */
import type { Path } from '@/lesson/types'

/** Record field / clock entry / table column: `alice.doc.title`. */
export const fieldPath = (path: Path, key: string): Path => `${path}.${key}`
/** List/set item, counter row, table row, byte, pattern token: `alice.cart[milk]`. */
export const itemPath = (path: Path, id: string | number): Path => `${path}[${id}]`
/** Sidecar selector: `alice.status@ts`, `alice.text@cursor`. */
export const metaPath = (path: Path, key: string): Path => `${path}@${key}`
/** Byte / character range, half-open: `laptop.id[0..6]`. */
export const rangePath = (path: Path, from: number, to: number): Path => `${path}[${from}..${to}]`

/** A value drawn inside a message token (payloads are not addressable; no shared layout ids). */
export const isTokenPath = (path: Path): boolean => path.startsWith('msg:')

/**
 * The node that holds `path` (`alice.doc.title` → `alice.doc`, `alice.cart[milk]` → `alice.cart`,
 * `alice.cart[milk].qty` → `alice.cart[milk]`); undefined for a root (`alice`, `msg:m1`). Keys never
 * contain `.` / `[` / `]`; ids never contain `]` (DSL §3).
 */
export function parentPath(path: Path): Path | undefined {
  const selector = path.indexOf('@')
  const base = selector >= 0 ? path.slice(0, selector) : path
  if (base.endsWith(']')) {
    const open = base.lastIndexOf('[')
    return open > 0 ? base.slice(0, open) : undefined
  }
  const dot = base.lastIndexOf('.')
  if (dot <= 0 || dot < base.lastIndexOf(']')) return undefined
  return base.startsWith('board.') && dot === 5 ? undefined : base.slice(0, dot)
}

const SEGMENT_END = /[.[@]/

/**
 * The slot a path lives in (`alice.cart[milk]@tags` → `alice.cart`, `board.t[r1].use` → `board.t`);
 * a bare root (`alice`, `alice@outbox`) is its own slot root.
 */
export function slotRootOf(path: Path): Path {
  const first = path.search(SEGMENT_END)
  if (first < 0 || path[first] !== '.') return first < 0 ? path : path.slice(0, first)
  const rest = path.slice(first + 1)
  const second = rest.search(SEGMENT_END)
  return second < 0 ? path : path.slice(0, first + 1 + second)
}

const RANGE_TAIL = /^\[(\d+)\.\.(\d+)\]$/

/**
 * The `[a..b]` ranges under `path` that some mark points at (keys of `marksByPath`), so a
 * highlight / callout on `matcher.text[4..7]` or `laptop.id[0..6]` has a node to anchor on.
 */
export function markedRanges(keys: Iterable<Path>, path: Path): Array<[number, number]> {
  const out: Array<[number, number]> = []
  const prefix = `${path}[`
  for (const key of keys) {
    if (!key.startsWith(prefix)) continue
    const m = RANGE_TAIL.exec(key.slice(path.length))
    if (!m) continue
    const from = Number(m[1])
    const to = Number(m[2])
    if (to > from) out.push([from, to])
  }
  return out.sort((a, b) => a[0] - b[0] || a[1] - b[1])
}
