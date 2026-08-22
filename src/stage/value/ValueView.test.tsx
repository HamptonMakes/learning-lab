import { cleanup } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { Value } from '@/lesson/types'
import { deriveStageFrame } from '../StageContext'
import {
  forbiddenMotionClasses,
  makeFrame,
  markedFrame,
  node,
  renderValue,
  s,
} from './test-helpers'

afterEach(cleanup)

const every: Array<[string, Value, string]> = [
  ['scalar', s('Lunch'), 'Lunch'],
  ['record', { kind: 'record', fields: [{ key: 'title', value: s('Q3') }] }, '{"title":"Q3"}'],
  ['list', { kind: 'list', items: [{ id: 'milk', value: s('milk') }] }, '["milk"]'],
  ['set', { kind: 'set', items: [{ id: 'a', value: s('a') }] }, '["a"]'],
  ['counter', { kind: 'counter', rows: [{ node: 'alice', inc: 2 }], total: 2 }, '2'],
  ['clock', { kind: 'clock', entries: { alice: 2, bob: 1 } }, 'alice2 bob1'],
  [
    'table',
    {
      kind: 'table',
      columns: [{ key: 'how', label: 'How' }],
      rows: [{ id: 'r1', cells: { how: s('x') } }],
    },
    '[{"how":"x"}]',
  ],
  ['bytes', { kind: 'bytes', bytes: [1, 160], display: 'hex', annotations: [] }, '01a0'],
  ['text', { kind: 'text', text: 'the cat', annotations: [] }, 'the cat'],
  ['pattern', { kind: 'pattern', tokens: [{ id: 'p0', src: 'a+', kind: 'quant' }] }, 'a+'],
  ['meter', { kind: 'meter', value: 6, max: 24, label: 'tries' }, '6'],
]

describe('ValueView (dispatcher + DOM contract)', () => {
  it('renders every kind with data-path / data-kind / data-value', () => {
    for (const [kind, value, dataValue] of every) {
      const { container, unmount } = renderValue('alice.v', value)
      const el = node(container, 'alice.v')
      expect(el.dataset.kind).toBe(kind)
      expect(el.dataset.value).toBe(dataValue)
      expect(el.dataset.highlight).toBeUndefined()
      expect(el.dataset.tombstone).toBeUndefined()
      unmount()
    }
  })

  it('never leaks CSS transition / animation utilities into the stage', () => {
    for (const [, value] of every) {
      const { container, unmount } = renderValue('alice.v', value, { off: false })
      expect(forbiddenMotionClasses(container)).toEqual([])
      unmount()
    }
  })

  it('marks tombstones and draws highlight tone, check / cross glyphs, via chips and changed flags on the node', () => {
    const frame = markedFrame({
      highlight: [
        { path: 'alice.doc.title', tone: 'warn' },
        { path: 'alice.doc', tone: 'ok' },
      ],
      check: ['alice.doc.title'],
      cross: ['alice.doc.owner'],
      changed: ['alice.doc.owner'],
      via: { path: 'alice.doc', from: 'bob', message: 'm7' },
    })
    const value: Value = {
      kind: 'record',
      fields: [
        { key: 'title', value: s('Q3', { ts: 2, node: 'bob' }) },
        { key: 'owner', value: s('Bob', { tombstone: true }) },
      ],
    }
    const { container } = renderValue('alice.doc', value, { frame })
    const doc = node(container, 'alice.doc')
    expect(doc.dataset.highlight).toBe('ok')
    expect(doc.querySelector('[data-highlight-ring]')).not.toBeNull()
    const via = doc.querySelector<HTMLElement>('[data-via]')
    expect(via?.dataset.via).toBe('bob')
    expect(via?.dataset.viaMessage).toBe('m7')
    expect(via?.textContent).toBe('B')
    expect(via?.getAttribute('title')).toBe('from Bob')

    const title = node(container, 'alice.doc.title')
    expect(title.dataset.highlight).toBe('warn')
    expect(title.dataset.value).toBe('Q3')
    const check = title.querySelector<HTMLElement>('[data-mark-kind="check"]')
    expect(check).not.toBeNull()
    expect(check?.dataset.mark).toBe('k3')

    const owner = node(container, 'alice.doc.owner')
    expect(owner.dataset.tombstone).toBe('true')
    expect(owner.dataset.changed).toBe('true')
    expect(owner.querySelector('[data-mark-kind="cross"]')).not.toBeNull()
    expect(owner.dataset.highlight).toBeUndefined()
  })

  it('uses the strongest highlight tone on a path and re-keys the ring per mark id', () => {
    const frame = makeFrame({
      marks: [
        { id: 'k1', kind: 'highlight', paths: ['alice.v'], tone: 'info' },
        { id: 'k2', kind: 'highlight', paths: ['alice.v'], tone: 'danger', sticky: true },
      ],
    })
    expect(deriveStageFrame(frame).highlightOf('alice.v')?.tone).toBe('danger')
    const { container } = renderValue('alice.v', s(1), { frame })
    expect(node(container, 'alice.v').dataset.highlight).toBe('danger')
  })

  it('renders LTR islands for bytes, text, pattern, text lists, Dot ids and clocks in an RTL stage', () => {
    const values: Value[] = [
      { kind: 'bytes', bytes: [1], display: 'hex', annotations: [] },
      { kind: 'text', text: 'ab', annotations: [] },
      { kind: 'pattern', tokens: [{ id: 'p0', src: 'a', kind: 'literal' }] },
      { kind: 'list', display: 'text', items: [{ id: 'alice:1', value: s('a') }] },
      { kind: 'clock', entries: { alice: 1 } },
      s('x', { tag: 'alice:3' }),
    ]
    for (const value of values) {
      const { container, unmount } = renderValue('alice.v', value, { dir: 'rtl' })
      expect(container.querySelector('bdi[dir="ltr"]')).not.toBeNull()
      unmount()
    }
  })

  it('keeps rendering at rest with motion on (enter animations finish instantly under skipAnimations)', () => {
    const { container } = renderValue(
      'alice.v',
      { kind: 'list', items: [{ id: 'a', value: s('a') }] },
      { off: false },
    )
    expect(node(container, 'alice.v[a]').dataset.value).toBe('a')
  })
})
