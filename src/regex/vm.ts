/**
 * Backtracking regex VM that advances one character test at a time and records what it did.
 *
 * `regexInit(pattern, input, flags)` compiles and positions the VM at attempt 0. `regexAdvance`
 * runs *ticks* until the requested event. A tick is:
 *
 *   1. (if a test failed last tick) pop the top choice point and retry — or begin the next
 *      attempt when the stack is empty;
 *   2. run silent instructions (captures, jumps, splits that push choice points);
 *   3. perform ONE test (a character, a zero-width anchor, or one character of a quantifier run);
 *   4. if it passed, run silent instructions until the next test, or the match.
 *
 * So after every tick the VM rests on the next test token, on a failed test (failure stays
 * visible until the next tick resolves it), on `matched`, or on `failed`. Events per tick:
 * `attempt`, `backtrack`, `step` (a test ran), `fail`, `match`. `regexAdvance(state, until)` stops
 * after the first tick whose events contain `until`, where `token` means "the pattern cursor is on
 * a different token than when the call began" (a greedy run collapses into one call) and `end`
 * means "a terminal status". Every `until` stops at a terminal status.
 *
 * Quantified single characters (`a+`, `.*`, `\d{4}`) are one choice point with a counter: a greedy
 * run takes as many as it can (one test per tick), then gives one back per backtrack; a lazy run
 * takes its minimum, then one more per backtrack. Group quantifiers and alternation use plain
 * `split` choice points. Pure, deterministic, iterative (no recursion), JSON state throughout.
 */
import { compile } from './compile'
import type {
  Atom,
  ChoicePoint,
  EngineState,
  Instr,
  Program,
  RegexAnnotation,
  RegexEventKind,
  RegexUntil,
} from './types'

export class RegexLimitError extends Error {
  constructor(ticks: number) {
    super(`regexAdvance: more than ${ticks} ticks in one call (catastrophic backtracking?)`)
    this.name = 'RegexLimitError'
  }
}

export interface AdvanceOptions {
  /** Ticks one `regexAdvance` call may run before throwing `RegexLimitError` (default 200 000). */
  maxTicks?: number
}

const DEFAULT_MAX_TICKS = 200_000

const EVENT_RANK: Record<RegexEventKind, number> = {
  step: 1,
  attempt: 2,
  backtrack: 3,
  fail: 4,
  match: 5,
}

// ─── Character tests ───────────────────────────────────────────────────────────────────────────

const LINE_TERMINATORS = new Set(['\n', '\r', '\u2028', '\u2029'])

function inRanges(ranges: Array<[number, number]>, code: number): boolean {
  for (const [lo, hi] of ranges) if (code >= lo && code <= hi) return true
  return false
}

function atomMatches(atom: Atom, ch: string, ignoreCase: boolean): boolean {
  switch (atom.kind) {
    case 'char':
      if (atom.ch === ch) return true
      if (!ignoreCase) return false
      return (
        atom.ch.toLowerCase() === ch.toLowerCase() || atom.ch.toUpperCase() === ch.toUpperCase()
      )
    case 'any':
      return !LINE_TERMINATORS.has(ch)
    case 'class': {
      let hit = inRanges(atom.ranges, ch.charCodeAt(0))
      if (!hit && ignoreCase) {
        hit =
          inRanges(atom.ranges, ch.toLowerCase().charCodeAt(0)) ||
          inRanges(atom.ranges, ch.toUpperCase().charCodeAt(0))
      }
      return hit !== atom.negated
    }
  }
}

function isWordChar(ch: string): boolean {
  return /^[A-Za-z0-9_]$/.test(ch)
}

function assertHolds(
  at: Extract<Instr, { op: 'assert' }>['at'],
  input: string,
  ti: number,
): boolean {
  switch (at) {
    case 'start':
      return ti === 0
    case 'end':
      return ti === input.length
    case 'boundary':
    case 'nonboundary': {
      const before = ti > 0 && isWordChar(input.charAt(ti - 1))
      const after = ti < input.length && isWordChar(input.charAt(ti))
      return (before !== after) === (at === 'boundary')
    }
  }
}

// ─── State helpers ─────────────────────────────────────────────────────────────────────────────

function instrAt(program: Program, pc: number): Instr {
  const ins = program.code[pc]
  if (ins === undefined) throw new Error(`regex vm: no instruction at pc ${pc}`)
  return ins
}

function tokenOf(program: Program, pc: number): number {
  return instrAt(program, pc).token
}

function freshSaved(program: Program): Array<number | null> {
  return new Array<number | null>(2 * (program.groups + 1)).fill(null)
}

function freshRegs(program: Program): number[] {
  return new Array<number>(program.regs).fill(-1)
}

/** A shallow working copy: arrays that ticks mutate are copied up front; choice points are replaced, never mutated. */
function draft(state: EngineState): EngineState {
  return {
    ...state,
    stack: state.stack.slice(),
    saved: state.saved.slice(),
    regs: state.regs.slice(),
    failedStarts: state.failedStarts.slice(),
    events: [],
  }
}

function captureSpans(state: EngineState): Array<[number, number] | null> {
  const out: Array<[number, number] | null> = []
  for (let g = 0; g <= state.program.groups; g++) {
    const from = state.saved[2 * g] ?? null
    const to = state.saved[2 * g + 1] ?? null
    out.push(from !== null && to !== null && to >= from ? [from, to] : null)
  }
  return out
}

function annotations(state: EngineState): RegexAnnotation[] {
  const out: RegexAnnotation[] = []
  const len = state.input.length
  for (const start of state.failedStarts) {
    if (start < len) out.push({ id: `fail-${start}`, from: start, to: start + 1, tone: 'danger' })
  }
  if (state.status === 'matched' && state.match !== null) {
    // An empty match paints nothing (`state.match` still says where it is).
    if (state.match[1] > state.match[0]) {
      out.push({ id: 'match', from: state.match[0], to: state.match[1], tone: 'ok' })
    }
    return out
  }
  // A dead attempt (waiting for the restart) owns nothing any more: only its danger mark remains.
  if (state.status === 'failed' || state.pending === 'restart') return out
  const runs = state.stack
    .flatMap((cp) => (cp.kind === 'run' && cp.count > 0 ? [cp] : []))
    .sort((a, b) => a.from - b.from)
  let pos = state.attempt
  for (const run of runs) {
    if (run.from > pos) out.push({ id: `ok-${pos}`, from: pos, to: run.from, tone: 'ok' })
    const token = state.program.tokens[run.token]
    const span: RegexAnnotation = {
      id: `run-${run.id}`,
      from: run.from,
      to: run.from + run.count,
      tone: 'change',
    }
    if (token !== undefined) span.label = token.src
    out.push(span)
    pos = run.from + run.count
  }
  if (state.ti > pos) out.push({ id: `ok-${pos}`, from: pos, to: state.ti, tone: 'ok' })
  return out
}

/** Derive the display fields (cursor, captures, annotations, lastEvent) from the core state. */
function finalize(state: EngineState): EngineState {
  const tokenCursor =
    state.status === 'matched' ? state.program.tokens.length : tokenOf(state.program, state.pc)
  const withCursor: EngineState = { ...state, tokenCursor, captures: captureSpans(state) }
  let lastEvent: RegexEventKind | null = null
  for (const e of state.events) {
    if (lastEvent === null || EVENT_RANK[e] > EVENT_RANK[lastEvent]) lastEvent = e
  }
  return { ...withCursor, annotations: annotations(withCursor), lastEvent }
}

// ─── Ticks ─────────────────────────────────────────────────────────────────────────────────────

/** A test failed (or a loop made no progress): decide what the next tick must do. */
function failed(s: EngineState): EngineState {
  s.events.push('fail')
  if (s.stack.length > 0) {
    s.pending = 'backtrack'
  } else {
    s.failedStarts.push(s.attempt)
    if (s.attempt < s.input.length) {
      s.pending = 'restart'
    } else {
      s.pending = 'none'
      s.status = 'failed'
    }
  }
  return finalize(s)
}

function matched(s: EngineState): EngineState {
  s.status = 'matched'
  s.pending = 'none'
  s.match = [s.attempt, s.ti]
  s.saved[0] = s.attempt
  s.saved[1] = s.ti
  s.events.push('match')
  return finalize(s)
}

function topRun(s: EngineState, pc: number): Extract<ChoicePoint, { kind: 'run' }> | null {
  const top = s.stack[s.stack.length - 1]
  if (top !== undefined && top.kind === 'run' && top.phase === 'grow' && top.pc === pc) return top
  return null
}

/**
 * The run at `pc` stops taking characters with `count` of them. Keep its choice point (phase
 * `hold`) only if it still has something to offer: a greedy run can give back while `count > min`,
 * a lazy run can take more while `count < max`.
 */
function settleRun(s: EngineState, cp: Extract<ChoicePoint, { kind: 'run' }>, count: number): void {
  const ins = instrAt(s.program, cp.pc)
  if (ins.op !== 'run') throw new Error('regex vm: run choice point without run instruction')
  s.stack.pop()
  const keep = ins.lazy ? ins.max === null || count < ins.max : count > ins.min
  if (keep) s.stack.push({ ...cp, count, phase: 'hold' })
  s.pc = cp.pc + 1
}

function tick(prev: EngineState): EngineState {
  const s = draft(prev)
  const { program, input } = s
  const ignoreCase = s.flags.includes('i')
  const len = input.length
  let tested = false

  // 1. Resolve what the last failed test left pending.
  if (s.pending === 'backtrack') {
    const cp = s.stack.pop()
    if (cp === undefined) throw new Error('regex vm: backtrack with an empty stack')
    s.events.push('backtrack')
    s.saved = cp.saved.slice()
    s.regs = cp.regs.slice()
    s.pending = 'none'
    if (cp.kind === 'alt') {
      s.ti = cp.ti
      s.pc = cp.pc
    } else {
      const ins = instrAt(program, cp.pc)
      if (ins.op !== 'run') throw new Error('regex vm: run choice point without run instruction')
      if (!ins.lazy) {
        // Greedy: give one character back, then retry what follows the run.
        const count = cp.count - 1
        s.ti = cp.from + count
        s.pc = cp.pc + 1
        if (count > ins.min) s.stack.push({ ...cp, count })
      } else {
        // Lazy: take one more character (this tick's test), then retry what follows the run.
        s.ti = cp.from + cp.count
        s.pc = cp.pc
        s.tries += 1
        s.events.push('step')
        tested = true
        if (s.ti < len && atomMatches(ins.atom, input.charAt(s.ti), ignoreCase)) {
          const count = cp.count + 1
          s.ti += 1
          s.pc = cp.pc + 1
          if (ins.max === null || count < ins.max) s.stack.push({ ...cp, count })
        } else {
          return failed(s)
        }
      }
    }
  } else if (s.pending === 'restart') {
    s.attempt += 1
    s.ti = s.attempt
    s.pc = 0
    s.stack = []
    s.saved = freshSaved(program)
    s.regs = freshRegs(program)
    s.pending = 'none'
    s.events.push('attempt')
  }

  // 2–4. Silent instructions, one test, silent instructions.
  for (;;) {
    const ins = instrAt(program, s.pc)
    switch (ins.op) {
      case 'match':
        return matched(s)
      case 'save':
        s.saved[ins.slot] = s.ti
        s.pc += 1
        continue
      case 'clear':
        for (let slot = ins.lo; slot < ins.hi; slot++) s.saved[slot] = null
        s.pc += 1
        continue
      case 'mark':
        s.regs[ins.reg] = s.ti
        s.pc += 1
        continue
      case 'jmp':
        s.pc = ins.to
        continue
      case 'split':
        s.stack.push({
          id: `c${s.nextChoice}`,
          kind: 'alt',
          token: ins.token,
          pc: ins.alt,
          ti: s.ti,
          saved: s.saved.slice(),
          regs: s.regs.slice(),
        })
        s.nextChoice += 1
        s.pc = ins.next
        continue
      case 'progress':
        if (s.ti === s.regs[ins.reg]) return failed(s)
        s.pc += 1
        continue
      case 'assert':
        if (tested) return finalize(s)
        tested = true
        s.tries += 1
        s.events.push('step')
        if (!assertHolds(ins.at, input, s.ti)) return failed(s)
        s.pc += 1
        continue
      case 'test':
        if (tested) return finalize(s)
        tested = true
        s.tries += 1
        s.events.push('step')
        if (!(s.ti < len && atomMatches(ins.atom, input.charAt(s.ti), ignoreCase))) return failed(s)
        s.ti += 1
        s.pc += 1
        continue
      case 'run': {
        if (tested) return finalize(s)
        let cp = topRun(s, s.pc)
        if (cp === null) {
          cp = {
            id: `c${s.nextChoice}`,
            kind: 'run',
            token: ins.token,
            pc: s.pc,
            from: s.ti,
            count: 0,
            phase: 'grow',
            saved: s.saved.slice(),
            regs: s.regs.slice(),
          }
          s.nextChoice += 1
          s.stack.push(cp)
        }
        const doneGrowing = (count: number): boolean =>
          ins.lazy ? count >= ins.min : ins.max !== null && count >= ins.max
        if (doneGrowing(cp.count)) {
          // Lazy run at its minimum, or a run that may take nothing (`a{0}`): no test this tick.
          settleRun(s, cp, cp.count)
          continue
        }
        tested = true
        s.tries += 1
        s.events.push('step')
        if (s.ti < len && atomMatches(ins.atom, input.charAt(s.ti), ignoreCase)) {
          const count = cp.count + 1
          s.ti += 1
          if (doneGrowing(count)) {
            settleRun(s, cp, count)
            continue
          }
          s.stack[s.stack.length - 1] = { ...cp, count }
          return finalize(s)
        }
        if (cp.count >= ins.min) {
          // The run simply ends here; the failed character test is not a failure of the attempt.
          settleRun(s, cp, cp.count)
          continue
        }
        s.stack.pop()
        return failed(s)
      }
    }
  }
}

// ─── Public API ────────────────────────────────────────────────────────────────────────────────

/** Compile `pattern` and position the VM at the start of attempt 0. Nothing has run yet. */
export function regexInit(pattern: string, input: string, flags = ''): EngineState {
  const program = compile(pattern, flags)
  const state: EngineState = {
    program,
    input,
    flags,
    status: 'running',
    attempt: 0,
    ti: 0,
    pc: 0,
    tokenCursor: 0,
    stack: [],
    nextChoice: 1,
    saved: freshSaved(program),
    regs: freshRegs(program),
    captures: [],
    tries: 0,
    pending: 'none',
    failedStarts: [],
    annotations: [],
    events: [],
    lastEvent: null,
    match: null,
  }
  return finalize(state)
}

function stopsAt(until: RegexUntil, state: EngineState, startToken: number): boolean {
  switch (until) {
    case 'end':
    case 'match':
      return false // terminal status only
    case 'token':
      return state.tokenCursor !== startToken
    default:
      return state.events.includes(until)
  }
}

/**
 * Run ticks until the next `until` event (see the module doc), or until the VM is `matched` /
 * `failed`. A terminal state is returned unchanged. Pure: `state` is never mutated.
 */
export function regexAdvance(
  state: EngineState,
  until: RegexUntil,
  options: AdvanceOptions = {},
): EngineState {
  if (state.status !== 'running') return state
  const maxTicks = options.maxTicks ?? DEFAULT_MAX_TICKS
  const startToken = state.tokenCursor
  let s = state
  for (let n = 0; ; n++) {
    if (n >= maxTicks) throw new RegexLimitError(maxTicks)
    s = tick(s)
    if (s.status !== 'running' || stopsAt(until, s, startToken)) return s
  }
}

/** Convenience: the id of the token under the pattern cursor, or null once matched. */
export function currentToken(state: EngineState): string | null {
  return state.program.tokens[state.tokenCursor]?.id ?? null
}
