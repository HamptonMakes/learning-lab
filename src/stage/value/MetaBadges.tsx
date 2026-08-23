/**
 * Meta badges — the CRDT sidecar drawn next to a value node (DSL §2 `Meta`, stage-architecture §3):
 * type, stamp (`t3`, or the HLC `(10:05, 2)` when present), writer node (hue dot + id), op tag,
 * OR-Set tags (≤ 3 + `+n`, alive / dead), tombstone, add / remove stamps, compact version vector
 * (full in `title`), applied ids (≤ 3 + `+n`), RGA stats (`visible/stored`), and a note. The
 * sidecar is quiet by design — one muted mono line, `t2 · bob · alice:1`, with separators drawn
 * by CSS — so the value stays the hero. Every badge is a node: `data-path=<path>@<key>` (the
 * tombstone badge answers to `@tomb` and `@tombstone`), registered as an anchor, so highlights and
 * callouts can point at it.
 *
 * Gating (legibility, DSL §2): a badge nobody can use is still rendered, but hidden (`NodeBox
 * hidden` → `sr-only` + `data-hidden`), so anchors, marks and the DOM contract keep resolving.
 *  - Seed stamps (`node: 'seed'`, the initial state nobody wrote) hide their `ts` / `hlc` / `node`
 *    badges everywhere: `t=0 · init` is noise.
 *  - Inside a composed document (DocContext) the document is the hero: a node's sidecar shows only
 *    where the step points — the node changed this step, landed via a message, carries a mark, or
 *    its parent changed (a freshly added item shows its parts' stamps). Per-part type chips stay
 *    hidden (the slot caption names the doc once).
 *  - A mark or change on the badge's own path (`alice.card.title@type`, `bob.cart[milk]@tags`)
 *    always shows that badge. Atomic slots keep their sidecar: there, the stamp is the lesson.
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
import { useDocRoot } from './doc'
import { compactClock, formatStamp, fullClock, orderEntries } from './format'
import { NodeBox } from './NodeBox'
import { metaPath, parentPath } from './paths'

export interface MetaBadgesProps {
  path: Path
  meta: Meta | undefined
  className?: string
}

export function MetaBadges({ path, meta, className }: MetaBadgesProps) {
  const t = useT()
  const frame = useStageFrame()
  const { world } = frame
  const inDoc = useDocRoot() !== null
  if (!meta) return null
  const stamp = (ts: number) => formatStamp(ts, world.clock, t)

  /** The step points at `p`: a mark anchors on it, or it changed this step. */
  const pointed = (p: Path) => frame.marksByPath.has(p) || frame.changedPaths.has(p)
  const parent = parentPath(path)
  const nodeShown =
    !inDoc ||
    pointed(path) ||
    frame.via.has(path) ||
    (parent !== undefined && frame.changedPaths.has(parent))
  const seed = meta.node === 'seed'
  /** Quiet badges hide unless pointed at; the rest follow their node. */
  const shown = (key: string, quiet: boolean, aliases: readonly string[] = []): boolean =>
    [key, ...aliases].some((k) => pointed(metaPath(path, k))) || (nodeShown && !quiet)

  const badges: ReactNode[] = []
  let visible = 0
  const push = (key: string, quiet: boolean, render: (hidden: boolean) => ReactNode) => {
    const hidden = !shown(key, quiet, key === 'tomb' ? ['tombstone'] : [])
    if (!hidden) visible += 1
    badges.push(render(hidden))
  }

  if (meta.type) {
    push('type', inDoc, (hidden) => (
      <Badge
        key="type"
        path={path}
        metaKey="type"
        dataValue={meta.type ?? ''}
        title={t('stage.meta.type')}
        hidden={hidden}
        className="font-sans text-[10px] font-semibold tracking-wide text-teal uppercase"
      >
        {t(`stage.type.${meta.type}`)}
      </Badge>
    ))
  }
  if (meta.hlc) {
    const hlc = meta.hlc
    const text = `(${world.clock.format === 'time' ? stamp(hlc.wall) : hlc.wall}, ${hlc.counter})`
    push('hlc', seed, (hidden) => (
      <Badge
        key="hlc"
        path={path}
        metaKey="hlc"
        dataValue={text}
        title={t('stage.meta.hlc')}
        hidden={hidden}
      >
        <Ltr>{text}</Ltr>
      </Badge>
    ))
  } else if (meta.ts !== undefined) {
    const text = stamp(meta.ts)
    push('ts', seed, (hidden) => (
      <Badge
        key="ts"
        path={path}
        metaKey="ts"
        dataValue={text}
        title={t('stage.meta.ts')}
        hidden={hidden}
      >
        <Ltr>{text}</Ltr>
      </Badge>
    ))
  }
  if (meta.node !== undefined) {
    const node = meta.node
    push('node', seed, (hidden) => (
      <Badge
        key="node"
        path={path}
        metaKey="node"
        dataValue={node}
        title={t('stage.meta.node', { node })}
        hidden={hidden}
      >
        <NodeChip node={node} className="text-ink-3" />
      </Badge>
    ))
  }
  if (meta.tag) {
    const tag = meta.tag
    push('tag', false, (hidden) => (
      <Badge
        key="tag"
        path={path}
        metaKey="tag"
        dataValue={tag}
        title={t('stage.meta.tag', { tag })}
        hidden={hidden}
      >
        <Ltr>#{tag}</Ltr>
      </Badge>
    ))
  }
  if (meta.tags) {
    const tags = meta.tags
    const shownTags = tags.slice(0, LIMITS.maxBadges)
    const more = tags.length - shownTags.length
    push('tags', false, (hidden) => (
      <Badge
        key="tags"
        path={path}
        metaKey="tags"
        dataValue={JSON.stringify(tags)}
        title={t('stage.meta.tags')}
        hidden={hidden}
        className="gap-1.5"
      >
        {shownTags.map((tg) => (
          <TagPill key={tg.tag} tag={tg.tag} alive={tg.alive} />
        ))}
        {more > 0 && <OverflowChip count={more} />}
      </Badge>
    ))
  }
  if (meta.tombstone) {
    push('tomb', false, (hidden) => (
      <Badge
        key="tomb"
        path={path}
        metaKey="tomb"
        aliases={[metaPath(path, 'tombstone')]}
        dataValue="true"
        title={t('stage.deleted')}
        hidden={hidden}
        className="font-sans text-ink-3"
      >
        <X className="size-2.5 shrink-0" aria-hidden />
        {t('stage.deleted')}
      </Badge>
    ))
  }
  if (meta.addTs !== undefined) {
    const ts = stamp(meta.addTs)
    const text = t('stage.meta.addTs', { ts })
    push('addTs', false, (hidden) => (
      <Badge key="addTs" path={path} metaKey="addTs" dataValue={ts} title={text} hidden={hidden}>
        <Ltr>{text}</Ltr>
      </Badge>
    ))
  }
  if (meta.removeTs !== undefined) {
    const ts = stamp(meta.removeTs)
    const text = t('stage.meta.removeTs', { ts })
    push('removeTs', false, (hidden) => (
      <Badge
        key="removeTs"
        path={path}
        metaKey="removeTs"
        dataValue={ts}
        title={text}
        hidden={hidden}
      >
        <Ltr>{text}</Ltr>
      </Badge>
    ))
  }
  if (meta.vc) {
    const ordered = orderEntries(meta.vc, Object.keys(world.actors))
    push('vc', false, (hidden) => (
      <Badge
        key="vc"
        path={path}
        metaKey="vc"
        dataValue={compactClock(ordered)}
        title={t('stage.meta.vc', { vc: fullClock(ordered) })}
        hidden={hidden}
      >
        <Ltr>{compactClock(ordered)}</Ltr>
      </Badge>
    ))
  }
  if (meta.applied) {
    const applied = meta.applied
    const shownIds = applied.slice(0, LIMITS.maxBadges)
    const more = applied.length - shownIds.length
    push('applied', false, (hidden) => (
      <Badge
        key="applied"
        path={path}
        metaKey="applied"
        dataValue={applied.join(' ')}
        title={t('stage.meta.applied')}
        hidden={hidden}
        className="gap-1"
      >
        <Ltr className="inline-flex gap-1">
          {shownIds.map((id) => (
            <span key={id} data-applied={id}>
              {id}
            </span>
          ))}
        </Ltr>
        {more > 0 && <OverflowChip count={more} />}
      </Badge>
    ))
  }
  if (meta.stats) {
    const stats = meta.stats
    const text = `${stats.visible}/${stats.stored}`
    push('stats', false, (hidden) => (
      <Badge
        key="stats"
        path={path}
        metaKey="stats"
        dataValue={text}
        title={t('stage.meta.stats', stats)}
        hidden={hidden}
      >
        <Ltr>{text}</Ltr>
      </Badge>
    ))
  }
  if (meta.note) {
    const note = meta.note
    push('note', false, (hidden) => (
      <Badge
        key="note"
        path={path}
        metaKey="note"
        dataValue={note}
        hidden={hidden}
        className="h-auto font-sans whitespace-normal italic"
      >
        {note}
      </Badge>
    ))
  }
  if (badges.length === 0) return null
  const allHidden = visible === 0
  return (
    <span
      data-meta-badges=""
      data-hidden={allHidden ? '' : undefined}
      className={cn(
        allHidden ? 'sr-only' : 'inline-flex max-w-full flex-wrap items-baseline gap-x-1 gap-y-0.5',
        className,
      )}
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
  hidden,
  className,
  children,
}: {
  path: Path
  metaKey: string
  dataValue: string
  title?: string
  aliases?: readonly Path[]
  hidden: boolean
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
      hidden={hidden}
      attrs={{ 'data-meta': metaKey }}
      layout={hidden ? undefined : 'position'}
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
