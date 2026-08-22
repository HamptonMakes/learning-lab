/**
 * Text — a short string (≤ 96 characters, schema) wrapped to a couple of lines, with a caret at
 * `cursor` (`${path}@cursor`) and annotations as toned underlays with labels beneath (lanes are
 * deterministic). The string is split into segments at every annotation / mark-range / caret
 * boundary (`segmentText`), so each annotation and each `[a..b]` range some mark points at is one
 * element: annotations carry `data-annotation`, mark ranges are nodes at `${path}[${a}..${b}]`.
 * The whole value is an LTR island (DSL §9).
 */
import { Fragment, type ReactNode } from 'react'
import type { Path, ValueOf } from '@/lesson/types'
import { useT } from '@/i18n'
import { cn } from '@/lib/utils'
import { useStageFrame } from '../StageContext'
import {
  laneCount,
  layoutTextAnnotations,
  segmentText,
  type TextAnnotationLayout,
  type TextRange,
  type TextSegment,
} from './annotations'
import { Caret, Ltr } from './chips'
import { MetaBadges } from './MetaBadges'
import { NodeBox } from './NodeBox'
import { isTokenPath, markedRanges, metaPath, rangePath } from './paths'
import { toneVars } from './tone'

const CARET_KEY = '@cursor'
const MARK_PREFIX = 'mark:'
const LANE_EM = 0.75

export function Text({
  path,
  value,
  depth,
}: {
  path: Path
  value: ValueOf<'text'>
  depth: number
}) {
  const t = useT()
  const { marksByPath } = useStageFrame()
  const { text, cursor } = value
  const anns = layoutTextAnnotations(value.annotations)
  const lanes = laneCount(anns)
  const byId = new Map(anns.map((a) => [a.id, a]))
  const ranges: TextRange[] = anns.map((a) => ({ key: a.id, from: a.from, to: a.to }))
  for (const [a, b] of markedRanges(marksByPath.keys(), path)) {
    ranges.push({ key: `${MARK_PREFIX}${a}..${b}`, from: a, to: b })
  }
  if (cursor !== undefined) ranges.push({ key: CARET_KEY, from: cursor, to: cursor })
  const segments = segmentText(ranges, 0, text.length)
  const shared = !isTokenPath(path)

  const render = (segs: TextSegment[]): ReactNode =>
    segs.map((seg) => {
      if (seg.type === 'text') {
        return <Fragment key={`t${seg.from}`}>{text.slice(seg.from, seg.to)}</Fragment>
      }
      if (seg.type === 'point') {
        return (
          <Caret
            key="caret"
            path={path}
            index={seg.at}
            layoutId={shared ? metaPath(path, 'cursor') : undefined}
          />
        )
      }
      if (seg.key.startsWith(MARK_PREFIX)) {
        const [a, b] = seg.key.slice(MARK_PREFIX.length).split('..').map(Number) as [number, number]
        return (
          <NodeBox
            key={`${seg.key}:${seg.from}`}
            as="span"
            path={rangePath(path, a, b)}
            kind="range"
            dataValue={text.slice(a, b)}
            title={t('stage.text.range', { from: a, to: b })}
            className="rounded-sm"
          >
            {render(seg.children)}
          </NodeBox>
        )
      }
      const ann = byId.get(seg.key)
      if (!ann) return <Fragment key={`${seg.key}:${seg.from}`}>{render(seg.children)}</Fragment>
      return (
        <Annotated key={`${seg.key}:${seg.from}`} ann={ann} first={seg.from === ann.from}>
          {render(seg.children)}
        </Annotated>
      )
    })

  return (
    <NodeBox
      path={path}
      kind="text"
      dataValue={text}
      tombstone={value.meta?.tombstone}
      attrs={{ 'data-cursor': cursor }}
      className={cn(
        'flex max-w-full min-w-0 flex-col gap-1 rounded-sm font-mono text-[13px] text-ink',
        depth === 0 && 'px-0.5',
      )}
    >
      <Ltr
        className="block max-w-full break-words whitespace-pre-wrap"
        // Room for the label lanes under every line (labels sit in the leading).
      >
        <span
          data-text-body=""
          className="inline"
          style={{
            lineHeight: `${1.5 + lanes * LANE_EM}em`,
            paddingBlockEnd: lanes ? `${lanes * LANE_EM * 0.5}em` : undefined,
          }}
        >
          {text.length === 0 && cursor === undefined ? (
            <span className="text-ink-3">""</span>
          ) : (
            render(segments)
          )}
        </span>
      </Ltr>
      <MetaBadges path={path} meta={value.meta} />
    </NodeBox>
  )
}

/** One piece of an annotation: soft fill, a lane underline, and (on its first piece) the label. */
function Annotated({
  ann,
  first,
  children,
}: {
  ann: TextAnnotationLayout
  first: boolean
  children: ReactNode
}) {
  return (
    <span
      data-annotation={ann.id}
      data-lane={ann.lane}
      data-from={ann.from}
      data-to={ann.to}
      title={ann.label}
      style={toneVars(ann.tone)}
      className="relative rounded-sm bg-(--tone-soft)"
    >
      {children}
      <i
        aria-hidden
        className="pointer-events-none absolute inset-x-0 h-0.5 rounded-full bg-(--tone)"
        style={{ bottom: `${-0.15 - ann.lane * 0.3}em` }}
      />
      {first && ann.label && (
        <span
          className="pointer-events-none absolute start-0 top-full font-sans text-[10px] leading-3 whitespace-nowrap text-(--tone)"
          style={{ marginBlockStart: `${ann.lane * LANE_EM}em` }}
        >
          {ann.label}
        </span>
      )}
    </span>
  )
}
