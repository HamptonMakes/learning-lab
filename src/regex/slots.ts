/**
 * The five "plain-looking" slots the engine writes onto its actor (docs/animation-dsl.md §5.3):
 * `pattern`, `text`, `stack`, `captures`, `tries`. These are Values in the shape the stage draws.
 *
 * The `RegexValue*` types below mirror the DSL's `Value` shapes field-for-field (defined locally:
 * `src/lesson` is not importable from here). Each one is structurally assignable to the
 * corresponding `Value` variant, so the lesson layer can pass them through unchanged.
 */
import type { ChoicePoint, EngineState, PatternToken, RegexAnnotation, RegexTone } from './types'

export type RegexScalar = string | number | boolean | null

export interface RegexValueScalar {
  kind: 'scalar'
  value: RegexScalar
}

export interface RegexValuePattern {
  kind: 'pattern'
  tokens: PatternToken[]
  /** Index of the token under test; `tokens.length` once matched. */
  cursor?: number
}

export interface RegexValueText {
  kind: 'text'
  text: string
  /** The next character to test. */
  cursor?: number
  annotations: RegexAnnotation[]
}

export interface RegexValueList {
  kind: 'list'
  items: Array<{ id: string; value: RegexValueScalar }>
  display?: 'row' | 'column' | 'text'
}

export interface RegexValueRecord {
  kind: 'record'
  fields: Array<{ key: string; value: RegexValueScalar }>
  display?: 'card' | 'tree'
}

export interface RegexValueMeter {
  kind: 'meter'
  value: number
  max?: number
  label?: string
  tone?: RegexTone
}

export interface RegexSlots {
  pattern: RegexValuePattern
  text: RegexValueText
  /** Choice points, bottom first; ids `c1`…; value `"p3 @ 4"` (alt) or `"p1 @ 1 ×4"` (a run holding 4). */
  stack: RegexValueList
  /** `$1`…`$n`: the captured substring, or null while the group is open / unmatched. */
  captures: RegexValueRecord
  /** Character tests so far. */
  tries: RegexValueMeter
}

export const SLOT_NAMES = ['pattern', 'text', 'stack', 'captures', 'tries'] as const
export type SlotName = (typeof SLOT_NAMES)[number]

/** What a choice point remembers, as one short string: token id, text index, and the run counter. */
export function describeChoice(state: EngineState, cp: ChoicePoint): string {
  const token = state.program.tokens[cp.token]?.id ?? `#${cp.token}`
  return cp.kind === 'alt' ? `${token} @ ${cp.ti}` : `${token} @ ${cp.from} ×${cp.count}`
}

export function engineSlots(state: EngineState): RegexSlots {
  const fields: RegexValueRecord['fields'] = []
  for (let g = 1; g <= state.program.groups; g++) {
    const span = state.captures[g] ?? null
    fields.push({
      key: `$${g}`,
      value: { kind: 'scalar', value: span === null ? null : state.input.slice(span[0], span[1]) },
    })
  }
  return {
    pattern: { kind: 'pattern', tokens: state.program.tokens, cursor: state.tokenCursor },
    text: { kind: 'text', text: state.input, cursor: state.ti, annotations: state.annotations },
    stack: {
      kind: 'list',
      items: state.stack.map((cp) => ({
        id: cp.id,
        value: { kind: 'scalar', value: describeChoice(state, cp) },
      })),
    },
    captures: { kind: 'record', fields },
    tries: { kind: 'meter', value: state.tries, label: 'tries' },
  }
}
