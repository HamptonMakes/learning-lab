import type { ReactNode } from 'react'
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Frame, Mark } from '@/lesson/types'
import { StageMotionProvider } from '../motion'
import { StageFrameProvider } from '../StageContext'
import { frame, GEO, msg, world } from '../message/testing'
import { CalloutLayer } from './CalloutLayer'

interface Opts {
  instant?: boolean
  dir?: 'ltr' | 'rtl'
}

function Wrap({ f, opts, children }: { f: Frame; opts: Opts; children: ReactNode }) {
  return (
    <StageMotionProvider
      speed={1}
      reducedSetting={false}
      instant={opts.instant ?? true}
      dir={opts.dir ?? 'ltr'}
    >
      <StageFrameProvider frame={f}>{children}</StageFrameProvider>
    </StageMotionProvider>
  )
}

function renderCallouts(marks: Mark[], opts: Opts = {}, geometry = GEO) {
  return render(
    <Wrap f={frame(world({ marks }))} opts={opts}>
      <CalloutLayer geometry={geometry} />
    </Wrap>,
  )
}

const q = (root: HTMLElement, sel: string) => root.querySelector<HTMLElement>(sel)

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('CalloutLayer — callouts', () => {
  it('renders the text as-is with the tone, above the anchor when there is room', () => {
    const { container } = renderCallouts([
      {
        id: 'k1',
        kind: 'callout',
        at: 'bob.doc',
        text: 'Whoops — now we have a problem.',
        tone: 'warn',
      },
    ])
    const c = q(container, '[data-mark="k1"]')
    expect(c).toHaveAttribute('data-mark-kind', 'callout')
    expect(c).toHaveAttribute('data-tone', 'warn')
    expect(c).toHaveAttribute('data-side', 'above')
    expect(c).toHaveTextContent('Whoops — now we have a problem.')
    expect(c?.style.borderColor).toBe('var(--warn)')
    expect(c?.querySelector('svg')).not.toBeNull() // tone icon: colour is never the only signal
    const doc = GEO.get('bob.doc')
    if (!doc) throw new Error('fixture')
    expect(parseFloat(c?.style.top ?? '')).toBeLessThan(doc.y)
  })

  it('flips below when the anchor is at the top', () => {
    const { container } = renderCallouts([
      { id: 'k2', kind: 'callout', at: 'alice.top', text: 'Up here', tone: 'info' },
    ])
    const c = q(container, '[data-mark="k2"]')
    expect(c).toHaveAttribute('data-side', 'below')
    const top = GEO.get('alice.top')
    if (!top) throw new Error('fixture')
    expect(parseFloat(c?.style.top ?? '')).toBeGreaterThanOrEqual(top.y + top.h)
  })

  it('draws every tone with an icon', () => {
    const tones = ['change', 'info', 'ok', 'warn', 'danger'] as const
    const { container } = renderCallouts(
      tones.map((tone, i) => ({ id: `t${i}`, kind: 'callout', at: 'bob.doc', text: tone, tone })),
    )
    for (const tone of tones) {
      const c = q(container, `[data-mark-kind="callout"][data-tone="${tone}"]`)
      expect(c).not.toBeNull()
      expect(c?.querySelector('svg')).not.toBeNull()
    }
  })

  it('on a message token it waits for the travel when animating, and mounts at once when instant', () => {
    const marks: Mark[] = [
      { id: 'k3', kind: 'callout', at: 'msg:m1', text: 'in flight', tone: 'info' },
    ]
    const geo = new Map(GEO)
    geo.set('msg:m1', { x: 300, y: 60, w: 60, h: 30 })
    const w = world({ marks, messages: [msg('m1', 'alice', 'bob')] })
    const instant = render(
      <Wrap f={frame(w)} opts={{ instant: true }}>
        <CalloutLayer geometry={geo} />
      </Wrap>,
    )
    expect(q(instant.container, '[data-mark="k3"]')).not.toBeNull()
    cleanup()

    vi.useFakeTimers()
    const animated = render(
      <Wrap f={frame(w)} opts={{ instant: false }}>
        <CalloutLayer geometry={geo} />
      </Wrap>,
    )
    expect(q(animated.container, '[data-mark="k3"]')).toBeNull()
    act(() => {
      vi.advanceTimersByTime(700)
    })
    expect(q(animated.container, '[data-mark="k3"]')).not.toBeNull()
  })

  it('renders nothing for an anchor that is not measured yet', () => {
    const { container } = renderCallouts([
      { id: 'k4', kind: 'callout', at: 'nobody', text: 'x', tone: 'info' },
    ])
    expect(q(container, '[data-mark]')).toBeNull()
  })
})

describe('CalloutLayer — unchanged pills', () => {
  it('shows "no change" on the slot top-end corner', () => {
    const { container } = renderCallouts([{ id: 'u1', kind: 'unchanged', path: 'alice.doc' }])
    const pill = q(container, '[data-mark="u1"]')
    expect(pill).toHaveAttribute('data-mark-kind', 'unchanged')
    expect(pill).toHaveTextContent('no change')
    const doc = GEO.get('alice.doc')
    if (!doc) throw new Error('fixture')
    expect(pill?.style.left).toBe(`${doc.x + doc.w}px`)
    expect(pill?.style.top).toBe(`${doc.y}px`)
    expect(pill?.querySelector('svg')).not.toBeNull()
  })

  it('mirrors the end corner in RTL', () => {
    const { container } = renderCallouts([{ id: 'u1', kind: 'unchanged', path: 'alice.doc' }], {
      dir: 'rtl',
    })
    const doc = GEO.get('alice.doc')
    if (!doc) throw new Error('fixture')
    expect(q(container, '[data-mark="u1"]')?.style.left).toBe(`${doc.x}px`)
  })
})

describe('CalloutLayer — action chips', () => {
  function renderActions(
    changes: Parameters<typeof frame>[1],
    opts: Opts = {},
    geometry = GEO,
    marks: Mark[] = [],
  ) {
    return render(
      <Wrap f={frame(world({ marks }), changes)} opts={opts}>
        <CalloutLayer geometry={geometry} />
      </Wrap>,
    )
  }
  const inc = { key: 'stage.op.inc', vars: { n: 1 }, by: 'alice' }
  const doc = GEO.get('bob.doc')
  if (!doc) throw new Error('fixture')

  it("draws the operation on the node's top-end corner, in the acting actor's hue, with its icon", () => {
    const { container } = renderActions([
      { kind: 'value', path: 'bob.doc', op: 'changed', action: inc },
    ])
    const chip = q(container, '[data-action]')
    expect(chip).toHaveAttribute('data-action', 'inc')
    expect(chip).toHaveAttribute('data-action-key', 'stage.op.inc')
    expect(chip).toHaveAttribute('data-action-by', 'alice')
    expect(chip).toHaveAttribute('data-action-path', 'bob.doc')
    expect(chip).toHaveAttribute('data-side', 'outward')
    expect(chip).toHaveTextContent('inc 1')
    expect(chip?.style.left).toBe(`${doc.x + doc.w}px`)
    expect(chip?.style.top).toBe(`${doc.y}px`)
    expect(chip?.style.getPropertyValue('--hue')).toBe('var(--actor-a)')
    expect(chip?.querySelector('svg')).not.toBeNull() // icon: colour is never the only signal
  })

  it('falls back to the accent when nobody acted (a plain set) and mirrors the corner in RTL', () => {
    const { container } = renderActions(
      [{ kind: 'value', path: 'bob.doc', op: 'changed', action: { key: 'stage.op.setPlain' } }],
      { dir: 'rtl' },
    )
    const chip = q(container, '[data-action]')
    expect(chip).toHaveAttribute('data-action', 'set')
    expect(chip).toHaveTextContent('set')
    expect(chip?.style.left).toBe(`${doc.x}px`)
    expect(chip?.style.getPropertyValue('--hue')).toBe('var(--accent)')
  })

  it('flips inward when hanging outward would run into the next card', () => {
    const tight = new Map(GEO)
    tight.set('carol', { x: doc.x + doc.w + 20, y: 0, w: 200, h: 140 })
    const { container } = renderActions(
      [{ kind: 'value', path: 'bob.doc', op: 'changed', action: inc }],
      {},
      tight,
    )
    expect(q(container, '[data-action]')).toHaveAttribute('data-side', 'inward')
  })

  it('draws nothing for a path without a rect; one chip per acted path', () => {
    const { container } = renderActions([
      { kind: 'value', path: 'nowhere.x', op: 'changed', action: inc },
      {
        kind: 'value',
        path: 'alice.doc',
        op: 'changed',
        action: { key: 'stage.op.merge', by: 'bob' },
      },
      { kind: 'value', path: 'bob.doc', op: 'changed', action: inc },
    ])
    expect(container.querySelectorAll('[data-action]')).toHaveLength(2)
    expect(q(container, '[data-action="merge"]')).toHaveAttribute('data-action-by', 'bob')
  })
})

describe('CalloutLayer — hygiene', () => {
  it('uses no CSS transition/animation utilities', () => {
    const { container } = renderCallouts([
      { id: 'k1', kind: 'callout', at: 'bob.doc', text: 'hi', tone: 'ok' },
      { id: 'u1', kind: 'unchanged', path: 'alice.doc' },
    ])
    expect(container.innerHTML).not.toMatch(/\b(transition|animate)-/)
  })
})
