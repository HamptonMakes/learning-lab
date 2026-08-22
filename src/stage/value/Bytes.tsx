/**
 * Bytes — `display: hex | bits | canonical | dec` (stage-architecture §5.5). One cell per byte
 * (`${path}[${i}]`, `data-value` = two lower-case hex digits, full detail in `title`), 16 per row
 * in hex / dec / canonical; `bits` expands `range` (`[from, to)`) inline as `0111 0100` and, with no
 * range, wraps 4 bytes per row; `canonical` groups `8-4-4-4-12` with hyphens (exempt from the 24
 * character rule). Every row is a CSS grid whose columns are nibbles (collapsed bytes) or bits
 * (expanded bytes) plus hyphen columns, so annotation bars and mark ranges are placed by column
 * index — nothing is measured. Bit annotations over collapsed bytes snap outward to the nibble
 * (exact bits in `title`); lanes are deterministic (sort by `from`, then `id`; first free lane).
 * Byte cells carry `layoutId`, so `view` changes glide. Everything sits in `<bdi dir="ltr">`.
 */
import { Fragment, useMemo } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import type { Path, ValueOf } from '@/lesson/types'
import { toHex } from '@/lesson/path'
import { useT } from '@/i18n'
import { cn } from '@/lib/utils'
import { useStageMotion } from '../motion/StageMotionProvider'
import { useStageFrame } from '../StageContext'
import { laneCount, layoutByteAnnotations, type ByteAnnotationLayout } from './annotations'
import {
  bitRangeToColumns,
  byteRows,
  gridColumn,
  isExpanded,
  rowLayout,
  type ByteCellLayout,
  type RowLayout,
} from './bytesLayout'
import { Ltr } from './chips'
import { bits8, bitsGrouped, hex2 } from './format'
import { MetaBadges } from './MetaBadges'
import { NodeBox } from './NodeBox'
import { isTokenPath, itemPath, markedRanges, rangePath } from './paths'
import { toneVars } from './tone'

const LANE_HEIGHT = '1rem'

export function Bytes({
  path,
  value,
  depth,
}: {
  path: Path
  value: ValueOf<'bytes'>
  depth: number
}) {
  const { bytes, display, range, annotations } = value
  const { marksByPath } = useStageFrame()
  const anns = useMemo(
    () => layoutByteAnnotations(annotations, (i) => isExpanded(display, range, i)),
    [annotations, display, range],
  )
  const lanes = laneCount(anns)
  const rows = byteRows(display, bytes.length, range)
  const marked = markedRanges(marksByPath.keys(), path)
  const shared = !isTokenPath(path)
  return (
    <NodeBox
      path={path}
      kind="bytes"
      dataValue={toHex(bytes)}
      tombstone={value.meta?.tombstone}
      attrs={{
        'data-display': display,
        'data-range': range ? `${range[0]}..${range[1]}` : undefined,
      }}
      className={cn(
        'inline-flex max-w-full min-w-0 flex-col items-start gap-1 rounded-sm font-mono text-[13px]',
        depth === 0 && 'px-0.5',
      )}
    >
      <Ltr className="flex max-w-full flex-col gap-1 overflow-x-auto">
        {rows.map(([from, to]) => {
          const row = rowLayout(display, range, from, to)
          return (
            <div
              key={from}
              data-byte-row={from}
              className="grid items-end"
              style={{
                gridTemplateColumns: `repeat(${Math.max(row.total, 1)}, auto)`,
                gridTemplateRows: `auto repeat(${lanes}, ${LANE_HEIGHT})`,
              }}
            >
              {marked.map(([a, b]) => {
                const span = bitRangeToColumns(row, a * 8, b * 8)
                if (!span) return null
                return (
                  <NodeBox
                    key={`${a}..${b}`}
                    as="span"
                    path={rangePath(path, a, b)}
                    kind="range"
                    dataValue={toHex(bytes.slice(a, b))}
                    className="z-0 self-stretch rounded-sm"
                    style={{ gridRow: 1, gridColumn: gridColumn(span) }}
                  />
                )
              })}
              {row.cells.map((cell) => (
                <Fragment key={cell.byte}>
                  {cell.sepBefore && (
                    <span
                      aria-hidden
                      className="z-10 self-center px-px text-center leading-5 text-ink-3"
                      style={{ gridRow: 1, gridColumn: cell.start }}
                    >
                      -
                    </span>
                  )}
                  <ByteCell
                    path={path}
                    byte={bytes[cell.byte] ?? 0}
                    cell={cell}
                    display={display}
                    layoutId={shared ? itemPath(path, cell.byte) : undefined}
                  />
                </Fragment>
              ))}
              <AnimatePresence initial={false}>
                {anns.map((a) => {
                  const span = bitRangeToColumns(row, a.bits[0], a.bits[1])
                  if (!span) return null
                  return <AnnotationBar key={a.id} path={path} ann={a} row={row} span={span} />
                })}
              </AnimatePresence>
            </div>
          )
        })}
      </Ltr>
      <MetaBadges path={path} meta={value.meta} />
    </NodeBox>
  )
}

function ByteCell({
  path,
  byte,
  cell,
  display,
  layoutId,
}: {
  path: Path
  byte: number
  cell: ByteCellLayout
  display: ValueOf<'bytes'>['display']
  layoutId?: string
}) {
  const t = useT()
  const hex = hex2(byte)
  const title = t('stage.bytes.byte', { i: cell.byte, hex, dec: byte, bits: bitsGrouped(byte) })
  let glyphs
  if (cell.expanded) {
    glyphs = Array.from(bits8(byte)).map((bit, i) => (
      <span key={i} data-bit={i} className={cn('text-center', i === 4 && 'ms-1')}>
        {bit}
      </span>
    ))
  } else if (display === 'dec') {
    glyphs = (
      <span className="col-span-2 text-center tabular-nums" data-dec="">
        {byte}
      </span>
    )
  } else {
    glyphs = Array.from(hex).map((n, i) => (
      <span key={i} data-nibble={i} className="text-center">
        {n}
      </span>
    ))
  }
  return (
    <NodeBox
      as="span"
      path={itemPath(path, cell.byte)}
      kind="byte"
      dataValue={hex}
      title={title}
      attrs={{ 'data-index': cell.byte, 'data-expanded': cell.expanded ? 'true' : undefined }}
      layout
      layoutId={layoutId}
      style={{ gridRow: 1, gridColumn: `${cell.start + 1} / span ${cell.cols}`, borderRadius: 4 }}
      className={cn(
        'z-10 grid grid-cols-subgrid items-baseline leading-5 text-ink',
        display === 'canonical' ? 'px-0' : 'px-0.5',
        cell.expanded && 'tabular-nums',
      )}
    >
      {glyphs}
    </NodeBox>
  )
}

function AnnotationBar({
  path,
  ann,
  row,
  span,
}: {
  path: Path
  ann: ByteAnnotationLayout
  row: RowLayout
  span: [number, number]
}) {
  const t = useT()
  const { off, tr } = useStageMotion()
  const [ef, et] = ann.exact
  const where =
    ann.unit === 'bit'
      ? t('stage.bytes.bits', { from: ef, to: et })
      : t('stage.bytes.bytes', { from: ef / 8, to: et / 8 })
  const title = [ann.label, where, ann.snapped ? t('stage.bytes.snapped') : undefined]
    .filter(Boolean)
    .join(' · ')
  // The label is only shown on the row where the annotation starts (it may span rows in `bits`).
  const showLabel = ann.bits[0] >= row.from * 8
  return (
    <motion.span
      data-annotation={ann.id}
      data-unit={ann.unit}
      data-lane={ann.lane}
      data-from={ef}
      data-to={et}
      data-path={ann.unit === 'byte' ? rangePath(path, ef / 8, et / 8) : undefined}
      data-snapped={ann.snapped ? 'true' : undefined}
      title={title}
      style={{ ...toneVars(ann.tone), gridRow: 2 + ann.lane, gridColumn: gridColumn(span) }}
      className="relative z-10 mt-0.5 h-[calc(1rem-2px)] min-w-0 border-t-2 border-(--tone) px-0.5"
      layout
      initial={off ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, transition: tr('exit') }}
      transition={{ ...tr('enter'), layout: tr('layout') }}
    >
      {showLabel && ann.label && (
        <span className="absolute start-0.5 top-0 font-sans text-[10px] leading-3 whitespace-nowrap text-(--tone)">
          {ann.label}
        </span>
      )}
    </motion.span>
  )
}
