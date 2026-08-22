/**
 * Tone and actor hue → CSS custom properties (tokens.css), set on a node's `style` so Tailwind
 * utilities like `ring-(--tone)` / `bg-(--hue-soft)` pick them up. `change` maps to the accent
 * (DSL §10); colour is never the only signal — every tone pairs with a glyph or a label.
 */
import type { CSSProperties } from 'react'
import type { ActorColor, Tone } from '@/lesson/types'

const TONE_BASE: Record<Tone, string> = {
  change: 'accent',
  info: 'info',
  ok: 'ok',
  warn: 'warn',
  danger: 'danger',
}

/** `--tone` / `--tone-soft` for a tone. */
export function toneVars(tone: Tone): CSSProperties {
  const base = TONE_BASE[tone]
  return { '--tone': `var(--${base})`, '--tone-soft': `var(--${base}-soft)` } as CSSProperties
}

/** `--hue` / `--hue-soft` for the hue an actor owns. */
export function hueVars(color: ActorColor): CSSProperties {
  return {
    '--hue': `var(--actor-${color})`,
    '--hue-soft': `var(--actor-${color}-soft)`,
  } as CSSProperties
}
