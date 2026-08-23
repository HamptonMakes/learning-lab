/**
 * <TryIt>: the trigger opens a sheet laid out as data (left: stage + narration + code on demand)
 * and actions (right: "Try this" suggestions, verb-first buttons per actor and network, undo /
 * reset); pressing a control runs the real reducer (the stage's data-value changes), prompts are
 * inline, errors are shown inline, the Code panel prints the real function that ran, suggestions
 * tick themselves, analytics and sound fire. `renderTrigger` / <TryItTrigger> place the entry
 * point elsewhere.
 */
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { track } from '@/analytics'
import { crdt, offline } from '@/lesson/builders'
import { initWorld, makeReduceCtx, reduce } from '@/lesson/reducer'
import type { Command, Frame, World } from '@/lesson/types'
import { settingsStore } from '@/settings'
import { TryIt, TryItTrigger } from './TryIt'

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
const click = (testId: string) => fireEvent.click(screen.getByTestId(testId))

beforeEach(() => {
  localStorage.clear()
  settingsStore.reset()
  vi.mocked(track).mockClear()
  playSpy.mockClear()
})
afterEach(cleanup)

describe('<TryIt>', () => {
  it('renders a compact open button; the sheet has a stage region, an actions region and suggestions', () => {
    const f = frameOf(world(BASE))
    render(<TryIt frame={f} topicRef={TOPIC} sceneId="intro" />)
    expect(screen.queryByTestId('try-it-sheet')).toBeNull()
    const open = screen.getByTestId('try-it-open')
    expect(open).toHaveTextContent('Open sandbox')

    fireEvent.click(open)
    const sheet = screen.getByTestId('try-it-sheet')
    expect(sheet).toHaveAttribute('role', 'dialog')
    expect(within(sheet).getByText(/Every press runs the real CRDT code/)).toBeInTheDocument()

    // Three regions: the data (stage + narration), the actions, and the code on demand.
    const stage = screen.getByTestId('try-it-stage')
    const actions = screen.getByTestId('try-it-actions')
    expect(stage.querySelector('[data-stage][data-scene="intro"]')).not.toBeNull()
    expect(within(stage).getByTestId('try-it-say')).toHaveTextContent('This is step 3.')
    expect(screen.queryByTestId('try-it-code')).toBeNull()
    expect(within(actions).getByTestId('try-it-suggestions')).toBeInTheDocument()
    expect(actions).toHaveAttribute('aria-label', 'Actions')

    // Actions read as actions: verb-first labels, grouped under "Alice can…" / "Network".
    const alice = within(actions).getByTestId('try-it-actor-alice')
    expect(alice).toHaveTextContent('Alice can…')
    expect(alice).toHaveTextContent('status · LWW')
    expect(alice).toHaveTextContent('views · G-Counter')
    expect(within(alice).getByTestId('try-it-op-alice-status-set')).toHaveTextContent('Set status…')
    expect(within(alice).getByTestId('try-it-op-alice-views-inc')).toHaveTextContent(
      'Add 1 to views',
    )
    expect(within(alice).getByTestId('try-it-actor-alice-offline')).toHaveTextContent('Go offline')
    expect(screen.getByTestId('try-it-op-bob-views-inc')).toBeInTheDocument()
    const network = screen.getByTestId('try-it-network')
    expect(network).toHaveTextContent('Network')
    expect(within(network).getByTestId('try-it-net-sync-status-alice-bob')).toHaveTextContent(
      'Sync Alice ↔ Bob',
    )
    expect(within(network).getByTestId('try-it-net-sync-status-alice-bob')).toHaveTextContent(
      'status',
    )
    expect(within(network).getByTestId('try-it-net-tick')).toHaveTextContent('Tick the clock')
    // Every control is a real button with an icon.
    for (const b of within(actions).getAllByRole('button')) {
      if (b.dataset.action) expect(b.querySelector('svg')).not.toBeNull()
    }
    expect(screen.getByTestId('try-it-undo')).toBeDisabled()
    expect(tracked()).toEqual([{ name: 'try_it', props: { ...TOPIC, action: 'open' } }])
  })

  it('renderTrigger places a custom <TryItTrigger> and the sheet still opens', () => {
    const f = frameOf(world(BASE))
    render(
      <TryIt
        frame={f}
        topicRef={TOPIC}
        sceneId="intro"
        renderTrigger={(open) => <TryItTrigger onClick={open} data-testid="custom-open" />}
      />,
    )
    expect(screen.queryByTestId('try-it-panel')).toBeNull()
    const custom = screen.getByTestId('custom-open')
    expect(custom).toHaveTextContent('Open sandbox')
    fireEvent.click(custom)
    expect(screen.getByTestId('try-it-sheet')).toBeInTheDocument()
    expect(tracked()).toEqual([{ name: 'try_it', props: { ...TOPIC, action: 'open' } }])
  })

  it('pressing +1 runs the real G-Counter: the stage data-value, narration, sound and analytics follow', () => {
    const { value } = setup()
    expect(value('alice.views')).toBe('0')
    click('try-it-op-alice-views-inc')
    expect(value('alice.views')).toBe('1')
    expect(value('bob.views')).toBe('0')
    expect(screen.getByTestId('try-it-say')).toHaveTextContent('Alice adds 1 to views.')
    expect(screen.getByTestId('try-it-say')).toHaveAttribute('data-step', 'x1')
    expect(playSpy).toHaveBeenCalledWith('tick')
    expect(tracked().at(-1)).toEqual({ name: 'try_it', props: { ...TOPIC, action: 'inc' } })

    click('try-it-op-alice-views-inc')
    click('try-it-net-sync-views-alice-bob')
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
    click('try-it-prompt-confirm')
    expect(screen.queryByTestId('try-it-prompt')).toBeNull()
    expect(value('alice.status')).toBe('Lunch')
    expect(value('bob.status')).toBe('Offline')
    expect(screen.getByTestId('try-it-say')).toHaveTextContent('Alice sets status to Lunch.')

    // Cancel leaves the world alone.
    click('try-it-op-bob-status-set')
    click('try-it-prompt-cancel')
    expect(screen.queryByTestId('try-it-prompt')).toBeNull()
    expect(value('bob.status')).toBe('Offline')
  })

  it('undo and reset rewind the sandbox', () => {
    const { value } = setup()
    click('try-it-op-alice-views-inc')
    click('try-it-op-alice-views-inc')
    expect(value('alice.views')).toBe('2')
    click('try-it-undo')
    expect(value('alice.views')).toBe('1')
    expect(tracked().at(-1)).toEqual({ name: 'try_it', props: { ...TOPIC, action: 'undo' } })
    click('try-it-reset')
    expect(value('alice.views')).toBe('0')
    expect(screen.getByTestId('try-it-undo')).toBeDisabled()
    expect(screen.getByTestId('try-it-say')).toHaveTextContent('This is step 3.')
  })

  it('offline toggles swap, a disabled sync says why, and a reducer error is shown inline', () => {
    const { value } = setup()
    click('try-it-actor-bob-offline')
    expect(screen.getByTestId('try-it-actor-bob')).toHaveAttribute('data-online', 'false')
    expect(screen.getByTestId('try-it-actor-bob-online')).toHaveTextContent('Go online')
    const sync = screen.getByTestId('try-it-net-sync-views-alice-bob')
    expect(sync).toBeDisabled()
    expect(sync).toHaveAttribute('title', 'Both sides must be online.')
    expect(value('bob.views')).toBe('0')

    // Force a refused step through a scene whose start world already has Bob offline and a
    // lesson message parked: delivering to an online actor works, the sandbox never throws.
    const f = frameOf(world([...BASE, offline('bob'), crdt.send('alice', 'bob', 'views')]), 4)
    cleanup()
    render(<TryIt frame={f} topicRef={TOPIC} sceneId="intro" />)
    click('try-it-open')
    const all = screen.getByTestId('try-it-net-deliver-all')
    expect(all).toBeDisabled() // parked at an offline Bob: nothing deliverable
    click('try-it-actor-bob-online')
    click('try-it-net-deliver-all')
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
    click('try-it-open')
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

  it('"Try this" lists experiments for the world and ticks one when the history shows it', () => {
    setup()
    const box = screen.getByTestId('try-it-suggestions')
    expect(box).toHaveTextContent('Try this')
    expect(within(box).getAllByRole('listitem')).toHaveLength(3)
    const race = screen.getByTestId('try-it-suggestion-race-status')
    const double = screen.getByTestId('try-it-suggestion-doubleCount-views')
    expect(race).toHaveTextContent('Make a race: set status on Alice, set it on Bob, then sync.')
    expect(double).toHaveTextContent('Add 1 on Alice and on Bob, sync, then sync again.')
    expect(double).toHaveAttribute('data-done', 'false')

    click('try-it-op-alice-views-inc')
    click('try-it-op-bob-views-inc')
    click('try-it-net-sync-views-alice-bob')
    expect(double).toHaveAttribute('data-done', 'false')
    click('try-it-net-sync-views-alice-bob')
    expect(double).toHaveAttribute('data-done', 'true')
    expect(double).toHaveTextContent('(Done)')
    expect(race).toHaveAttribute('data-done', 'false')
    // Undo takes the tick back: it is derived from the history.
    click('try-it-undo')
    expect(double).toHaveAttribute('data-done', 'false')
  })

  it('the Code panel is off by default; it shows the real function that ran, with file lines', () => {
    setup()
    const toggle = screen.getByTestId('try-it-code-toggle')
    expect(toggle).toHaveAttribute('aria-pressed', 'false')
    expect(screen.queryByTestId('try-it-code')).toBeNull()

    // Nothing ran yet: the reference is the merge of the first slot's type.
    fireEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-pressed', 'true')
    const code = screen.getByTestId('try-it-code')
    expect(within(screen.getByTestId('try-it-stage')).getByTestId('try-it-code')).toBe(code)
    expect(screen.getByTestId('try-it-code-headline')).toHaveTextContent(
      'Nothing has run yet. Press an action and its code shows here. For reference, every sync calls lwwRegister.merge:',
    )
    expect(screen.getByTestId('try-it-code-block')).toHaveAttribute('data-fn', 'lwwRegister.merge')
    expect(screen.getByTestId('try-it-code-block')).toHaveTextContent(
      'return compareStamp(b, a) > 0 ? b : a',
    )
    expect(tracked().at(-1)).toEqual({ name: 'try_it', props: { ...TOPIC, action: 'codeShow' } })

    // +1 on Alice: gCounter.prepare then gCounter.effect, from src/crdt/g-counter.ts.
    click('try-it-op-alice-views-inc')
    const headline = screen.getByTestId('try-it-code-headline')
    expect(headline).toHaveTextContent('This ran: gCounter.prepare → gCounter.effect')
    const blocks = screen.getAllByTestId('try-it-code-block')
    expect(blocks.map((b) => b.dataset.fn)).toEqual(['gCounter.prepare', 'gCounter.effect'])
    expect(blocks[0]).toHaveTextContent('src/crdt/g-counter.ts, lines')
    expect(blocks[0]).toHaveTextContent('Alice built op alice:1')
    expect(blocks[0]).toHaveTextContent(
      'prepare(state: GCounterState, u: GCounterUpdate, ctx: Ctx): GCounterOp {',
    )
    expect(blocks[1]).toHaveTextContent('Alice applied alice:1')
    expect(blocks[1]).toHaveTextContent(
      'effect(state: GCounterState, op: GCounterOp): GCounterState {',
    )
    // The function's own lines are marked hot; its doc comment (if any) is context.
    expect(blocks[1]?.querySelectorAll('[data-hot]').length).toBeGreaterThan(0)

    // A sync: both directions in one merge block.
    click('try-it-net-sync-views-alice-bob')
    expect(screen.getByTestId('try-it-code-headline')).toHaveTextContent('This ran: gCounter.merge')
    expect(screen.getByTestId('try-it-code-block')).toHaveTextContent('Alice ← Bob · Bob ← Alice')

    // Going offline runs nothing in the CRDT: the panel says so and keeps the last function.
    click('try-it-actor-bob-offline')
    expect(screen.getByTestId('try-it-code-note')).toHaveTextContent(
      'No CRDT function ran: only the network changed.',
    )
    expect(screen.getByTestId('try-it-code-headline')).toHaveTextContent(
      'Before that, this ran: gCounter.merge',
    )

    fireEvent.click(toggle)
    expect(screen.queryByTestId('try-it-code')).toBeNull()
    expect(tracked().at(-1)).toEqual({ name: 'try_it', props: { ...TOPIC, action: 'codeHide' } })
  })
})
