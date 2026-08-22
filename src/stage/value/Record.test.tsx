import { cleanup } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { Value } from '@/lesson/types'
import { node, renderValue, s } from './test-helpers'

afterEach(cleanup)

describe('Record', () => {
  const rec: Value = {
    kind: 'record',
    fields: [
      { key: 'title', value: s('Q3 plan') },
      { key: 'owner', value: s('Bob') },
      { key: 'tags', value: { kind: 'list', items: [{ id: 'x', value: s('x') }] } },
    ],
  }

  it('renders card rows: each field is a node at `${path}.${key}`', () => {
    const { container } = renderValue('alice.doc', rec)
    const root = node(container, 'alice.doc')
    expect(root.dataset.kind).toBe('record')
    expect(root.dataset.display).toBe('card')
    expect(root.dataset.value).toBe('{"title":"Q3 plan","owner":"Bob","tags":["x"]}')
    expect(node(container, 'alice.doc.title').dataset.value).toBe('Q3 plan')
    expect(node(container, 'alice.doc.owner').dataset.kind).toBe('scalar')
    expect(node(container, 'alice.doc.tags[x]').dataset.value).toBe('x')
    expect(container.querySelectorAll('[data-field]')).toHaveLength(3)
    expect(container.querySelector('[data-field="title"]')?.textContent).toContain('title')
  })

  it('renders a tree with nested records inheriting the tree display', () => {
    const tree: Value = {
      kind: 'record',
      display: 'tree',
      fields: [
        { key: 'events', value: { kind: 'record', fields: [{ key: 'price', value: s(3) }] } },
        { key: 'n', value: s(1) },
      ],
    }
    const { container } = renderValue('board.schema', tree)
    expect(node(container, 'board.schema').dataset.display).toBe('tree')
    expect(node(container, 'board.schema.events').dataset.display).toBe('tree')
    expect(node(container, 'board.schema.events.price').dataset.value).toBe('3')
  })

  it('renders meta: per-field LWW stamps (lww-map) and a root type chip', () => {
    const v: Value = {
      kind: 'record',
      meta: { type: 'lww-map', vc: { alice: 2, bob: 0 } },
      fields: [
        { key: 'status', value: s('Doing', { ts: 3, node: 'bob' }) },
        { key: 'due', value: s('Fri', { ts: 1, node: 'alice', tombstone: true }) },
      ],
    }
    const { container } = renderValue('bob.task', v)
    expect(node(container, 'bob.task@type').textContent).toBe('LWW map')
    expect(node(container, 'bob.task@vc').dataset.value).toBe('alice2 bob0')
    expect(node(container, 'bob.task.status@ts').dataset.value).toBe('t=3')
    expect(node(container, 'bob.task.status@node').dataset.value).toBe('bob')
    expect(node(container, 'bob.task.due').dataset.tombstone).toBe('true')
    expect(node(container, 'bob.task.due@tomb')).toBeTruthy()
    // a tombstoned field keeps its value in the plain record (only list / set items drop out)
    expect(node(container, 'bob.task').dataset.value).toBe('{"status":"Doing","due":"Fri"}')
  })
})
