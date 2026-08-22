/**
 * Public surface of `src/regex/`: the compiler (`compile`), the stepping VM (`regexInit`,
 * `regexAdvance`), and the slot projection the lesson reducer writes onto the actor
 * (`engineSlots`). See docs/animation-dsl.md §5.3.
 */
export { compile, RegexSyntaxError } from './compile'
export { regexInit, regexAdvance, currentToken, RegexLimitError } from './vm'
export type { AdvanceOptions } from './vm'
export { engineSlots, describeChoice, SLOT_NAMES } from './slots'
export type {
  RegexScalar,
  RegexSlots,
  RegexValueList,
  RegexValueMeter,
  RegexValuePattern,
  RegexValueRecord,
  RegexValueScalar,
  RegexValueText,
  SlotName,
} from './slots'
export type {
  AssertKind,
  Atom,
  ChoicePoint,
  EngineState,
  Instr,
  PatternToken,
  PatternTokenKind,
  Program,
  RegexAnnotation,
  RegexEventKind,
  RegexStatus,
  RegexTone,
  RegexUntil,
} from './types'
