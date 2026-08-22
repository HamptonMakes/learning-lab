/** Compiler: tokens the stage draws, the program the VM runs, and clear errors on unsupported syntax. */
import { describe, expect, it } from 'vitest'
import { compile, RegexSyntaxError } from './compile'
import type { Instr } from './types'

function tokens(pattern: string) {
  return compile(pattern).tokens
}

function ops(pattern: string): Instr['op'][] {
  return compile(pattern).code.map((i) => i.op)
}

describe('compile: tokens', () => {
  it('one chip per literal, "." and class; ids p0… in source order', () => {
    expect(tokens('c.t')).toEqual([
      { id: 'p0', src: 'c', kind: 'literal' },
      { id: 'p1', src: '.', kind: 'any', label: 'any char' },
      { id: 'p2', src: 't', kind: 'literal' },
    ])
  })

  it('a quantifier merges into the chip before it (kind quant, plain-words label)', () => {
    expect(tokens('ORD-\\d{4}')).toEqual([
      { id: 'p0', src: 'O', kind: 'literal' },
      { id: 'p1', src: 'R', kind: 'literal' },
      { id: 'p2', src: 'D', kind: 'literal' },
      { id: 'p3', src: '-', kind: 'literal' },
      { id: 'p4', src: '\\d{4}', kind: 'quant', label: 'digit, exactly 4' },
    ])
    expect(tokens('a.*b')[1]).toEqual({
      id: 'p1',
      src: '.*',
      kind: 'quant',
      label: 'any char, zero or more (greedy)',
    })
    expect(tokens('a.*?b')[1]?.label).toBe('any char, zero or more (lazy)')
    expect(tokens('colou?r')[4]).toEqual({
      id: 'p4',
      src: 'u?',
      kind: 'quant',
      label: "'u', optional",
    })
    expect(tokens('u??')[0]?.label).toBe("'u', optional (lazy)")
    expect(tokens('x+')[0]?.label).toBe("'x', one or more (greedy)")
    expect(tokens('x{2,}')[0]?.label).toBe("'x', 2 or more (greedy)")
    expect(tokens('x{2,4}?')[0]?.label).toBe("'x', 2 to 4 (lazy)")
    expect(tokens('[a-z]+')[0]?.label).toBe('a–z, one or more (greedy)')
  })

  it('groups: "(" and ")" are group chips; a quantified group merges into ")"', () => {
    expect(tokens('ORD-(\\d{4})')).toEqual([
      { id: 'p0', src: 'O', kind: 'literal' },
      { id: 'p1', src: 'R', kind: 'literal' },
      { id: 'p2', src: 'D', kind: 'literal' },
      { id: 'p3', src: '-', kind: 'literal' },
      { id: 'p4', src: '(', kind: 'group', label: 'group 1' },
      { id: 'p5', src: '\\d{4}', kind: 'quant', label: 'digit, exactly 4' },
      { id: 'p6', src: ')', kind: 'group', label: 'end of group 1' },
    ])
    expect(tokens('(a+)+b')).toEqual([
      { id: 'p0', src: '(', kind: 'group', label: 'group 1' },
      { id: 'p1', src: 'a+', kind: 'quant', label: "'a', one or more (greedy)" },
      { id: 'p2', src: ')+', kind: 'quant', label: 'group 1, one or more (greedy)' },
      { id: 'p3', src: 'b', kind: 'literal' },
    ])
    expect(tokens('(?:ab)*')).toEqual([
      { id: 'p0', src: '(?:', kind: 'group', label: 'group (no capture)' },
      { id: 'p1', src: 'a', kind: 'literal' },
      { id: 'p2', src: 'b', kind: 'literal' },
      { id: 'p3', src: ')*', kind: 'quant', label: 'group, zero or more (greedy)' },
    ])
  })

  it('alternation, anchors, escapes and classes get their own kinds and words', () => {
    expect(tokens('a|b')[1]).toEqual({ id: 'p1', src: '|', kind: 'alt', label: 'or' })
    expect(tokens('^a$')).toEqual([
      { id: 'p0', src: '^', kind: 'anchor', label: 'start of text' },
      { id: 'p1', src: 'a', kind: 'literal' },
      { id: 'p2', src: '$', kind: 'anchor', label: 'end of text' },
    ])
    expect(tokens('\\bx\\B').map((t) => [t.kind, t.label])).toEqual([
      ['anchor', 'word boundary'],
      ['literal', undefined],
      ['anchor', 'not a word boundary'],
    ])
    expect(tokens('\\d\\D\\w\\W\\s\\S').map((t) => [t.kind, t.src, t.label])).toEqual([
      ['class', '\\d', 'digit'],
      ['class', '\\D', 'not a digit'],
      ['class', '\\w', 'word char'],
      ['class', '\\W', 'not a word char'],
      ['class', '\\s', 'whitespace'],
      ['class', '\\S', 'not whitespace'],
    ])
    expect(tokens('\\.\\\\\\n\\u0041\\x42').map((t) => [t.kind, t.src, t.label])).toEqual([
      ['literal', '\\.', "'.'"],
      ['literal', '\\\\', "'\\'"],
      ['literal', '\\n', 'newline'],
      ['literal', '\\u0041', "'A'"],
      ['literal', '\\x42', "'B'"],
    ])
    expect(tokens('[a-z0-9_]')[0]).toEqual({
      id: 'p0',
      src: '[a-z0-9_]',
      kind: 'class',
      label: 'a–z, 0–9, _',
    })
    expect(tokens('[^"]')[0]?.label).toBe('not "')
    expect(tokens('[\\d.-]')[0]?.label).toBe('digit, ., -')
    expect(tokens('[\\d-z]')[0]?.label).toBe('digit, -, z')
    expect(tokens('[]')[0]?.label).toBe('nothing')
    expect(tokens('[^]')[0]?.label).toBe('any char')
    expect(tokens('[ ]')[0]?.label).toBe('space')
  })

  it('token sources concatenate back to the pattern', () => {
    for (const pattern of [
      'cat',
      'a.*b',
      '(a|ab)c',
      'colou?r',
      '^\\d+$',
      'ORD-(\\d{4})',
      '(a+)+b',
      '(?:x|y){2,3}?z',
      '[^a-f\\s]*\\.[\\]\\-]+',
      'a||b',
      '()',
      '\\bfoo\\b|bar$',
    ]) {
      expect(
        compile(pattern)
          .tokens.map((t) => t.src)
          .join(''),
      ).toBe(pattern)
      expect(compile(pattern).tokens.map((t) => t.id)).toEqual(
        compile(pattern).tokens.map((_, i) => `p${i}`),
      )
    }
  })
})

describe('compile: program', () => {
  it('literals are tests; a quantified single char is one run; match closes the program', () => {
    expect(ops('cat')).toEqual(['test', 'test', 'test', 'match'])
    const prog = compile('a.*b')
    expect(prog.code).toEqual([
      { op: 'test', atom: { kind: 'char', ch: 'a' }, token: 0 },
      { op: 'run', atom: { kind: 'any' }, min: 0, max: null, lazy: false, token: 1 },
      { op: 'test', atom: { kind: 'char', ch: 'b' }, token: 2 },
      { op: 'match', token: 3 },
    ])
    expect(compile('\\d{4}').code[0]).toMatchObject({ op: 'run', min: 4, max: 4, lazy: false })
    expect(compile('x{2,}?').code[0]).toMatchObject({ op: 'run', min: 2, max: null, lazy: true })
    expect(compile('x{0}').code[0]).toMatchObject({ op: 'run', min: 0, max: 0 })
  })

  it('groups save captures; alternation splits; loops expand with a progress guard', () => {
    expect(compile('(a|b)').code).toEqual([
      { op: 'save', slot: 2, token: 0 },
      { op: 'split', next: 2, alt: 4, token: 2 },
      { op: 'test', atom: { kind: 'char', ch: 'a' }, token: 1 },
      { op: 'jmp', to: 5, token: 2 },
      { op: 'test', atom: { kind: 'char', ch: 'b' }, token: 3 },
      { op: 'save', slot: 3, token: 4 },
      { op: 'match', token: 5 },
    ])
    expect(compile('(a|b)').groups).toBe(1)
    expect(compile('(?:a)(b)(c)').groups).toBe(2)
    expect(ops('(ab)*')).toEqual([
      'split',
      'mark',
      'clear',
      'save',
      'test',
      'test',
      'save',
      'progress',
      'jmp',
      'match',
    ])
    expect(ops('(ab)+')).toEqual([
      'clear',
      'save',
      'test',
      'test',
      'save',
      'split',
      'mark',
      'clear',
      'save',
      'test',
      'test',
      'save',
      'progress',
      'jmp',
      'match',
    ])
    expect(compile('x(a(b))+').code[1]).toEqual({ op: 'clear', lo: 2, hi: 6, token: 6 })
    expect(ops('(?:a){2,4}')).toEqual(['test', 'test', 'split', 'test', 'split', 'test', 'match'])
    expect(compile('(ab)*').regs).toBe(1)
    const lazyStar = compile('(?:ab)*?').code[0]
    expect(lazyStar).toMatchObject({ op: 'split', next: 6, alt: 1 })
  })

  it('accepts flag i only', () => {
    expect(compile('a', 'i').flags).toBe('i')
    expect(() => compile('a', 'g')).toThrow(RegexSyntaxError)
    expect(() => compile('a', 'ii')).toThrow(/flag/)
    expect(() => compile('a', 'm')).toThrow(/Unsupported flag 'm'/)
  })
})

describe('compile: errors are clear and located', () => {
  const cases: Array<[string, RegExp]> = [
    ['(?=a)', /lookaround/],
    ['(?<n>a)', /named groups/],
    ['\\1', /backreference/i],
    ['\\p{L}', /unicode/],
    ['\\q', /Unknown escape/],
    ['a**', /Nothing to repeat/],
    ['*a', /Nothing to repeat/],
    ['^*', /Nothing to repeat/],
    ['a{2}{3}', /Nothing to repeat/],
    ['a{', /quantifier/],
    ['a{,5}', /quantifier/],
    ['{2}', /Nothing to repeat/],
    ['a{2,1}', /out of order/],
    ['a{1001}', /too large/],
    ['(a', /Unterminated group/],
    ['a)', /Unmatched/],
    ['[a', /Unterminated character class/],
    ['[z-a]', /out of order/],
    ['[a-\\d]', /class escape/],
    ['a\\', /Trailing backslash/],
    ['\\u12', /hex/],
  ]
  for (const [pattern, message] of cases) {
    it(`rejects ${JSON.stringify(pattern)}`, () => {
      expect(() => compile(pattern)).toThrow(RegexSyntaxError)
      expect(() => compile(pattern)).toThrow(message)
      expect(() => compile(pattern)).toThrow(/\(at index \d+\)/)
    })
  }

  it('reports the index of the problem', () => {
    try {
      compile('ab(?=c)')
      expect.unreachable()
    } catch (e) {
      expect(e).toBeInstanceOf(RegexSyntaxError)
      expect((e as RegexSyntaxError).index).toBe(2)
    }
  })

  it('treats a lone ] or } as a literal (like JavaScript)', () => {
    expect(tokens('a]b}').map((t) => t.src)).toEqual(['a', ']', 'b', '}'])
  })
})
