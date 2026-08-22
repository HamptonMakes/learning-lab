import { cleanup } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { Value } from '@/lesson/types'
import { markedFrame, node, renderValue, s } from './test-helpers'

afterEach(cleanup)

const table: Value = {
  kind: 'table',
  columns: [
    { key: 'how', label: 'How it merges' },
    { key: 'use', label: 'Use it for' },
  ],
  rows: [
    { id: 'r1', cells: { how: s('replaces'), use: s('LWW register') } },
    { id: 'r2', cells: { how: s('adds') } },
  ],
}

describe('Table', () => {
  it('renders header columns, rows and cells as nodes with their paths', () => {
    const { container } = renderValue('board.t', table)
    const root = node(container, 'board.t')
    expect(root.dataset.kind).toBe('table')
    expect(root.dataset.value).toBe('[{"how":"replaces","use":"LWW register"},{"how":"adds"}]')
    const col = node(container, 'board.t.use')
    expect(col.dataset.kind).toBe('column')
    expect(col.closest('th')).not.toBeNull()
    expect(col.textContent).toBe('Use it for')
    expect(col.dataset.value).toBe('["LWW register",null]')
    const row = node(container, 'board.t[r1]')
    expect(row.tagName).toBe('TR')
    expect(row.dataset.kind).toBe('row')
    expect(row.dataset.value).toBe('{"how":"replaces","use":"LWW register"}')
    expect(node(container, 'board.t[r1].use').dataset.value).toBe('LWW register')
    expect(node(container, 'board.t[r2].how').dataset.kind).toBe('scalar')
    expect(container.querySelectorAll('tbody tr')).toHaveLength(2)
    expect(container.querySelectorAll('tbody td')).toHaveLength(4)
  })

  it('highlights a row with an outline (tr has no overlay) and a cell with a ring', () => {
    const frame = markedFrame({
      highlight: [
        { path: 'board.t[r1]', tone: 'ok' },
        { path: 'board.t[r1].use', tone: 'warn' },
      ],
    })
    const { container } = renderValue('board.t', table, { frame })
    const row = node(container, 'board.t[r1]')
    expect(row.dataset.highlight).toBe('ok')
    expect(row.className).toContain('outline-2')
    expect(row.querySelector(':scope > [data-highlight-ring]')).toBeNull()
    const cell = node(container, 'board.t[r1].use')
    expect(cell.dataset.highlight).toBe('warn')
    expect(cell.querySelector('[data-highlight-ring]')).not.toBeNull()
  })

  it('renders meta on the table and on cells', () => {
    const v: Value = {
      ...table,
      meta: { note: 'simplified' },
      rows: [{ id: 'r1', cells: { how: s('x', { ts: 4, node: 'server' }) } }],
    } as Value
    const { container } = renderValue('board.t', v)
    expect(node(container, 'board.t@note').dataset.value).toBe('simplified')
    expect(node(container, 'board.t[r1].how@node').dataset.value).toBe('server')
  })
})
