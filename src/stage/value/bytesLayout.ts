/**
 * Pure geometry for the `bytes` view (stage-architecture §5.5): which bytes share a row, how many
 * grid columns each byte takes (2 nibbles collapsed, 8 bits expanded, plus a hyphen column between
 * canonical groups), and how a bit range maps onto those columns. The view is a CSS grid per row;
 * byte cells and annotation bars are placed by column index, so nothing is measured.
 */
import { LIMITS } from '@/lesson/types'
import { BYTE_BITS, NIBBLE_BITS } from './annotations'

export type BytesDisplay = 'hex' | 'bits' | 'canonical' | 'dec'
export type ByteRange = [number, number] // half-open [from, to)

/** `8-4-4-4-12` hex digits: a hyphen before bytes 4, 6, 8 and 10. */
export const CANONICAL_BREAKS: ReadonlySet<number> = new Set([4, 6, 8, 10])

/** A byte is drawn bit by bit when the display is `bits` and it lies in `range` (no range ⇒ all). */
export function isExpanded(
  display: BytesDisplay,
  range: ByteRange | undefined,
  i: number,
): boolean {
  if (display !== 'bits') return false
  if (!range) return true
  return i >= range[0] && i < range[1]
}

/** Rows of bytes: 16 per row in hex / dec / canonical and in bits with a range; 4 per row in bits without. */
export function byteRows(
  display: BytesDisplay,
  n: number,
  range: ByteRange | undefined,
): ByteRange[] {
  const per = display === 'bits' && !range ? LIMITS.bytesPerRowBits : LIMITS.bytesPerRowHex
  const rows: ByteRange[] = []
  for (let start = 0; start < n; start += per) rows.push([start, Math.min(n, start + per)])
  if (rows.length === 0) rows.push([0, 0])
  return rows
}

export interface ByteCellLayout {
  byte: number
  /** Grid columns this byte spans (2 nibbles or 8 bits). */
  cols: number
  expanded: boolean
  /** A canonical hyphen occupies the column right before this cell. */
  sepBefore: boolean
  /** 0-based index of the cell's first column. */
  start: number
}

export interface RowLayout {
  from: number
  to: number
  cells: ByteCellLayout[]
  /** Total grid columns in the row (cells + separators). */
  total: number
}

export function rowLayout(
  display: BytesDisplay,
  range: ByteRange | undefined,
  from: number,
  to: number,
): RowLayout {
  const cells: ByteCellLayout[] = []
  let col = 0
  for (let i = from; i < to; i++) {
    const sepBefore = display === 'canonical' && i > from && CANONICAL_BREAKS.has(i)
    if (sepBefore) col += 1
    const expanded = isExpanded(display, range, i)
    const cols = expanded ? BYTE_BITS : BYTE_BITS / NIBBLE_BITS
    cells.push({ byte: i, cols, expanded, sepBefore, start: col })
    col += cols
  }
  return { from, to, cells, total: col }
}

/** 0-based column of the sub-unit (bit or nibble) that holds `bit`; the bit must lie in the row. */
export function bitToColumn(row: RowLayout, bit: number): number {
  const cell = row.cells[Math.floor(bit / BYTE_BITS) - row.from]
  if (!cell) return 0
  const within = bit % BYTE_BITS
  return cell.start + (cell.expanded ? within : Math.floor(within / NIBBLE_BITS))
}

/** Columns `[startCol, endCol)` a bit range covers inside this row, or null when it misses the row. */
export function bitRangeToColumns(
  row: RowLayout,
  from: number,
  to: number,
): [number, number] | null {
  const f = Math.max(from, row.from * BYTE_BITS)
  const t = Math.min(to, row.to * BYTE_BITS)
  if (t <= f) return null
  return [bitToColumn(row, f), bitToColumn(row, t - 1) + 1]
}

/** CSS `grid-column` value for a 0-based half-open column span. */
export function gridColumn(span: [number, number]): string {
  return `${span[0] + 1} / ${span[1] + 1}`
}
