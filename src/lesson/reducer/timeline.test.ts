import { afterEach, describe, expect, it, vi } from 'vitest'
import { ReducerError, type Scene, type Topic } from '../types'
import { buildTimeline, frameAt } from './timeline'
import { sceneWorld, step } from './test-utils'

const topicOf = (scenes: Scene[], id = 't'): Topic => ({
  id,
  title: 'T',
  goal: 'g',
  whenToUse: [],
  whenNotToUse: [],
  realWorld: 'r',
  scenes,
})

const twoScenes = (): Topic =>
  topicOf([
    {
      id: 'one',
      world: sceneWorld,
      steps: [
        step(
          's01',
          { t: 'set', path: 'alice.doc', value: 'a' },
          { t: 'callout', at: 'alice.doc', text: 'x', sticky: true },
        ),
        step('s02', {
          t: 'send',
          from: 'alice',
          to: 'bob',
          payload: { ref: 'alice.doc' },
          id: 'm1',
          into: 'bob.doc',
        }),
        step('s03', { t: 'deliver', message: 'm1' }, { t: 'expect', path: 'bob.doc', equals: 'a' }),
      ],
    },
    {
      id: 'two',
      startFrom: 'one',
      steps: [step('s01', { t: 'set', path: 'bob.doc', value: 'b' }), step('s02', { t: 'tick' })],
    },
  ])

describe('buildTimeline', () => {
  afterEach(() => vi.restoreAllMocks())

  it('folds scenes into frames with global index, sceneIndex, prev and changes', () => {
    const frames = buildTimeline(twoScenes())
    expect(frames.map((f) => [f.index, f.sceneId, f.sceneIndex, f.step.id])).toEqual([
      [0, 'one', 0, 's01'],
      [1, 'one', 0, 's02'],
      [2, 'one', 0, 's03'],
      [3, 'two', 1, 's01'],
      [4, 'two', 1, 's02'],
    ])
    const [f0, f1, , f3] = frames
    expect(f0?.prev.actors.alice?.holds.doc).toEqual({ kind: 'scalar', value: 'hello' })
    expect(f0?.world.actors.alice?.holds.doc).toEqual({ kind: 'scalar', value: 'a' })
    expect(f1?.prev).toBe(f0?.world)
    expect(f0?.changes.map((c) => c.kind)).toEqual(['value', 'mark', 'mark'])
    expect(frameAt(frames, 'two', 's02')?.index).toBe(4)
    expect(frameAt(frames, 'two', 's09')).toBeUndefined()
    // startFrom: the parent's end world with marks cleared; prev of the first frame is that world0
    expect(f3?.prev.marks).toEqual([])
    expect(f3?.prev.actors.bob?.holds.doc).toEqual({ kind: 'scalar', value: 'a' })
    expect(f3?.prev.messages).toEqual([])
    expect(f3?.changes.some((c) => c.kind === 'mark' && c.op === 'removed')).toBe(false)
  })

  it('is deterministic and memoized per (topic, assertMode)', () => {
    const topic = twoScenes()
    const a = buildTimeline(topic)
    const b = buildTimeline(topic)
    expect(b).toBe(a)
    const again = buildTimeline(twoScenes())
    expect(again).not.toBe(a)
    expect(again).toEqual(a)
    expect(JSON.stringify(again)).toBe(JSON.stringify(a))
    const warnMode = buildTimeline(topic, { assertMode: 'warn' })
    expect(warnMode).not.toBe(a)
    expect(warnMode).toEqual(a)
    expect(buildTimeline(topic, { assertMode: 'warn' })).toBe(warnMode)
  })

  it('startFrom: parent must be earlier and have no messages in flight; exactly one of world / startFrom', () => {
    const inFlight = topicOf([
      {
        id: 'one',
        world: sceneWorld,
        steps: [step('s01', { t: 'send', from: 'alice', to: 'bob', payload: 1, id: 'm1' })],
      },
      { id: 'two', startFrom: 'one', steps: [step('s01')] },
    ])
    expect(() => buildTimeline(inFlight)).toThrow(/in flight or parked \(m1\)/)
    const later = topicOf([
      { id: 'two', startFrom: 'one', steps: [step('s01')] },
      { id: 'one', world: sceneWorld, steps: [step('s01')] },
    ])
    expect(() => buildTimeline(later)).toThrow(/not an earlier scene/)
    expect(() => buildTimeline(topicOf([{ id: 'x', steps: [] }]))).toThrow(/exactly one/)
    expect(() =>
      buildTimeline(topicOf([{ id: 'x', world: sceneWorld, startFrom: 'x', steps: [] }])),
    ).toThrow(/exactly one/)
    expect(() =>
      buildTimeline(
        topicOf([
          { id: 'x', world: sceneWorld, steps: [] },
          { id: 'x', world: sceneWorld, steps: [] },
        ]),
      ),
    ).toThrow(/used twice/)
    expect(() =>
      buildTimeline(topicOf([{ id: 'x', world: sceneWorld, steps: [step('s01'), step('s01')] }])),
    ).toThrow(/step id "s01"/)
    expect(() =>
      buildTimeline(
        topicOf([
          { id: 'x', world: { actors: [{ id: 'msg', kind: 'person', label: 'M' }] }, steps: [] },
        ]),
      ),
    ).toThrow(/scene "x": bad actor id/)
  })

  it('is the dry-run: authoring mistakes throw ReducerError with the step id; assertMode governs expect', () => {
    const bad = topicOf([
      {
        id: 'one',
        world: sceneWorld,
        steps: [step('s01', { t: 'tick' }), step('s02', { t: 'deliver', message: 'ghost' })],
      },
    ])
    let err: unknown
    try {
      buildTimeline(bad)
    } catch (e) {
      err = e
    }
    expect(err).toBeInstanceOf(ReducerError)
    expect((err as ReducerError).ctx).toMatchObject({
      stepId: 's02',
      command: { t: 'deliver', message: 'ghost' },
    })
    const failing = topicOf([
      {
        id: 'one',
        world: sceneWorld,
        steps: [step('s01', { t: 'expect', path: 'alice.doc', equals: 'nope' })],
      },
    ])
    expect(() => buildTimeline(failing)).toThrow(/expect failed/)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(buildTimeline(failing, { assertMode: 'warn' })).toHaveLength(1)
    expect(warn).toHaveBeenCalledTimes(1)
    expect(buildTimeline(failing, { assertMode: 'ignore' })).toHaveLength(1)
    expect(warn).toHaveBeenCalledTimes(1)
  })

  it('an empty topic yields no frames; a narration-only step yields a frame without changes', () => {
    expect(buildTimeline(topicOf([]))).toEqual([])
    const frames = buildTimeline(topicOf([{ id: 'one', world: sceneWorld, steps: [step('s01')] }]))
    expect(frames).toHaveLength(1)
    expect(frames[0]?.changes).toEqual([])
    expect(frames[0]?.world).toEqual(frames[0]?.prev)
  })
})
