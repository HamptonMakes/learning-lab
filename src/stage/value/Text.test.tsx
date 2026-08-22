import { cleanup } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { Value } from '@/lesson/types'
import { markedFrame, node, renderValue } from './test-helpers'

afterEach(cleanup)

describe('Text', () => {
  it('renders the text with its data-value inside an LTR island, and a caret at the cursor', () => {
    const v: Value = { kind: 'text', text: 'the cat sat', cursor: 4, annotations: [] }
    const { container } = renderValue('matcher.text', v, { dir: 'rtl' })
    const root = node(container, 'matcher.text')
    expect(root.dataset.kind).toBe('text')
    expect(root.dataset.value).toBe('the cat sat')
    expect(root.dataset.cursor).toBe('4')
    expect(root.querySelector('bdi[dir="ltr"]')).not.toBeNull()
    expect(root.querySelector('[data-text-body]')?.textContent).toBe('the cat sat')
    const caret = node(container, 'matcher.text@cursor')
    expect(caret.dataset.kind).toBe('cursor')
    expect(caret.dataset.value).toBe('4')
    expect(caret.getAttribute('title')).toBe('cursor at 4')
    // the caret sits between "the " and "cat"
    const body = root.querySelector('[data-text-body]')
    expect(body?.innerHTML.indexOf('the ')).toBeLessThan(
      body?.innerHTML.indexOf('data-kind="cursor"') ?? -1,
    )
  })

  it('draws annotations as underlays with tone, lane and label; overlapping ones take separate lanes', () => {
    const v: Value = {
      kind: 'text',
      text: 'the cat sat',
      annotations: [
        { id: 'fail', from: 0, to: 1, tone: 'danger', label: 'no match at 0' },
        { id: 'ok', from: 4, to: 7, tone: 'ok', label: 'consumed' },
        { id: 'greedy', from: 5, to: 7, tone: 'change', label: 'greedy' },
      ],
    }
    const { container } = renderValue('matcher.text', v)
    const fail = container.querySelector<HTMLElement>('[data-annotation="fail"]')
    expect(fail?.dataset.lane).toBe('0')
    expect(fail?.textContent).toContain('t')
    expect(fail?.textContent).toContain('no match at 0')
    const ok = container.querySelector<HTMLElement>('[data-annotation="ok"]')
    expect(ok?.dataset.lane).toBe('0')
    expect(ok?.dataset.from).toBe('4')
    expect(ok?.dataset.to).toBe('7')
    const greedy = container.querySelector<HTMLElement>('[data-annotation="greedy"]')
    expect(greedy?.dataset.lane).toBe('1')
    // greedy is nested inside ok (containment)
    expect(ok?.contains(greedy as Node)).toBe(true)
    expect(greedy?.style.getPropertyValue('--tone')).toBe('var(--accent)')
    expect(ok?.style.getPropertyValue('--tone')).toBe('var(--ok)')
    // the visible text is unchanged once the labels (drawn inside their wrappers) are removed
    const body = node(container, 'matcher.text').querySelector('[data-text-body]')
    const plain = (body?.textContent ?? '')
      .replace('no match at 0', '')
      .replace('consumed', '')
      .replace('greedy', '')
    expect(plain).toBe('the cat sat')
  })

  it('exposes `[a..b]` ranges that marks point at as nodes and highlights them', () => {
    const frame = markedFrame({ highlight: [{ path: 'matcher.text[4..7]', tone: 'warn' }] })
    const v: Value = { kind: 'text', text: 'the cat sat', cursor: 7, annotations: [] }
    const { container } = renderValue('matcher.text', v, { frame })
    const range = node(container, 'matcher.text[4..7]')
    expect(range.dataset.kind).toBe('range')
    expect(range.dataset.value).toBe('cat')
    expect(range.dataset.highlight).toBe('warn')
    expect(range.textContent).toBe('cat')
    // caret at 7 sits right after the range, not inside it
    expect(range.querySelector('[data-kind="cursor"]')).toBeNull()
    expect(node(container, 'matcher.text@cursor')).toBeTruthy()
  })

  it('renders an empty text as "" and meta badges (note boards)', () => {
    const { container } = renderValue('board.rule', {
      kind: 'text',
      text: '',
      annotations: [],
      meta: { note: 'law 1' },
    })
    expect(node(container, 'board.rule').dataset.value).toBe('')
    expect(node(container, 'board.rule').textContent).toContain('""')
    expect(node(container, 'board.rule@note').dataset.value).toBe('law 1')
  })
})
