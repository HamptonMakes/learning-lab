/**
 * <TryIt>: the panel opens a sheet with a live stage and controls derived from the frame's world;
 * pressing a control runs the real reducer (the stage's data-value changes), prompts are inline,
 * errors are shown inline, undo / reset rewind, analytics and sound fire.
 */
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { track } from '@/analytics'
import { crdt, offline } from '@/lesson/builders'
import { initWorld, makeReduceCtx, reduce } from '@/lesson/reducer'
import type { Command, Frame, World } from '@/lesson/types'
import { settingsStore } from '@/settings'
import { TryIt } from './TryIt'

const { playSpy } = vi.hoisted(() => ({ playSpy: vi.fn() }))
vi.mock('@/analytics', () => ({ track: vi.fn() }))
vi.mock('@/sound', () => ({
  useSound: () => ({
    play: playSpy,
    enabled: true,
    setEnabled: () => {},
    volume: 0.5,
    setVolume: () => {},
  }),
}))

const TOPIC = { module: 'crdts', unit: 'state-based', topic: 'lww-register' }

function world(cmds: Command[]): World {
  let w = initWorld({
    layout: 'pair',
    actors: [
      { id: 'alice', kind: 'person', label: 'Alice' },
      { id: 'bob', kind: 'person', label: 'Bob' },
    ],
  })
  const ctx = makeReduceCtx({ sceneId: 'intro', stepId: 's01' })
  for (const c of cmds) w = reduce(w, c, ctx)
  return w
}

const BASE: Command[] = [
  crdt.init(['alice', 'bob'], 'status', 'lww-register', {
    seed: [{ op: 'set', args: ['Offline'] }],
  }),
  crdt.init(['alice', 'bob'], 'views', 'g-counter'),
]

function frameOf(w: World, index = 2): Frame {
  return {
    index,
    sceneId: 'intro',
    sceneIndex: 0,
    step: { id: 's03', say: 'A lesson step.', do: [] },
    world: w,
    prev: w,
    changes: [],
  }
}

function setup(f: Frame = frameOf(world(BASE))) {
  const utils = render(<TryIt frame={f} topicRef={TOPIC} sceneId={f.sceneId} />)
  fireEvent.click(screen.getByTestId('try-it-open'))
  const sheet = screen.getByTestId('try-it-sheet')
  const value = (path: string) => {
    const el = sheet.querySelector<HTMLElement>(`[data-stage] [data-path="${path}"]`)
    if (!el) throw new Error(`no stage node at ${path}`)
    return el.getAttribute('data-value')
  }
  return { ...utils, sheet, value }
}

const tracked = () => vi.mocked(track).mock.calls.map(([name, props]) => ({ name, props }))

beforeEach(() => {
  localStorage.clear()
  settingsStore.reset()
  vi.mocked(track).mockClear()
  playSpy.mockClear()
})
afterEach(cleanup)

describe('<TryIt>', () => {
  it('renders a compact open button; the sheet shows a stage, narration and derived controls', () => {
    const f = frameOf(world(BASE))
    render(<TryIt frame={f} topicRef={TOPIC} sceneId="intro" />)
    expect(screen.queryByTestId('try-it-sheet')).toBeNull()
    const open = screen.getByTestId('try-it-open')
    expect(open).toHaveTextContent('Open sandbox')

    fireEvent.click(open)
    const sheet = screen.getByTestId('try-it-sheet')
    expect(sheet).toHaveAttribute('role', 'dialog')
    expect(within(sheet).getByText('Every button runs the real CRDT code.')).toBeInTheDocument()
    expect(sheet.querySelector('[data-stage][data-scene="intro"]')).not.toBeNull()
    expect(screen.getByTestId('try-it-say')).toHaveTextContent('This is step 3.')
    // Controls per actor and slot.
    expect(screen.getByTestId('try-it-actor-alice')).toHaveTextContent('Alice')
    expect(screen.getByTestId('try-it-op-alice-status-set')).toHaveTextContent('Set')
    expect(screen.getByTestId('try-it-op-alice-views-inc')).toHaveTextContent('+1')
    expect(screen.getByTestId('try-it-op-bob-views-inc')).toBeInTheDocument()
    expect(screen.getByTestId('try-it-actor-bob-offline')).toHaveTextContent('Go offline')
    expect(screen.getByTestId('try-it-net-sync-status-alice-bob')).toHaveTextContent(
      'Sync Alice ↔ Bob',
    )
    expect(screen.getByTestId('try-it-net-tick')).toBeInTheDocument()
    expect(screen.getByTestId('try-it-undo')).toBeDisabled()
    expect(tracked()).toEqual([{ name: 'try_it', props: { ...TOPIC, action: 'open' } }])
  })

  it('pressing +1 runs the real G-Counter: the stage data-value, narration, sound and analytics follow', () => {
    const { value } = setup()
    expect(value('alice.views')).toBe('0')
    fireEvent.click(screen.getByTestId('try-it-op-alice-views-inc'))
    expect(value('alice.views')).toBe('1')
    expect(value('bob.views')).toBe('0')
    expect(screen.getByTestId('try-it-say')).toHaveTextContent('Alice adds 1 to views.')
    expect(screen.getByTestId('try-it-say')).toHaveAttribute('data-step', 'x1')
    expect(playSpy).toHaveBeenCalledWith('tick')
    expect(tracked().at(-1)).toEqual({ name: 'try_it', props: { ...TOPIC, action: 'inc' } })

    fireEvent.click(screen.getByTestId('try-it-op-alice-views-inc'))
    fireEvent.click(screen.getByTestId('try-it-net-sync-views-alice-bob'))
    expect(value('alice.views')).toBe('2')
    expect(value('bob.views')).toBe('2')
    expect(screen.getByTestId('try-it-say')).toHaveTextContent('Alice and Bob sync views.')
  })

  it('set opens an inline prompt; confirming runs the LWW set (no window.prompt)', () => {
    const { value } = setup()
    expect(value('alice.status')).toBe('Offline')
    const set = screen.getByTestId('try-it-op-alice-status-set')
    fireEvent.click(set)
    expect(set).toHaveAttribute('aria-expanded', 'true')
    const input = screen.getByTestId('try-it-prompt-value')
    expect(screen.getByTestId('try-it-prompt-confirm')).toBeDisabled()
    fireEvent.change(input, { target: { value: 'Lunch' } })
    fireEvent.click(screen.getByTestId('try-it-prompt-confirm'))
    expect(screen.queryByTestId('try-it-prompt')).toBeNull()
    expect(value('alice.status')).toBe('Lunch')
    expect(value('bob.status')).toBe('Offline')
    expect(screen.getByTestId('try-it-say')).toHaveTextContent('Alice sets status to Lunch.')

    // Cancel leaves the world alone.
    fireEvent.click(screen.getByTestId('try-it-op-bob-status-set'))
    fireEvent.click(screen.getByTestId('try-it-prompt-cancel'))
    expect(screen.queryByTestId('try-it-prompt')).toBeNull()
    expect(value('bob.status')).toBe('Offline')
  })

  it('undo and reset rewind the sandbox', () => {
    const { value } = setup()
    fireEvent.click(screen.getByTestId('try-it-op-alice-views-inc'))
    fireEvent.click(screen.getByTestId('try-it-op-alice-views-inc'))
    expect(value('alice.views')).toBe('2')
    fireEvent.click(screen.getByTestId('try-it-undo'))
    expect(value('alice.views')).toBe('1')
    expect(tracked().at(-1)).toEqual({ name: 'try_it', props: { ...TOPIC, action: 'undo' } })
    fireEvent.click(screen.getByTestId('try-it-reset'))
    expect(value('alice.views')).toBe('0')
    expect(screen.getByTestId('try-it-undo')).toBeDisabled()
    expect(screen.getByTestId('try-it-say')).toHaveTextContent('This is step 3.')
  })

  it('offline toggles swap, a disabled sync says why, and a reducer error is shown inline', () => {
    const { value } = setup()
    fireEvent.click(screen.getByTestId('try-it-actor-bob-offline'))
    expect(screen.getByTestId('try-it-actor-bob')).toHaveAttribute('data-online', 'false')
    expect(screen.getByTestId('try-it-actor-bob-online')).toBeInTheDocument()
    const sync = screen.getByTestId('try-it-net-sync-views-alice-bob')
    expect(sync).toBeDisabled()
    expect(sync).toHaveAttribute('title', 'Both sides must be online.')
    expect(value('bob.views')).toBe('0')

    // Force a refused step through a scene whose start world already has Bob offline and a
    // lesson message parked: delivering to an online actor works, the sandbox never throws.
    const f = frameOf(world([...BASE, offline('bob'), crdt.send('alice', 'bob', 'views')]), 4)
    cleanup()
    render(<TryIt frame={f} topicRef={TOPIC} sceneId="intro" />)
    fireEvent.click(screen.getByTestId('try-it-open'))
    const all = screen.getByTestId('try-it-net-deliver-all')
    expect(all).toBeDisabled() // parked at an offline Bob: nothing deliverable
    fireEvent.click(screen.getByTestId('try-it-actor-bob-online'))
    fireEvent.click(screen.getByTestId('try-it-net-deliver-all'))
    expect(screen.queryByTestId('try-it-error')).toBeNull()
    expect(playSpy).toHaveBeenCalledWith('bloop', { volume: 0.5 })
  })

  it('shows the reducer message when the real code refuses a step', () => {
    // An op whose arity is wrong cannot come from the buttons; drive it through a TryIt override.
    const f = frameOf(world(BASE))
    render(
      <TryIt
        frame={f}
        topicRef={TOPIC}
        sceneId="intro"
        tryIt={{ slot: 'views', ops: [{ op: 'inc', label: 'Bad inc', args: [1, 2, 3] }] }}
      />,
    )
    fireEvent.click(screen.getByTestId('try-it-open'))
    const bad = screen.getByTestId('try-it-op-alice-views-inc')
    expect(bad).toHaveTextContent('Bad inc')
    act(() => {
      fireEvent.click(bad)
    })
    const err = screen.getByTestId('try-it-error')
    expect(err).toHaveAttribute('role', 'alert')
    expect(err).toHaveTextContent(/argument/)
    expect(screen.getByTestId('try-it-undo')).toBeDisabled()
    expect(playSpy).not.toHaveBeenCalledWith('tick')
  })
})
