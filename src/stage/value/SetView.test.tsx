import { cleanup } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { Value } from '@/lesson/types'
import { node, renderValue, s } from './test-helpers'

afterEach(cleanup)

describe('SetView', () => {
  it('renders elements as pills at `${path}[${id}]` with a sorted plain data-value', () => {
    const v: Value = {
      kind: 'set',
      items: [
        { id: 'milk', value: s('milk') },
        { id: 'eggs', value: s('eggs') },
      ],
    }
    const { container } = renderValue('alice.cart', v)
    const root = node(container, 'alice.cart')
    expect(root.dataset.kind).toBe('set')
    expect(root.dataset.value).toBe('["eggs","milk"]')
    expect(node(container, 'alice.cart[milk]').dataset.value).toBe('milk')
    expect(node(container, 'alice.cart[eggs]').dataset.kind).toBe('scalar')
    expect(container.querySelectorAll('[data-item]')).toHaveLength(2)
  })

  it('renders meta: OR-Set tags (alive / dead, ≤ 3 + n), tombstone, LWW-set add / remove stamps', () => {
    const v: Value = {
      kind: 'set',
      meta: { type: 'or-set' },
      items: [
        {
          id: 'milk',
          value: s('milk', {
            tags: [
              { tag: 'alice:1', alive: false },
              { tag: 'alice:2', alive: true },
              { tag: 'bob:1', alive: true },
              { tag: 'bob:2', alive: true },
            ],
          }),
        },
        { id: 'jazz', value: s('jazz', { addTs: 1, removeTs: 2, tombstone: true }) },
      ],
    }
    const { container } = renderValue('bob.cart', v)
    expect(node(container, 'bob.cart@type').textContent).toBe('OR-Set')
    const tags = node(container, 'bob.cart[milk]@tags')
    expect(tags.dataset.kind).toBe('meta')
    expect(tags.dataset.value).toBe(
      '[{"tag":"alice:1","alive":false},{"tag":"alice:2","alive":true},{"tag":"bob:1","alive":true},{"tag":"bob:2","alive":true}]',
    )
    const pills = Array.from(tags.querySelectorAll<HTMLElement>('[data-tag]'))
    expect(pills.map((p) => p.dataset.tag)).toEqual(['alice:1', 'alice:2', 'bob:1'])
    expect(pills[0]?.dataset.alive).toBe('false')
    expect(pills[0]?.getAttribute('dir')).toBe('ltr')
    expect(pills[1]?.dataset.alive).toBe('true')
    expect(tags.querySelector<HTMLElement>('[data-overflow]')?.dataset.overflow).toBe('1')
    const jazz = node(container, 'bob.cart[jazz]')
    expect(jazz.dataset.tombstone).toBe('true')
    expect(node(container, 'bob.cart[jazz]@addTs').dataset.value).toBe('t1')
    expect(node(container, 'bob.cart[jazz]@removeTs').dataset.value).toBe('t2')
    expect(node(container, 'bob.cart[jazz]@tomb').textContent).toContain('deleted')
    // the plain set excludes the tombstone
    expect(node(container, 'bob.cart').dataset.value).toBe('["milk"]')
  })
})
