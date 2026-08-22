/**
 * With the real `useInstantCommit` (Motion's useInstantTransition) and no stage mounted, Motion
 * skips the callback — the player must still commit prev / seek.
 */
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { progressStore, settingsStore } from '@/settings'
import { frames } from './frames.fixture'
import { usePlayer } from './usePlayer'

vi.mock('@/analytics', () => ({ track: vi.fn() }))

const TOPIC = { module: 'crdts', unit: 'state-based', topic: 'lww-register' }
const FRAMES = frames(4) // stable: the hook reloads when the frames change identity

beforeEach(() => {
  localStorage.clear()
  settingsStore.reset()
  progressStore.reset()
})
afterEach(() => cleanup())

describe('usePlayer with the real instant commit', () => {
  it('commits prev / seek / load even when no projection node exists', () => {
    const { result } = renderHook(() =>
      usePlayer(FRAMES, { topic: TOPIC, locale: 'en', initialIndex: 2 }),
    )
    act(() => result.current.prev())
    expect(result.current.state).toMatchObject({ index: 1, move: { kind: 'prev' } })
    act(() => result.current.seek(3))
    expect(result.current.state).toMatchObject({ index: 3, move: { kind: 'seek' } })
    act(() => result.current.dispatch({ t: 'load', total: 3, index: 3 }))
    expect(result.current.state).toMatchObject({ index: 2, total: 3 })
    act(() => result.current.prev())
    act(() => result.current.next())
    expect(result.current.state).toMatchObject({ index: 2, move: { kind: 'next' } })
  })
})
