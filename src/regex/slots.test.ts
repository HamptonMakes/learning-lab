/** Slots: the five Values the engine writes, validated against the DSL §2 shapes at every step. */
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { describeChoice, engineSlots, SLOT_NAMES } from './slots'
import type { EngineState, RegexUntil } from './types'
import { regexAdvance, regexInit } from './vm'

// Mirrors docs/animation-dsl.md §2 for the kinds the engine produces (strict: no extra keys).
const Tone = z.enum(['change', 'info', 'ok', 'warn', 'danger'])
const Scalar = z
  .object({
    kind: z.literal('scalar'),
    value: z.union([z.string(), z.number(), z.boolean(), z.null()]),
  })
  .strict()
const PatternToken = z
  .object({
    id: z.string().regex(/^p\d+$/),
    src: z.string().min(1),
    kind: z.enum(['literal', 'any', 'class', 'quant', 'group', 'anchor', 'alt']),
    label: z.string().min(1).optional(),
  })
  .strict()
const Pattern = z
  .object({
    kind: z.literal('pattern'),
    tokens: z.array(PatternToken),
    cursor: z.number().int().min(0).optional(),
  })
  .strict()
const Annotation = z
  .object({
    id: z.string().optional(),
    from: z.number().int().min(0),
    to: z.number().int().min(0),
    label: z.string().optional(),
    tone: Tone.optional(),
  })
  .strict()
  .refine((a) => a.to > a.from, 'non-empty span')
const Text = z
  .object({
    kind: z.literal('text'),
    text: z.string(),
    cursor: z.number().int().min(0).optional(),
    annotations: z.array(Annotation),
  })
  .strict()
const List = z
  .object({
    kind: z.literal('list'),
    items: z.array(z.object({ id: z.string().regex(/^c\d+$/), value: Scalar }).strict()),
    display: z.enum(['row', 'column', 'text']).optional(),
  })
  .strict()
const RecordValue = z
  .object({
    kind: z.literal('record'),
    fields: z.array(z.object({ key: z.string().regex(/^\$\d+$/), value: Scalar }).strict()),
    display: z.enum(['card', 'tree']).optional(),
  })
  .strict()
const Meter = z
  .object({
    kind: z.literal('meter'),
    value: z.number().int().min(0),
    max: z.number().optional(),
    label: z.string().optional(),
    tone: Tone.optional(),
  })
  .strict()
const Slots = z
  .object({ pattern: Pattern, text: Text, stack: List, captures: RecordValue, tries: Meter })
  .strict()

function walk(pattern: string, input: string, until: RegexUntil, flags = ''): EngineState[] {
  const out: EngineState[] = [regexInit(pattern, input, flags)]
  for (let n = 0; n < 300 && out[out.length - 1]?.status === 'running'; n++) {
    out.push(regexAdvance(out[out.length - 1] as EngineState, until))
  }
  return out
}

describe('engineSlots', () => {
  it('names the five slots', () => {
    expect(SLOT_NAMES).toEqual(['pattern', 'text', 'stack', 'captures', 'tries'])
    expect(Object.keys(engineSlots(regexInit('a', 'a')))).toEqual([...SLOT_NAMES])
  })

  it('projects the state into the spec shapes (pattern, text, stack, captures, tries)', () => {
    let s = regexInit('(a|ab)c', 'abc')
    expect(engineSlots(s)).toEqual({
      pattern: {
        kind: 'pattern',
        tokens: [
          { id: 'p0', src: '(', kind: 'group', label: 'group 1' },
          { id: 'p1', src: 'a', kind: 'literal' },
          { id: 'p2', src: '|', kind: 'alt', label: 'or' },
          { id: 'p3', src: 'a', kind: 'literal' },
          { id: 'p4', src: 'b', kind: 'literal' },
          { id: 'p5', src: ')', kind: 'group', label: 'end of group 1' },
          { id: 'p6', src: 'c', kind: 'literal' },
        ],
        cursor: 0,
      },
      text: { kind: 'text', text: 'abc', cursor: 0, annotations: [] },
      stack: { kind: 'list', items: [] },
      captures: { kind: 'record', fields: [{ key: '$1', value: { kind: 'scalar', value: null } }] },
      tries: { kind: 'meter', value: 0, label: 'tries' },
    })
    s = regexAdvance(s, 'step')
    expect(engineSlots(s)).toEqual({
      pattern: expect.objectContaining({ cursor: 6 }),
      text: {
        kind: 'text',
        text: 'abc',
        cursor: 1,
        annotations: [{ id: 'ok-0', from: 0, to: 1, tone: 'ok' }],
      },
      stack: { kind: 'list', items: [{ id: 'c1', value: { kind: 'scalar', value: 'p2 @ 0' } }] },
      captures: { kind: 'record', fields: [{ key: '$1', value: { kind: 'scalar', value: 'a' } }] },
      tries: { kind: 'meter', value: 1, label: 'tries' },
    })
    s = regexAdvance(s, 'end')
    expect(engineSlots(s)).toEqual({
      pattern: expect.objectContaining({ cursor: 7 }),
      text: {
        kind: 'text',
        text: 'abc',
        cursor: 3,
        annotations: [{ id: 'match', from: 0, to: 3, tone: 'ok' }],
      },
      stack: { kind: 'list', items: [] },
      captures: { kind: 'record', fields: [{ key: '$1', value: { kind: 'scalar', value: 'ab' } }] },
      tries: { kind: 'meter', value: 5, label: 'tries' },
    })
  })

  it('describes a run choice point with its counter and an alternative with its text index', () => {
    const greedy = regexAdvance(regexInit('a.*b', 'aXbYb'), 'token')
    const run = regexAdvance(greedy, 'token')
    expect(run.stack.map((cp) => describeChoice(run, cp))).toEqual(['p1 @ 1 ×4'])
    expect(engineSlots(run).stack.items).toEqual([
      { id: 'c1', value: { kind: 'scalar', value: 'p1 @ 1 ×4' } },
    ])
    expect(engineSlots(run).text.annotations).toEqual([
      { id: 'ok-0', from: 0, to: 1, tone: 'ok' },
      { id: 'run-c1', from: 1, to: 5, tone: 'change', label: '.*' },
    ])
    const alt = regexAdvance(regexInit('x(a|b)', 'xb'), 'step')
    expect(engineSlots(alt).stack.items).toEqual([
      { id: 'c1', value: { kind: 'scalar', value: 'p3 @ 1' } },
    ])
  })

  it('the failed text slot keeps one danger mark per failed start (none for the end position)', () => {
    const s = regexAdvance(regexInit('ORD-\\d{4}', '2026-08-22 refund ok'), 'end')
    expect(s.status).toBe('failed')
    const text = engineSlots(s).text
    expect(text.annotations).toHaveLength('2026-08-22 refund ok'.length)
    expect(text.annotations.every((a) => a.tone === 'danger' && a.to === a.from + 1)).toBe(true)
    expect(text.cursor).toBe(20)
  })

  it('every state of every walk has valid slot shapes, with cursors in range', () => {
    const walks: Array<[string, string, string?]> = [
      ['cat', 'the cat sat'],
      ['a.*b', 'aXbYb'],
      ['a.*?b', 'a1b2b'],
      ['(a|ab)c', 'abc'],
      ['colou?r', 'color'],
      ['colou?r', 'colour'],
      ['^\\d+$', '12a'],
      ['ORD-(\\d{4})', '2026-08-22 paid ORD-0042 ok'],
      ['(a+)+b', 'aaaaX'],
      ['(\\d+)-(\\d+)', 'call 555-1234 now'],
      ['\\bCAT\\b|dog', 'hotdog cat', 'i'],
      ['(?:ab)*?c', 'ababc'],
      ['x*', ''],
    ]
    const untils: RegexUntil[] = ['step', 'token', 'fail', 'attempt', 'backtrack', 'match', 'end']
    let checked = 0
    for (const [pattern, input, flags] of walks) {
      for (const until of untils) {
        for (const s of walk(pattern, input, until, flags)) {
          const slots = engineSlots(s)
          const parsed = Slots.safeParse(slots)
          expect(
            parsed.success,
            `${pattern} on ${input} (${until}): ${JSON.stringify(parsed.error?.issues)}`,
          ).toBe(true)
          expect(slots.pattern.cursor).toBeLessThanOrEqual(slots.pattern.tokens.length)
          expect(slots.text.cursor).toBeLessThanOrEqual(input.length)
          for (const a of slots.text.annotations) expect(a.to).toBeLessThanOrEqual(input.length)
          expect(slots.stack.items.map((i) => i.id)).toEqual(s.stack.map((cp) => cp.id))
          expect(slots.captures.fields).toHaveLength(s.program.groups)
          expect(slots.tries.value).toBe(s.tries)
          expect(JSON.parse(JSON.stringify(slots))).toEqual(slots)
          checked += 1
        }
      }
    }
    expect(checked).toBeGreaterThan(500)
  })
})
