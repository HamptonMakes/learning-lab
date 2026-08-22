/**
 * Pure layout helpers for annotations on `bytes` and `text` values (DSL §4.2):
 *  - deterministic lanes: sort by `from`, then `id`; first free lane (so two renders stack alike);
 *  - nibble snapping: a bit-unit annotation over bytes that are not expanded snaps outward to the
 *    nibble (the exact bits stay in `title`);
 *  - text segmentation: split a string at every annotation / mark-range / caret boundary into a
 *    tree of wrappers, so each range becomes one element (a partial overlap is split into pieces).
 */
import type { Annotation, Tone } from '@/lesson/types'

// ─── Lanes ────────────────────────────────────────────────────────────────────────────────────

/** `reserve` = extra extent (same unit as from/to) the item's label needs beyond `to`, so labels of
 *  narrow annotations do not overlap the next bar in the same lane. */
export type LaneItem = { id: string; from: number; to: number; reserve?: number }

function cmpId(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

/** Lane per item id. Items are sorted by `from`, then `id`; each takes the first lane that is free at `from`. */
export function assignLanes(items: readonly LaneItem[]): Map<string, number> {
  const sorted = [...items].sort((a, b) => a.from - b.from || cmpId(a.id, b.id))
  const laneEnds: number[] = []
  const out = new Map<string, number>()
  for (const item of sorted) {
    const end = Math.max(item.to, item.from + (item.reserve ?? 0))
    let lane = laneEnds.findIndex((laneEnd) => laneEnd <= item.from)
    if (lane === -1) {
      lane = laneEnds.length
      laneEnds.push(end)
    } else {
      laneEnds[lane] = end
    }
    out.set(item.id, lane)
  }
  return out
}

export function laneCount(items: ReadonlyArray<{ lane: number }>): number {
  return items.reduce((max, it) => Math.max(max, it.lane + 1), 0)
}

/** `id` of an annotation, or a stable fallback from its index (`a0`, `a1`…). */
export function annotationId(a: Annotation, index: number): string {
  return a.id ?? `a${index}`
}

// ─── Bytes ────────────────────────────────────────────────────────────────────────────────────

export const NIBBLE_BITS = 4
export const BYTE_BITS = 8

/**
 * Snap a bit range `[from, to)` outward to nibble boundaries, except at an end that falls inside an
 * expanded byte (drawn bit by bit, so it needs no snapping).
 */
export function snapBits(
  from: number,
  to: number,
  expandedAt: (byte: number) => boolean = () => false,
): [number, number] {
  if (to <= from) return [from, from]
  const start = expandedAt(Math.floor(from / BYTE_BITS))
    ? from
    : Math.floor(from / NIBBLE_BITS) * NIBBLE_BITS
  const end = expandedAt(Math.floor((to - 1) / BYTE_BITS))
    ? to
    : Math.ceil(to / NIBBLE_BITS) * NIBBLE_BITS
  return [start, end]
}

export interface ByteAnnotationLayout {
  id: string
  label?: string
  tone: Tone
  unit: 'byte' | 'bit'
  /** The authored range in bits. */
  exact: [number, number]
  /** The drawn range in bits (nibble-snapped over collapsed bytes). */
  bits: [number, number]
  snapped: boolean
  lane: number
}

/** Lay out byte annotations: bits, snapping, lanes. Lanes are assigned on the drawn (snapped) ranges. */
export function layoutByteAnnotations(
  annotations: readonly Annotation[],
  expandedAt: (byte: number) => boolean,
): ByteAnnotationLayout[] {
  const prepared = annotations.map((a, i) => {
    const unit = a.unit ?? 'byte'
    const exact: [number, number] =
      unit === 'bit' ? [a.from, a.to] : [a.from * BYTE_BITS, a.to * BYTE_BITS]
    const bits = unit === 'bit' ? snapBits(exact[0], exact[1], expandedAt) : exact
    return {
      id: annotationId(a, i),
      label: a.label,
      tone: a.tone ?? 'info',
      unit,
      exact,
      bits,
      snapped: bits[0] !== exact[0] || bits[1] !== exact[1],
    }
  })
  // A 10px label char is roughly 2 bits wide in the hex grid; reserve that so labels never collide.
  const lanes = assignLanes(
    prepared.map((p) => ({
      id: p.id,
      from: p.bits[0],
      to: p.bits[1],
      reserve: (p.label?.length ?? 0) * 2,
    })),
  )
  return prepared.map((p) => ({ ...p, lane: lanes.get(p.id) ?? 0 }))
}

// ─── Text ─────────────────────────────────────────────────────────────────────────────────────

export interface TextAnnotationLayout {
  id: string
  label?: string
  tone: Tone
  from: number
  to: number
  lane: number
}

export function layoutTextAnnotations(annotations: readonly Annotation[]): TextAnnotationLayout[] {
  const prepared = annotations.map((a, i) => ({
    id: annotationId(a, i),
    label: a.label,
    tone: a.tone ?? 'info',
    from: a.from,
    to: a.to,
  }))
  // A 10px label char is about 0.7 of a 13px mono text character.
  const lanes = assignLanes(
    prepared.map((p) => ({ ...p, reserve: p.label ? (p.label.length + 1) * 0.7 : 0 })),
  )
  return prepared.map((p) => ({ ...p, lane: lanes.get(p.id) ?? 0 }))
}

export type TextRange = { key: string; from: number; to: number }
export type TextSegment =
  | { type: 'text'; from: number; to: number }
  | { type: 'point'; key: string; at: number }
  | { type: 'wrap'; key: string; from: number; to: number; children: TextSegment[] }

/**
 * Split `[from, to)` into segments: plain text, zero-length points (a caret) and wrappers (one per
 * range, nested when one contains another; a range that partially overlaps an earlier wrapper is
 * split at the wrapper's end, so both pieces carry the same `key`). Deterministic: ranges are
 * ordered by start, then length (longest first), then key.
 */
export function segmentText(ranges: readonly TextRange[], from: number, to: number): TextSegment[] {
  const sorted = ranges
    .filter((r) => r.from <= r.to)
    .map((r) => ({ ...r, from: Math.max(r.from, from), to: Math.min(r.to, to) }))
    .filter((r) => r.from < r.to || (r.from === r.to && r.from >= from && r.from <= to))
    .sort((a, b) => a.from - b.from || b.to - b.from - (a.to - a.from) || cmpId(a.key, b.key))
  return build(sorted, from, to)
}

function build(sorted: readonly TextRange[], from: number, to: number): TextSegment[] {
  const out: TextSegment[] = []
  let pos = from
  for (let i = 0; i < sorted.length; i++) {
    const r = sorted[i]
    if (!r) continue
    if (r.from === r.to) {
      if (r.from < pos) continue // drawn inside an earlier wrapper
      if (r.from > pos) {
        out.push({ type: 'text', from: pos, to: r.from })
        pos = r.from
      }
      out.push({ type: 'point', key: r.key, at: r.from })
      continue
    }
    const start = Math.max(r.from, pos)
    if (start >= r.to) continue // fully covered by an earlier wrapper at this level (drawn inside it)
    if (start > pos) {
      out.push({ type: 'text', from: pos, to: start })
      pos = start
    }
    const inner = sorted
      .slice(i + 1)
      .filter(
        (x) =>
          (x.from < r.to && x.to > start && x.from < x.to) ||
          (x.from === x.to && x.from >= start && x.from < r.to),
      )
      .map((x) => ({ ...x, from: Math.max(x.from, start), to: Math.min(x.to, r.to) }))
    out.push({
      type: 'wrap',
      key: r.key,
      from: start,
      to: r.to,
      children: build(inner, start, r.to),
    })
    pos = r.to
  }
  if (pos < to) out.push({ type: 'text', from: pos, to })
  return out
}
