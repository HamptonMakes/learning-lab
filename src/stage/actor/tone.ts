/**
 * Tone → token mapping for the stage (DSL §10): `change` is the accent, the others map to the
 * semantic palette. Returned as `var(--…)` references so dark mode follows the tokens.
 */
import type { CSSProperties } from 'react'
import type { ActorColor, Tone } from '@/lesson/types'

const TONE_VAR: Record<Tone, string> = {
  change: 'var(--accent)',
  info: 'var(--info)',
  ok: 'var(--ok)',
  warn: 'var(--warn)',
  danger: 'var(--danger)',
}

const TONE_SOFT_VAR: Record<Tone, string> = {
  change: 'var(--accent-soft)',
  info: 'var(--info-soft)',
  ok: 'var(--ok-soft)',
  warn: 'var(--warn-soft)',
  danger: 'var(--danger-soft)',
}

export function toneVar(tone: Tone): string {
  return TONE_VAR[tone]
}

export function toneSoftVar(tone: Tone): string {
  return TONE_SOFT_VAR[tone]
}

/** An actor's hue as CSS variables the card chrome reads (`--card-hue`, `--card-hue-soft`). */
export function actorHueStyle(color: ActorColor): CSSProperties {
  return {
    '--card-hue': `var(--actor-${color})`,
    '--card-hue-soft': `var(--actor-${color}-soft)`,
  } as CSSProperties
}
