/**
 * A small icon + word badge for card chrome (status, offline, clock). Not shadcn's Badge: that
 * carries `transition-*` utilities, which are banned inside the stage (Motion owns all motion).
 * Colour is never the only signal — every pill pairs an icon with a word.
 */
import type { ComponentProps, CSSProperties } from 'react'
import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

export type PillTone = 'neutral' | 'accent' | 'ok' | 'warn' | 'danger'

const PILL_TONES: Record<PillTone, { fg: string; bg: string }> = {
  neutral: { fg: 'var(--ink-2)', bg: 'var(--paper-3)' },
  accent: { fg: 'var(--accent)', bg: 'var(--accent-soft)' },
  ok: { fg: 'var(--ok)', bg: 'var(--ok-soft)' },
  warn: { fg: 'var(--warn)', bg: 'var(--warn-soft)' },
  danger: { fg: 'var(--danger)', bg: 'var(--danger-soft)' },
}

export interface PillProps extends ComponentProps<'span'> {
  tone?: PillTone
  icon?: LucideIcon
}

export function Pill({
  tone = 'neutral',
  icon: Icon,
  className,
  style,
  children,
  ...rest
}: PillProps) {
  const colours = PILL_TONES[tone]
  const vars = { '--pill-fg': colours.fg, '--pill-bg': colours.bg } as CSSProperties
  return (
    <span
      data-tone={tone}
      style={{ ...vars, ...style }}
      className={cn(
        'inline-flex h-5 max-w-full items-center gap-1 rounded-full bg-(--pill-bg) px-2 text-[11px] leading-none whitespace-nowrap text-ink-2',
        className,
      )}
      {...rest}
    >
      {Icon && <Icon className="size-3 shrink-0 text-(--pill-fg)" aria-hidden />}
      {children}
    </span>
  )
}
