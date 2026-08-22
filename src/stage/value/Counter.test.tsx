import { cleanup } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { Value } from '@/lesson/types'
import { node, nodes, renderValue } from './test-helpers'

afterEach(cleanup)

describe('Counter', () => {
  it('renders G-Counter rows per node with inc cells and a total', () => {
    const v: Value = {
      kind: 'counter',
      rows: [
        { node: 'alice', inc: 2 },
        { node: 'bob', inc: 1 },
        { node: 'seed', inc: 5 },
      ],
      total: 8,
    }
    const { container } = renderValue('alice.views', v)
    const root = node(container, 'alice.views')
    expect(root.dataset.kind).toBe('counter')
    expect(root.dataset.value).toBe('8')
    expect(node(container, 'alice.views[alice]').dataset.kind).toBe('row')
    expect(node(container, 'alice.views[alice]').dataset.value).toBe('{"inc":2}')
    expect(node(container, 'alice.views[alice]@inc').dataset.value).toBe('2')
    expect(node(container, 'alice.views[alice]@inc').textContent).toBe('+2')
    expect(node(container, 'alice.views[bob]@inc').dataset.kind).toBe('cell')
    expect(nodes(container, 'alice.views[alice]@dec')).toHaveLength(0)
    expect(node(container, 'alice.views[seed]').textContent).toContain('init')
    expect(container.querySelector('[data-total]')?.textContent).toBe('8')
    expect(container.querySelector('[data-node="alice"]')).not.toBeNull()
  })

  it('renders PN-Counter rows with dec cells at @dec', () => {
    const v: Value = {
      kind: 'counter',
      rows: [
        { node: 'alice', inc: 3, dec: 1 },
        { node: 'bob', inc: 0, dec: 2 },
      ],
      total: 0,
    }
    const { container } = renderValue('bob.likes', v)
    expect(node(container, 'bob.likes[alice]').dataset.value).toBe('{"inc":3,"dec":1}')
    expect(node(container, 'bob.likes[alice]@dec').dataset.value).toBe('1')
    expect(node(container, 'bob.likes[alice]@dec').textContent).toBe('−1')
    expect(node(container, 'bob.likes[bob]@dec').dataset.value).toBe('2')
    expect(node(container, 'bob.likes').dataset.value).toBe('0')
  })

  it('renders meta: exposed version vector and type chip on the counter', () => {
    const v: Value = {
      kind: 'counter',
      rows: [{ node: 'alice', inc: 1 }],
      total: 1,
      meta: { type: 'g-counter', vc: { bob: 0, alice: 1 } },
    }
    const { container } = renderValue('alice.views', v)
    expect(node(container, 'alice.views@type').textContent).toBe('G-Counter')
    // world actor order first: alice, then bob
    expect(node(container, 'alice.views@vc').dataset.value).toBe('alice1 bob0')
    expect(node(container, 'alice.views@vc').getAttribute('title')).toBe('version alice: 1, bob: 0')
  })
})
