import { cleanup } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { node, renderValue, s } from './test-helpers'

afterEach(cleanup)

describe('Scalar', () => {
  it('renders every kind of scalar with its canonical data-value', () => {
    const cases: Array<[string | number | boolean | null, string, string]> = [
      ['Lunch', 'Lunch', 'string'],
      [42, '42', 'number'],
      [true, 'true', 'boolean'],
      [null, 'null', 'null'],
      ['', '', 'string'],
    ]
    for (const [value, data, type] of cases) {
      const { container, unmount } = renderValue('alice.v', s(value))
      const el = node(container, 'alice.v')
      expect(el.dataset.kind).toBe('scalar')
      expect(el.dataset.value).toBe(data)
      expect(el.dataset.scalarType).toBe(type)
      expect(el.querySelector('bdi')?.textContent).toBe(value === '' ? '""' : data)
      unmount()
    }
  })

  it('middle-ellipsizes beyond 24 characters and keeps the full value in title / data-value', () => {
    const long = 'The quick brown fox jumps over the lazy dog'
    const { container } = renderValue('alice.v', s(long))
    const el = node(container, 'alice.v')
    expect(el.dataset.value).toBe(long)
    expect(el.getAttribute('title')).toBe(long)
    const shown = el.querySelector('bdi')?.textContent ?? ''
    expect(shown).toContain('…')
    expect(Array.from(shown).length).toBe(24)
  })

  it('renders meta: stamp, writer chip, tombstone (struck through) as addressable badges', () => {
    const { container } = renderValue(
      'alice.status',
      s('Offline', { ts: 0, node: 'seed', tombstone: true }),
    )
    expect(node(container, 'alice.status').dataset.tombstone).toBe('true')
    expect(node(container, 'alice.status@ts').dataset.value).toBe('t0')
    expect(node(container, 'alice.status@node').textContent).toBe('init')
    expect(node(container, 'alice.status@tomb').dataset.value).toBe('true')
    expect(node(container, 'alice.status').querySelector('bdi')?.className).toContain(
      'line-through',
    )
  })
})
