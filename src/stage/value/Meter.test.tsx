import { cleanup } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { node, renderValue } from './test-helpers'

afterEach(cleanup)

describe('Meter', () => {
  it('renders label, value / max, an accessible meter and a Motion-driven bar', () => {
    const { container } = renderValue('matcher.tries', {
      kind: 'meter',
      value: 6,
      max: 24,
      label: 'tries',
    })
    const root = node(container, 'matcher.tries')
    expect(root.dataset.kind).toBe('meter')
    expect(root.dataset.value).toBe('6')
    expect(root.dataset.max).toBe('24')
    expect(root.textContent).toContain('tries')
    expect(root.textContent).toContain('6')
    expect(root.textContent).toContain('/ 24')
    const meter = root.querySelector('meter')
    expect(meter?.getAttribute('value')).toBe('6')
    expect(meter?.getAttribute('max')).toBe('24')
    expect(meter?.getAttribute('aria-label')).toBe('tries')
    const bar = root.querySelector<HTMLElement>('[data-meter-bar]')
    expect(bar?.style.width).toBe('25%')
    expect(bar?.className).not.toMatch(/transition/)
  })

  it('renders a tone and meta, and copes with no max / zero', () => {
    const { container } = renderValue('a.m', {
      kind: 'meter',
      value: 0,
      tone: 'danger',
      meta: { note: 'n' },
    })
    const root = node(container, 'a.m')
    expect(root.style.getPropertyValue('--tone')).toBe('var(--danger)')
    expect(root.querySelector<HTMLElement>('[data-meter-bar]')?.style.width).toBe('0%')
    expect(node(container, 'a.m@note').dataset.value).toBe('n')
  })
})
