/**
 * Regex compiler: a pattern string → the `PatternToken`s the stage draws + the program the VM runs.
 *
 * Supported syntax (JavaScript flavour, no `u` flag): literals; escapes `\d \w \s \D \W \S`,
 * `\b \B`, `\n \t \r \f \v \0`, `\uXXXX`, `\xHH`, and `\` + any punctuation (`\. \\ \( \*`…);
 * `.`; classes `[abc]`, `[a-z]`, `[^…]` (with escapes inside); quantifiers `* + ? {m} {m,} {m,n}`,
 * greedy and lazy (`*? +? ?? {m,n}?`); capturing `( )` and non-capturing `(?: )` groups;
 * alternation `|`; anchors `^ $`; flag `i`. Anything else (backreferences, lookaround, named
 * groups, `\p{…}`, other flags, a `{` that is not a quantifier) throws `RegexSyntaxError`.
 *
 * Tokens: one chip per literal character, escape, `.`, class, `(`, `)`, `|`, `^`, `$`; a quantifier
 * merges into the chip before it (`\d{4}` is one `quant` chip, `)+` is one `quant` chip). Ids are
 * `p0`, `p1`… in source order. Labels are plain words the renderer may show ("digit, exactly 4").
 *
 * Code: quantified single-character atoms compile to one `run` instruction (the VM shows them as
 * one choice point with a counter); quantified groups expand to `split`/`jmp` loops (`X+` = `X X*`,
 * `X{2,4}` = `X X (X (X)?)?`) with an empty-iteration guard on unbounded loops, like the ECMAScript
 * RepeatMatcher. Alternation is `split`, branch, `jmp`. Captures are `save` instructions.
 */
import type { AssertKind, Atom, Instr, PatternToken, PatternTokenKind, Program } from './types'

export class RegexSyntaxError extends Error {
  /** Index into the pattern where the problem starts. */
  readonly index: number
  constructor(message: string, index: number) {
    super(`${message} (at index ${index})`)
    this.name = 'RegexSyntaxError'
    this.index = index
  }
}

/** Largest `{m,n}` bound and largest expanded program we accept; lesson patterns are tiny. */
const MAX_REPEAT = 1000
const MAX_CODE = 5000

// ─── Character sets ────────────────────────────────────────────────────────────────────────────

type Range = [number, number]

const DIGIT: Range[] = [[0x30, 0x39]]
const WORD: Range[] = [
  [0x30, 0x39],
  [0x41, 0x5a],
  [0x5f, 0x5f],
  [0x61, 0x7a],
]
const SPACE: Range[] = [
  [0x09, 0x0d],
  [0x20, 0x20],
  [0xa0, 0xa0],
  [0x1680, 0x1680],
  [0x2000, 0x200a],
  [0x2028, 0x2029],
  [0x202f, 0x202f],
  [0x205f, 0x205f],
  [0x3000, 0x3000],
  [0xfeff, 0xfeff],
]

/** Complement of a (possibly unsorted, overlapping) range list within the UTF-16 code unit space. */
function complement(ranges: Range[]): Range[] {
  const sorted = [...ranges].sort((a, b) => a[0] - b[0])
  const out: Range[] = []
  let next = 0
  for (const [lo, hi] of sorted) {
    if (lo > next) out.push([next, lo - 1])
    if (hi + 1 > next) next = hi + 1
  }
  if (next <= 0xffff) out.push([next, 0xffff])
  return out
}

// ─── Labels (plain words) ──────────────────────────────────────────────────────────────────────

const NAMED_ESCAPES: Record<string, { ch: string; label: string }> = {
  n: { ch: '\n', label: 'newline' },
  t: { ch: '\t', label: 'tab' },
  r: { ch: '\r', label: 'carriage return' },
  f: { ch: '\f', label: 'form feed' },
  v: { ch: '\v', label: 'vertical tab' },
  '0': { ch: '\0', label: 'NUL' },
}

const CLASS_ESCAPES: Record<string, { ranges: Range[]; negated: boolean; label: string }> = {
  d: { ranges: DIGIT, negated: false, label: 'digit' },
  D: { ranges: DIGIT, negated: true, label: 'not a digit' },
  w: { ranges: WORD, negated: false, label: 'word char' },
  W: { ranges: WORD, negated: true, label: 'not a word char' },
  s: { ranges: SPACE, negated: false, label: 'whitespace' },
  S: { ranges: SPACE, negated: true, label: 'not whitespace' },
}

function showChar(ch: string): string {
  if (ch === ' ') return 'space'
  const code = ch.charCodeAt(0)
  if (code < 0x20 || code === 0x7f) return `U+${code.toString(16).toUpperCase().padStart(4, '0')}`
  return ch
}

interface Quant {
  min: number
  max: number | null
  lazy: boolean
  src: string
  form: '*' | '+' | '?' | 'exact' | 'atLeast' | 'between'
}

function quantWords(q: Quant): string {
  let words: string
  switch (q.form) {
    case '*':
      words = 'zero or more'
      break
    case '+':
      words = 'one or more'
      break
    case '?':
      words = 'optional'
      break
    case 'exact':
      words = `exactly ${q.min}`
      break
    case 'atLeast':
      words = `${q.min} or more`
      break
    case 'between':
      words = `${q.min} to ${q.max}`
      break
  }
  if (q.form === 'exact') return words
  if (q.lazy) return `${words} (lazy)`
  if (q.form === '?') return words
  return `${words} (greedy)`
}

// ─── AST ───────────────────────────────────────────────────────────────────────────────────────

type Node =
  | { type: 'atom'; atom: Atom; token: number; words: string }
  | { type: 'assert'; at: AssertKind; token: number }
  | {
      type: 'group'
      capture: number | null
      body: Node
      open: number
      close: number
      /** Capturing groups this group contains (itself included): `firstGroup`..`lastGroup`, or empty. */
      firstGroup: number
      lastGroup: number
    }
  | { type: 'seq'; items: Node[] }
  | { type: 'alt'; branches: Node[]; seps: number[] }
  | { type: 'quant'; body: Node; min: number; max: number | null; lazy: boolean; token: number }

/** What `parseAtom` can return: a single thing a quantifier may apply to (or an anchor, which it may not). */
type AtomNode = Extract<Node, { type: 'atom' | 'assert' | 'group' }>

interface Parser {
  src: string
  i: number
  tokens: PatternToken[]
  groups: number
}

function fail(p: Parser, message: string, at = p.i): never {
  throw new RegexSyntaxError(message, at)
}

function peek(p: Parser, offset = 0): string {
  return p.src.charAt(p.i + offset)
}

function pushToken(p: Parser, src: string, kind: PatternTokenKind, label?: string): number {
  const token: PatternToken = { id: `p${p.tokens.length}`, src, kind }
  if (label !== undefined) token.label = label
  p.tokens.push(token)
  return p.tokens.length - 1
}

function parseAlt(p: Parser): Node {
  const branches: Node[] = [parseSeq(p)]
  const seps: number[] = []
  while (peek(p) === '|') {
    seps.push(pushToken(p, '|', 'alt', 'or'))
    p.i += 1
    branches.push(parseSeq(p))
  }
  const first = branches[0]
  if (branches.length === 1 && first !== undefined) return first
  return { type: 'alt', branches, seps }
}

function parseSeq(p: Parser): Node {
  const items: Node[] = []
  while (p.i < p.src.length && peek(p) !== '|' && peek(p) !== ')') {
    items.push(parseQuantified(p))
  }
  return { type: 'seq', items }
}

function parseQuantified(p: Parser): Node {
  const start = p.i
  const atom = parseAtom(p)
  const q = parseQuantifier(p)
  if (q === null) return atom
  if (atom.type === 'assert')
    fail(p, 'Nothing to repeat: a quantifier cannot follow an anchor', start)
  if (peek(p) === '*' || peek(p) === '+' || peek(p) === '?' || peek(p) === '{') {
    fail(p, 'Nothing to repeat: a quantifier cannot follow a quantifier')
  }
  // Merge the quantifier into the chip it applies to (the atom, or the group's `)`).
  const tokenIndex = atom.type === 'group' ? atom.close : atom.token
  const token = p.tokens[tokenIndex]
  if (token === undefined) fail(p, 'internal: missing token', start)
  const words =
    atom.type === 'atom'
      ? atom.words
      : atom.type === 'group'
        ? atom.capture === null
          ? 'group'
          : `group ${atom.capture}`
        : token.src
  p.tokens[tokenIndex] = {
    id: token.id,
    src: token.src + q.src,
    kind: 'quant',
    label: `${words}, ${quantWords(q)}`,
  }
  return { type: 'quant', body: atom, min: q.min, max: q.max, lazy: q.lazy, token: tokenIndex }
}

const BRACED = /^\{(\d+)(?:(,)(\d*))?\}/

function parseQuantifier(p: Parser): Quant | null {
  const ch = peek(p)
  let q: Omit<Quant, 'lazy' | 'src'> | null = null
  let width = 0
  if (ch === '*') q = { min: 0, max: null, form: '*' }
  else if (ch === '+') q = { min: 1, max: null, form: '+' }
  else if (ch === '?') q = { min: 0, max: 1, form: '?' }
  else if (ch === '{') {
    const m = BRACED.exec(p.src.slice(p.i))
    if (m === null) {
      fail(p, "Unsupported syntax: '{' must start a quantifier like {2} or {2,5}; escape it as \\{")
    }
    const min = Number(m[1])
    const comma = m[2] !== undefined
    const hiText = m[3] ?? ''
    const max = !comma ? min : hiText === '' ? null : Number(hiText)
    if (min > MAX_REPEAT || (max !== null && max > MAX_REPEAT)) {
      fail(p, `Quantifier bound too large (max ${MAX_REPEAT})`)
    }
    if (max !== null && max < min) fail(p, 'Quantifier range out of order: {m,n} needs m <= n')
    q = { min, max, form: !comma ? 'exact' : max === null ? 'atLeast' : 'between' }
    width = m[0].length - 1
  }
  if (q === null) return null
  const from = p.i
  p.i += 1 + width
  let lazy = false
  if (peek(p) === '?') {
    lazy = true
    p.i += 1
  }
  return { ...q, lazy, src: p.src.slice(from, p.i) }
}

function parseAtom(p: Parser): AtomNode {
  const ch = peek(p)
  const start = p.i
  switch (ch) {
    case '(':
      return parseGroup(p)
    case '[':
      return parseClass(p)
    case '\\':
      return parseEscape(p)
    case '.':
      p.i += 1
      return {
        type: 'atom',
        atom: { kind: 'any' },
        token: pushToken(p, '.', 'any', 'any char'),
        words: 'any char',
      }
    case '^':
      p.i += 1
      return { type: 'assert', at: 'start', token: pushToken(p, '^', 'anchor', 'start of text') }
    case '$':
      p.i += 1
      return { type: 'assert', at: 'end', token: pushToken(p, '$', 'anchor', 'end of text') }
    case '*':
    case '+':
    case '?':
      return fail(p, 'Nothing to repeat: a quantifier needs something before it', start)
    case '{':
      if (BRACED.test(p.src.slice(p.i))) {
        fail(p, 'Nothing to repeat: a quantifier needs something before it', start)
      }
      return fail(
        p,
        "Unsupported syntax: '{' must start a quantifier like {2} or {2,5}; escape it as \\{",
      )
    case ')':
      return fail(p, "Unmatched ')'", start)
    case '':
      return fail(p, 'internal: unexpected end of pattern', start)
    default:
      p.i += 1
      return literal(p, ch, ch)
  }
}

function literal(p: Parser, ch: string, src: string, label?: string): AtomNode {
  const words = label ?? `'${showChar(ch)}'`
  const token = pushToken(p, src, 'literal', src === ch ? undefined : words)
  return { type: 'atom', atom: { kind: 'char', ch }, token, words }
}

function parseGroup(p: Parser): AtomNode {
  const start = p.i
  const firstGroup = p.groups + 1
  p.i += 1 // (
  let capture: number | null
  let openSrc = '('
  if (peek(p) === '?') {
    if (peek(p, 1) === ':') {
      capture = null
      openSrc = '(?:'
      p.i += 2
    } else {
      fail(
        p,
        `Unsupported syntax: '(?${peek(p, 1)}' groups (lookaround, named groups) are not supported`,
        start,
      )
    }
  } else {
    p.groups += 1
    capture = p.groups
  }
  const open = pushToken(
    p,
    openSrc,
    'group',
    capture === null ? 'group (no capture)' : `group ${capture}`,
  )
  const body = parseAlt(p)
  if (peek(p) !== ')') fail(p, "Unterminated group: missing ')'", start)
  p.i += 1
  const close = pushToken(
    p,
    ')',
    'group',
    capture === null ? 'end of group' : `end of group ${capture}`,
  )
  return { type: 'group', capture, body, open, close, firstGroup, lastGroup: p.groups }
}

function hex(p: Parser, digits: number): number {
  const text = p.src.slice(p.i, p.i + digits)
  if (text.length !== digits || !/^[0-9a-fA-F]+$/.test(text)) {
    fail(p, `Bad escape: expected ${digits} hex digits`)
  }
  p.i += digits
  return parseInt(text, 16)
}

function parseEscape(p: Parser): AtomNode {
  const start = p.i
  p.i += 1 // backslash
  const c = peek(p)
  if (c === '') fail(p, 'Trailing backslash', start)
  p.i += 1
  const cls = CLASS_ESCAPES[c]
  if (cls !== undefined) {
    const src = `\\${c}`
    const token = pushToken(p, src, 'class', cls.label)
    return {
      type: 'atom',
      atom: { kind: 'class', ranges: cls.ranges, negated: cls.negated },
      token,
      words: cls.label,
    }
  }
  const named = NAMED_ESCAPES[c]
  if (named !== undefined) {
    if (c === '0' && /\d/.test(peek(p))) fail(p, 'Unsupported syntax: octal escapes', start)
    return literal(p, named.ch, `\\${c}`, named.label)
  }
  if (c === 'b')
    return { type: 'assert', at: 'boundary', token: pushToken(p, '\\b', 'anchor', 'word boundary') }
  if (c === 'B') {
    return {
      type: 'assert',
      at: 'nonboundary',
      token: pushToken(p, '\\B', 'anchor', 'not a word boundary'),
    }
  }
  if (c === 'u' || c === 'x') {
    const code = hex(p, c === 'u' ? 4 : 2)
    return literal(p, String.fromCharCode(code), p.src.slice(start, p.i))
  }
  if (/[1-9]/.test(c)) fail(p, 'Unsupported syntax: backreferences (\\1…\\9)', start)
  if (c === 'p' || c === 'P') fail(p, 'Unsupported syntax: \\p{…} unicode properties', start)
  if (c === 'k') fail(p, 'Unsupported syntax: named backreferences', start)
  if (/[A-Za-z0-9]/.test(c)) fail(p, `Unknown escape '\\${c}'`, start)
  return literal(p, c, `\\${c}`)
}

type ClassItem =
  { kind: 'char'; code: number; show: string } | { kind: 'set'; ranges: Range[]; show: string }

function parseClassItem(p: Parser): ClassItem {
  const ch = peek(p)
  if (ch !== '\\') {
    p.i += 1
    return { kind: 'char', code: ch.charCodeAt(0), show: showChar(ch) }
  }
  const start = p.i
  p.i += 1
  const c = peek(p)
  if (c === '') fail(p, 'Trailing backslash', start)
  p.i += 1
  const cls = CLASS_ESCAPES[c]
  if (cls !== undefined) {
    return {
      kind: 'set',
      ranges: cls.negated ? complement(cls.ranges) : cls.ranges,
      show: cls.label,
    }
  }
  const named = NAMED_ESCAPES[c]
  if (named !== undefined) return { kind: 'char', code: named.ch.charCodeAt(0), show: named.label }
  if (c === 'b') return { kind: 'char', code: 0x08, show: 'backspace' }
  if (c === 'u' || c === 'x') {
    const code = hex(p, c === 'u' ? 4 : 2)
    return { kind: 'char', code, show: showChar(String.fromCharCode(code)) }
  }
  if (/[1-9]/.test(c)) fail(p, 'Unsupported syntax: backreferences inside a class', start)
  if (/[A-Za-z0-9]/.test(c)) fail(p, `Unknown escape '\\${c}' inside a class`, start)
  return { kind: 'char', code: c.charCodeAt(0), show: showChar(c) }
}

function parseClass(p: Parser): AtomNode {
  const start = p.i
  p.i += 1 // [
  let negated = false
  if (peek(p) === '^') {
    negated = true
    p.i += 1
  }
  const ranges: Range[] = []
  const shows: string[] = []
  while (peek(p) !== ']') {
    if (p.i >= p.src.length) fail(p, "Unterminated character class: missing ']'", start)
    const item = parseClassItem(p)
    if (item.kind === 'char' && peek(p) === '-' && peek(p, 1) !== ']' && peek(p, 1) !== '') {
      p.i += 1 // -
      const hi = parseClassItem(p)
      if (hi.kind !== 'char')
        fail(p, 'Unsupported syntax: a class escape cannot end a range', start)
      if (hi.code < item.code) fail(p, 'Range out of order in character class', start)
      ranges.push([item.code, hi.code])
      shows.push(`${item.show}–${hi.show}`)
    } else if (item.kind === 'char') {
      ranges.push([item.code, item.code])
      shows.push(item.show)
    } else {
      ranges.push(...item.ranges)
      shows.push(item.show)
    }
  }
  p.i += 1 // ]
  const src = p.src.slice(start, p.i)
  let words: string
  if (shows.length === 0) words = negated ? 'any char' : 'nothing'
  else words = `${negated ? 'not ' : ''}${shows.join(', ')}`
  const token = pushToken(p, src, 'class', words)
  return { type: 'atom', atom: { kind: 'class', ranges, negated }, token, words }
}

// ─── Code generation ───────────────────────────────────────────────────────────────────────────

interface Gen {
  code: Instr[]
  regs: number
}

type SplitInstr = Extract<Instr, { op: 'split' }>
type JmpInstr = Extract<Instr, { op: 'jmp' }>

function emit<I extends Instr>(g: Gen, ins: I): I {
  if (g.code.length >= MAX_CODE) {
    throw new RegexSyntaxError(`Pattern expands to more than ${MAX_CODE} instructions`, 0)
  }
  g.code.push(ins)
  return ins
}

function gen(g: Gen, node: Node): void {
  switch (node.type) {
    case 'atom':
      emit(g, { op: 'test', atom: node.atom, token: node.token })
      return
    case 'assert':
      emit(g, { op: 'assert', at: node.at, token: node.token })
      return
    case 'seq':
      for (const item of node.items) gen(g, item)
      return
    case 'group':
      if (node.capture === null) {
        gen(g, node.body)
      } else {
        emit(g, { op: 'save', slot: 2 * node.capture, token: node.open })
        gen(g, node.body)
        emit(g, { op: 'save', slot: 2 * node.capture + 1, token: node.close })
      }
      return
    case 'alt': {
      const jumps: JmpInstr[] = []
      for (let k = 0; k < node.branches.length - 1; k++) {
        const branch = node.branches[k]
        const sep = node.seps[k]
        if (branch === undefined || sep === undefined)
          throw new RegexSyntaxError('internal: bad alternation', 0)
        const split = emit(g, {
          op: 'split',
          next: g.code.length + 1,
          alt: -1,
          token: sep,
        } as SplitInstr)
        gen(g, branch)
        jumps.push(emit(g, { op: 'jmp', to: -1, token: sep } as JmpInstr))
        split.alt = g.code.length
      }
      const last = node.branches[node.branches.length - 1]
      if (last !== undefined) gen(g, last)
      for (const j of jumps) j.to = g.code.length
      return
    }
    case 'quant':
      genQuant(g, node)
      return
  }
}

function genQuant(g: Gen, node: Extract<Node, { type: 'quant' }>): void {
  const { body, min, max, lazy, token } = node
  if (body.type === 'atom') {
    emit(g, { op: 'run', atom: body.atom, min, max, lazy, token })
    return
  }
  // Like the ECMAScript RepeatMatcher, every iteration starts with the group's captures cleared.
  const iteration = (): void => {
    if (body.type === 'group' && body.lastGroup >= body.firstGroup) {
      emit(g, { op: 'clear', lo: 2 * body.firstGroup, hi: 2 * body.lastGroup + 2, token })
    }
    gen(g, body)
  }
  for (let k = 0; k < min; k++) iteration()
  if (max === null) {
    // X*: L1: split L2, L3; L2: mark; X; progress; jmp L1; L3:
    const reg = g.regs++
    const l1 = g.code.length
    const split = emit(g, { op: 'split', next: -1, alt: -1, token } as SplitInstr)
    const l2 = g.code.length
    emit(g, { op: 'mark', reg, token })
    iteration()
    emit(g, { op: 'progress', reg, token })
    emit(g, { op: 'jmp', to: l1, token })
    const l3 = g.code.length
    if (lazy) {
      split.next = l3
      split.alt = l2
    } else {
      split.next = l2
      split.alt = l3
    }
    return
  }
  // X{m,n}: m copies, then (n - m) nested optionals: (X (X (X)?)?)?
  const splits: SplitInstr[] = []
  for (let k = 0; k < max - min; k++) {
    const split = emit(g, { op: 'split', next: -1, alt: -1, token } as SplitInstr)
    const bodyAt = g.code.length
    iteration()
    if (lazy) split.alt = bodyAt
    else split.next = bodyAt
    splits.push(split)
  }
  const end = g.code.length
  for (const split of splits) {
    if (lazy) split.next = end
    else split.alt = end
  }
}

// ─── Public API ────────────────────────────────────────────────────────────────────────────────

/**
 * Compile `pattern` (+ optional `flags`, only `i`) into tokens + VM code. Throws `RegexSyntaxError`
 * with a plain-words message and the offending index on unsupported or malformed syntax.
 */
export function compile(pattern: string, flags = ''): Program {
  for (let k = 0; k < flags.length; k++) {
    const f = flags.charAt(k)
    if (f !== 'i' || flags.indexOf(f) !== k) {
      throw new RegexSyntaxError(`Unsupported flag '${f}': only 'i' is supported`, k)
    }
  }
  const p: Parser = { src: pattern, i: 0, tokens: [], groups: 0 }
  const ast = parseAlt(p)
  if (p.i < pattern.length) {
    if (peek(p) === ')') fail(p, "Unmatched ')'")
    fail(p, 'internal: unexpected trailing input')
  }
  const g: Gen = { code: [], regs: 0 }
  gen(g, ast)
  emit(g, { op: 'match', token: p.tokens.length })
  return { source: pattern, flags, tokens: p.tokens, code: g.code, groups: p.groups, regs: g.regs }
}
