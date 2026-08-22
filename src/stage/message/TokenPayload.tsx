/**
 * What a message token shows: the optional label, a compact rendering of the payload and the
 * envelope badges from `payload.meta` (type, stamp, writer, op id/tag, version vector, size) as one
 * quiet muted line (`t2 · bob · alice:1`, separators drawn by CSS).
 * A state snapshot (`data.kind === 'state'`) is drawn compact: type chip + ≤ 24-char summary; an op
 * message is already `{ scalar: opLabel(op), meta: { tag, ts, node } }`. The full canonical payload
 * lives in `title` and `data-value`. Colour is the sender's hue; the label and text carry the meaning.
 * A parked token is one row (label · summary), so it fits the tray's single token row.
 */
import type { ActorColor, Message, Meta } from '@/lesson/types'
import { useT } from '@/i18n'
import { cn } from '@/lib/utils'
import { useStageFrame } from '../StageContext'
import { actorVar } from '../marks/tone'
import { formatStamp } from '../value/format'
import { canonicalValue, compactClock, CRDT_SHORT, summarizeValue } from './summarize'

export interface TokenPayloadProps {
  message: Message
  /** The sender's hue. */
  color: ActorColor
  /** Parked tokens sit in a one-row tray: label and summary inline, no badges. */
  parked?: boolean
}

export function TokenPayload({ message, color, parked = false }: TokenPayloadProps) {
  const t = useT()
  const { world } = useStageFrame()
  const { payload } = message
  const hue = actorVar(color)
  const full = canonicalValue(payload)
  const summary = summarizeValue(payload)
  const isState = message.data?.kind === 'state'
  const typeChip = isState
    ? payload.meta?.type
      ? CRDT_SHORT[payload.meta.type]
      : t('stage.token.state')
    : undefined
  return (
    <div
      className={cn(
        'flex max-w-56 rounded-lg border bg-card px-2.5 py-1.5 text-ink shadow-(--shadow-pop)',
        parked ? 'h-(--stage-token-h) flex-row items-center gap-1.5' : 'flex-col gap-0.5',
      )}
      style={{ borderColor: hue }}
      title={full}
      data-value={full}
    >
      {message.label ? (
        <span
          className="text-[11px] leading-none font-medium whitespace-nowrap"
          style={{ color: hue }}
          data-label
        >
          {message.label}
        </span>
      ) : null}
      <div className="flex items-center gap-1.5">
        {typeChip ? (
          <span
            className="text-[10px] leading-none font-semibold tracking-wide uppercase"
            style={{ color: hue }}
            data-type-chip
          >
            {typeChip}
          </span>
        ) : null}
        <span className="font-mono text-[13px] leading-tight whitespace-nowrap" data-summary>
          {summary}
        </span>
      </div>
      {parked ? null : (
        <Badges
          meta={payload.meta}
          size={message.size}
          colorOf={(n) => world.actors[n]?.color}
          stamp={(ts) => formatStamp(ts, world.clock, t)}
        />
      )}
    </div>
  )
}

function Badges({
  meta,
  size,
  colorOf,
  stamp,
}: {
  meta: Meta | undefined
  size: number | undefined
  colorOf: (node: string) => ActorColor | undefined
  /** A stamp in the scene's clock format (`t2`, `150 ms`, `10:05`). */
  stamp: (ts: number) => string
}) {
  const t = useT()
  const items: Array<{ key: string; text: string; hue?: string }> = []
  if (meta?.hlc) items.push({ key: 'hlc', text: `(${meta.hlc.wall}, ${meta.hlc.counter})` })
  else if (meta?.ts !== undefined) items.push({ key: 'ts', text: stamp(meta.ts) })
  if (meta?.node) {
    const c = colorOf(meta.node)
    items.push({ key: 'node', text: meta.node, hue: c ? actorVar(c) : undefined })
  }
  if (meta?.tag) items.push({ key: 'tag', text: meta.tag })
  if (meta?.vc) items.push({ key: 'vc', text: compactClock(meta.vc) })
  if (size !== undefined) items.push({ key: 'size', text: t('stage.bytes', { n: size }) })
  if (items.length === 0) return null
  return (
    // Dot ids and clocks are LTR islands (DSL §9).
    <bdi
      dir="ltr"
      data-token-badges=""
      className="flex flex-wrap items-center gap-1 font-mono text-[10px] leading-3 text-ink-3"
    >
      {items.map((b) => (
        <span key={b.key} className="inline-flex items-center gap-1" data-badge={b.key}>
          {b.hue ? (
            <span
              aria-hidden
              className="inline-block size-1.5 rounded-full"
              style={{ backgroundColor: b.hue }}
            />
          ) : null}
          {b.text}
        </span>
      ))}
    </bdi>
  )
}
