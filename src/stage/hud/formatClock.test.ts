import { describe, expect, it } from 'vitest'
import { formatClock, formatDelta, formatTime, parseHhMm, type ClockTranslate } from './formatClock'

const t: ClockTranslate = (key, vars) =>
  key === 'stage.clock.counter' ? `t=${vars.now}` : `${vars.now} ms`

describe('parseHhMm', () => {
  it('reads hh:mm as minutes since midnight', () => {
    expect(parseHhMm('10:05')).toBe(605)
    expect(parseHhMm('0:00')).toBe(0)
    expect(parseHhMm('23:59')).toBe(1439)
  })
  it('treats missing or malformed starts as midnight', () => {
    expect(parseHhMm(undefined)).toBe(0)
    expect(parseHhMm('')).toBe(0)
    expect(parseHhMm('noon')).toBe(0)
    expect(parseHhMm('24:00')).toBe(0)
    expect(parseHhMm('10:60')).toBe(0)
  })
})

describe('formatTime', () => {
  it('adds minutes to the start', () => {
    expect(formatTime('10:05', 0)).toBe('10:05')
    expect(formatTime('10:05', 12)).toBe('10:17')
    expect(formatTime('10:05', 55)).toBe('11:00')
  })
  it('wraps around midnight in both directions', () => {
    expect(formatTime('23:50', 20)).toBe('00:10')
    expect(formatTime('00:10', -20)).toBe('23:50')
    expect(formatTime('00:00', 24 * 60 + 5)).toBe('00:05')
  })
  it('starts at midnight when no start is given', () => {
    expect(formatTime(undefined, 90)).toBe('01:30')
  })
})

describe('formatClock', () => {
  it('counter → t=n', () => {
    expect(formatClock({ format: 'counter' }, 3, t)).toBe('t=3')
  })
  it('ms → n ms', () => {
    expect(formatClock({ format: 'ms' }, 150, t)).toBe('150 ms')
  })
  it('time → hh:mm from start + minutes', () => {
    expect(formatClock({ format: 'time', start: '10:05' }, 12, t)).toBe('10:17')
  })
})

describe('formatDelta', () => {
  it('signs the skew with a true minus', () => {
    expect(formatDelta(5)).toBe('+5')
    expect(formatDelta(-2)).toBe('−2')
    expect(formatDelta(0)).toBe('+0')
  })
})
