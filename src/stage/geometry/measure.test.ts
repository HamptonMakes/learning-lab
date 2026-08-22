import { describe, expect, it } from 'vitest'
import { arcBetween, edgePoint, sameRect, stackOffset } from './measure'

describe('geometry', () => {
  const a = { x: 0, y: 0, w: 100, h: 50 }
  const b = { x: 300, y: 0, w: 100, h: 50 }
  it('edgePoint lands on the facing border', () => {
    expect(edgePoint(a, b)).toEqual({ x: 100, y: 25 })
    expect(edgePoint(b, a)).toEqual({ x: 300, y: 25 })
  })
  it('arcBetween starts and ends on the edges and bulges perpendicular to the chord', () => {
    const arc = arcBetween(a, b)
    expect(arc.at(0)).toEqual(arc.p0)
    expect(arc.at(1)).toEqual(arc.p1)
    expect(arc.c.y).toBeGreaterThan(25) // bulge below the chord for a left→right arc with +bulge
    expect(arcBetween(a, b, -0.18).c.y).toBeLessThan(25)
    expect(arc.length).toBeGreaterThan(200)
    expect(arc.d).toMatch(/^M 100 25 Q /)
  })
  it('stackOffset alternates around 50%', () => {
    expect([0, 1, 2, 3, 4].map(stackOffset)).toEqual([50, 42, 58, 34, 66])
  })
  it('sameRect tolerates sub-pixel jitter', () => {
    expect(sameRect(a, { ...a, x: 0.3 })).toBe(true)
    expect(sameRect(a, { ...a, x: 2 })).toBe(false)
  })
})
