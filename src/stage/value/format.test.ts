import { describe, expect, it } from 'vitest'
import type { Value } from '@/lesson/types'
import { clockTime, compactClock, dataValueOf, formatStamp, fullClock } from './format'
import { markedRanges } from './paths'

const s = (value: string | number | boolean | null): Value => ({ kind: 'scalar', value })

describe('dataValueOf', () => {
  it('follows the §4.5 plain-value rules per kind', () => {
    expect(dataValueOf(s('Lunch'))).toBe('Lunch')
    expect(dataValueOf(s(null))).toBe('null')
    expect(dataValueOf(s(false))).toBe('false')
    expect(
      dataValueOf({
        kind: 'record',
        fields: [
          { key: 'title', value: s('Q3') },
          { key: 'n', value: s(2) },
        ],
      }),
    ).toBe('{"title":"Q3","n":2}')
    expect(
      dataValueOf({
        kind: 'list',
        items: [
          { id: 'milk', value: s('milk') },
          { id: 'eggs', value: { kind: 'scalar', value: 'eggs', meta: { tombstone: true } } },
        ],
      }),
    ).toBe('["milk"]')
    expect(
      dataValueOf({
        kind: 'list',
        display: 'text',
        items: [
          { id: 'a:1', value: s('w') },
          { id: 'a:2', value: { kind: 'scalar', value: 'x', meta: { tombstone: true } } },
          { id: 'a:3', value: s('h') },
        ],
      }),
    ).toBe('wh')
    expect(
      dataValueOf({
        kind: 'set',
        items: [
          { id: 'b', value: s('b') },
          { id: 'a', value: s('a') },
        ],
      }),
    ).toBe('["a","b"]')
    expect(dataValueOf({ kind: 'counter', rows: [{ node: 'alice', inc: 2 }], total: 2 })).toBe('2')
    expect(dataValueOf({ kind: 'clock', entries: { alice: 2, bob: 1 } })).toBe('alice2 bob1')
    expect(
      dataValueOf({ kind: 'bytes', bytes: [1, 160, 255], display: 'hex', annotations: [] }),
    ).toBe('01a0ff')
    expect(dataValueOf({ kind: 'text', text: 'the cat', annotations: [] })).toBe('the cat')
    expect(
      dataValueOf({
        kind: 'pattern',
        tokens: [
          { id: 'p0', src: 'a', kind: 'literal' },
          { id: 'p1', src: '.*', kind: 'quant' },
        ],
      }),
    ).toBe('a.*')
    expect(dataValueOf({ kind: 'meter', value: 6, max: 24 })).toBe('6')
    expect(
      dataValueOf({
        kind: 'table',
        columns: [{ key: 'how', label: 'How' }],
        rows: [{ id: 'r1', cells: { how: s('replaces') } }],
      }),
    ).toBe('[{"how":"replaces"}]')
  })
})

describe('clocks and stamps', () => {
  const t = (key: string, vars?: Record<string, string | number>) =>
    key === 'stage.clock.counter'
      ? `t=${vars?.now}`
      : key === 'stage.clock.ms'
        ? `${vars?.now} ms`
        : key
  it('formats compact and full clocks', () => {
    expect(compactClock({ alice: 2, bob: 1 })).toBe('alice2 bob1')
    expect(fullClock({ alice: 2, bob: 1 })).toBe('alice: 2, bob: 1')
  })
  it('formats stamps by the scene clock format', () => {
    expect(formatStamp(3, { format: 'counter' }, t)).toBe('t=3')
    expect(formatStamp(150, { format: 'ms' }, t)).toBe('150 ms')
    expect(formatStamp(65, { format: 'time', start: '10:00' }, t)).toBe('11:05')
    expect(clockTime('23:30', 45)).toBe('00:15')
  })
})

describe('markedRanges', () => {
  it('finds [a..b] mark keys under a path, sorted', () => {
    const keys = [
      'matcher.text[4..7]',
      'matcher.text[0..1]',
      'matcher.text@cursor',
      'matcher.textx[1..2]',
      'matcher.text[3..3]',
      'matcher.text[x]',
    ]
    expect(markedRanges(keys, 'matcher.text')).toEqual([
      [0, 1],
      [4, 7],
    ])
  })
})
