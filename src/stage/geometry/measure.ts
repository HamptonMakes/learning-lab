/**
 * Arc geometry shared by message arcs, flow arrows and tokens so they stay on one curve.
 * All coordinates are stage-container pixels (see AnchorRegistry).
 */
export type Rect = { x: number; y: number; w: number; h: number }
export type Point = { x: number; y: number }

/** The point on r's border facing `toward` (centre-to-centre ray, clipped to r's box). */
export function edgePoint(r: Rect, toward: Rect): Point {
  const cx = r.x + r.w / 2
  const cy = r.y + r.h / 2
  const tx = toward.x + toward.w / 2
  const ty = toward.y + toward.h / 2
  const dx = tx - cx
  const dy = ty - cy
  if (dx === 0 && dy === 0) return { x: cx, y: cy }
  const sx = dx === 0 ? Infinity : r.w / 2 / Math.abs(dx)
  const sy = dy === 0 ? Infinity : r.h / 2 / Math.abs(dy)
  const s = Math.min(sx, sy)
  return { x: cx + dx * s, y: cy + dy * s }
}

export interface Arc {
  /** SVG path data (quadratic Bézier). */
  d: string
  p0: Point
  p1: Point
  c: Point
  /** Point at parameter t ∈ [0, 1]. */
  at(t: number): Point
  /** Approximate length in px (for offset-path percentages → px conversions). */
  length: number
}

/**
 * A quadratic arc from a's edge to b's edge, bulging perpendicular to the chord.
 * `bulge` > 0 bends one way, < 0 the other — opposite directions between the same pair use
 * opposite signs so their arcs do not overlap (DSL §4.3).
 */
export function arcBetween(a: Rect, b: Rect, bulge = 0.18): Arc {
  const p0 = edgePoint(a, b)
  const p1 = edgePoint(b, a)
  const mx = (p0.x + p1.x) / 2
  const my = (p0.y + p1.y) / 2
  const dx = p1.x - p0.x
  const dy = p1.y - p0.y
  const c = { x: mx - dy * bulge, y: my + dx * bulge }
  const at = (t: number): Point => ({
    x: (1 - t) ** 2 * p0.x + 2 * (1 - t) * t * c.x + t * t * p1.x,
    y: (1 - t) ** 2 * p0.y + 2 * (1 - t) * t * c.y + t * t * p1.y,
  })
  let length = 0
  let prev = p0
  for (let i = 1; i <= 16; i++) {
    const p = at(i / 16)
    length += Math.hypot(p.x - prev.x, p.y - prev.y)
    prev = p
  }
  return {
    d: `M ${f(p0.x)} ${f(p0.y)} Q ${f(c.x)} ${f(c.y)} ${f(p1.x)} ${f(p1.y)}`,
    p0,
    p1,
    c,
    at,
    length,
  }
}

const f = (n: number) => Math.round(n * 100) / 100

/** Rest position (offset-distance %) of the i-th token (creation order, 0-based) on one arc: 50, 42, 58, 34, 66 … */
export function stackOffset(i: number): number {
  const k = Math.ceil(i / 2) * 8
  return 50 + (i % 2 === 1 ? -k : k)
}

/** Centre of a rect. */
export function center(r: Rect): Point {
  return { x: r.x + r.w / 2, y: r.y + r.h / 2 }
}

export function sameRect(a: Rect | undefined, b: Rect | undefined, tolerance = 0.5): boolean {
  if (!a || !b) return a === b
  return (
    Math.abs(a.x - b.x) <= tolerance &&
    Math.abs(a.y - b.y) <= tolerance &&
    Math.abs(a.w - b.w) <= tolerance &&
    Math.abs(a.h - b.h) <= tolerance
  )
}
