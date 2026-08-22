/**
 * useSandbox: run builds `x1, x2 …` steps through the real reducer from a lesson frame, undo and
 * reset rewind the history, a ReducerError is caught into `lastError`, and a new start frame
 * resets everything.
 */
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { crdt, tick } from '../builders'
import { lwwRegisterTopic } from '../fixtures'
import { plainValueAt } from '../path'
import { buildTimeline } from '../reducer/timeline'
import type { Frame } from '../types'
import { useSandbox } from './useSandbox'

const frames = buildTimeline(lwwRegisterTopic)
/** The frame after Alice set her status (s03): both replicas exist, the clock shows. */
const START: Frame = (() => {
  const f = frames.find((x) => x.step.id === 's03')
  if (!f) throw new Error('fixture frame s03 not found')
  return f
})()
const CTX = { sceneId: START.sceneId, topicId: 'lww-register' }

afterEach(cleanup)

describe('useSandbox', () => {
  it('starts on the given frame with an empty history', () => {
    const { result } = renderHook(() => useSandbox(START, CTX))
    expect(result.current.frame).toBe(START)
    expect(result.current.history).toEqual([START])
    expect(result.current.move).toBe('start')
    expect(result.current.canUndo).toBe(false)
    expect(result.current.lastError).toBeUndefined()
  })

  it('run applies the commands as one synthetic step and appends a frame', () => {
    const { result } = renderHook(() => useSandbox(START, CTX))
    let out: ReturnType<typeof result.current.run> | undefined
    act(() => {
      out = result.current.run(
        [tick(), crdt.update('alice', 'status', 'set', 'Hi')],
        'Alice says hi.',
      )
    })
    expect(out?.ok).toBe(true)
    const f = result.current.frame
    expect(f.index).toBe(START.index + 1)
    expect(f.sceneId).toBe(START.sceneId)
    expect(f.step).toEqual({
      id: 'x1',
      say: 'Alice says hi.',
      do: [
        { t: 'tick' },
        { t: 'crdt.update', actor: 'alice', slot: 'status', op: 'set', args: ['Hi'] },
      ],
    })
    expect(f.prev).toBe(START.world)
    expect(plainValueAt(f.world, 'alice.status')).toBe('Hi')
    expect(plainValueAt(START.world, 'alice.status')).toBe('In a meeting') // immutable
    expect(f.changes.some((c) => c.kind === 'value' && c.path === 'alice.status')).toBe(true)
    expect(result.current.history).toHaveLength(2)
    expect(result.current.move).toBe('run')
    expect(result.current.canUndo).toBe(true)

    act(() => {
      result.current.run([crdt.sync('alice', 'bob', 'status')], 'They sync.')
    })
    expect(result.current.frame.step.id).toBe('x2')
    expect(result.current.frame.index).toBe(START.index + 2)
    expect(plainValueAt(result.current.frame.world, 'bob.status')).toBe('Hi')
  })

  it('undo pops one frame, reset returns to the start; ids keep counting up', () => {
    const { result } = renderHook(() => useSandbox(START, CTX))
    act(() => {
      result.current.run([tick(), crdt.update('alice', 'status', 'set', 'A')], 'a')
      result.current.run([tick(), crdt.update('alice', 'status', 'set', 'B')], 'b')
    })
    expect(result.current.history).toHaveLength(3)
    act(() => result.current.undo())
    expect(result.current.move).toBe('undo')
    expect(result.current.frame.step.id).toBe('x1')
    expect(plainValueAt(result.current.frame.world, 'alice.status')).toBe('A')
    act(() => result.current.reset())
    expect(result.current.move).toBe('reset')
    expect(result.current.frame).toBe(START)
    expect(result.current.canUndo).toBe(false)
    act(() => result.current.undo()) // no-op at the start
    expect(result.current.frame).toBe(START)
    act(() => {
      result.current.run([crdt.update('alice', 'status', 'set', 'C')], 'c')
    })
    expect(result.current.frame.step.id).toBe('x3')
  })

  it('catches a ReducerError into lastError and leaves the history alone', () => {
    const { result } = renderHook(() => useSandbox(START, CTX))
    let out: ReturnType<typeof result.current.run> | undefined
    act(() => {
      out = result.current.run([crdt.update('alice', 'status', 'bogus', 1)], 'nope')
    })
    expect(out?.ok).toBe(false)
    expect(result.current.lastError).toMatch(/bogus/)
    expect(result.current.history).toHaveLength(1)
    expect(result.current.frame).toBe(START)

    // An instant merge with an offline side is also a ReducerError, not a crash.
    act(() => {
      result.current.run([{ t: 'offline', actor: 'bob' }], 'bob off')
      out = result.current.run([crdt.sync('alice', 'bob', 'status')], 'sync')
    })
    expect(out?.ok).toBe(false)
    expect(result.current.lastError).toMatch(/offline/)
    expect(result.current.history).toHaveLength(2)

    act(() => {
      out = result.current.run([crdt.update('alice', 'status', 'set', 'ok')], 'fine')
    })
    expect(out?.ok).toBe(true)
    expect(result.current.lastError).toBeUndefined()
  })

  it('resets when the start frame changes (the lesson moved on)', () => {
    const other = frames.find((x) => x.step.id === 's04')
    if (!other) throw new Error('fixture frame s04 not found')
    const { result, rerender } = renderHook(({ start }) => useSandbox(start, CTX), {
      initialProps: { start: START },
    })
    act(() => {
      result.current.run([crdt.update('alice', 'status', 'set', 'A')], 'a')
    })
    expect(result.current.history).toHaveLength(2)
    rerender({ start: other })
    expect(result.current.frame).toBe(other)
    expect(result.current.history).toEqual([other])
    expect(result.current.move).toBe('start')
  })
})
