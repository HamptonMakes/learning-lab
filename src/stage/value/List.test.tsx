import { cleanup } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { Item, Value } from '@/lesson/types'
import { visibleItems } from './visible'
import { node, nodes, renderValue, s } from './test-helpers'

afterEach(cleanup)

const items = (ids: string[]): Item[] => ids.map((id) => ({ id, value: s(id) }))

describe('List', () => {
  it('renders row / column displays with one node per item at `${path}[${id}]`', () => {
    for (const display of ['row', 'column'] as const) {
      const v: Value = { kind: 'list', display, items: items(['bread', 'milk']) }
      const { container, unmount } = renderValue('alice.list', v)
      const root = node(container, 'alice.list')
      expect(root.dataset.kind).toBe('list')
      expect(root.dataset.display).toBe(display)
      expect(root.dataset.value).toBe('["bread","milk"]')
      expect(node(container, 'alice.list[bread]').dataset.value).toBe('bread')
      expect(node(container, 'alice.list[milk]').dataset.kind).toBe('scalar')
      expect(container.querySelector('ul')?.dataset.orientation).toBe(display)
      unmount()
    }
  })

  it('shows ≤ 8 live items plus a +n chip; tombstones stay (struck) and do not count', () => {
    const live = items(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'])
    const dead: Item = { id: 'z', value: s('z', { tombstone: true }) }
    const all = [dead, ...live]
    expect(visibleItems(all).shown.map((i) => i.id)).toEqual([
      'z',
      'a',
      'b',
      'c',
      'd',
      'e',
      'f',
      'g',
      'h',
    ])
    expect(visibleItems(all).overflow).toBe(2)
    const { container } = renderValue('alice.list', { kind: 'list', items: all })
    expect(container.querySelectorAll('[data-item]')).toHaveLength(9)
    expect(container.querySelector<HTMLElement>('[data-overflow]')?.dataset.overflow).toBe('2')
    expect(container.querySelector('[data-overflow]')?.textContent).toBe('+2')
    expect(node(container, 'alice.list[z]').dataset.tombstone).toBe('true')
    expect(nodes(container, 'alice.list[j]')).toHaveLength(0)
    expect(node(container, 'alice.list').dataset.value).toBe(
      '["a","b","c","d","e","f","g","h","i","j"]',
    )
  })

  it('renders the text display: one character per item, id beneath, data-value = id, inside an LTR island', () => {
    const v: Value = {
      kind: 'list',
      display: 'text',
      meta: { stats: { stored: 4, visible: 3 }, vc: { alice: 3, bob: 1 } },
      items: [
        { id: 'alice:1', value: s('c', { ts: 1, node: 'alice' }) },
        { id: 'alice:2', value: s('a', { ts: 2, node: 'alice', tombstone: true }) },
        { id: 'bob:1', value: s(' ', { ts: 3, node: 'bob' }) },
        { id: 'alice:3', value: s('t', { ts: 4, node: 'alice' }) },
      ],
    }
    const { container } = renderValue('alice.text', v, { dir: 'rtl' })
    const root = node(container, 'alice.text')
    expect(root.dataset.display).toBe('text')
    expect(root.dataset.value).toBe('c t')
    const c = node(container, 'alice.text[alice:1]')
    expect(c.dataset.value).toBe('alice:1')
    expect(c.dataset.char).toBe('c')
    expect(c.textContent).toBe('c')
    expect(node(container, 'alice.text[alice:2]').dataset.tombstone).toBe('true')
    expect(node(container, 'alice.text[bob:1]').textContent).toBe('␣')
    expect(container.querySelector('[data-item="alice:3"]')?.textContent).toContain('alice:3')
    expect(root.querySelector('bdi[dir="ltr"]')).not.toBeNull()
    expect(node(container, 'alice.text@stats').dataset.value).toBe('3/4')
    expect(node(container, 'alice.text@vc').dataset.value).toBe('alice3 bob1')
  })

  it('renders meta on items: OR-Set style tags via the item badges', () => {
    const v: Value = {
      kind: 'list',
      items: [{ id: 'milk', value: s('milk', { tag: 'alice:1', ts: 1, node: 'alice' }) }],
    }
    const { container } = renderValue('alice.list', v)
    expect(node(container, 'alice.list[milk]@tag').dataset.value).toBe('alice:1')
    expect(node(container, 'alice.list[milk]@ts').dataset.value).toBe('t1')
  })
})
