/**
 * Meter — a label, `value / max` and a bar whose width Motion animates from `value / max`
 * (never a CSS transition). `data-value` = the value. Tone colours the bar (default: accent).
 */
import { motion } from 'motion/react'
import type { Path, ValueOf } from '@/lesson/types'
import { cn } from '@/lib/utils'
import { useStageMotion } from '../motion/StageMotionProvider'
import { MetaBadges } from './MetaBadges'
import { NodeBox } from './NodeBox'
import { toneVars } from './tone'

export function Meter({
  path,
  value,
  depth,
}: {
  path: Path
  value: ValueOf<'meter'>
  depth: number
}) {
  const { off, tr } = useStageMotion()
  const max = value.max ?? Math.max(value.value, 1)
  const pct = max > 0 ? Math.max(0, Math.min(100, (value.value / max) * 100)) : 0
  return (
    <NodeBox
      path={path}
      kind="meter"
      dataValue={String(value.value)}
      tombstone={value.meta?.tombstone}
      style={toneVars(value.tone ?? 'change')}
      attrs={{ 'data-max': value.max }}
      className={cn(
        'flex min-w-28 flex-col gap-0.5 rounded-sm font-mono text-[13px]',
        depth === 0 && 'px-0.5',
      )}
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-sans text-[11px] leading-4 text-ink-2">{value.label}</span>
        <span className="tabular-nums">
          <span data-meter-value="">{value.value}</span>
          {value.max !== undefined && <span className="text-ink-3"> / {value.max}</span>}
        </span>
      </div>
      <meter value={value.value} min={0} max={max} aria-label={value.label} className="sr-only">
        {value.value}
      </meter>
      <div aria-hidden className="h-1.5 w-full overflow-hidden rounded-full bg-paper-3">
        <motion.div
          data-meter-bar=""
          className="h-full rounded-full bg-(--tone)"
          initial={off ? false : { width: 0 }}
          animate={{ width: `${pct}%` }}
          transition={tr('settle')}
        />
      </div>
      <MetaBadges path={path} meta={value.meta} />
    </NodeBox>
  )
}
