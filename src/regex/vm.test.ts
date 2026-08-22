/** VM: event sequences, cursors, choice points, tries, captures, determinism, purity. */
import { describe, expect, it } from 'vitest'
import { RegexSyntaxError } from './compile'
import { engineSlots } from './slots'
import type { EngineState, RegexUntil } from './types'
import { currentToken, regexAdvance, regexInit, RegexLimitError } from './vm'

/** Run `advance(until)` repeatedly; returns [init, after 1st advance, after 2nd, …] until terminal or `max`. */
function trace(pattern: string, input: string, until: RegexUntil = 'step', flags = '', max = 500) {
  const states: EngineState[] = [regexInit(pattern, input, flags)]
  while (states[states.length - 1]?.status === 'running' && states.length <= max) {
    states.push(regexAdvance(states[states.length - 1] as EngineState, until))
  }
  return states
}

function at(states: EngineState[], n: number): EngineState {
  const s = states[n]
  if (s === undefined) throw new Error(`no state #${n}`)
  return s
}

function stackIds(s: EngineState): string[] {
  return engineSlots(s).stack.items.map((i) => `${i.id}:${String(i.value.value)}`)
}

function danger(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    id: `fail-${i}`,
    from: i,
    to: i + 1,
    tone: 'danger',
  }))
}

describe('regexInit', () => {
  it('compiles and rests at attempt 0 with nothing run', () => {
    const s = regexInit('cat', 'the cat sat')
    expect(s).toMatchObject({
      input: 'the cat sat',
      flags: '',
      status: 'running',
      attempt: 0,
      ti: 0,
      pc: 0,
      tokenCursor: 0,
      stack: [],
      tries: 0,
      pending: 'none',
      failedStarts: [],
      annotations: [],
      events: [],
      lastEvent: null,
      match: null,
      captures: [null],
    })
    expect(currentToken(s)).toBe('p0')
  })

  it('throws RegexSyntaxError on unsupported syntax', () => {
    expect(() => regexInit('(?=a)', 'a')).toThrow(RegexSyntaxError)
    expect(() => regexInit('a', 'a', 'g')).toThrow(RegexSyntaxError)
  })
})

describe('cat on "the cat sat": fail, slide, fail…, then match at 4', () => {
  const steps = trace('cat', 'the cat sat', 'step')

  it('takes 7 steps: 4 failed starts, then c, a, t', () => {
    expect(steps).toHaveLength(8)
    for (let k = 1; k <= 4; k++) {
      const s = at(steps, k)
      expect(s.status).toBe('running')
      expect(s.attempt).toBe(k - 1)
      expect(s.ti).toBe(k - 1)
      expect(s.tokenCursor).toBe(0)
      expect(s.pending).toBe('restart')
      expect(s.lastEvent).toBe('fail')
      expect(s.tries).toBe(k)
      expect(s.stack).toEqual([])
      expect(s.annotations).toEqual(danger(k))
      expect(s.events).toEqual(k === 1 ? ['step', 'fail'] : ['attempt', 'step', 'fail'])
    }
    expect(at(steps, 5)).toMatchObject({
      attempt: 4,
      ti: 5,
      tokenCursor: 1,
      tries: 5,
      events: ['attempt', 'step'],
      lastEvent: 'attempt',
      annotations: [...danger(4), { id: 'ok-4', from: 4, to: 5, tone: 'ok' }],
    })
    expect(at(steps, 6)).toMatchObject({
      ti: 6,
      tokenCursor: 2,
      tries: 6,
      events: ['step'],
      lastEvent: 'step',
    })
    expect(at(steps, 7)).toMatchObject({
      status: 'matched',
      match: [4, 7],
      ti: 7,
      tokenCursor: 3,
      tries: 7,
      events: ['step', 'match'],
      lastEvent: 'match',
      captures: [[4, 7]],
      annotations: [...danger(4), { id: 'match', from: 4, to: 7, tone: 'ok' }],
    })
    expect(currentToken(at(steps, 7))).toBeNull()
  })

  it("until 'match' and 'end' jump straight to the same final state", () => {
    const init = regexInit('cat', 'the cat sat')
    expect(regexAdvance(init, 'match')).toEqual(at(steps, 7))
    expect(regexAdvance(init, 'end')).toEqual(at(steps, 7))
  })

  it("until 'fail' stops at the first failed test; until 'attempt' at each new start position", () => {
    const init = regexInit('cat', 'the cat sat')
    expect(regexAdvance(init, 'fail')).toEqual(at(steps, 1))
    const attempts = trace('cat', 'the cat sat', 'attempt')
    // init, attempt 1 (fail), attempt 2 (fail), attempt 3 (fail), attempt 4 (c passes), then the match
    expect(attempts.map((s) => s.attempt)).toEqual([0, 1, 2, 3, 4, 4])
    expect(at(attempts, 1)).toEqual(at(steps, 2))
    expect(at(attempts, 4)).toEqual(at(steps, 5))
    expect(at(attempts, 5)).toEqual(at(steps, 7))
  })

  it('a terminal state is returned as-is', () => {
    const done = at(steps, 7)
    expect(regexAdvance(done, 'step')).toBe(done)
    expect(regexAdvance(done, 'end')).toBe(done)
  })
})

describe('a.*b on "aXbYb": greedy takes everything, gives one back, matches 0..5', () => {
  const steps = trace('a.*b', 'aXbYb', 'step')

  it('grows the run one test per step, with one choice point that counts', () => {
    expect(at(steps, 1)).toMatchObject({ ti: 1, tokenCursor: 1, tries: 1, stack: [] })
    for (let k = 1; k <= 4; k++) {
      const s = at(steps, 1 + k)
      expect(s.ti).toBe(1 + k)
      expect(s.tokenCursor).toBe(1)
      expect(s.tries).toBe(1 + k)
      expect(s.events).toEqual(['step'])
      expect(stackIds(s)).toEqual([`c1:p1 @ 1 ×${k}`])
      expect(s.stack[0]).toMatchObject({
        id: 'c1',
        kind: 'run',
        token: 1,
        from: 1,
        count: k,
        phase: 'grow',
      })
      expect(s.annotations).toEqual([
        { id: 'ok-0', from: 0, to: 1, tone: 'ok' },
        { id: 'run-c1', from: 1, to: 1 + k, tone: 'change', label: '.*' },
      ])
    }
  })

  it('the run ends at the end of the text (a test, not a failure); b fails; backtrack + retry matches', () => {
    expect(at(steps, 6)).toMatchObject({
      ti: 5,
      tokenCursor: 2,
      tries: 6,
      events: ['step'],
      pending: 'none',
    })
    expect(at(steps, 6).stack[0]).toMatchObject({ count: 4, phase: 'hold' })
    expect(at(steps, 7)).toMatchObject({
      ti: 5,
      tokenCursor: 2,
      tries: 7,
      events: ['step', 'fail'],
      lastEvent: 'fail',
      pending: 'backtrack',
    })
    expect(stackIds(at(steps, 7))).toEqual(['c1:p1 @ 1 ×4'])
    expect(at(steps, 8)).toMatchObject({
      status: 'matched',
      match: [0, 5],
      ti: 5,
      tokenCursor: 3,
      tries: 8,
      events: ['backtrack', 'step', 'match'],
      lastEvent: 'match',
      annotations: [{ id: 'match', from: 0, to: 5, tone: 'ok' }],
    })
    expect(stackIds(at(steps, 8))).toEqual(['c1:p1 @ 1 ×3'])
    expect(steps).toHaveLength(9)
    expect(steps.filter((s) => s.events.includes('backtrack'))).toHaveLength(1)
  })

  it("until 'token' collapses the greedy run into one command", () => {
    const byToken = trace('a.*b', 'aXbYb', 'token')
    expect(byToken.map((s) => [s.tokenCursor, s.ti, s.tries])).toEqual([
      [0, 0, 0],
      [1, 1, 1],
      [2, 5, 6],
      [3, 5, 8],
    ])
    expect(at(byToken, 2)).toEqual(at(steps, 6))
    expect(at(byToken, 3)).toEqual(at(steps, 8))
  })

  it("until 'fail' then 'backtrack' walks fail → give-back", () => {
    const init = regexInit('a.*b', 'aXbYb')
    const failed = regexAdvance(init, 'fail')
    expect(failed).toEqual(at(steps, 7))
    expect(regexAdvance(failed, 'backtrack')).toEqual(at(steps, 8))
    expect(regexAdvance(init, 'backtrack')).toEqual(at(steps, 8))
  })

  it('the lazy a.*?b on "a1b2b" takes as little as possible and matches 0..3', () => {
    const lazy = trace('a.*?b', 'a1b2b', 'step')
    expect(at(lazy, 1)).toMatchObject({ ti: 1, tokenCursor: 1, stack: [] })
    expect(at(lazy, 2)).toMatchObject({
      ti: 1,
      tokenCursor: 2,
      events: ['step', 'fail'],
      pending: 'backtrack',
    })
    expect(stackIds(at(lazy, 2))).toEqual(['c1:p1 @ 1 ×0'])
    expect(at(lazy, 3)).toMatchObject({
      ti: 2,
      tokenCursor: 2,
      events: ['backtrack', 'step'],
      lastEvent: 'backtrack',
    })
    expect(stackIds(at(lazy, 3))).toEqual(['c1:p1 @ 1 ×1'])
    expect(at(lazy, 3).annotations).toEqual([
      { id: 'ok-0', from: 0, to: 1, tone: 'ok' },
      { id: 'run-c1', from: 1, to: 2, tone: 'change', label: '.*?' },
    ])
    expect(at(lazy, 4)).toMatchObject({ status: 'matched', match: [0, 3], tries: 4 })
    expect(lazy).toHaveLength(5)
  })
})

describe('(a|ab)c on "abc": the first branch matches, c fails, backtrack to the other branch', () => {
  const steps = trace('(a|ab)c', 'abc', 'step')

  it('remembers the alternative as c1 (p2 @ 0), restores captures on backtrack', () => {
    expect(at(steps, 1)).toMatchObject({
      ti: 1,
      tokenCursor: 6,
      tries: 1,
      captures: [null, [0, 1]],
    })
    expect(stackIds(at(steps, 1))).toEqual(['c1:p2 @ 0'])
    expect(at(steps, 1).stack[0]).toMatchObject({ id: 'c1', kind: 'alt', token: 2, pc: 4, ti: 0 })
    expect(engineSlots(at(steps, 1)).captures.fields).toEqual([
      { key: '$1', value: { kind: 'scalar', value: 'a' } },
    ])
    expect(at(steps, 2)).toMatchObject({
      ti: 1,
      tokenCursor: 6,
      tries: 2,
      events: ['step', 'fail'],
      pending: 'backtrack',
    })
    expect(at(steps, 3)).toMatchObject({
      ti: 1,
      tokenCursor: 4,
      tries: 3,
      events: ['backtrack', 'step'],
      lastEvent: 'backtrack',
      stack: [],
      captures: [null, null],
    })
    expect(at(steps, 4)).toMatchObject({
      ti: 2,
      tokenCursor: 6,
      tries: 4,
      captures: [null, [0, 2]],
    })
    expect(at(steps, 5)).toMatchObject({
      status: 'matched',
      match: [0, 3],
      tries: 5,
      captures: [
        [0, 3],
        [0, 2],
      ],
    })
    expect(engineSlots(at(steps, 5)).captures.fields).toEqual([
      { key: '$1', value: { kind: 'scalar', value: 'ab' } },
    ])
    expect(steps).toHaveLength(6)
  })

  it("until 'backtrack' lands on the retry of the other branch", () => {
    expect(regexAdvance(regexInit('(a|ab)c', 'abc'), 'backtrack')).toEqual(at(steps, 3))
  })
})

describe('colou?r: an optional that takes nothing leaves no choice point; one that takes a char does', () => {
  it('"color": u? sees r, takes nothing, match 0..5 with 6 tries and an empty stack', () => {
    const steps = trace('colou?r', 'color', 'step')
    expect(at(steps, 4)).toMatchObject({ ti: 4, tokenCursor: 4, tries: 4 })
    expect(at(steps, 5)).toMatchObject({
      ti: 4,
      tokenCursor: 5,
      tries: 5,
      stack: [],
      events: ['step'],
    })
    expect(at(steps, 6)).toMatchObject({ status: 'matched', match: [0, 5], tries: 6 })
    expect(steps).toHaveLength(7)
    expect(steps.some((s) => s.events.includes('fail') || s.events.includes('backtrack'))).toBe(
      false,
    )
  })

  it('"colour": u? takes the u (c1 holds 1), match 0..6 with 6 tries', () => {
    const steps = trace('colou?r', 'colour', 'step')
    expect(at(steps, 5)).toMatchObject({ ti: 5, tokenCursor: 5, tries: 5 })
    expect(stackIds(at(steps, 5))).toEqual(['c1:p4 @ 4 ×1'])
    expect(at(steps, 5).annotations).toEqual([
      { id: 'ok-0', from: 0, to: 4, tone: 'ok' },
      { id: 'run-c1', from: 4, to: 5, tone: 'change', label: 'u?' },
    ])
    expect(at(steps, 6)).toMatchObject({ status: 'matched', match: [0, 6], tries: 6 })
    expect(steps).toHaveLength(7)
  })
})

describe('^\\d+$ on "12a": anchors are tests; the attempt backtracks once, then every start fails', () => {
  const steps = trace('^\\d+$', '12a', 'step')

  it('walks: ^, 1, 2, (a ends the run), $ fails, give back + $ fails, ^ fails at 1, 2, 3', () => {
    expect(at(steps, 1)).toMatchObject({ ti: 0, tokenCursor: 1, tries: 1, events: ['step'] })
    expect(at(steps, 3)).toMatchObject({ ti: 2, tokenCursor: 1, tries: 3 })
    expect(stackIds(at(steps, 3))).toEqual(['c1:p1 @ 0 ×2'])
    expect(at(steps, 4)).toMatchObject({ ti: 2, tokenCursor: 2, tries: 4, events: ['step'] })
    expect(at(steps, 5)).toMatchObject({
      ti: 2,
      tokenCursor: 2,
      tries: 5,
      events: ['step', 'fail'],
      pending: 'backtrack',
    })
    expect(at(steps, 6)).toMatchObject({
      ti: 1,
      tokenCursor: 2,
      tries: 6,
      events: ['backtrack', 'step', 'fail'],
      lastEvent: 'fail',
      pending: 'restart',
      stack: [],
      annotations: danger(1),
    })
    expect(at(steps, 7)).toMatchObject({
      attempt: 1,
      ti: 1,
      tokenCursor: 0,
      tries: 7,
      events: ['attempt', 'step', 'fail'],
    })
    expect(at(steps, 8)).toMatchObject({ attempt: 2, ti: 2, tokenCursor: 0, tries: 8 })
    expect(at(steps, 9)).toMatchObject({
      status: 'failed',
      attempt: 3,
      ti: 3,
      tokenCursor: 0,
      tries: 9,
      pending: 'none',
      match: null,
      failedStarts: [0, 1, 2, 3],
      annotations: danger(3),
    })
    expect(steps).toHaveLength(10)
  })

  it("until 'end' reaches the same failed state; 'attempt' stops three times", () => {
    expect(regexAdvance(regexInit('^\\d+$', '12a'), 'end')).toEqual(at(steps, 9))
    const attempts = trace('^\\d+$', '12a', 'attempt')
    expect(attempts.map((s) => s.attempt)).toEqual([0, 1, 2, 3])
    expect(at(attempts, 3)).toEqual(at(steps, 9))
  })
})

describe('more syntax, end to end', () => {
  function matchOf(pattern: string, input: string, flags = '') {
    const s = regexAdvance(regexInit(pattern, input, flags), 'end')
    return s.status === 'matched'
      ? { match: s.match, captures: s.captures.slice(1), tries: s.tries }
      : null
  }

  it('agrees with JavaScript on spans and captures', () => {
    const cases: Array<[string, string, string?]> = [
      ['ORD-(\\d{4})', '2026-08-22 paid ORD-0042 ok'],
      ['ORD-\\d{4}', '2026-08-22 refund ok'],
      ['(ab)+c', 'ababc'],
      ['(a*)*b', 'aab'],
      ['(?:x|y)*z', 'xyxz'],
      ['x{2,4}', 'xxxxx'],
      ['x{2,4}?', 'xxxxx'],
      ['(x{2,4}?)y', 'xxxy'],
      ['a|b', 'cb'],
      ['a|', 'x'],
      ['x*', ''],
      ['\\bcat\\b', 'concat cat'],
      ['a$', 'ba'],
      ['^a', 'ba'],
      ['[^a-f\\s]+', 'abc xyz'],
      ['[\\]\\-]+', 'a-]b'],
      ['CAT', 'the cat', 'i'],
      ['[a-c]+', 'xBc', 'i'],
      ['\\w+@\\w+\\.\\w{2,3}', 'mail me: bob@example.org now'],
      ['(\\d+)-(\\d+)', 'call 555-1234'],
      ['((a)|(b))+', 'ab'],
      ['.+', 'ab\ncd'],
      ['\\s\\S', 'a b'],
      ['(?:ab)*?c', 'ababc'],
      ['a{0}b', 'ab'],
      ['colou?r', 'colour'],
      ['(a|ab)(c|bcd)(d*)', 'abcd'],
    ]
    for (const [pattern, input, flags = ''] of cases) {
      const expected = new RegExp(pattern, flags).exec(input)
      const got = matchOf(pattern, input, flags)
      if (expected === null) {
        expect(got, pattern).toBeNull()
      } else {
        expect(got?.match, pattern).toEqual([expected.index, expected.index + expected[0].length])
        const caps = expected.slice(1).map((c) => (c === undefined ? null : c))
        const ours = got?.captures.map((c) => (c === null ? null : input.slice(c[0], c[1])))
        expect(ours, pattern).toEqual(caps)
      }
    }
  })

  it('nested quantifiers blow up: (a+)+b tries every split and grows exponentially', () => {
    const four = regexAdvance(regexInit('(a+)+b', 'aaaaX'), 'end')
    expect(four.status).toBe('failed')
    expect(four.tries).toBe(84)
    const five = regexAdvance(regexInit('(a+)+b', 'aaaaaX'), 'end')
    const six = regexAdvance(regexInit('(a+)+b', 'aaaaaaX'), 'end')
    expect(five.tries).toBeGreaterThan(four.tries * 1.5)
    expect(six.tries).toBeGreaterThan(five.tries * 1.5)
    const linear = regexAdvance(regexInit('a+b', 'aaaaX'), 'end')
    expect(linear.status).toBe('failed')
    expect(linear.tries).toBeLessThan(four.tries / 3)
  })

  it('stops a runaway match with RegexLimitError instead of hanging', () => {
    const s = regexInit('(a+)+b', 'a'.repeat(30) + 'X')
    expect(() => regexAdvance(s, 'end', { maxTicks: 1000 })).toThrow(RegexLimitError)
  })

  it('handles a 200-character input without recursion or drama', () => {
    const input = 'x'.repeat(199) + 'y'
    const s = regexAdvance(regexInit('x*y', input), 'end')
    expect(s.match).toEqual([0, 200])
    expect(s.tries).toBe(201)
    const nope = regexAdvance(regexInit('x*z', input), 'end')
    expect(nope.status).toBe('failed')
  })
})

describe('determinism and purity', () => {
  const patterns: Array<[string, string, string?]> = [
    ['cat', 'the cat sat'],
    ['a.*b', 'aXbYb'],
    ['(a|ab)c', 'abc'],
    ['colou?r', 'colour'],
    ['^\\d+$', '12a'],
    ['(a+)+b', 'aaaX'],
    ['a.*?b', 'a1b2b'],
    ['CAT', 'the cat', 'i'],
  ]

  it('the same inputs always produce deep-equal states, for every until', () => {
    const untils: RegexUntil[] = ['step', 'token', 'fail', 'attempt', 'backtrack', 'match', 'end']
    for (const [pattern, input, flags] of patterns) {
      for (const until of untils) {
        expect(trace(pattern, input, until, flags)).toEqual(trace(pattern, input, until, flags))
      }
    }
  })

  it('states are plain JSON (round-trip equal) and never mutated by advancing', () => {
    for (const [pattern, input, flags] of patterns) {
      let s = regexInit(pattern, input, flags)
      for (let n = 0; n < 100 && s.status === 'running'; n++) {
        expect(JSON.parse(JSON.stringify(s))).toEqual(s)
        const before = JSON.stringify(s)
        const next = regexAdvance(s, 'step')
        expect(JSON.stringify(s)).toBe(before)
        expect(next).not.toBe(s)
        s = next
      }
      expect(JSON.parse(JSON.stringify(s))).toEqual(s)
    }
  })

  it('choice point ids count up and are never reused within one init', () => {
    const states = trace('(a+)+b', 'aaaX', 'step')
    const seen = new Map<string, string>()
    for (let k = 1; k < states.length; k++) {
      const s = at(states, k)
      expect(s.nextChoice).toBeGreaterThanOrEqual(at(states, k - 1).nextChoice)
      for (const cp of s.stack) {
        expect(cp.id).toMatch(/^c\d+$/)
        expect(Number(cp.id.slice(1))).toBeLessThan(s.nextChoice)
        const identity = cp.kind === 'alt' ? `alt:${cp.pc}@${cp.ti}` : `run:${cp.pc}@${cp.from}`
        const before = seen.get(cp.id)
        if (before !== undefined) expect(before).toBe(identity)
        seen.set(cp.id, identity)
      }
    }
    expect(seen.size).toBeGreaterThan(5)
  })
})
