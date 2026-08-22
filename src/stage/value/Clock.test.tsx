import { cleanup } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { Value } from '@/lesson/types'
import { node, renderValue } from './test-helpers'

afterEach(cleanup)

describe('Clock', () => {
  it('renders entries as `${path}.${node}` nodes inside an LTR island, compact data-value on the clock', () => {
    const v: Value = { kind: 'clock', entries: { alice: 2, bob: 1, carol: 0 } }
    const { container } = renderValue('alice.vc', v, { dir: 'rtl' })
    const root = node(container, 'alice.vc')
    expect(root.dataset.kind).toBe('clock')
    expect(root.dataset.value).toBe('alice2 bob1 carol0')
    expect(root.getAttribute('title')).toBe('alice: 2, bob: 1, carol: 0')
    expect(node(container, 'alice.vc.alice').dataset.kind).toBe('entry')
    expect(node(container, 'alice.vc.alice').dataset.value).toBe('2')
    expect(node(container, 'alice.vc.bob').textContent).toContain('bob')
    expect(node(container, 'alice.vc.bob').textContent).toContain('1')
    expect(root.querySelector('bdi[dir="ltr"]')).not.toBeNull()
    expect(root.querySelectorAll('[data-node]')).toHaveLength(3)
  })

  it('renders meta badges on the clock node', () => {
    const v: Value = {
      kind: 'clock',
      entries: { alice: 1 },
      meta: { type: 'vector-clock', note: 'join = max per node' },
    }
    const { container } = renderValue('bob.vc', v)
    expect(node(container, 'bob.vc@type').textContent).toBe('Vector clock')
    expect(node(container, 'bob.vc@note').dataset.value).toBe('join = max per node')
  })
})
