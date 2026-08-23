/**
 * NodeBox — the frame around every addressable node a value view draws (the value itself, a record
 * field, a list item, a counter row / cell, a clock entry, a table row / column, a byte, a range, a
 * pattern token, a caret, a meta badge). It owns the DOM contract (DSL §14): `data-path`,
 * `data-kind`, `data-value`, `data-tombstone`, `data-highlight`, plus `data-changed` for tooling
 * and `data-hidden` on a node that is in the DOM but not on the stage (gated sidecar);
 * registers the element in the anchor registry under its path (and any alias, e.g. `@tomb` and
 * `@tombstone`); and draws what sits ON the node: the highlight ring pulse, the change flash, the
 * via flash + chip, and the check / cross glyph. Layers draw everything else (callouts, pills,
 * bolts, links) from the registry. All motion goes through `tr()`; under `off` everything is at rest.
 */
import { useCallback, type CSSProperties, type ReactNode } from 'react'
import { motion, type HTMLMotionProps } from 'motion/react'
import type { Mark, Path } from '@/lesson/types'
import { useT } from '@/i18n'
import { cn } from '@/lib/utils'
import { useStageFrame } from '../StageContext'
import { useStageMotion } from '../motion/StageMotionProvider'
import { useAnchorRegistry } from '../geometry/AnchorRegistry'
import { hueVars, toneVars } from './tone'
import { ViaChip } from './ViaChip'

export type NodeTag = 'div' | 'span' | 'li' | 'tr'

const TAGS = { div: motion.div, span: motion.span, li: motion.li, tr: motion.tr } as const

type GlyphMark = Extract<Mark, { kind: 'check' | 'cross' }>
const isGlyphMark = (m: Mark): m is GlyphMark => m.kind === 'check' || m.kind === 'cross'

/** Presence / layout props a parent `AnimatePresence` or list passes down to the node element. */
export type NodePresence = Pick<
  HTMLMotionProps<'div'>,
  'initial' | 'animate' | 'exit' | 'transition' | 'layout' | 'layoutId'
>

export interface NodeBoxProps extends NodePresence {
  path: Path
  /** `data-kind`: the Value kind, or a node kind for sub-nodes (row, cell, entry, column, byte, range, token, cursor, meta). */
  kind: string
  /** `data-value`: the canonical string (never localized). */
  dataValue: string
  tombstone?: boolean
  as?: NodeTag
  className?: string
  style?: CSSProperties
  title?: string
  /** Accessible name, when the node is not self-describing text. */
  label?: string
  /** Extra registry keys that alias this node (`alice.cart[milk]@tombstone` for `…@tomb`). */
  aliases?: readonly Path[]
  /** Extra `data-*` attributes. */
  attrs?: { [key: `data-${string}`]: string | number | undefined }
  /**
   * Present in the DOM but not on the stage: visually hidden (`sr-only`), `aria-hidden`, no
   * overlays, `data-hidden=""`. Gated sidecar (seed stamps, doc metadata nobody points at) keeps
   * its anchor and its `data-path` / `data-value` contract this way.
   */
  hidden?: boolean
  children?: ReactNode
}

export function NodeBox({
  path,
  kind,
  dataValue,
  tombstone,
  as = 'div',
  className,
  style,
  title,
  label,
  aliases,
  attrs,
  hidden = false,
  children,
  initial,
  animate,
  exit,
  transition,
  layout,
  layoutId,
}: NodeBoxProps) {
  const frame = useStageFrame()
  const { off } = useStageMotion()
  const registry = useAnchorRegistry()
  const aliasKey = aliases?.join(' ') ?? ''
  const ref = useCallback(
    (el: Element | null) => {
      if (!registry) return
      registry.register(path, el)
      if (aliasKey) for (const alias of aliasKey.split(' ')) registry.register(alias, el)
    },
    [registry, path, aliasKey],
  )

  const keys = aliases ? [path, ...aliases] : [path]
  let highlight = frame.highlightOf(path)
  let glyph: GlyphMark | undefined
  for (const key of keys) {
    highlight ??= frame.highlightOf(key)
    glyph ??= (frame.marksByPath.get(key) ?? []).find(isGlyphMark)
  }
  const via = frame.via.get(path)
  const changed = frame.changedPaths.has(path)
  // A table row cannot host absolutely positioned overlays; it gets an outline instead.
  const overlays = as !== 'tr' && !hidden
  const Comp = TAGS[as] as unknown as typeof motion.div
  const frameIndex = frame.frame.index

  return (
    <Comp
      ref={ref}
      data-path={path}
      data-kind={kind}
      data-value={dataValue}
      data-tombstone={tombstone ? 'true' : undefined}
      data-highlight={highlight?.tone}
      data-changed={changed ? 'true' : undefined}
      data-hidden={hidden ? '' : undefined}
      title={title}
      aria-label={label}
      aria-hidden={hidden || undefined}
      {...attrs}
      className={cn(
        hidden ? 'sr-only' : 'relative isolate',
        highlight && !overlays && !hidden && 'outline-2 outline-offset-1 outline-(--tone)',
        className,
      )}
      style={{
        ...style,
        ...(highlight ? toneVars(highlight.tone) : undefined),
        ...(via ? hueVars(via.color) : undefined),
      }}
      initial={initial}
      animate={animate}
      exit={exit}
      transition={transition}
      layout={layout}
      layoutId={layoutId}
    >
      {children}
      {overlays && highlight && <HighlightRing key={highlight.id} />}
      {overlays && changed && !highlight && !via && !off && (
        <Flash key={`change-${frameIndex}`} className="bg-teal-soft" />
      )}
      {overlays && via && !off && <Flash key={`via-${frameIndex}`} className="bg-(--hue-soft)" />}
      {overlays && via && <ViaChip key={`${frameIndex}:${via.message}`} via={via} />}
      {overlays && glyph && <MarkGlyph mark={glyph} />}
    </Comp>
  )
}

/** The highlight ring (DSL §10): pulses in, then rests; `sticky` marks simply keep it. */
function HighlightRing() {
  const { off, tr } = useStageMotion()
  return (
    <motion.span
      aria-hidden
      data-highlight-ring=""
      className="pointer-events-none absolute -inset-px z-10 rounded-[inherit] ring-2 ring-(--tone)"
      initial={off ? false : { opacity: 0 }}
      animate={{ opacity: off ? 0.9 : [0, 1, 0.9] }}
      transition={tr('flash')}
    />
  )
}

/** A one-shot soft fill behind the content (a change, or a landing in the sender's hue). */
function Flash({ className }: { className: string }) {
  const { tr } = useStageMotion()
  return (
    <motion.span
      aria-hidden
      data-flash=""
      className={cn('pointer-events-none absolute inset-0 -z-10 rounded-[inherit]', className)}
      initial={{ opacity: 0 }}
      animate={{ opacity: [0, 0.9, 0] }}
      transition={tr('flash')}
    />
  )
}

/** Check / cross drawn on the node (DSL §10): a small badge at the top-end corner, path drawn on. */
function MarkGlyph({ mark }: { mark: GlyphMark }) {
  const { off, tr } = useStageMotion()
  const t = useT()
  const check = mark.kind === 'check'
  const draw = {
    initial: off ? false : { pathLength: 0 },
    animate: { pathLength: 1 },
    transition: tr('draw'),
  } as const
  return (
    <span
      data-mark={mark.id}
      data-mark-kind={mark.kind}
      style={toneVars(check ? 'ok' : 'danger')}
      className="pointer-events-none absolute -end-2 -top-2 z-20 grid size-4 place-items-center rounded-full bg-card text-(--tone) shadow-xs ring-1 ring-line"
    >
      <svg
        viewBox="0 0 16 16"
        className="size-3"
        fill="none"
        stroke="currentColor"
        strokeWidth={2.4}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-label={t(check ? 'stage.check' : 'stage.cross')}
      >
        <title>{t(check ? 'stage.check' : 'stage.cross')}</title>
        {check ? (
          <motion.path d="M3.5 8.5 6.5 11.5 12.5 4.5" {...draw} />
        ) : (
          <>
            <motion.path d="M4 4l8 8" {...draw} />
            <motion.path d="M12 4l-8 8" {...draw} />
          </>
        )}
      </svg>
    </span>
  )
}
