import { cleanup } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { Value } from '@/lesson/types'
import { node, renderValue } from './test-helpers'

afterEach(cleanup)

const pattern: Value = {
  kind: 'pattern',
  cursor: 1,
  tokens: [
    { id: 'p0', src: '^', kind: 'anchor', label: 'start of input' },
    { id: 'p1', src: 'a', kind: 'literal' },
    { id: 'p2', src: '.*', kind: 'quant', label: 'any, greedy' },
    { id: 'p3', src: '[xy]', kind: 'class' },
  ],
}

describe('Pattern', () => {
  it('renders tokens as chips at `${path}[${id}]` with data-value = src, the cursor token emphasised', () => {
    const { container } = renderValue('matcher.pattern', pattern, { dir: 'rtl' })
    const root = node(container, 'matcher.pattern')
    expect(root.dataset.kind).toBe('pattern')
    expect(root.dataset.value).toBe('^a.*[xy]')
    expect(root.dataset.cursor).toBe('1')
    expect(root.querySelector('bdi[dir="ltr"]')).not.toBeNull()
    const p2 = node(container, 'matcher.pattern[p2]')
    expect(p2.dataset.kind).toBe('token')
    expect(p2.dataset.value).toBe('.*')
    expect(p2.dataset.tokenKind).toBe('quant')
    expect(p2.getAttribute('title')).toBe('any, greedy')
    const p1 = node(container, 'matcher.pattern[p1]')
    expect(p1.dataset.current).toBe('true')
    expect(node(container, 'matcher.pattern[p0]').dataset.current).toBeUndefined()
    const caret = node(container, 'matcher.pattern@cursor')
    expect(caret.dataset.value).toBe('1')
    // caret precedes the current token
    expect(caret.compareDocumentPosition(p1) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('puts the caret after the last token when the cursor is past the end, and none without a cursor', () => {
    const { container } = renderValue('m.p', { ...pattern, cursor: 4 } as Value)
    const caret = node(container, 'm.p@cursor')
    const p3 = node(container, 'm.p[p3]')
    expect(p3.compareDocumentPosition(caret) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    const none = renderValue('m.q', {
      kind: 'pattern',
      tokens: pattern.kind === 'pattern' ? pattern.tokens : [],
    })
    expect(none.container.querySelector('[data-kind="cursor"]')).toBeNull()
    none.unmount()
  })

  it('renders meta badges on the pattern', () => {
    const { container } = renderValue('m.p', { ...pattern, meta: { note: 'greedy' } } as Value)
    expect(node(container, 'm.p@note').dataset.value).toBe('greedy')
  })
})
