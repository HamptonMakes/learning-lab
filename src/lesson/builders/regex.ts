/**
 * Regex engine commands (docs/animation-dsl.md §5.3): `regex.init` compiles a pattern and loads the
 * input onto an actor; `regex.advance` runs the VM to the next event.
 */
import type { ActorId } from '../types'
import { compact, type Cmd } from './internal'

export type RegexUntil = Cmd<'regex.advance'>['until']

export const regex = {
  /** `regex.init('matcher', 'ca*t', 'the cat sat')` — pattern and input are data, never localized. */
  init(actor: ActorId, pattern: string, input: string, flags?: string): Cmd<'regex.init'> {
    return compact({ t: 'regex.init', actor, pattern, input, flags })
  },
  /** `regex.advance('matcher', 'backtrack')` — step · token · fail · attempt · backtrack · match · end. */
  advance(actor: ActorId, until: RegexUntil): Cmd<'regex.advance'> {
    return { t: 'regex.advance', actor, until }
  },
}
