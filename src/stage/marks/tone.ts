/**
 * Colour helpers for the overlay layers. Tones come from `../actor/tone` (one mapping for the whole
 * stage); this file adds the actor hue lookup and the compare-verdict glyph/tone table.
 * Colour is never the only signal: every tone pairs with an icon or glyph.
 */
import type { ActorColor, Tone, Verdict } from '@/lesson/types'
import type { PillTone } from '../actor/Pill'

export { toneVar, toneSoftVar } from '../actor/tone'

/** `var(--actor-a)` … for the hue an actor owns (`soft` → the tinted fill). */
export function actorVar(color: ActorColor, soft = false): string {
  return `var(--actor-${color}${soft ? '-soft' : ''})`
}

/** The tone a compare verdict is drawn in (the glyph + word carry the meaning; colour assists). */
export function verdictTone(verdict: Verdict): Tone {
  switch (verdict) {
    case 'equal':
      return 'ok'
    case 'different':
    case 'concurrent':
      return 'warn'
    default:
      return 'info'
  }
}

/** The Pill tone for a stage tone (`change`/`info` share the accent). */
export function pillTone(tone: Tone): PillTone {
  return tone === 'change' || tone === 'info' ? 'accent' : tone
}

/** Verdict glyphs. The directional ones are bidi-mirrored characters, so RTL needs no special casing. */
export const VERDICT_GLYPH: Record<Verdict, string> = {
  equal: '=',
  different: '≠',
  before: '≺',
  after: '≻',
  concurrent: '∥',
  less: '<',
  greater: '>',
}
