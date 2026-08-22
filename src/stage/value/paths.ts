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
