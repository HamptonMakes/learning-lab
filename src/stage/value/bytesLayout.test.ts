import { describe, expect, it } from 'vitest'
import {
  bitRangeToColumns,
  bitToColumn,
  byteRows,
  gridColumn,
  isExpanded,
  rowLayout,
} from './bytesLayout'

describe('byteRows', () => {
  it('wraps 16 per row in hex / dec / canonical and in bits with a range', () => {
    expect(byteRows('hex', 16, undefined)).toEqual([[0, 16]])
    expect(byteRows('dec', 20, undefined)).toEqual([
      [0, 16],
      [16, 20],
    ])
    expect(byteRows('canonical', 16, undefined)).toEqual([[0, 16]])
    expect(byteRows('bits', 16, [6, 9])).toEqual([[0, 16]])
  })
  it('wraps 4 per row in bits without a range', () => {
    expect(byteRows('bits', 10, undefined)).toEqual([
      [0, 4],
      [4, 8],
      [8, 10],
    ])
  })
  it('keeps one empty row for zero bytes', () => {
    expect(byteRows('hex', 0, undefined)).toEqual([[0, 0]])
  })
})

describe('rowLayout / columns', () => {
  it('gives 2 columns per collapsed byte and 8 per expanded byte', () => {
    const row = rowLayout('bits', [6, 9], 0, 16)
    expect(row.total).toBe(13 * 2 + 3 * 8)
    expect(row.cells[6]).toMatchObject({ byte: 6, cols: 8, expanded: true, start: 12 })
    expect(row.cells[9]).toMatchObject({ byte: 9, cols: 2, expanded: false, start: 36 })
  })

  it('inserts hyphen columns at the canonical group breaks', () => {
    const row = rowLayout('canonical', undefined, 0, 16)
    expect(row.cells.filter((c) => c.sepBefore).map((c) => c.byte)).toEqual([4, 6, 8, 10])
    expect(row.total).toBe(32 + 4)
    expect(row.cells[4]?.start).toBe(9) // 8 nibbles + 1 hyphen
  })

  it('maps bits to nibble columns when collapsed and to bit columns when expanded', () => {
    const row = rowLayout('bits', [6, 9], 0, 16)
    expect(bitToColumn(row, 0)).toBe(0)
    expect(bitToColumn(row, 4)).toBe(1)
    expect(bitToColumn(row, 47)).toBe(11)
    expect(bitToColumn(row, 48)).toBe(12) // byte 6 expanded: bit 0 → col 12
    expect(bitToColumn(row, 51)).toBe(15)
    expect(bitRangeToColumns(row, 48, 52)).toEqual([12, 16])
    expect(bitRangeToColumns(row, 64, 66)).toEqual([28, 30]) // byte 8 expanded: cols 28..36
  })

  it('clips bit ranges to the row and reports misses', () => {
    const first = rowLayout('bits', undefined, 0, 4)
    const second = rowLayout('bits', undefined, 4, 8)
    expect(bitRangeToColumns(first, 0, 48)).toEqual([0, 32])
    expect(bitRangeToColumns(second, 0, 48)).toEqual([0, 16])
    expect(bitRangeToColumns(second, 0, 16)).toBeNull()
  })

  it('formats CSS grid-column spans 1-based', () => {
    expect(gridColumn([12, 16])).toBe('13 / 17')
  })

  it('knows which bytes are expanded', () => {
    expect(isExpanded('hex', undefined, 3)).toBe(false)
    expect(isExpanded('bits', undefined, 3)).toBe(true)
    expect(isExpanded('bits', [6, 9], 5)).toBe(false)
    expect(isExpanded('bits', [6, 9], 8)).toBe(true)
  })
})
