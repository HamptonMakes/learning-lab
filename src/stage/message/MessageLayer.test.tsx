import { useEffect, useRef, type ReactNode } from 'react'
import { act, cleanup, render, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Change, Frame } from '@/lesson/types'
import {
  AnchorRegistryProvider,
  arcBetween,
  useAnchorRegistry,
  type AnchorRegistry,
} from '../geometry'
import { StageMotionProvider } from '../motion'
import { StageFrameProvider } from '../StageContext'
import { Stage } from '../Stage'
import { MessageLayer } from './MessageLayer'
import { ARC_BULGE, parkedDelta } from './stacks'
import { frame, GEO, msg, scalar, translateOf, world } from './testing'

interface Opts {
  instant?: boolean
  reduced?: boolean
  dir?: 'ltr' | 'rtl'
}

function Wrap({ f, opts, children }: { f: Frame; opts: Opts; children: ReactNode }) {
  return (
    <StageMotionProvider
      speed={1}
      reducedSetting={opts.reduced ?? false}
      instant={opts.instant ?? true}
      dir={opts.dir ?? 'ltr'}
    >
      <StageFrameProvider frame={f}>{children}</StageFrameProvider>
    </StageMotionProvider>
  )
}

function renderLayer(f: Frame, opts: Opts = {}) {
  const r = render(
    <Wrap f={f} opts={opts}>
      <MessageLayer geometry={GEO} />
    </Wrap>,
  )
  return {
    ...r,
    rerenderFrame: (next: Frame, o: Opts = opts) =>
      r.rerender(
        <Wrap f={next} opts={o}>
          <MessageLayer geometry={GEO} />
        </Wrap>,
      ),
  }
}

const q = (root: HTMLElement, sel: string) => root.querySelector<HTMLElement>(sel)
const qa = (root: HTMLElement, sel: string) => [...root.querySelectorAll<HTMLElement>(sel)]

afterEach(cleanup)

describe('MessageLayer — flying tokens', () => {
  it('renders one token per flying message with the DOM contract and an arc underlay', () => {
    const w = world({
      messages: [
        msg('m1', 'alice', 'bob', scalar('hello'), { label: 'save' }),
        msg('m2', 'bob', 'alice'),
      ],
    })
    const { container } = renderLayer(frame(w))
    const m1 = q(container, '[data-message="m1"]')
    expect(m1).not.toBeNull()
    expect(m1).toHaveAttribute('data-from', 'alice')
    expect(m1).toHaveAttribute('data-to', 'bob')
    expect(m1).toHaveAttribute('data-state', 'flying')
    expect(m1).toHaveAttribute('data-path', 'msg:m1')
    expect(m1?.style.getPropertyValue('offset-path')).toMatch(/^path\("M /)
    expect(m1?.style.getPropertyValue('offset-distance')).toBe('50%')
    expect(m1).toHaveTextContent('save')
    expect(m1).toHaveTextContent('hello')
    expect(q(container, '[data-message="m2"]')).toHaveAttribute('data-from', 'bob')
    expect(qa(container, '[data-arc]')).toHaveLength(2)
    expect(q(container, '[data-arc="alice→bob"]')).toHaveAttribute('stroke', 'var(--line-2)')
  })

  it('stacks tokens on one arc by creation order (50 %, 42 %, 58 %)', () => {
    const w = world({
      messages: [msg('m1', 'alice', 'bob'), msg('m2', 'alice', 'bob'), msg('m3', 'alice', 'bob')],
    })
    const { container } = renderLayer(frame(w))
    const offsets = ['m1', 'm2', 'm3'].map((id) =>
      q(container, `[data-message="${id}"]`)?.style.getPropertyValue('offset-distance'),
    )
    expect(offsets).toEqual(['50%', '42%', '58%'])
    expect(qa(container, '[data-arc]')).toHaveLength(1)
  })

  it('uses the `into` node as the arc endpoint', () => {
    const w = world({ messages: [msg('m1', 'alice', 'bob', scalar(1), { into: 'bob.doc' })] })
    const { container } = renderLayer(frame(w))
    const bob = GEO.get('bob')
    const doc = GEO.get('bob.doc')
    const alice = GEO.get('alice')
    if (!bob || !doc || !alice) throw new Error('fixture')
    const path = q(container, '[data-message="m1"]')?.style.getPropertyValue('offset-path')
    expect(path).toContain(arcBetween(alice, doc, ARC_BULGE).d)
    expect(path).not.toContain(arcBetween(alice, bob, ARC_BULGE).d)
  })

  it('collapses 4+ tokens on one arc into a deck with a count, keeping hidden [data-message] elements', () => {
    const op = (id: number) =>
      msg('m' + id, 'alice', 'bob', scalar(`inc ${id}`, { tag: `alice:${id}` }), {
        data: {
          kind: 'op',
          slot: 'n',
          op: { id: `alice:${id}`, op: {}, deps: {}, label: 'inc', ts: 0 },
        },
      })
    const w = world({ messages: [op(1), op(2), op(3), op(4)] })
    const { container } = renderLayer(frame(w))
    const deck = q(container, '[data-deck]')
    expect(deck).not.toBeNull()
    expect(deck).toHaveAttribute('data-count', '4')
    expect(deck).toHaveTextContent('4 ops')
    expect(deck?.style.getPropertyValue('offset-distance')).toBe('50%')
    expect(qa(container, '[data-message]')).toHaveLength(4)
    expect(deck?.querySelectorAll('[data-message][data-decked]')).toHaveLength(4)
    expect(qa(container, '[data-arc]')).toHaveLength(1)
  })

  it('registers each token as the anchor `msg:<id>`', () => {
    const captured: { reg: AnchorRegistry | null } = { reg: null }
    function Probe() {
      const reg = useAnchorRegistry()
      useEffect(() => {
        captured.reg = reg
      }, [reg])
      return null
    }
    function Host() {
      const ref = useRef<HTMLDivElement>(null)
      return (
        <div ref={ref}>
          <AnchorRegistryProvider container={ref}>
            <Probe />
            <MessageLayer geometry={GEO} />
          </AnchorRegistryProvider>
        </div>
      )
    }
    const w = world({
      messages: [
        msg('m1', 'alice', 'bob'),
        msg('p1', 'bob', 'carol', scalar(1), { state: 'parked' }),
      ],
    })
    render(
      <Wrap f={frame(w)} opts={{}}>
        <Host />
      </Wrap>,
    )
    expect(captured.reg).not.toBeNull()
    expect(captured.reg?.has('msg:m1')).toBe(true)
    expect(captured.reg?.has('msg:p1')).toBe(true)
  })
})

describe('MessageLayer — parked tokens', () => {
  it('sits a parked token in the recipient inbox tray, slotted by creation order', () => {
    const w = world({
      messages: [
        msg('p1', 'alice', 'bob', scalar('x'), { state: 'parked' }),
        msg('p2', 'carol', 'bob', scalar('y'), { state: 'parked' }),
      ],
    })
    const { container } = renderLayer(frame(w))
    const p1 = q(container, '[data-message="p1"]')
    const p2 = q(container, '[data-message="p2"]')
    expect(p1).toHaveAttribute('data-state', 'parked')
    expect(p1).toHaveAttribute('data-tray-slot', '0')
    expect(p2).toHaveAttribute('data-tray-slot', '1')
    expect(p1?.style.getPropertyValue('offset-distance')).toBe('100%')
    const alice = GEO.get('alice')
    const bob = GEO.get('bob')
    const tray = GEO.get('bob@inbox')
    if (!alice || !bob || !tray || !p1) throw new Error('fixture')
    const expected = parkedDelta(arcBetween(alice, bob, ARC_BULGE).p1, tray, 0)
    const got = translateOf(p1.style)
    expect(got.x).toBeCloseTo(expected.x, 1)
    expect(got.y).toBeCloseTo(expected.y, 1)
    expect(qa(container, '[data-arc]')).toHaveLength(0) // parked tokens draw no arc
  })
})

describe('MessageLayer — transient flights', () => {
  const changes: Change[] = [
    { kind: 'message', op: 'sent', message: msg('t=1', 'alice', 'bob'), transient: true },
    { kind: 'message', op: 'delivered', message: msg('t=1', 'alice', 'bob'), transient: true },
  ]
  it('flies a transient token while animating', () => {
    const { container } = renderLayer(frame(world({}), changes), { instant: false })
    const t1 = q(container, '[data-message="t=1"]')
    expect(t1).not.toBeNull()
    expect(t1).toHaveAttribute('data-transient')
    expect(t1).toHaveAttribute('data-state', 'flying')
    expect(t1).toHaveAttribute('data-outcome', 'delivered')
  })
  it('draws nothing under instant commits or reduced motion', () => {
    const a = renderLayer(frame(world({}), changes), { instant: true })
    expect(q(a.container, '[data-transient]')).toBeNull()
    cleanup()
    const b = renderLayer(frame(world({}), changes), { instant: false, reduced: true })
    expect(q(b.container, '[data-transient]')).toBeNull()
  })
})

describe('MessageLayer — exits', () => {
  it('removes a delivered token from the DOM and reports the outcome through the stage events', async () => {
    const m1 = msg('m1', 'alice', 'bob')
    const before = frame(world({ messages: [m1] }))
    const delivered: Change[] = [{ kind: 'message', op: 'delivered', message: m1 }]
    const after = frame(world({}), delivered, 1)
    const onEvent = vi.fn()
    const props = { speed: 1, reducedSetting: false, instant: true, dir: 'ltr' as const, onEvent }
    const { container, rerender } = render(<Stage frame={before} {...props} />)
    expect(q(container, '[data-message="m1"]')).not.toBeNull()
    await act(async () => {
      rerender(<Stage frame={after} {...props} />)
    })
    await waitFor(() => expect(q(container, '[data-message="m1"]')).toBeNull())
    await waitFor(() =>
      expect(onEvent).toHaveBeenCalledWith({ kind: 'message', op: 'delivered', message: m1 }),
    )
  })
})

describe('MessageLayer — hygiene', () => {
  it('uses no CSS transition/animation utilities (Motion owns all motion)', () => {
    const w = world({
      messages: [
        msg('m1', 'alice', 'bob'),
        msg('p1', 'bob', 'carol', scalar(1), { state: 'parked' }),
      ],
    })
    const { container } = renderLayer(frame(w))
    expect(container.innerHTML).not.toMatch(/\b(transition|animate)-/)
  })
})
