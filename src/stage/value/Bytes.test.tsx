import { cleanup } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { Value } from '@/lesson/types'
import { markedFrame, node, nodes, renderValue } from './test-helpers'

afterEach(cleanup)

const UUID = [
  0x01, 0xa0, 0x28, 0xe9, 0xb5, 0x00, 0x74, 0x71, 0xad, 0x66, 0xc0, 0x15, 0x8a, 0xf3, 0x41, 0x02,
]
const bytes = (over: Partial<Extract<Value, { kind: 'bytes' }>> = {}): Value => ({
  kind: 'bytes',
  bytes: UUID,
  display: 'hex',
  annotations: [],
  ...over,
})

describe('Bytes', () => {
  it('renders hex: one cell per byte at `${path}[${i}]`, 16 per row, hex data-values, LTR island', () => {
    const { container } = renderValue('laptop.id', bytes(), { dir: 'rtl' })
    const root = node(container, 'laptop.id')
    expect(root.dataset.kind).toBe('bytes')
    expect(root.dataset.display).toBe('hex')
    expect(root.dataset.value).toBe('01a028e9b5007471ad66c0158af34102')
    expect(container.querySelectorAll('[data-byte-row]')).toHaveLength(1)
    const b6 = node(container, 'laptop.id[6]')
    expect(b6.dataset.kind).toBe('byte')
    expect(b6.dataset.value).toBe('74')
    expect(b6.dataset.index).toBe('6')
    expect(b6.textContent).toBe('74')
    expect(b6.getAttribute('title')).toBe('byte 6: 0x74 = 116 = 0111 0100')
    expect(nodes(container, 'laptop.id[15]')).toHaveLength(1)
    expect(root.querySelector('bdi[dir="ltr"]')).not.toBeNull()
  })

  it('renders bits with a range expanded inline (exact bits over expanded bytes) and 4 per row without', () => {
    const { container } = renderValue(
      'laptop.id',
      bytes({
        display: 'bits',
        range: [6, 9],
        annotations: [
          { from: 48, to: 52, unit: 'bit', label: 'version = 7' },
          { from: 64, to: 66, unit: 'bit', label: 'variant = 10' },
        ],
      }),
    )
    const b6 = node(container, 'laptop.id[6]')
    expect(b6.dataset.expanded).toBe('true')
    expect(b6.textContent).toBe('01110100')
    expect(b6.querySelectorAll('[data-bit]')).toHaveLength(8)
    expect(node(container, 'laptop.id[5]').dataset.expanded).toBeUndefined()
    expect(node(container, 'laptop.id[5]').textContent).toBe('00')
    const ver = container.querySelector<HTMLElement>('[data-annotation="a0"]')
    expect(ver?.dataset.snapped).toBeUndefined()
    expect(ver?.style.gridColumn).toBe('13 / 17') // byte 6 starts at col 12 (0-based)
    const variant = container.querySelector<HTMLElement>('[data-annotation="a1"]')
    expect(variant?.style.gridColumn).toBe('29 / 31')
    expect(variant?.dataset.snapped).toBeUndefined()

    const all = renderValue('x.b', bytes({ display: 'bits' }))
    expect(all.container.querySelectorAll('[data-byte-row]')).toHaveLength(4)
    all.unmount()
  })

  it('snaps bit annotations to nibbles over collapsed bytes and lanes the overlap deterministically', () => {
    const { container } = renderValue(
      'laptop.id',
      bytes({
        annotations: [
          { id: 'var', from: 64, to: 66, unit: 'bit', label: 'variant = 10' },
          { id: 'rand2', from: 66, to: 128, unit: 'bit', label: 'random', tone: 'info' },
          { id: 'time', from: 0, to: 6, label: 'unix ms', tone: 'change' },
        ],
      }),
    )
    const variant = container.querySelector<HTMLElement>('[data-annotation="var"]')
    expect(variant?.dataset.snapped).toBe('true')
    expect(variant?.dataset.unit).toBe('bit')
    expect(variant?.getAttribute('title')).toBe('variant = 10 · bits 64–66 · drawn to the nibble')
    expect(variant?.style.gridColumn).toBe('17 / 18') // nibble 16 only
    const rand = container.querySelector<HTMLElement>('[data-annotation="rand2"]')
    expect(rand?.style.gridColumn).toBe('17 / 33') // nibbles 16..31
    expect(rand?.dataset.lane).not.toBe(variant?.dataset.lane)
    expect(rand?.dataset.lane).toBe('0') // 'rand2' sorts before 'var' at the same from
    expect(variant?.dataset.lane).toBe('1')
    const time = container.querySelector<HTMLElement>('[data-annotation="time"]')
    expect(time?.dataset.unit).toBe('byte')
    expect(time?.dataset.path).toBe('laptop.id[0..6]')
    expect(time?.dataset.lane).toBe('0')
    expect(time?.style.gridColumn).toBe('1 / 13')
    expect(time?.textContent).toBe('unix ms')
  })

  it('renders canonical 8-4-4-4-12 with hyphens and dec cells', () => {
    const { container } = renderValue('laptop.id', bytes({ display: 'canonical' }))
    const row = container.querySelector('[data-byte-row]')
    expect(row?.textContent).toBe('01a028e9-b500-7471-ad66-c0158af34102')
    expect(node(container, 'laptop.id[4]').style.gridColumn).toBe('10 / span 2')
    const dec = renderValue('x.b', bytes({ display: 'dec', bytes: [0, 255, 7] }))
    expect(node(dec.container, 'x.b[1]').textContent).toBe('255')
    expect(node(dec.container, 'x.b[1]').dataset.value).toBe('ff')
    expect(node(dec.container, 'x.b').dataset.value).toBe('00ff07')
    dec.unmount()
  })

  it('draws a range node for `[a..b]` paths that marks point at, and highlights bytes', () => {
    const frame = markedFrame({
      highlight: [
        { path: 'laptop.id[6]', tone: 'change' },
        { path: 'laptop.id[0..6]', tone: 'info' },
      ],
    })
    const { container } = renderValue('laptop.id', bytes(), { frame })
    expect(node(container, 'laptop.id[6]').dataset.highlight).toBe('change')
    const range = node(container, 'laptop.id[0..6]')
    expect(range.dataset.kind).toBe('range')
    expect(range.dataset.value).toBe('01a028e9b500')
    expect(range.dataset.highlight).toBe('info')
    expect(range.style.gridColumn).toBe('1 / 13')
  })

  it('renders meta badges on the bytes node', () => {
    const { container } = renderValue('laptop.id', bytes({ meta: { note: 'v7' } }))
    expect(node(container, 'laptop.id@note').dataset.value).toBe('v7')
  })
})
