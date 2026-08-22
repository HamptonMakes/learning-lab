import { beforeEach, describe, expect, it } from 'vitest'
import { z } from 'zod'
import { createLocalStore } from './store'
import { recordStep, progressStore, topicKey } from './progress'

const Schema = z.object({ a: z.number().default(1), b: z.string().default('x') })

describe('createLocalStore', () => {
  beforeEach(() => localStorage.clear())

  it('returns defaults when nothing is stored', () => {
    const s = createLocalStore('t:1', Schema, { a: 1, b: 'x' })
    expect(s.get()).toEqual({ a: 1, b: 'x' })
  })

  it('persists and patches', () => {
    const s = createLocalStore('t:2', Schema, { a: 1, b: 'x' })
    s.patch({ a: 5 })
    expect(JSON.parse(localStorage.getItem('t:2') ?? '{}')).toEqual({ a: 5, b: 'x' })
    expect(s.get().a).toBe(5)
  })

  it('falls back to defaults on corrupt or invalid data', () => {
    localStorage.setItem('t:3', '{not json')
    const s = createLocalStore('t:3', Schema, { a: 1, b: 'x' })
    expect(s.get()).toEqual({ a: 1, b: 'x' })
    localStorage.setItem('t:4', JSON.stringify({ a: 'nope' }))
    const s4 = createLocalStore('t:4', Schema, { a: 1, b: 'x' })
    expect(s4.get()).toEqual({ a: 1, b: 'x' })
  })

  it('notifies subscribers', () => {
    const s = createLocalStore('t:5', Schema, { a: 1, b: 'x' })
    let calls = 0
    const off = s.subscribe(() => calls++)
    s.patch({ b: 'y' })
    off()
    s.patch({ b: 'z' })
    expect(calls).toBe(1)
  })
})

describe('progress', () => {
  beforeEach(() => {
    localStorage.clear()
    progressStore.reset()
  })

  it('records furthest step and completion', () => {
    const key = topicKey('crdts', 'unit-1', 'topic-a')
    recordStep(key, 2, 5)
    expect(progressStore.get().topics[key]?.lastStep).toBe(2)
    expect(progressStore.get().topics[key]?.completed).toBe(false)
    recordStep(key, 1, 5)
    expect(progressStore.get().topics[key]?.lastStep).toBe(2)
    recordStep(key, 4, 5)
    expect(progressStore.get().topics[key]?.completed).toBe(true)
  })
})
