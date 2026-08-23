import { describe, expect, it } from 'vitest'
import { parentPath, slotRootOf } from './paths'

describe('parentPath', () => {
  it('strips the last field / item segment', () => {
    expect(parentPath('alice.doc.title')).toBe('alice.doc')
    expect(parentPath('alice.cart[milk]')).toBe('alice.cart')
    expect(parentPath('alice.cart[milk].qty')).toBe('alice.cart[milk]')
    expect(parentPath('alice.list[a.b]')).toBe('alice.list')
    expect(parentPath('alice.doc.title@ts')).toBe('alice.doc')
    expect(parentPath('board.schema.events')).toBe('board.schema')
    expect(parentPath('alice.doc')).toBe('alice')
  })

  it('is undefined for a root', () => {
    expect(parentPath('alice')).toBeUndefined()
    expect(parentPath('board.schema')).toBeUndefined()
    expect(parentPath('msg:m1')).toBeUndefined()
  })
})

describe('slotRootOf', () => {
  it('names the slot a path lives in; a bare root is its own', () => {
    expect(slotRootOf('alice.cart[milk]@tags')).toBe('alice.cart')
    expect(slotRootOf('alice.cart[milk].qty[alice]')).toBe('alice.cart')
    expect(slotRootOf('alice.doc.title')).toBe('alice.doc')
    expect(slotRootOf('alice.doc')).toBe('alice.doc')
    expect(slotRootOf('board.t[r1].use')).toBe('board.t')
    expect(slotRootOf('alice')).toBe('alice')
    expect(slotRootOf('alice@outbox')).toBe('alice')
  })
})
