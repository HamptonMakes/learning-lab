import { describe, expect, it } from 'vitest'
import type { Annotation } from '@/lesson/types'
import {
  assignLanes,
  laneCount,
  layoutByteAnnotations,
  layoutTextAnnotations,
  segmentText,
  snapBits,
} from './annotations'

describe('assignLanes', () => {
  it('is deterministic: sort by from, then id; first free lane', () => {
    const lanes = assignLanes([
      { id: 'b', from: 4, to: 8 },
      { id: 'a', from: 0, to: 6 },
      { id: 'c', from: 8, to: 10 },
      { id: 'd', from: 9, to: 12 },
    ])
    expect(lanes.get('a')).toBe(0)
    expect(lanes.get('b')).toBe(1) // overlaps a
    expect(lanes.get('c')).toBe(0) // a ended at 6 ≤ 8 → lane 0 free again
    expect(lanes.get('d')).toBe(1)
  })

  it('breaks ties on equal `from` by id', () => {
    const lanes = assignLanes([
      { id: 'z', from: 0, to: 2 },
      { id: 'a', from: 0, to: 2 },
    ])
    expect(lanes.get('a')).toBe(0)
    expect(lanes.get('z')).toBe(1)
  })

  it('gives the same answer regardless of input order', () => {
    const items = [
      { id: 'rand', from: 0, to: 128 },
      { id: 'ver', from: 48, to: 52 },
      { id: 'var', from: 64, to: 66 },
    ]
    const a = assignLanes(items)
    const b = assignLanes([...items].reverse())
    expect([...a.entries()].sort()).toEqual([...b.entries()].sort())
    expect(laneCount([...a.values()].map((lane) => ({ lane })))).toBe(2)
  })
})

describe('snapBits', () => {
  it('snaps outward to the nibble over collapsed bytes', () => {
    expect(snapBits(50, 52)).toEqual([48, 52])
    expect(snapBits(64, 66)).toEqual([64, 68])
    expect(snapBits(66, 128)).toEqual([64, 128])
    expect(snapBits(52, 64)).toEqual([52, 64]) // already aligned
  })

  it('keeps exact bits over expanded bytes', () => {
    const expanded = (b: number) => b >= 6 && b < 9
    expect(snapBits(50, 52, expanded)).toEqual([50, 52])
    expect(snapBits(64, 66, expanded)).toEqual([64, 66])
    // ends in a collapsed byte still snap
    expect(snapBits(66, 74, expanded)).toEqual([66, 76])
  })

  it('handles empty ranges', () => {
    expect(snapBits(5, 5)).toEqual([5, 5])
  })
})

describe('layoutByteAnnotations', () => {
  const anns: Annotation[] = [
    { id: 'ver', from: 48, to: 52, unit: 'bit', label: 'version = 7' },
    { id: 'var', from: 64, to: 66, unit: 'bit', label: 'variant = 10' },
    { id: 'rand2', from: 66, to: 128, unit: 'bit', label: 'random', tone: 'info' },
    { from: 0, to: 6, label: 'unix ms', tone: 'change' },
  ]

  it('converts bytes to bits, snaps bit annotations and lanes the overlaps (variant + random share nibble 16)', () => {
    const out = layoutByteAnnotations(anns, () => false)
    const byId = Object.fromEntries(out.map((a) => [a.id, a]))
    expect(byId.ver?.bits).toEqual([48, 52])
    expect(byId.ver?.snapped).toBe(false)
    expect(byId.var?.bits).toEqual([64, 68])
    expect(byId.var?.snapped).toBe(true)
    expect(byId.var?.exact).toEqual([64, 66])
    expect(byId.rand2?.bits).toEqual([64, 128])
    expect(byId.rand2?.lane).not.toBe(byId.var?.lane)
    expect(byId.a3?.unit).toBe('byte')
    expect(byId.a3?.bits).toEqual([0, 48])
    expect(byId.a3?.tone).toBe('change')
    expect(byId.ver?.tone).toBe('info') // default tone
  })

  it('does not snap over expanded bytes', () => {
    const out = layoutByteAnnotations(anns, (b) => b >= 6 && b < 9)
    const v = out.find((a) => a.id === 'var')
    expect(v?.bits).toEqual([64, 66])
    expect(v?.snapped).toBe(false)
  })
})

describe('layoutTextAnnotations', () => {
  it('lanes overlapping character ranges', () => {
    const out = layoutTextAnnotations([
      { id: 'ok', from: 2, to: 6, tone: 'ok' },
      { id: 'greedy', from: 3, to: 5, tone: 'change' },
      { id: 'fail', from: 0, to: 1, tone: 'danger' },
    ])
    const byId = Object.fromEntries(out.map((a) => [a.id, a]))
    expect(byId.fail?.lane).toBe(0)
    expect(byId.ok?.lane).toBe(0)
    expect(byId.greedy?.lane).toBe(1)
  })
})

describe('segmentText', () => {
  it('splits plain text around a single range', () => {
    expect(segmentText([{ key: 'a', from: 2, to: 5 }], 0, 8)).toEqual([
      { type: 'text', from: 0, to: 2 },
      { type: 'wrap', key: 'a', from: 2, to: 5, children: [{ type: 'text', from: 2, to: 5 }] },
      { type: 'text', from: 5, to: 8 },
    ])
  })

  it('nests a contained range and splits a partial overlap into two pieces with the same key', () => {
    const segs = segmentText(
      [
        { key: 'outer', from: 0, to: 6 },
        { key: 'inner', from: 2, to: 4 },
        { key: 'cross', from: 4, to: 8 },
      ],
      0,
      10,
    )
    expect(segs.map((s) => s.type)).toEqual(['wrap', 'wrap', 'text'])
    const outer = segs[0]
    expect(outer?.type === 'wrap' && outer.key).toBe('outer')
    if (outer?.type !== 'wrap') throw new Error('expected wrap')
    expect(
      outer.children.map((c) => (c.type === 'wrap' ? `${c.key}:${c.from}-${c.to}` : c.type)),
    ).toEqual(['text', 'inner:2-4', 'cross:4-6'])
    const tail = segs[1]
    expect(tail?.type === 'wrap' && `${tail.key}:${tail.from}-${tail.to}`).toBe('cross:6-8')
  })

  it('places a caret (zero-length range) inside the wrapper it starts in and after the one it ends at', () => {
    const segs = segmentText(
      [
        { key: 'a', from: 2, to: 5 },
        { key: 'caret', from: 2, to: 2 },
      ],
      0,
      6,
    )
    const wrap = segs.find((s) => s.type === 'wrap')
    expect(wrap?.type === 'wrap' && wrap.children[0]).toEqual({
      type: 'point',
      key: 'caret',
      at: 2,
    })
    const after = segmentText(
      [
        { key: 'a', from: 2, to: 5 },
        { key: 'caret', from: 5, to: 5 },
      ],
      0,
      6,
    )
    expect(after.map((s) => s.type)).toEqual(['text', 'wrap', 'point', 'text'])
  })

  it('handles a caret at the very end and empty text', () => {
    expect(segmentText([{ key: 'caret', from: 3, to: 3 }], 0, 3)).toEqual([
      { type: 'text', from: 0, to: 3 },
      { type: 'point', key: 'caret', at: 3 },
    ])
    expect(segmentText([{ key: 'caret', from: 0, to: 0 }], 0, 0)).toEqual([
      { type: 'point', key: 'caret', at: 0 },
    ])
  })

  it('clips ranges to the text and ignores inverted ones', () => {
    expect(
      segmentText(
        [
          { key: 'a', from: 4, to: 20 },
          { key: 'bad', from: 5, to: 2 },
        ],
        0,
        6,
      ),
    ).toEqual([
      { type: 'text', from: 0, to: 4 },
      { type: 'wrap', key: 'a', from: 4, to: 6, children: [{ type: 'text', from: 4, to: 6 }] },
    ])
  })
})
