import { describe, expect, it } from 'vitest'
import type { Change } from '@/lesson/types'
import { arcBetween } from '../geometry'
import {
  ARC_BULGE,
  arcKey,
  exitOutcomes,
  groupFlying,
  messageIds,
  parkedDelta,
  transientFlights,
  traySlotCenter,
  traySlots,
} from './stacks'
import { canonicalValue, middleEllipsis, summarizeValue } from './summarize'
import { GEO, msg, scalar } from './testing'

describe('arcs and stacks', () => {
  it('groups flying messages by arc in creation order; the endpoint is `into` when given', () => {
    const groups = groupFlying([
      msg('m1', 'alice', 'bob'),
      msg('m2', 'bob', 'alice'),
      msg('m3', 'alice', 'bob'),
      msg('m4', 'alice', 'bob', scalar(1), { into: 'bob.doc' }),
      msg('m5', 'alice', 'bob', scalar(1), { state: 'parked' }),
    ])
    expect(groups.map((g) => [g.key, g.messages.map((m) => m.id)])).toEqual([
      ['alice→bob', ['m1', 'm3']],
      ['bob→alice', ['m2']],
      ['alice→bob.doc', ['m4']],
    ])
    expect(arcKey(msg('x', 'alice', 'bob', scalar(1), { into: 'bob.doc' }))).toBe('alice→bob.doc')
  })

  it('puts the two directions of a pair on opposite sides of the chord (two lanes)', () => {
    const a = GEO.get('alice')
    const b = GEO.get('bob')
    if (!a || !b) throw new Error('fixture')
    const ab = arcBetween(a, b, ARC_BULGE)
    const ba = arcBetween(b, a, ARC_BULGE)
    const chordY = ab.p0.y
    expect(Math.sign(ab.c.y - chordY)).not.toBe(Math.sign(ba.c.y - chordY))
    expect(ab.c.y).not.toBe(ba.c.y)
  })

  it('slots parked messages per recipient in creation order', () => {
    const slots = traySlots([
      msg('m1', 'alice', 'bob', scalar(1), { state: 'parked' }),
      msg('m2', 'alice', 'carol', scalar(1), { state: 'parked' }),
      msg('m3', 'carol', 'bob', scalar(1), { state: 'parked' }),
      msg('m4', 'carol', 'bob'),
    ])
    expect([...slots.entries()]).toEqual([
      ['m1', 0],
      ['m2', 0],
      ['m3', 1],
    ])
  })

  it('lays tray slots out from the start edge and stacks beyond the third', () => {
    const tray = { x: 100, y: 50, w: 200, h: 32 }
    const c0 = traySlotCenter(tray, 0)
    const c1 = traySlotCenter(tray, 1)
    const c3 = traySlotCenter(tray, 3)
    const c4 = traySlotCenter(tray, 4)
    expect(c1.x).toBeGreaterThan(c0.x)
    expect(c0.y).toBe(66)
    expect(c4.x - c3.x).toBeLessThan(c1.x - c0.x) // stacked, a small drift only
    expect(traySlotCenter(tray, 0, 'rtl').x).toBeGreaterThan(traySlotCenter(tray, 1, 'rtl').x)
    const d = parkedDelta({ x: 400, y: 70 }, tray, 0)
    expect(d).toEqual({ x: c0.x - 400, y: c0.y - 70 })
  })
})

describe('change log readers', () => {
  const m1 = msg('m1', 'alice', 'bob')
  const m2 = msg('m2', 'alice', 'carol')
  const m3 = msg('m3', 'bob', 'alice')
  const changes: Change[] = [
    { kind: 'message', op: 'sent', message: m3 },
    { kind: 'message', op: 'delivered', message: m1 },
    { kind: 'message', op: 'dropped', message: m2 },
    { kind: 'message', op: 'sent', message: msg('t=1', 'alice', 'bob'), transient: true },
    { kind: 'message', op: 'delivered', message: msg('t=1', 'alice', 'bob'), transient: true },
    { kind: 'message', op: 'sent', message: msg('t=2', 'bob', 'carol'), transient: true },
    { kind: 'message', op: 'dropped', message: msg('t=2', 'bob', 'carol'), transient: true },
    {
      kind: 'message',
      op: 'parked',
      message: msg('p1', 'bob', 'carol', scalar(1), { state: 'parked' }),
    },
  ]
  it('exit outcomes come from non-transient delivered/dropped events', () => {
    expect(exitOutcomes(changes)).toEqual({ m1: 'delivered', m2: 'dropped' })
  })
  it('sent / parked ids ignore transient events', () => {
    expect([...messageIds(changes, 'sent')]).toEqual(['m3'])
    expect([...messageIds(changes, 'parked')]).toEqual(['p1'])
  })
  it('transient flights pair a transient send with its delivery or drop', () => {
    expect(transientFlights(changes).map((f) => [f.message.id, f.outcome])).toEqual([
      ['t=1', 'delivered'],
      ['t=2', 'dropped'],
    ])
  })
})

describe('payload summaries', () => {
  it('middle-ellipsizes to 24 characters', () => {
    expect(middleEllipsis('short')).toBe('short')
    const long = 'abcdefghijklmnopqrstuvwxyz0123'
    const out = middleEllipsis(long)
    expect(out).toHaveLength(24)
    expect(out).toContain('…')
    expect(out.startsWith('abcdefghijkl')).toBe(true)
  })
  it('summarizes every value kind compactly', () => {
    expect(summarizeValue(scalar(null))).toBe('null')
    expect(summarizeValue(scalar(42))).toBe('42')
    expect(
      summarizeValue({
        kind: 'record',
        fields: [
          { key: 'title', value: scalar('Milk') },
          { key: 'tags', value: { kind: 'set', items: [] } },
        ],
      }),
    ).toBe('{title: Milk, tags: …}')
    expect(
      summarizeValue({
        kind: 'list',
        items: [
          { id: 'a', value: scalar('a') },
          { id: 'b', value: scalar('b', { tombstone: true }) },
          { id: 'c', value: scalar('c') },
        ],
      }),
    ).toBe('[a, c]')
    expect(summarizeValue({ kind: 'set', items: [{ id: 'x', value: scalar('x') }] })).toBe('{x}')
    expect(summarizeValue({ kind: 'counter', rows: [{ node: 'a', inc: 2 }], total: 2 })).toBe('2')
    expect(summarizeValue({ kind: 'clock', entries: { alice: 2, bob: 1 } })).toBe('alice2 bob1')
    expect(
      summarizeValue({ kind: 'bytes', bytes: [1, 160, 255], display: 'hex', annotations: [] }),
    ).toBe('01a0ff')
    expect(summarizeValue({ kind: 'text', text: 'hello', annotations: [] })).toBe('hello')
    expect(summarizeValue({ kind: 'meter', value: 3, max: 10 })).toBe('3/10')
  })
  it('keeps the full canonical value for title / data-value', () => {
    const v = { kind: 'text' as const, text: 'x'.repeat(40), annotations: [] }
    expect(canonicalValue(v)).toHaveLength(40)
    expect(summarizeValue(v)).toHaveLength(24)
  })
})
