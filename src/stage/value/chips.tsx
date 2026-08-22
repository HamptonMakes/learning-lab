/**
 * Small shared chips: a node (actor) chip in its hue, the `+n` overflow chip, an OR-Set tag pill
 * (alive / dead), an LTR island for Dot ids, and the caret (`@cursor`) node.
 */
import type { ReactNode } from 'react'
import type { Dot, NodeId, Path } from '@/lesson/types'
import { useT } from '@/i18n'
import { cn } from '@/lib/utils'
import { useStageFrame } from '../StageContext'
import { NodeBox } from './NodeBox'
import { metaPath } from './paths'
import { hueVars } from './tone'

/** The node that wrote a value: actor chip in its hue; the pseudo-node `seed` is a dim "init" chip. */
export function NodeChip({ node, className }: { node: NodeId; className?: string }) {
  const t = useT()
  const { world } = useStageFrame()
  if (node === 'seed') {
    return (
      <span
        data-node="seed"
        className={cn(
          'inline-flex h-4 items-center rounded-sm bg-paper-2 px-1 font-sans text-[11px] leading-none text-ink-3 italic',
          className,
        )}
      >
        {t('stage.init')}
      </span>
    )
  }
  const color = world.actors[node]?.color ?? 'neutral'
  return (
    <span
      data-node={node}
      style={hueVars(color)}
      className={cn(
        'inline-flex h-4 items-center gap-1 rounded-sm bg-(--hue-soft) px-1 font-sans text-[11px] leading-none font-medium text-(--hue)',
        className,
      )}
    >
      <i aria-hidden className="size-1.5 shrink-0 rounded-full bg-(--hue)" />
      <bdi>{node}</bdi>
    </span>
  )
}

/** `+n` — items / badges beyond the legibility limit (DSL §2). */
export function OverflowChip({ count, className }: { count: number; className?: string }) {
  const t = useT()
  return (
    <span
      data-overflow={count}
      className={cn(
        'inline-flex h-4 items-center rounded-sm border border-dashed border-line-2 px-1 font-mono text-[11px] leading-none text-ink-2',
        className,
      )}
    >
      {t('stage.more', { count })}
    </span>
  )
}

/** One OR-Set tag: alive (plain) or dead (dashed + struck through). Dot ids are LTR islands. */
export function TagPill({ tag, alive }: { tag: Dot; alive: boolean }) {
  const t = useT()
  return (
    <bdi
      dir="ltr"
      data-tag={tag}
      data-alive={alive ? 'true' : 'false'}
      title={t(alive ? 'stage.tag.alive' : 'stage.tag.dead', { tag })}
      className={cn(
        'inline-flex h-4 items-center rounded-sm border px-1 font-mono text-[10px] leading-none',
        alive
          ? 'border-line bg-card text-ink'
          : 'border-dashed border-line text-ink-3 line-through',
      )}
    >
      {tag}
    </bdi>
  )
}

/** A Dot id (`alice:3`) or any other left-to-right data, isolated for RTL pages (DSL §9). */
export function Ltr({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <bdi dir="ltr" className={className}>
      {children}
    </bdi>
  )
}

/** The cursor caret of a `text` / `pattern` value: the `@cursor` node. Glides via layoutId. */
export function Caret({ path, index, layoutId }: { path: Path; index: number; layoutId?: string }) {
  const t = useT()
  return (
    <NodeBox
      as="span"
      path={metaPath(path, 'cursor')}
      kind="cursor"
      dataValue={String(index)}
      label={t('stage.cursor', { index })}
      title={t('stage.cursor', { index })}
      layout
      layoutId={layoutId}
      className="mx-px inline-block h-[1.15em] w-0.5 shrink-0 self-center rounded-full bg-teal align-text-bottom"
    />
  )
}
