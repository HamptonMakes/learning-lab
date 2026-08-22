import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import { demonstrateLwwSkew, skewedNow } from './clock-skew'

describe('clock skew', () => {
  it('skewedNow adds the drift (behind is negative, ahead is positive)', () => {
    expect(skewedNow(10_000, -5_000)).toBe(5_000)
    expect(skewedNow(10_000, 250)).toBe(10_250)
    expect(skewedNow(10_000, 0)).toBe(10_000)
  })

  it('demonstrateLwwSkew: the later real-time write loses when its clock is behind', () => {
    const demo = demonstrateLwwSkew()
    expect(demo.first.node).toBe('bob')
    expect(demo.second.node).toBe('alice')
    expect(demo.second.trueTime).toBeGreaterThan(demo.first.trueTime)
    expect(demo.second.stampedTime).toBeLessThan(demo.first.stampedTime)
    expect(demo.second.stampedTime).toBe(demo.second.trueTime + demo.second.skewMs)
    expect(demo.winner).toBe(demo.first)
    expect(demo.loser).toBe(demo.second)
    expect(demo.winner.value).toBe('draft')
    expect(demo.laterWriteLost).toBe(true)
  })

  it('with no skew the later write wins, as people expect', () => {
    const demo = demonstrateLwwSkew(0)
    expect(demo.winner).toBe(demo.second)
    expect(demo.winner.value).toBe('final')
    expect(demo.laterWriteLost).toBe(false)
  })

  it('property: the later write is lost exactly when the skew erases the real gap', () => {
    fc.assert(
      fc.property(fc.integer({ min: -10_000, max: 10_000 }), (skew) => {
        const demo = demonstrateLwwSkew(skew)
        const gap = demo.second.trueTime - demo.first.trueTime
        // Alice loses when her stamp is older, or ties (alice < bob by node id breaks the tie).
        const expected = skew < -gap || (skew === -gap && demo.second.node < demo.first.node)
        return demo.laterWriteLost === expected
      }),
    )
  })

  it('is pure: two calls give equal results', () => {
    expect(demonstrateLwwSkew()).toEqual(demonstrateLwwSkew())
  })
})
