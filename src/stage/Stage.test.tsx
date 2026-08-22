/**
 * Stage scaffold — DOM contract (DSL §14, stage-architecture §3.2) for the stage root, actor
 * cards, inbox/outbox regions, boards, the clock HUD, layout slots and RTL. Worlds are literals;
 * the value views, message layer and mark layers are placeholders here.
 */
import { cleanup, render, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { Actor, Board, Frame, Message, Scalar, Value, World } from '@/lesson/types'
import { Stage, type StageProps } from './Stage'

// ─── fixtures ────────────────────────────────────────────────────────────────────────────────

const scalar = (value: Scalar): Value => ({ kind: 'scalar', value })

function actor(id: string, over: Partial<Actor> = {}): Actor {
  return {
    id,
    kind: 'person',
    label: id.charAt(0).toUpperCase() + id.slice(1),
    color: 'a',
    online: true,
    holds: {},
    outbox: [],
    ...over,
  }
}

function world(over: Partial<World> = {}): World {
  return {
    layout: { preset: 'row' },
    clock: { now: 0, show: false, format: 'counter' },
    actors: {},
    boards: {},
    messages: [],
    marks: [],
    replicas: {},
    engines: {},
    ids: 0,
    ...over,
  }
}

function frame(w: World, over: Partial<Frame> = {}): Frame {
  return {
    index: 0,
    sceneId: 'intro',
    sceneIndex: 0,
    step: { id: 'step-1', say: 'Hello.', do: [] },
    world: w,
    prev: w,
    changes: [],
    ...over,
  }
}

function renderStage(f: Frame, props: Partial<StageProps> = {}) {
  return render(<Stage frame={f} speed={1} reducedSetting={false} instant dir="ltr" {...props} />)
}

function q(root: ParentNode, selector: string): HTMLElement {
  const el = root.querySelector<HTMLElement>(selector)
  if (!el) throw new Error(`expected an element matching ${selector}`)
  return el
}

const qa = (root: ParentNode, selector: string) =>
  Array.from(root.querySelectorAll<HTMLElement>(selector))

const alice = actor('alice', { holds: { doc: scalar('Draft'), n: scalar(3) } })
const bob = actor('bob', { kind: 'device', color: 'b', online: false, status: 'waiting' })
const srv = actor('srv', {
  kind: 'server',
  label: 'Server',
  color: 'server',
  status: 'lock',
  skew: 2,
})

afterEach(cleanup)

// ─── root ────────────────────────────────────────────────────────────────────────────────────

describe('stage root', () => {
  it('carries data-stage / data-step / data-step-index / data-scene / data-layout and the dir', () => {
    const { container, rerender } = renderStage(frame(world({ actors: { alice } }), { index: 4 }))
    const root = q(container, '[data-stage]')
    expect(root).toHaveAttribute('data-step', 'step-1')
    expect(root).toHaveAttribute('data-step-index', '4')
    expect(root).toHaveAttribute('data-scene', 'intro')
    expect(root).toHaveAttribute('data-layout', 'row')
    expect(root).toHaveAttribute('dir', 'ltr')
    expect(root).toHaveAttribute('data-instant')
    rerender(
      <Stage
        frame={frame(world({ actors: { alice } }), { index: 4 })}
        speed={1}
        reducedSetting={false}
        instant={false}
        dir="ltr"
      />,
    )
    expect(q(container, '[data-stage]')).not.toHaveAttribute('data-instant')
  })

  it('mirrors for RTL through the dir attribute', () => {
    const { container } = renderStage(frame(world({ actors: { alice } })), { dir: 'rtl' })
    expect(q(container, '[data-stage]')).toHaveAttribute('dir', 'rtl')
  })

  it('uses no transition-* or animate-* utilities anywhere inside the stage', () => {
    const w = world({
      layout: { preset: 'hub' },
      clock: { now: 3, show: true, format: 'counter' },
      actors: { alice, bob, srv },
      boards: {
        rule: {
          id: 'rule',
          label: 'Rule',
          tone: 'info',
          value: { kind: 'text', text: 'Max wins.', annotations: [] },
        },
      },
      marks: [{ id: 'k1', kind: 'highlight', paths: ['alice'], tone: 'warn' }],
    })
    const { container } = renderStage(frame(w))
    const offenders = qa(container, '[data-stage], [data-stage] *')
      .flatMap((el) => (el.getAttribute('class') ?? '').split(/\s+/))
      .filter((c) => /^(transition|animate)(-|$)/.test(c))
    expect(offenders).toEqual([])
  })
})

// ─── actor cards ─────────────────────────────────────────────────────────────────────────────

describe('actor cards', () => {
  it('render the §14 attributes and the root path anchor', () => {
    const { container } = renderStage(frame(world({ actors: { alice, bob, srv } })))
    const a = q(container, '[data-actor="alice"]')
    expect(a).toHaveAttribute('data-path', 'alice')
    expect(a).toHaveAttribute('data-kind', 'person')
    expect(a).toHaveAttribute('data-online', 'true')
    expect(a).toHaveAttribute('data-slot', 's1')
    expect(a).toHaveAttribute('data-color', 'a')
    expect(a).not.toHaveAttribute('data-status')
    expect(a.tagName).toBe('ARTICLE')
    expect(a).toHaveAttribute('aria-label', 'Alice')

    const b = q(container, '[data-actor="bob"]')
    expect(b).toHaveAttribute('data-kind', 'device')
    expect(b).toHaveAttribute('data-online', 'false')
    expect(b).toHaveAttribute('data-slot', 's2')
    expect(b).toHaveAttribute('data-color', 'b')
    expect(b).toHaveAttribute('data-status', 'waiting')

    const s = q(container, '[data-actor="srv"]')
    expect(s).toHaveAttribute('data-kind', 'server')
    expect(s).toHaveAttribute('data-color', 'server')
    expect(s).toHaveAttribute('data-slot', 's3')
    expect(s).toHaveAttribute('data-status', 'lock')
  })

  it('give every card an inbox tray and an outbox region with their selector anchors', () => {
    const { container } = renderStage(frame(world({ actors: { alice, bob } })))
    for (const id of ['alice', 'bob']) {
      const card = q(container, `[data-actor="${id}"]`)
      expect(q(card, '[data-inbox]')).toHaveAttribute('data-path', `${id}@inbox`)
      expect(q(card, '[data-inbox]')).toHaveAttribute('data-inbox', id)
      expect(q(card, '[data-outbox]')).toHaveAttribute('data-path', `${id}@outbox`)
      expect(q(card, '[data-outbox]')).toHaveAttribute('data-outbox', id)
    }
    expect(qa(container, '[data-inbox]')).toHaveLength(2)
    expect(qa(container, '[data-outbox]')).toHaveLength(2)
  })

  it('render holds in insertion order under slot labels via ValueView', () => {
    const { container } = renderStage(frame(world({ actors: { alice } })))
    const card = q(container, '[data-actor="alice"]')
    expect(qa(card, '[data-hold]').map((el) => el.dataset.hold)).toEqual(['doc', 'n'])
    expect(q(card, '[data-hold="doc"]').textContent).toContain('doc')
    expect(q(card, '[data-path="alice.doc"]')).toHaveAttribute('data-kind', 'scalar')
    expect(q(card, '[data-path="alice.n"]')).toHaveAttribute('data-kind', 'scalar')
    const order = qa(card, '[data-path]').map((el) => el.dataset.path)
    expect(order.indexOf('alice.doc')).toBeLessThan(order.indexOf('alice.n'))
  })

  it('draw outbox chips (label + op id) and a +n pill beyond three', () => {
    const outbox = [1, 2, 3, 4, 5].map((i) => ({
      slot: 'n',
      id: `alice:${i}` as const,
      label: `inc ${i}`,
    }))
    const { container } = renderStage(
      frame(world({ actors: { alice: actor('alice', { outbox }) } })),
    )
    const region = q(container, '[data-outbox="alice"]')
    expect(region).toHaveAttribute('data-pending', '5')
    const chips = qa(region, '[data-outbox-chip]')
    expect(chips.map((c) => c.dataset.outboxChip)).toEqual(['alice:1', 'alice:2', 'alice:3'])
    expect(chips[0]?.textContent).toContain('inc 1')
    expect(chips[0]?.textContent).toContain('alice:1')
    expect(q(region, '[data-outbox-more]')).toHaveTextContent('+2')
    expect(q(container, '[data-outbox="alice"]').title).toBe('5 ops not yet sent')
  })

  it('keep the outbox region in the DOM when empty and drop the pill under four chips', () => {
    const { container } = renderStage(
      frame(
        world({
          actors: {
            alice: actor('alice', { outbox: [{ slot: 'n', id: 'alice:1', label: 'inc 1' }] }),
            bob,
          },
        }),
      ),
    )
    expect(q(container, '[data-outbox="alice"]')).toHaveAttribute('data-pending', '1')
    expect(container.querySelector('[data-outbox="alice"] [data-outbox-more]')).toBeNull()
    expect(q(container, '[data-outbox="bob"]')).toHaveAttribute('data-pending', '0')
  })

  it('count parked messages in the inbox tray and show +n beyond three', () => {
    const parked = (i: number): Message => ({
      id: `m${i}`,
      from: 'bob',
      to: 'alice',
      payload: scalar(i),
      state: 'parked',
    })
    const flying: Message = {
      id: 'm9',
      from: 'bob',
      to: 'alice',
      payload: scalar(9),
      state: 'flying',
    }
    const { container } = renderStage(
      frame(
        world({ actors: { alice, bob }, messages: [1, 2, 3, 4, 5].map(parked).concat(flying) }),
      ),
    )
    const tray = q(container, '[data-inbox="alice"]')
    expect(tray).toHaveAttribute('data-parked', '5')
    expect(q(tray, '[data-inbox-more]')).toHaveTextContent('+2')
    expect(tray.title).toBe('5 messages waiting')
    const bobTray = q(container, '[data-inbox="bob"]')
    expect(bobTray).toHaveAttribute('data-parked', '0')
    expect(bobTray.querySelector('[data-inbox-more]')).toBeNull()
  })

  it('show the offline badge and dim an actor that is offline', () => {
    const { container } = renderStage(frame(world({ actors: { alice, bob } })))
    const b = q(container, '[data-actor="bob"]')
    expect(q(b, '[data-offline]')).toHaveTextContent('no connection')
    expect(qa(b, '.opacity-60').length).toBeGreaterThan(0)
    expect(container.querySelector('[data-actor="alice"] [data-offline]')).toBeNull()
  })

  it('show the status badge as icon + word, anchored at <actor>@status', () => {
    const { container } = renderStage(frame(world({ actors: { alice, bob, srv } })))
    const lock = q(container, '[data-path="srv@status"]')
    expect(lock).toHaveTextContent('locked')
    expect(lock.querySelector('svg')).not.toBeNull()
    expect(q(container, '[data-path="bob@status"]')).toHaveTextContent('waiting')
    expect(container.querySelector('[data-path="alice@status"]')).toBeNull()
  })

  it('show a clock badge (now + skew, delta) only when skew is defined', () => {
    const w = world({
      clock: { now: 3, show: true, format: 'counter' },
      actors: { alice, srv, late: actor('late', { skew: -1 }), sync: actor('sync', { skew: 0 }) },
    })
    const { container } = renderStage(frame(w))
    const badge = q(container, '[data-path="srv@clock"]')
    expect(badge).toHaveTextContent('t=5')
    expect(q(badge, '[data-delta]')).toHaveTextContent('+2')
    expect(badge.querySelector('bdi[dir="ltr"]')).not.toBeNull()
    expect(q(container, '[data-path="late@clock"]')).toHaveTextContent('t=2')
    expect(q(container, '[data-path="late@clock"] [data-delta]')).toHaveTextContent('−1')
    expect(q(container, '[data-path="sync@clock"] [data-delta]')).toHaveTextContent('+0')
    expect(container.querySelector('[data-path="alice@clock"]')).toBeNull()
  })

  it('format the clock badge in the scene format', () => {
    const w = world({
      clock: { now: 12, show: false, format: 'time', start: '10:05' },
      actors: { srv: actor('srv', { kind: 'server', skew: 5 }) },
    })
    const { container } = renderStage(frame(w))
    expect(q(container, '[data-path="srv@clock"]')).toHaveTextContent('10:22')
  })

  it('caption a device with its owner ("Alice\'s") and keep the label and subtitle', () => {
    const phone = actor('phone', {
      kind: 'device',
      icon: 'phone',
      label: 'Phone',
      subtitle: 'shares: text',
      owner: 'alice',
    })
    const { container } = renderStage(frame(world({ actors: { alice, phone } })))
    const card = q(container, '[data-actor="phone"]')
    expect(q(card, '[data-owner="alice"]')).toHaveTextContent("Alice's")
    expect(q(card, '[data-label]')).toHaveTextContent('Phone')
    expect(q(card, '[data-subtitle]')).toHaveTextContent('shares: text')
    expect(container.querySelector('[data-actor="alice"] [data-owner]')).toBeNull()
  })

  it('highlight the whole card when a highlight mark anchors on the actor root', () => {
    const w = world({
      actors: { alice, bob },
      marks: [
        { id: 'k1', kind: 'highlight', paths: ['alice'], tone: 'warn' },
        { id: 'k2', kind: 'highlight', paths: ['bob.doc'], tone: 'ok' },
      ],
    })
    const { container } = renderStage(frame(w))
    expect(q(container, '[data-actor="alice"]')).toHaveAttribute('data-highlight', 'warn')
    expect(q(container, '[data-actor="alice"] [data-highlight-ring="warn"]')).toBeInTheDocument()
    expect(q(container, '[data-actor="bob"]')).not.toHaveAttribute('data-highlight')
  })

  it('tag the card with the sender when a control message landed on the actor root', () => {
    const m: Message = {
      id: 'm1',
      from: 'bob',
      to: 'alice',
      payload: scalar('ping'),
      state: 'flying',
    }
    const f = frame(world({ actors: { alice, bob } }), {
      changes: [
        { kind: 'message', op: 'delivered', message: m },
        { kind: 'value', path: 'alice', op: 'changed', via: 'm1' },
      ],
    })
    const { container } = renderStage(f)
    const tag = q(container, '[data-actor="alice"] [data-via="m1"]')
    expect(tag).toHaveAttribute('data-via-from', 'bob')
    expect(tag).toHaveTextContent('B')
    expect(q(container, '[data-actor="alice"] [data-via-flash="b"]')).toBeInTheDocument()
    expect(container.querySelector('[data-actor="bob"] [data-via]')).toBeNull()
  })
})

// ─── layout ──────────────────────────────────────────────────────────────────────────────────

describe('layout presets', () => {
  const slots = (container: HTMLElement) =>
    qa(container, '[data-actor]').map((el) => `${el.dataset.actor}:${el.dataset.slot}`)

  it('assign s1… in insertion order and expose the preset on the grid', () => {
    const { container } = renderStage(frame(world({ actors: { alice, bob, srv } })))
    expect(slots(container)).toEqual(['alice:s1', 'bob:s2', 'srv:s3'])
    expect(q(container, '.stage-actors')).toHaveAttribute('data-layout', 'row')
  })

  it('give the hub slot to layout.hub in hub / ring', () => {
    const w = world({ layout: { preset: 'hub', hub: 'bob' }, actors: { alice, bob, srv } })
    const { container } = renderStage(frame(w))
    expect(slots(container)).toEqual(['alice:s1', 'bob:hub', 'srv:s2'])
    expect(q(container, '.stage-actors')).toHaveAttribute('data-hub', 'bob')
  })

  it('default the hub to the first server, else the first actor', () => {
    const withServer = renderStage(
      frame(world({ layout: { preset: 'ring' }, actors: { alice, bob, srv } })),
    )
    expect(slots(withServer.container)).toEqual(['alice:s1', 'bob:s2', 'srv:hub'])
    cleanup()
    const noServer = renderStage(
      frame(world({ layout: { preset: 'hub' }, actors: { alice, bob } })),
    )
    expect(slots(noServer.container)).toEqual(['alice:hub', 'bob:s1'])
  })

  it('glide cards to new slots when the layout changes (data attributes follow)', () => {
    const { container, rerender } = renderStage(frame(world({ actors: { alice, bob, srv } })))
    expect(q(container, '[data-stage]')).toHaveAttribute('data-layout', 'row')
    rerender(
      <Stage
        frame={frame(world({ layout: { preset: 'hub' }, actors: { alice, bob, srv } }), {
          index: 1,
        })}
        speed={1}
        reducedSetting={false}
        instant={false}
        dir="ltr"
      />,
    )
    expect(q(container, '[data-stage]')).toHaveAttribute('data-layout', 'hub')
    expect(q(container, '.stage-actors')).toHaveAttribute('data-layout', 'hub')
    expect(slots(container)).toEqual(['alice:s1', 'bob:s2', 'srv:hub'])
  })

  it('spawn and remove actors', async () => {
    const { container, rerender } = renderStage(frame(world({ actors: { alice, bob } })))
    expect(qa(container, '[data-actor]')).toHaveLength(2)
    rerender(
      <Stage
        frame={frame(world({ actors: { alice, carol: actor('carol', { color: 'c' }) } }), {
          index: 1,
        })}
        speed={1}
        reducedSetting={false}
        instant={false}
        dir="ltr"
      />,
    )
    expect(q(container, '[data-actor="carol"]')).toHaveAttribute('data-slot', 's2')
    await waitFor(() => expect(container.querySelector('[data-actor="bob"]')).toBeNull())
    expect(qa(container, '[data-actor]').map((el) => el.dataset.actor)).toEqual(['alice', 'carol'])
  })
})

// ─── boards ──────────────────────────────────────────────────────────────────────────────────

describe('boards', () => {
  const rule: Board = {
    id: 'rule',
    label: 'Rule',
    tone: 'info',
    value: { kind: 'text', text: 'Bigger timestamp wins.', annotations: [] },
  }
  const table: Board = {
    id: 'tbl',
    value: { kind: 'record', fields: [{ key: 'a', value: scalar(1) }] },
  }

  it('render data-board / data-path and the value through ValueView', () => {
    const { container } = renderStage(
      frame(world({ actors: { alice }, boards: { rule, tbl: table } })),
    )
    const card = q(container, '[data-board="rule"]')
    expect(card).toHaveAttribute('data-path', 'board.rule')
    expect(card).toHaveAttribute('data-board-kind', 'text')
    expect(card).toHaveAttribute('data-tone', 'info')
    expect(q(card, '[data-board-label]')).toHaveTextContent('Rule')
    expect(q(card, '[data-kind="text"]')).toHaveAttribute('data-path', 'board.rule')
    expect(card.className).toContain('font-mono')

    const tbl = q(container, '[data-board="tbl"]')
    expect(tbl).toHaveAttribute('data-path', 'board.tbl')
    expect(tbl.querySelector('[data-board-label]')).toBeNull()
    expect(tbl.className).not.toContain('font-mono')
    expect(q(container, '.stage-boards')).toHaveAttribute('data-boards', '2')
  })

  it('keep the gutter empty when there are no boards', () => {
    const { container } = renderStage(frame(world({ actors: { alice } })))
    expect(q(container, '.stage-boards')).toHaveAttribute('data-boards', '0')
    expect(container.querySelector('[data-board]')).toBeNull()
  })
})

// ─── clock HUD ───────────────────────────────────────────────────────────────────────────────

describe('clock HUD', () => {
  const hud = (clock: World['clock']) => {
    const { container } = renderStage(frame(world({ clock, actors: { alice } })))
    return container
  }

  it('counter → t3', () => {
    const c = hud({ now: 3, show: true, format: 'counter' })
    const el = q(c, '[data-clock]')
    expect(el).toHaveTextContent('t=3')
    expect(el).toHaveAttribute('data-now', '3')
    expect(el.querySelector('bdi[dir="ltr"]')).not.toBeNull()
  })

  it('ms → 150 ms', () => {
    expect(q(hud({ now: 150, show: true, format: 'ms' }), '[data-clock]')).toHaveTextContent(
      '150 ms',
    )
  })

  it('time → start + now minutes, wrapping at midnight', () => {
    expect(
      q(hud({ now: 12, show: true, format: 'time', start: '10:05' }), '[data-clock]'),
    ).toHaveTextContent('10:17')
    cleanup()
    expect(
      q(hud({ now: 20, show: true, format: 'time', start: '23:50' }), '[data-clock]'),
    ).toHaveTextContent('00:10')
  })

  it('is absent when clock.show is false', () => {
    expect(hud({ now: 3, show: false, format: 'counter' }).querySelector('[data-clock]')).toBeNull()
  })
})
