import type { ReactNode } from 'react'
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { Frame, Mark } from '@/lesson/types'
import { StageMotionProvider } from '../motion'
import { StageFrameProvider } from '../StageContext'
import { actor, frame, GEO, scalar, world } from '../message/testing'
import { MarkLayer } from './MarkLayer'
import { boltPath, placeCallout } from './markGeometry'

function Wrap({
  f,
  instant = true,
  children,
}: {
  f: Frame
  instant?: boolean
  children: ReactNode
}) {
  return (
    <StageMotionProvider speed={1} reducedSetting={false} instant={instant} dir="ltr">
      <StageFrameProvider frame={f}>{children}</StageFrameProvider>
    </StageMotionProvider>
  )
}

function renderMarks(marks: Mark[], w = world({ marks })) {
  return render(
    <Wrap f={frame({ ...w, marks })}>
      <MarkLayer geometry={GEO} />
    </Wrap>,
  )
}

const q = (root: HTMLElement, sel: string) => root.querySelector<HTMLElement>(sel)
const qa = (root: HTMLElement, sel: string) => [...root.querySelectorAll<HTMLElement>(sel)]

afterEach(cleanup)

describe('MarkLayer', () => {
  it('draws a conflict bolt between two anchors in the danger tone with a badge', () => {
    const { container } = renderMarks([
      { id: 'k1', kind: 'conflict', a: 'alice.doc', b: 'bob.doc' },
    ])
    const g = q(container, '[data-mark="k1"]')
    expect(g).toHaveAttribute('data-mark-kind', 'conflict')
    const path = g?.querySelector('path')
    expect(path).toHaveAttribute('stroke', 'var(--danger)')
    expect(path?.getAttribute('d')).toMatch(/^M 190 108 L /) // starts on alice.doc's facing edge
    expect(g?.querySelector('circle')).not.toBeNull()
  })

  it('draws a compare link with a verdict chip: glyph + word, data-verdict', () => {
    const { container } = renderMarks([
      {
        id: 'k2',
        kind: 'compare',
        paths: ['alice.doc', 'bob.doc'],
        verdict: 'before',
        rule: 'clock',
      },
    ])
    const g = q(container, '[data-mark="k2"]')
    expect(g).toHaveAttribute('data-mark-kind', 'compare')
    expect(g).toHaveAttribute('data-verdict', 'before')
    expect(g?.querySelectorAll('path')).toHaveLength(1)
    const chip = q(container, '[data-verdict-chip]')
    expect(chip).toHaveTextContent('≺')
    expect(chip).toHaveTextContent('before')
    expect(chip?.textContent).toMatch(/≺\s*before/)
  })

  it('shows every verdict as glyph + word', () => {
    const cases = [
      ['equal', '= equal'],
      ['different', '≠ different'],
      ['after', '≻ after'],
      ['concurrent', '∥ concurrent'],
      ['less', '< less'],
      ['greater', '> greater'],
    ] as const
    for (const [verdict, text] of cases) {
      const { container, unmount } = renderMarks([
        { id: 'k', kind: 'compare', paths: ['alice.doc', 'bob.doc'], verdict, rule: 'value' },
      ])
      const chip = q(container, '[data-verdict-chip]')
      expect(chip?.textContent?.replace(/\s+/g, ' ').trim()).toBe(text)
      unmount()
    }
  })

  it('adds the stamp reason for the stamp rule (ts 1 < 2, ts = → node)', () => {
    const w1 = world({
      actors: [
        actor('alice', 'a', { doc: scalar('A', { ts: 1, node: 'alice' }) }),
        actor('bob', 'b', { doc: scalar('B', { ts: 2, node: 'bob' }) }),
      ],
    })
    const a = renderMarks(
      [
        {
          id: 'k3',
          kind: 'compare',
          paths: ['alice.doc', 'bob.doc'],
          verdict: 'less',
          rule: 'stamp',
        },
      ],
      w1,
    )
    expect(q(a.container, '[data-verdict-chip]')).toHaveTextContent('ts 1 < 2')
    cleanup()
    const w2 = world({
      actors: [
        actor('alice', 'a', { doc: scalar('A', { ts: 2, node: 'alice' }) }),
        actor('bob', 'b', { doc: scalar('B', { ts: 2, node: 'bob' }) }),
      ],
    })
    const b = renderMarks(
      [
        {
          id: 'k3',
          kind: 'compare',
          paths: ['alice.doc', 'bob.doc'],
          verdict: 'less',
          rule: 'stamp',
        },
      ],
      w2,
    )
    expect(q(b.container, '[data-verdict-chip]')).toHaveTextContent('ts = → node')
  })

  it('chains =/≠ links for more than two paths (glyph only)', () => {
    const { container } = renderMarks([
      {
        id: 'k4',
        kind: 'compare',
        paths: ['alice.doc', 'bob.doc', 'carol.doc'],
        verdict: 'equal',
        rule: 'value',
      },
    ])
    const g = q(container, '[data-mark="k4"]')
    expect(g?.querySelectorAll('path')).toHaveLength(2)
    const chips = qa(container, '[data-verdict-chip]')
    expect(chips).toHaveLength(2)
    expect(chips.map((c) => c.textContent?.trim())).toEqual(['=', '='])
  })

  it('draws a flow arrow between two slots, double-headed when both', () => {
    const { container } = renderMarks([
      { id: 'k5', kind: 'flow', from: 'alice.doc', to: 'bob.doc', both: true },
      { id: 'k6', kind: 'flow', from: 'bob.doc', to: 'carol.doc' },
    ])
    const both = q(container, '[data-mark="k5"]')
    expect(both).toHaveAttribute('data-mark-kind', 'flow')
    expect(both).toHaveAttribute('data-from', 'alice.doc')
    expect(both).toHaveAttribute('data-to', 'bob.doc')
    expect(both).toHaveAttribute('data-both', 'true')
    expect(both?.querySelectorAll('[data-arrow-head]')).toHaveLength(2)
    expect(both?.querySelector('path')).toHaveAttribute('stroke', 'var(--accent)')
    const one = q(container, '[data-mark="k6"]')
    expect(one).toHaveAttribute('data-both', 'false')
    expect(one?.querySelectorAll('[data-arrow-head]')).toHaveLength(1)
  })

  it('skips marks the layer does not own and marks whose anchors are not measured yet', () => {
    const { container } = renderMarks([
      { id: 'h1', kind: 'highlight', paths: ['alice.doc'], tone: 'change' },
      { id: 'c1', kind: 'check', path: 'alice.doc' },
      { id: 'k7', kind: 'conflict', a: 'alice.doc', b: 'nobody.doc' },
    ])
    expect(qa(container, '[data-mark]')).toHaveLength(0)
  })

  it('uses no CSS transition/animation utilities', () => {
    const { container } = renderMarks([
      { id: 'k1', kind: 'conflict', a: 'alice.doc', b: 'bob.doc' },
      {
        id: 'k2',
        kind: 'compare',
        paths: ['alice.doc', 'bob.doc'],
        verdict: 'equal',
        rule: 'value',
      },
      { id: 'k5', kind: 'flow', from: 'alice.doc', to: 'bob.doc' },
    ])
    expect(container.innerHTML).not.toMatch(/\b(transition|animate)-/)
  })
})

describe('mark geometry', () => {
  it('boltPath zig-zags between the facing edges and reports the midpoint', () => {
    const a = { x: 0, y: 0, w: 100, h: 40 }
    const b = { x: 300, y: 0, w: 100, h: 40 }
    const { d, mid } = boltPath(a, b)
    expect(d.startsWith('M 100 20 L ')).toBe(true)
    expect(d.endsWith('L 300 20')).toBe(true)
    expect(mid).toEqual({ x: 200, y: 20 })
    expect(d.split(' L ')).toHaveLength(7) // M + 5 inner vertices + end
  })
  it('placeCallout prefers above, flips below near the top, clamps inside the bounds', () => {
    const box = { w: 120, h: 30 }
    const above = placeCallout({ x: 100, y: 200, w: 80, h: 20 }, box, { w: 600, h: 400 })
    expect(above.side).toBe('above')
    expect(above.y).toBe(200 - 8 - 30)
    expect(above.x).toBe(140 - 60)
    const below = placeCallout({ x: 100, y: 10, w: 80, h: 20 }, box, { w: 600, h: 400 })
    expect(below.side).toBe('below')
    expect(below.y).toBe(10 + 20 + 8)
    const clamped = placeCallout({ x: 560, y: 200, w: 40, h: 20 }, box, { w: 600, h: 400 })
    expect(clamped.x).toBe(600 - 120 - 4)
    expect(clamped.tailX).toBeGreaterThan(60) // the tail follows the anchor centre
    const left = placeCallout({ x: 0, y: 200, w: 20, h: 20 }, box, null)
    expect(left.x).toBe(4)
  })
})
