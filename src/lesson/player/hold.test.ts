import { describe, expect, it } from 'vitest'
import { CHANGES, frame } from './frames.fixture'
import { ANIM_BUDGET, HOLD, animBudget, holdMs } from './hold'

describe('animBudget', () => {
  it('is 0 with no changes or with only mark / clock changes', () => {
    expect(animBudget([])).toBe(0)
    expect(animBudget([CHANGES.mark, CHANGES.clock])).toBe(0)
  })
  it('is 350 for value / actor / board / layout changes', () => {
    for (const c of [CHANGES.value, CHANGES.actor, CHANGES.board, CHANGES.layout]) {
      expect(animBudget([c])).toBe(ANIM_BUDGET.value)
    }
  })
  it('is 600 for any message or sync change, whatever else is there', () => {
    for (const c of [
      CHANGES.sent,
      CHANGES.parked,
      CHANGES.delivered,
      CHANGES.dropped,
      CHANGES.sync,
    ]) {
      expect(animBudget([c])).toBe(ANIM_BUDGET.message)
    }
    expect(animBudget([CHANGES.value, CHANGES.mark, CHANGES.delivered])).toBe(600)
  })
})

describe('holdMs', () => {
  it('HOLD matches the DSL', () => {
    expect(HOLD).toEqual({ short: 1200, normal: 2200, long: 3600 })
  })
  it('defaults to a normal hold', () => {
    expect(holdMs(frame(0), 1, false)).toBe(2200)
    expect(holdMs(frame(0, { hold: 'short' }), 1, false)).toBe(1200)
    expect(holdMs(frame(0, { hold: 'long' }), 1, false)).toBe(3600)
  })
  it('adds the animation budget', () => {
    expect(holdMs(frame(0, { changes: [CHANGES.value] }), 1, false)).toBe(2550)
    expect(holdMs(frame(0, { hold: 'long', changes: [CHANGES.delivered] }), 1, false)).toBe(4200)
  })
  it('divides by the speed', () => {
    const f = frame(0, { changes: [CHANGES.delivered] })
    expect(holdMs(f, 2, false)).toBe(1400)
    expect(holdMs(f, 0.5, false)).toBe(5600)
    expect(holdMs(f, 3, false)).toBeCloseTo(2800 / 3)
  })
  it('under reduced motion drops the animation budget but keeps the hold', () => {
    expect(holdMs(frame(0, { changes: [CHANGES.delivered] }), 1, true)).toBe(2200)
    expect(holdMs(frame(0, { hold: 'short', changes: [CHANGES.value] }), 2, true)).toBe(600)
  })
})
