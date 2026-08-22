/**
 * Meta badges — the CRDT sidecar drawn next to a value node (DSL §2 `Meta`, stage-architecture §3):
 * type, stamp (`t3`, or the HLC `(10:05, 2)` when present), writer node (hue dot + id), op tag,
 * OR-Set tags (≤ 3 + `+n`, alive / dead), tombstone, add / remove stamps, compact version vector
 * (full in `title`), applied ids (≤ 3 + `+n`), RGA stats (`visible/stored`), and a note. The
 * sidecar is quiet by design — one muted mono line, `t2 · bob · alice:1`, with separators drawn
 * by CSS — so the value stays the hero. Every badge is a node: `data-path=<path>@<key>` (the
 * tombstone badge answers to `@tomb` and `@tombstone`), registered as an anchor, so highlights and
 * callouts can point at it.
 */
import type { ReactNode } from 'react'
import { AnimatePresence } from 'motion/react'
import { X } from 'lucide-react'
import { LIMITS, type Meta, type Path } from '@/lesson/types'
import { useT } from '@/i18n'
import { cn } from '@/lib/utils'
import { useStageFrame } from '../StageContext'
import { useStageMotion } from '../motion/StageMotionProvider'
import { Ltr, NodeChip, OverflowChip, TagPill } from './chips'
import { compactClock, formatStamp, fullClock, orderEntries } from './format'
import { NodeBox } from './NodeBox'
import { metaPath } from './paths'

export interface MetaBadgesProps {
  path: Path
  meta: Meta | undefined
  className?: string
}

export function MetaBadges({ path, meta, className }: MetaBadgesProps) {
  const t = useT()
  const { world } = useStageFrame()
  if (!meta) return null
  const stamp = (ts: number) => formatStamp(ts, world.clock, t)
  const badges: ReactNode[] = []

  if (meta.type) {
    badges.push(
      <Badge
        key="type"
        path={path}
        metaKey="type"
        dataValue={meta.type}
        title={t('stage.meta.type')}
        className="font-sans text-[10px] font-semibold tracking-wide text-teal uppercase"
      >
        {t(`stage.type.${meta.type}`)}
      </Badge>,
    )
  }
  if (meta.hlc) {
    const text = `(${world.clock.format === 'time' ? stamp(meta.hlc.wall) : meta.hlc.wall}, ${meta.hlc.counter})`
    badges.push(
      <Badge key="hlc" path={path} metaKey="hlc" dataValue={text} title={t('stage.meta.hlc')}>
        <Ltr>{text}</Ltr>
      </Badge>,
    )
  } else if (meta.ts !== undefined) {
    const text = stamp(meta.ts)
    badges.push(
      <Badge key="ts" path={path} metaKey="ts" dataValue={text} title={t('stage.meta.ts')}>
        <Ltr>{text}</Ltr>
      </Badge>,
    )
  }
  if (meta.node !== undefined) {
    badges.push(
      <Badge
        key="node"
        path={path}
        metaKey="node"
        dataValue={meta.node}
        title={t('stage.meta.node', { node: meta.node })}
      >
        <NodeChip node={meta.node} className="text-ink-3" />
      </Badge>,
    )
  }
  if (meta.tag) {
    badges.push(
      <Badge
        key="tag"
        path={path}
        metaKey="tag"
        dataValue={meta.tag}
        title={t('stage.meta.tag', { tag: meta.tag })}
      >
        <Ltr>#{meta.tag}</Ltr>
      </Badge>,
    )
  }
  if (meta.tags) {
    const shown = meta.tags.slice(0, LIMITS.maxBadges)
    const more = meta.tags.length - shown.length
    badges.push(
      <Badge
        key="tags"
        path={path}
        metaKey="tags"
        dataValue={JSON.stringify(meta.tags)}
        title={t('stage.meta.tags')}
        className="gap-1.5"
      >
        {shown.map((tg) => (
          <TagPill key={tg.tag} tag={tg.tag} alive={tg.alive} />
        ))}
        {more > 0 && <OverflowChip count={more} />}
      </Badge>,
    )
  }
  if (meta.tombstone) {
    badges.push(
      <Badge
        key="tomb"
        path={path}
        metaKey="tomb"
        aliases={[metaPath(path, 'tombstone')]}
        dataValue="true"
        title={t('stage.deleted')}
        className="font-sans text-ink-3"
      >
        <X className="size-2.5 shrink-0" aria-hidden />
        {t('stage.deleted')}
      </Badge>,
    )
  }
  if (meta.addTs !== undefined) {
    const text = t('stage.meta.addTs', { ts: stamp(meta.addTs) })
    badges.push(
      <Badge key="addTs" path={path} metaKey="addTs" dataValue={stamp(meta.addTs)} title={text}>
        <Ltr>{text}</Ltr>
      </Badge>,
    )
  }
  if (meta.removeTs !== undefined) {
    const text = t('stage.meta.removeTs', { ts: stamp(meta.removeTs) })
    badges.push(
      <Badge
        key="removeTs"
        path={path}
        metaKey="removeTs"
        dataValue={stamp(meta.removeTs)}
        title={text}
      >
        <Ltr>{text}</Ltr>
      </Badge>,
    )
  }
  if (meta.vc) {
    const ordered = orderEntries(meta.vc, Object.keys(world.actors))
    badges.push(
      <Badge
        key="vc"
        path={path}
        metaKey="vc"
        dataValue={compactClock(ordered)}
        title={t('stage.meta.vc', { vc: fullClock(ordered) })}
      >
        <Ltr>{compactClock(ordered)}</Ltr>
      </Badge>,
    )
  }
  if (meta.applied) {
    const shown = meta.applied.slice(0, LIMITS.maxBadges)
    const more = meta.applied.length - shown.length
    badges.push(
      <Badge
        key="applied"
        path={path}
        metaKey="applied"
        dataValue={meta.applied.join(' ')}
        title={t('stage.meta.applied')}
        className="gap-1"
      >
        <Ltr className="inline-flex gap-1">
          {shown.map((id) => (
            <span key={id} data-applied={id}>
              {id}
            </span>
          ))}
        </Ltr>
        {more > 0 && <OverflowChip count={more} />}
      </Badge>,
    )
  }
  if (meta.stats) {
    const text = `${meta.stats.visible}/${meta.stats.stored}`
    badges.push(
      <Badge
        key="stats"
        path={path}
        metaKey="stats"
        dataValue={text}
        title={t('stage.meta.stats', meta.stats)}
      >
        <Ltr>{text}</Ltr>
      </Badge>,
    )
  }
  if (meta.note) {
    badges.push(
      <Badge
        key="note"
        path={path}
        metaKey="note"
        dataValue={meta.note}
        className="h-auto font-sans whitespace-normal italic"
      >
        {meta.note}
      </Badge>,
    )
  }
  if (badges.length === 0) return null
  return (
    <span
      data-meta-badges=""
      className={cn('inline-flex max-w-full flex-wrap items-baseline gap-x-1 gap-y-0.5', className)}
    >
      <AnimatePresence initial={false}>{badges}</AnimatePresence>
    </span>
  )
}

function Badge({
  path,
  metaKey,
  dataValue,
  title,
  aliases,
  className,
  children,
}: {
  path: Path
  metaKey: string
  dataValue: string
  title?: string
  aliases?: readonly Path[]
  className?: string
  children: ReactNode
}) {
  const { off, tr } = useStageMotion()
  return (
    <NodeBox
      as="span"
      path={metaPath(path, metaKey)}
      kind="meta"
      dataValue={dataValue}
      title={title}
      aliases={aliases}
      attrs={{ 'data-meta': metaKey }}
      layout="position"
      initial={off ? false : { opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.9, transition: tr('exit') }}
      transition={{ ...tr('enter'), layout: tr('layout') }}
      className={cn(
        'inline-flex max-w-full items-center gap-1 rounded-sm px-0.5 font-mono text-[12.5px] leading-4 whitespace-nowrap text-ink-2',
        className,
      )}
    >
      {children}
    </NodeBox>
  )
}
