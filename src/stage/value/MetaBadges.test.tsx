import { cleanup } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { Meta, Value } from '@/lesson/types'
import { orderEntries } from './format'
import { MetaBadges } from './MetaBadges'
import { makeFrame, markedFrame, node, nodes, renderStage, renderValue, s } from './test-helpers'

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

  it('renders nothing for an empty meta; a seed stamp is hidden (anchor kept) unless pointed at', () => {
    const { container } = renderMeta({})
    expect(container.querySelector('[data-meta-badges]')).toBeNull()
    const seed = renderMeta({ ts: 0, node: 'seed' })
    expect(node(seed.container, 'alice.v@node').textContent).toBe('init')
    expect(node(seed.container, 'alice.v@node').dataset.hidden).toBe('')
    expect(node(seed.container, 'alice.v@ts').dataset.hidden).toBe('')
    // every badge hidden → the line itself is hidden too (no stray gap next to the value)
    expect(seed.container.querySelector('[data-meta-badges]')?.getAttribute('data-hidden')).toBe('')
    seed.unmount()
    // a highlight on the stamp shows it, seed or not: the step points at it
    const frame = markedFrame({ highlight: [{ path: 'alice.v@ts' }] })
    const pointed = renderMeta({ ts: 0, node: 'seed' }, { frame })
    expect(node(pointed.container, 'alice.v@ts').dataset.hidden).toBeUndefined()
    expect(node(pointed.container, 'alice.v@ts').dataset.highlight).toBe('change')
    expect(node(pointed.container, 'alice.v@node').dataset.hidden).toBe('')
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

// ─── composed documents ──────────────────────────────────────────────────────────────────────

/** A `crdt.doc` value as toValue draws it: typed parts under an untyped map root. */
const card: Value = {
  kind: 'record',
  fields: [
    { key: 'title', value: s('Fix login', { type: 'lww-register', ts: 1, node: 'alice' }) },
    {
      key: 'labels',
      value: {
        kind: 'set',
        meta: { type: 'or-set' },
        items: [
          { id: 'bug', value: s('bug', { tags: [{ tag: 'seed:1', alive: true }] }) },
          { id: 'ui', value: s('ui', { tags: [{ tag: 'bob:1', alive: true }] }) },
        ],
      },
    },
    {
      key: 'items',
      value: {
        kind: 'list',
        meta: { type: 'rga' },
        items: [
          {
            id: 'alice:1',
            value: {
              kind: 'record',
              meta: { ts: 1, node: 'alice' },
              fields: [
                { key: 'text', value: s('deploy', { type: 'lww-register', ts: 1, node: 'alice' }) },
              ],
            },
          },
        ],
      },
    },
  ],
}

describe('MetaBadges inside a composed document', () => {
  it('hides every badge the step does not point at; values stay', () => {
    const { container } = renderValue('alice.card', card)
    for (const p of [
      'alice.card.title@type',
      'alice.card.title@ts',
      'alice.card.title@node',
      'alice.card.labels@type',
      'alice.card.labels[bug]@tags',
      'alice.card.items@type',
      'alice.card.items[alice:1]@ts',
      'alice.card.items[alice:1].text@ts',
    ]) {
      const el = node(container, p)
      expect(el.dataset.hidden, p).toBe('')
      expect(el.dataset.kind).toBe('meta')
    }
    expect(node(container, 'alice.card.title').dataset.value).toBe('Fix login')
    expect(node(container, 'alice.card.labels[bug]').dataset.value).toBe('bug')
  })

  it('shows the sidecar of a node that changed, landed via a message, or carries a mark', () => {
    const frame = markedFrame({
      changed: ['alice.card.title'],
      highlight: [{ path: 'alice.card.labels[ui]' }],
      via: { path: 'alice.card.items[alice:1].text', from: 'bob' },
    })
    const { container } = renderValue('alice.card', card, { frame })
    expect(node(container, 'alice.card.title@ts').dataset.hidden).toBeUndefined()
    expect(node(container, 'alice.card.title@node').dataset.hidden).toBeUndefined()
    // the type chip stays quiet even on a changed part: the slot caption names the doc once
    expect(node(container, 'alice.card.title@type').dataset.hidden).toBe('')
    expect(node(container, 'alice.card.labels[ui]@tags').dataset.hidden).toBeUndefined()
    expect(node(container, 'alice.card.labels[bug]@tags').dataset.hidden).toBe('')
    expect(node(container, 'alice.card.items[alice:1].text@ts').dataset.hidden).toBeUndefined()
    expect(node(container, 'alice.card.items[alice:1]@ts').dataset.hidden).toBe('')
  })

  it('shows the stamps of the direct children of a node that changed (a freshly added item)', () => {
    const frame = markedFrame({ changed: ['alice.card.items[alice:1]'] })
    const { container } = renderValue('alice.card', card, { frame })
    expect(node(container, 'alice.card.items[alice:1]@ts').dataset.hidden).toBeUndefined()
    expect(node(container, 'alice.card.items[alice:1].text@ts').dataset.hidden).toBeUndefined()
    expect(node(container, 'alice.card.title@ts').dataset.hidden).toBe('')
  })

  it('a mark on a badge path shows that badge alone — type chips and tags included', () => {
    const frame = markedFrame({
      highlight: [{ path: 'alice.card.title@type' }, { path: 'alice.card.labels[bug]@tags' }],
    })
    const { container } = renderValue('alice.card', card, { frame })
    const type = node(container, 'alice.card.title@type')
    expect(type.dataset.hidden).toBeUndefined()
    expect(type.dataset.highlight).toBe('change')
    expect(type.textContent).toBe('LWW')
    expect(node(container, 'alice.card.title@ts').dataset.hidden).toBe('')
    expect(node(container, 'alice.card.labels[bug]@tags').dataset.hidden).toBeUndefined()
    expect(node(container, 'alice.card.labels[ui]@tags').dataset.hidden).toBe('')
  })

  it('an atomic slot (no typed parts) keeps its sidecar', () => {
    const atomic: Value = {
      kind: 'set',
      meta: { type: 'or-set' },
      items: [{ id: 'bug', value: s('bug', { tags: [{ tag: 'bob:1', alive: true }] }) }],
    }
    const { container } = renderValue('alice.labels', atomic)
    expect(node(container, 'alice.labels@type').dataset.hidden).toBeUndefined()
    expect(node(container, 'alice.labels[bug]@tags').dataset.hidden).toBeUndefined()
  })
})
