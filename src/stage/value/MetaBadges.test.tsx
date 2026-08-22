import { cleanup } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { Meta } from '@/lesson/types'
import { orderEntries } from './format'
import { MetaBadges } from './MetaBadges'
import { makeFrame, markedFrame, node, nodes, renderStage } from './test-helpers'

afterEach(cleanup)

function renderMeta(meta: Meta, opts: Parameters<typeof renderStage>[1] = {}) {
  return renderStage(<MetaBadges path="alice.v" meta={meta} />, opts)
}

describe('MetaBadges', () => {
  it('renders every meta key as an addressable badge in a fixed order', () => {
    const meta: Meta = {
      type: 'rga',
      ts: 3,
      node: 'alice',
      tag: 'alice:3',
      tags: [{ tag: 'alice:1', alive: true }],
      tombstone: true,
      addTs: 1,
      removeTs: 2,
      vc: { bob: 1, alice: 3 },
      applied: ['alice:1', 'alice:2', 'alice:3', 'bob:1'],
      stats: { stored: 5, visible: 3 },
      note: 'footnote',
    }
    const { container } = renderMeta(meta)
    const keys = Array.from(container.querySelectorAll<HTMLElement>('[data-meta]')).map(
      (b) => b.dataset.meta,
    )
    expect(keys).toEqual([
      'type',
      'ts',
      'node',
      'tag',
      'tags',
      'tomb',
      'addTs',
      'removeTs',
      'vc',
      'applied',
      'stats',
      'note',
    ])
    for (const key of keys) {
      const el = node(container, `alice.v@${key}`)
      expect(el.dataset.kind).toBe('meta')
    }
    expect(node(container, 'alice.v@type').textContent).toBe('RGA')
    expect(node(container, 'alice.v@ts').dataset.value).toBe('t=3')
    expect(node(container, 'alice.v@node').dataset.value).toBe('alice')
    expect(node(container, 'alice.v@node').querySelector('[data-node="alice"]')).not.toBeNull()
    expect(node(container, 'alice.v@tag').textContent).toBe('#alice:3')
    expect(node(container, 'alice.v@tomb').dataset.value).toBe('true')
    expect(node(container, 'alice.v@addTs').textContent).toBe('add t=1')
    expect(node(container, 'alice.v@removeTs').textContent).toBe('remove t=2')
    expect(node(container, 'alice.v@vc').dataset.value).toBe('alice3 bob1')
    const applied = node(container, 'alice.v@applied')
    expect(applied.dataset.value).toBe('alice:1 alice:2 alice:3 bob:1')
    expect(applied.querySelectorAll('[data-applied]')).toHaveLength(3)
    expect(applied.querySelector<HTMLElement>('[data-overflow]')?.dataset.overflow).toBe('1')
    expect(node(container, 'alice.v@stats').dataset.value).toBe('3/5')
    expect(node(container, 'alice.v@stats').getAttribute('title')).toBe('3 of 5 elements visible')
    expect(node(container, 'alice.v@note').textContent).toBe('footnote')
  })

  it('prefers the HLC over ts and formats stamps by the scene clock', () => {
    const hlc = renderMeta({ ts: 9, hlc: { wall: 605, counter: 2 } })
    expect(nodes(hlc.container, 'alice.v@ts')).toHaveLength(0)
    expect(node(hlc.container, 'alice.v@hlc').dataset.value).toBe('(605, 2)')
    hlc.unmount()

    const timeFrame = makeFrame({ clock: { format: 'time', start: '10:00' } })
    const time = renderMeta({ ts: 65, hlc: { wall: 5, counter: 2 } }, { frame: timeFrame })
    expect(node(time.container, 'alice.v@hlc').dataset.value).toBe('(10:05, 2)')
    time.unmount()

    const msFrame = makeFrame({ clock: { format: 'ms' } })
    const ms = renderMeta({ ts: 150 }, { frame: msFrame })
    expect(node(ms.container, 'alice.v@ts').dataset.value).toBe('150 ms')
  })

  it('renders nothing for an empty meta and the seed node as "init"', () => {
    const { container } = renderMeta({})
    expect(container.querySelector('[data-meta-badges]')).toBeNull()
    const seed = renderMeta({ node: 'seed' })
    expect(node(seed.container, 'alice.v@node').textContent).toBe('init')
  })

  it('lets a highlight target a badge, including the @tombstone alias of the @tomb badge', () => {
    const frame = markedFrame({
      highlight: [
        { path: 'alice.v@ts', tone: 'change' },
        { path: 'alice.v@tombstone', tone: 'warn' },
      ],
      check: ['alice.v@node'],
    })
    const { container } = renderMeta({ ts: 1, node: 'bob', tombstone: true }, { frame })
    expect(node(container, 'alice.v@ts').dataset.highlight).toBe('change')
    expect(node(container, 'alice.v@tomb').dataset.highlight).toBe('warn')
    expect(node(container, 'alice.v@node').querySelector('[data-mark-kind="check"]')).not.toBeNull()
  })

  it('orders version vectors by world actors first, then unknown nodes by id', () => {
    expect(orderEntries({ zed: 1, bob: 2, alice: 3, carol: 0 }, ['alice', 'bob'])).toEqual({
      alice: 3,
      bob: 2,
      carol: 0,
      zed: 1,
    })
  })
})
