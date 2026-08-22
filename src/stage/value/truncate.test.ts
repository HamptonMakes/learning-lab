import { describe, expect, it } from 'vitest'
import { isTruncated, middleEllipsis, SCALAR_MAX } from './truncate'

describe('middleEllipsis', () => {
  it('leaves short strings alone', () => {
    expect(middleEllipsis('In a meeting')).toBe('In a meeting')
    expect(middleEllipsis('x'.repeat(SCALAR_MAX))).toBe('x'.repeat(SCALAR_MAX))
  })

  it('cuts the middle and keeps both ends within the limit', () => {
    const s = 'abcdefghijklmnopqrstuvwxyz0123456789'
    const out = middleEllipsis(s)
    expect(Array.from(out).length).toBe(SCALAR_MAX)
    expect(out.startsWith('abcdefghijkl')).toBe(true)
    expect(out.endsWith('56789')).toBe(true)
    expect(out).toContain('…')
  })

  it('counts code points, not UTF-16 units', () => {
    const s = '😀'.repeat(30)
    const out = middleEllipsis(s, 9)
    expect(Array.from(out).length).toBe(9)
    expect(out.replace('…', '')).toBe('😀'.repeat(8))
  })

  it('respects a custom maximum', () => {
    expect(middleEllipsis('abcdefgh', 5)).toBe('ab…gh')
    expect(middleEllipsis('abcdefgh', 1)).toBe('…')
  })

  it('reports truncation', () => {
    expect(isTruncated('short')).toBe(false)
    expect(isTruncated('x'.repeat(SCALAR_MAX + 1))).toBe(true)
  })
})
