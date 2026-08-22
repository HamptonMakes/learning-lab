/**
 * Shared types of the regex engine (`src/regex/`): the compiled program the VM runs, the pattern
 * tokens the stage draws, and the JSON engine state the lesson reducer stores per actor.
 *
 * Everything here is plain data: no classes, no functions, no `undefined` values in serialized
 * positions (optional keys are omitted, never set to `undefined`) so that a state survives
 * `JSON.parse(JSON.stringify(state))` unchanged.
 */

/** Mirrors `Tone` in docs/animation-dsl.md §2 (defined locally: src/lesson is not importable). */
export type RegexTone = 'change' | 'info' | 'ok' | 'warn' | 'danger'

export type PatternTokenKind = 'literal' | 'any' | 'class' | 'quant' | 'group' | 'anchor' | 'alt'

/** One chip of the `pattern` Value (docs/animation-dsl.md §2 `PatternToken`). */
export interface PatternToken {
  /** Stable id, `p0`, `p1`… in source order. */
  id: string
  /** The exact source slice this chip stands for (`c`, `\d{4}`, `.*?`, `(`, `)+`, `|`). */
  src: string
  kind: PatternTokenKind
  /** Plain words for the chip ("any char", "digit, exactly 4", "a–z, one or more (greedy)"). */
  label?: string
}

/** A character test. Ranges are inclusive UTF-16 code unit ranges. */
export type Atom =
  | { kind: 'char'; ch: string }
  | { kind: 'any' }
  | { kind: 'class'; ranges: Array<[number, number]>; negated: boolean }

export type AssertKind = 'start' | 'end' | 'boundary' | 'nonboundary'

/**
 * VM instructions. Every instruction carries the index of the pattern token it belongs to; the
 * pattern cursor is the token of the instruction the VM rests on.
 *
 * - `test`     one character test against `atom`.
 * - `assert`   one zero-width test (`^`, `$`, `\b`, `\B`); counts as a test, consumes nothing.
 * - `run`      a quantified single-character atom (`a+`, `\d{4}`, `.*?`): one character test per
 *              tick, with one choice point that remembers how many characters the run holds.
 * - `split`    a choice: continue at `next`, remember `alt` on the stack (alternation, group loops).
 * - `jmp`, `save` (capture boundary), `clear` (reset the captures inside a repeated group at the
 *   start of each iteration, slots `[lo, hi)`), `mark`/`progress` (empty-iteration guard of group
 *   loops), `match`.
 */
export type Instr =
  | { op: 'test'; atom: Atom; token: number }
  | { op: 'assert'; at: AssertKind; token: number }
  | { op: 'run'; atom: Atom; min: number; max: number | null; lazy: boolean; token: number }
  | { op: 'split'; next: number; alt: number; token: number }
  | { op: 'jmp'; to: number; token: number }
  | { op: 'save'; slot: number; token: number }
  | { op: 'clear'; lo: number; hi: number; token: number }
  | { op: 'mark'; reg: number; token: number }
  | { op: 'progress'; reg: number; token: number }
  | { op: 'match'; token: number }

export interface Program {
  /** The pattern source, verbatim (data, never localized). */
  source: string
  /** Validated flags; only `i` is supported. */
  flags: string
  tokens: PatternToken[]
  code: Instr[]
  /** Number of capturing groups (`$1`…`$groups`). */
  groups: number
  /** Number of loop registers used by `mark`/`progress`. */
  regs: number
}

/**
 * What the VM remembers so that it can come back and try something else.
 *
 * - `alt`: resume at instruction `pc` with the text cursor at `ti` (the other branch of a `|`, or
 *   the exit / the next iteration of a group loop).
 * - `run`: a quantified single-char atom that started at `from` and currently holds `count`
 *   characters. `grow` = still taking characters; `hold` = done for now. A greedy run gives one
 *   character back per backtrack; a lazy run takes one more per backtrack.
 *
 * `saved` / `regs` are the capture and loop registers at the time the choice was made.
 */
export type ChoicePoint =
  | {
      id: string
      kind: 'alt'
      token: number
      pc: number
      ti: number
      saved: Array<number | null>
      regs: number[]
    }
  | {
      id: string
      kind: 'run'
      token: number
      pc: number
      from: number
      count: number
      phase: 'grow' | 'hold'
      saved: Array<number | null>
      regs: number[]
    }

export type RegexStatus = 'running' | 'matched' | 'failed'

/**
 * Event kinds a tick can produce (several per tick; `events` keeps them in order):
 * `attempt` (a new start position began), `backtrack` (a choice point was popped and retried),
 * `step` (one test ran), `fail` (a test failed or a loop made no progress), `match`.
 */
export type RegexEventKind = 'step' | 'fail' | 'backtrack' | 'attempt' | 'match'

/** What `regexAdvance` runs until (docs/animation-dsl.md §5.3). */
export type RegexUntil = 'step' | 'token' | 'fail' | 'attempt' | 'backtrack' | 'match' | 'end'

/** A span over the input text; mirrors `Annotation` (docs/animation-dsl.md §2) for `kind: 'text'`. */
export interface RegexAnnotation {
  id?: string
  /** Inclusive character index. */
  from: number
  /** Exclusive character index. */
  to: number
  label?: string
  tone?: RegexTone
}

/** The whole VM, as JSON. `regexAdvance` returns a new one; nothing is mutated. */
export interface EngineState {
  program: Program
  input: string
  flags: string
  status: RegexStatus
  /** Start index of the current attempt. */
  attempt: number
  /** Text cursor: the next character to test. */
  ti: number
  /** Instruction the VM rests on (a test, a run, an assert) or the one that just failed. */
  pc: number
  /** Pattern cursor: index into `program.tokens`; `tokens.length` once matched. */
  tokenCursor: number
  stack: ChoicePoint[]
  /** Next choice-point id number (`c1`, `c2`…). Ids are never reused within one `regexInit`. */
  nextChoice: number
  /** Capture registers: `saved[2g]` / `saved[2g+1]` = open / close index of group g (0 = match). */
  saved: Array<number | null>
  regs: number[]
  /** Group → [from, to) or null; index 0 is the whole match (null until matched). */
  captures: Array<[number, number] | null>
  /** Character tests so far (zero-width anchors count too). */
  tries: number
  /**
   * What the next tick must do first: `backtrack` = pop the top choice point and retry,
   * `restart` = begin the next attempt. A failed test leaves the failure visible until then.
   */
  pending: 'none' | 'backtrack' | 'restart'
  /** Start indices of every abandoned attempt. */
  failedStarts: number[]
  /** Text annotations: failed starts (danger), consumed spans (ok), held runs (change). */
  annotations: RegexAnnotation[]
  /** Events of the last tick, in order; empty right after `regexInit`. */
  events: RegexEventKind[]
  /** The most significant event of the last tick (match > fail > backtrack > attempt > step). */
  lastEvent: RegexEventKind | null
  /** [from, to) of the match once `status` is `matched`. */
  match: [number, number] | null
}
