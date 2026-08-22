/**
 * Pure geometry for the mark layers: the conflict bolt's zig-zag, arrow heads on an arc, and the
 * callout bubble placement. Stage-container pixels throughout (see AnchorRegistry).
 */
import { edgePoint, type Arc, type Point, type Rect } from '../geometry'

/** A zig-zag between the facing edges of two rects, plus its midpoint (for the badge). */
export function boltPath(a: Rect, b: Rect, segments = 6): { d: string; mid: Point } {
  const p0 = edgePoint(a, b)
  const p1 = edgePoint(b, a)
  const dx = p1.x - p0.x
  const dy = p1.y - p0.y
  const len = Math.hypot(dx, dy) || 1
  const nx = -dy / len
  const ny = dx / len
  const amp = Math.min(8, len / 10)
  const pts: Point[] = [p0]
  for (let i = 1; i < segments; i++) {
    const t = i / segments
    const s = i % 2 === 1 ? amp : -amp
    pts.push({ x: p0.x + dx * t + nx * s, y: p0.y + dy * t + ny * s })
  }
  pts.push(p1)
  const d = pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${r2(p.x)} ${r2(p.y)}`).join(' ')
  return { d, mid: { x: (p0.x + p1.x) / 2, y: (p0.y + p1.y) / 2 } }
}

/** Arrow head transform at one end of a quadratic arc: `translate(x y) rotate(deg)`, tip at the end. */
export function arrowHeadTransform(arc: Arc, end: 'start' | 'end'): string {
  const tip = end === 'end' ? arc.p1 : arc.p0
  // Tangent of a quadratic Bézier at t=1 is p1 - c; at t=0 it is c - p0 (reversed for the start head).
  const dir =
    end === 'end'
      ? { x: arc.p1.x - arc.c.x, y: arc.p1.y - arc.c.y }
      : { x: arc.p0.x - arc.c.x, y: arc.p0.y - arc.c.y }
  const deg = (Math.atan2(dir.y, dir.x) * 180) / Math.PI
  return `translate(${r2(tip.x)} ${r2(tip.y)}) rotate(${r2(deg)})`
}

/** A filled triangle whose tip is at the origin, pointing along +x. */
export const ARROW_HEAD_D = 'M 0 0 L -9 -4.5 L -9 4.5 Z'

/** A lightning glyph for the conflict badge, drawn in a 16×16 box around the origin. */
export const BOLT_GLYPH_D = 'M 1.5 -8 L -3.5 1 L 0 1 L -1.5 8 L 3.5 -1 L 0 -1 Z'

export type CalloutSide = 'above' | 'below'
export interface CalloutPlacement {
  x: number
  y: number
  side: CalloutSide
  /** Tail position, relative to the bubble's start edge. */
  tailX: number
}

const GAP = 8
const PAD = 4

/**
 * Place a bubble of size `box` near `anchor`: centred, above by default, below when there is no
 * room above; clamped inside `bounds` when the container size is known. The tail stays on the
 * anchor's centre even when the bubble had to slide.
 */
export function placeCallout(
  anchor: Rect,
  box: { w: number; h: number },
  bounds: { w: number; h: number } | null,
): CalloutPlacement {
  const cx = anchor.x + anchor.w / 2
  let side: CalloutSide = 'above'
  let y = anchor.y - GAP - box.h
  if (y < PAD) {
    side = 'below'
    y = anchor.y + anchor.h + GAP
  }
  let x = cx - box.w / 2
  if (bounds && bounds.w > 0) x = Math.min(x, bounds.w - box.w - PAD)
  x = Math.max(PAD, x)
  const tailX = Math.min(Math.max(cx - x, 10), Math.max(10, box.w - 10))
  return { x, y, side, tailX }
}

const r2 = (n: number) => Math.round(n * 100) / 100
