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

describe('CalloutLayer — hygiene', () => {
  it('uses no CSS transition/animation utilities', () => {
    const { container } = renderCallouts([
      { id: 'k1', kind: 'callout', at: 'bob.doc', text: 'hi', tone: 'ok' },
      { id: 'u1', kind: 'unchanged', path: 'alice.doc' },
    ])
    expect(container.innerHTML).not.toMatch(/\b(transition|animate)-/)
  })
})
