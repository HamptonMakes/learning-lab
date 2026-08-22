import { afterEach, describe, expect, it, vi } from 'vitest'
import { ReducerError, type Mark, type World } from '../types'
import { clearTransientMarks, computeVerdict } from './marks'
import {
  apply,
  clockOf,
  counter,
  ctx,
  fixtureWorld,
  list,
  rec,
  run,
  scalar,
  step,
} from './test-utils'

function withSlots(slots: Record<string, Record<string, ReturnType<typeof scalar>>>): World {
  const w = fixtureWorld()
  const actors = { ...w.actors }
  for (const [id, holds] of Object.entries(slots)) {
    const actor = actors[id]
    if (!actor) throw new Error(id)
    actors[id] = { ...actor, holds: { ...actor.holds, ...holds } }
  }
  return { ...w, actors }
}

describe('mark commands', () => {
  it('append marks with minted ids k1… or explicit ids; defaults tone change / info', () => {
    const { world } = run(fixtureWorld(), [
      { t: 'highlight', path: 'alice.doc' },
      { t: 'highlight', path: ['alice.doc', 'bob.doc'], tone: 'warn', sticky: true, id: 'h' },
      { t: 'callout', at: 'bob', text: 'hi' },
      { t: 'conflict', a: 'alice.doc', b: 'bob.doc' },
      { t: 'check', path: 'alice.doc', sticky: true },
      { t: 'cross', path: 'bob.doc' },
    ])
    expect(world.marks).toEqual([
      { id: 'k1', kind: 'highlight', paths: ['alice.doc'], tone: 'change' },
      { id: 'h', kind: 'highlight', paths: ['alice.doc', 'bob.doc'], tone: 'warn', sticky: true },
      { id: 'k2', kind: 'callout', at: 'bob', text: 'hi', tone: 'info' },
      { id: 'k3', kind: 'conflict', a: 'alice.doc', b: 'bob.doc' },
      { id: 'k4', kind: 'check', path: 'alice.doc', sticky: true },
      { id: 'k5', kind: 'cross', path: 'bob.doc' },
    ])
    expect(world.ids).toBe(5)
  })

  it('re-issuing an explicit id replaces the mark; unmark removes; clearMarks empties', () => {
    const a = run(fixtureWorld(), [
      { t: 'callout', at: 'alice', text: 'one', id: 'c1', sticky: true },
      { t: 'callout', at: 'alice', text: 'two', id: 'c1', sticky: true },
    ]).world
    expect(a.marks).toEqual([
      { id: 'c1', kind: 'callout', at: 'alice', text: 'two', tone: 'info', sticky: true },
    ])
    const b = run(a, [{ t: 'unmark', id: 'c1' }]).world
    expect(b.marks).toEqual([])
    expect(() => run(b, [{ t: 'unmark', id: 'c1' }])).toThrow(/no mark "c1"/)
    const c = run(a, [{ t: 'highlight', path: 'bob' }, { t: 'clearMarks' }]).world
    expect(c.marks).toEqual([])
    expect(c.boards).toEqual(a.boards)
  })

  it('compare records a provisional verdict and remembers expect in the scratch', () => {
    const c = ctx()
    const { world } = run(
      fixtureWorld(),
      [{ t: 'compare', paths: ['alice.doc', 'bob.doc'], expect: 'equal' }],
      c,
    )
    expect(world.marks).toEqual([
      {
        id: 'k1',
        kind: 'compare',
        paths: ['alice.doc', 'bob.doc'],
        verdict: 'equal',
        rule: 'value',
      },
    ])
    expect(c.scratch?.newMarks.get('k1')?.expect).toBe('equal')
    expect(() => run(fixtureWorld(), [{ t: 'compare', paths: ['alice.doc'] }])).toThrow(/two paths/)
    expect(() => run(fixtureWorld(), [{ t: 'highlight', path: [] }])).toThrow(/at least one path/)
  })

  it('clearTransientMarks keeps only sticky marks', () => {
    const marks: Mark[] = [
      { id: 'a', kind: 'highlight', paths: ['x'], tone: 'change', auto: true },
      { id: 'b', kind: 'callout', at: 'x', text: 't', tone: 'info', sticky: true },
      { id: 'c', kind: 'unchanged', path: 'x' },
      { id: 'd', kind: 'flow', from: 'x', to: 'y' },
      { id: 'e', kind: 'check', path: 'x', sticky: true },
    ]
    const w = { ...fixtureWorld(), marks }
    expect(clearTransientMarks(w).marks.map((m) => m.id)).toEqual(['b', 'e'])
    const onlySticky = { ...w, marks: marks.filter((m) => 'sticky' in m) }
    expect(clearTransientMarks(onlySticky)).toBe(onlySticky)
  })
})

describe('end-of-step resolution (applyStep)', () => {
  afterEach(() => vi.restoreAllMocks())

  it('anchors are checked against the end-of-step world: a path created later in the step is fine', () => {
    const { world } = apply(
      fixtureWorld(),
      step('s01', { t: 'highlight', path: 'alice.new' }, { t: 'set', path: 'alice.new', value: 1 }),
    )
    expect(
      world.marks.some((m) => m.kind === 'highlight' && m.paths[0] === 'alice.new' && !m.auto),
    ).toBe(true)
  })

  it('a new mark whose anchor does not resolve throws with the step id and command', () => {
    let err: unknown
    try {
      apply(fixtureWorld(), step('s07', { t: 'callout', at: 'alice.nope', text: 'x' }))
    } catch (e) {
      err = e
    }
    expect(err).toBeInstanceOf(ReducerError)
    expect((err as ReducerError).message).toMatch(/does not resolve at the end of step "s07"/)
    expect((err as ReducerError).ctx).toMatchObject({
      stepId: 's07',
      command: { t: 'callout', at: 'alice.nope' },
      path: 'alice.nope',
    })
    // deleted inside the same step → also an error
    expect(() =>
      apply(
        fixtureWorld(),
        step('s01', { t: 'check', path: 'alice.n' }, { t: 'delete', path: 'alice.n' }),
      ),
    ).toThrow(ReducerError)
  })

  it('a msg: anchor must still be live at the end of the step', () => {
    expect(() =>
      apply(
        fixtureWorld(),
        step(
          's01',
          { t: 'send', from: 'alice', to: 'bob', payload: 1, id: 'm1' },
          { t: 'callout', at: 'msg:m1', text: 'x' },
          { t: 'deliver', message: 'm1' },
        ),
      ),
    ).toThrow(/msg:m1/)
    const { world } = apply(
      fixtureWorld(),
      step(
        's01',
        { t: 'send', from: 'alice', to: 'bob', payload: 1, id: 'm1' },
        { t: 'callout', at: 'msg:m1', text: 'x' },
      ),
    )
    expect(world.marks.some((m) => m.kind === 'callout' && m.at === 'msg:m1')).toBe(true)
  })

  it('sticky marks from earlier steps vanish with their anchors (mark removed change)', () => {
    const s1 = apply(
      fixtureWorld(),
      step('s01', { t: 'callout', at: 'alice.n', text: 'n', sticky: true, id: 'c1' }),
    )
    expect(s1.world.marks.map((m) => m.id)).toContain('c1')
    const s2 = apply(s1.world, step('s02', { t: 'delete', path: 'alice.n' }))
    expect(s2.world.marks.map((m) => m.id)).not.toContain('c1')
    expect(s2.changes).toContainEqual({ kind: 'mark', id: 'c1', op: 'removed' })
    // a sticky mark whose anchor survives keeps its id and causes no mark change
    const s3 = apply(s1.world, step('s02', { t: 'tick' }))
    expect(s3.world.marks).toEqual(s1.world.marks.filter((m) => m.id === 'c1'))
    expect(s3.changes.filter((c) => c.kind === 'mark')).toEqual([])
  })
})

describe('compare verdicts (§10)', () => {
  afterEach(() => vi.restoreAllMocks())

  const clocks = withSlots({
    alice: { vc: clockOf({ alice: 2, bob: 1 }), meta: scalar('x', { vc: { alice: 1 } }) },
    bob: {
      vc: clockOf({ alice: 1, bob: 2 }),
      meta: scalar('y', { vc: { alice: 1, bob: 1 } }),
      same: clockOf({ alice: 2, bob: 1 }),
    },
  })

  it('clock rule: clock values or @vc metas → vcCompare', () => {
    expect(computeVerdict(clocks, ['alice.vc', 'bob.vc'])).toEqual({
      verdict: 'concurrent',
      rule: 'clock',
    })
    expect(computeVerdict(clocks, ['alice.meta@vc', 'bob.meta@vc'])).toEqual({
      verdict: 'before',
      rule: 'clock',
    })
    expect(computeVerdict(clocks, ['bob.meta@vc', 'alice.meta@vc'])).toEqual({
      verdict: 'after',
      rule: 'clock',
    })
    expect(computeVerdict(clocks, ['alice.vc', 'bob.same'])).toEqual({
      verdict: 'equal',
      rule: 'clock',
    })
    expect(computeVerdict(clocks, ['alice.vc', 'bob.meta@vc'])).toEqual({
      verdict: 'after',
      rule: 'clock',
    })
  })

  it('stamp rule: both nodes carry ts + node → compareStamp; equal only for identical stamps', () => {
    const w = withSlots({
      alice: {
        s: scalar('A', { ts: 1, node: 'alice' }),
        n: scalar(5, { ts: 3, node: 'alice' }),
        tie: scalar('T', { ts: 2, node: 'alice' }),
      },
      bob: {
        s: scalar('B', { ts: 2, node: 'bob' }),
        n: scalar(9, { ts: 3, node: 'bob' }),
        same: scalar('A', { ts: 1, node: 'alice' }),
        tie: scalar('T', { ts: 2, node: 'bob' }),
      },
    })
    expect(computeVerdict(w, ['alice.s', 'bob.s'])).toEqual({ verdict: 'less', rule: 'stamp' })
    expect(computeVerdict(w, ['bob.s', 'alice.s'])).toEqual({ verdict: 'greater', rule: 'stamp' })
    expect(computeVerdict(w, ['alice.s', 'bob.same'])).toEqual({ verdict: 'equal', rule: 'stamp' })
    // ts tie → higher node id wins; same value is still not "equal"
    expect(computeVerdict(w, ['alice.tie', 'bob.tie'])).toEqual({ verdict: 'less', rule: 'stamp' })
    // stamp beats number when both carry stamps
    expect(computeVerdict(w, ['alice.n', 'bob.n'])).toEqual({ verdict: 'less', rule: 'stamp' })
  })

  it('number rule: numeric plain values (scalars, counters, rows, bytes, meters)', () => {
    const w = withSlots({
      alice: { c: counter({ alice: 2 }), m: { kind: 'meter', value: 6 } },
      bob: { c: counter({ bob: 1, alice: 1 }) },
    })
    expect(computeVerdict(w, ['alice.n', 'bob.c'])).toEqual({ verdict: 'less', rule: 'number' })
    expect(computeVerdict(w, ['alice.c', 'bob.c'])).toEqual({ verdict: 'equal', rule: 'number' })
    expect(computeVerdict(w, ['alice.m', 'alice.c[alice]@inc'])).toEqual({
      verdict: 'greater',
      rule: 'number',
    })
  })

  it('value rule: deep equality of plain values; n paths → equal iff every adjacent pair is equal', () => {
    const w = withSlots({
      alice: { l: list(['a', 'b']), r: rec({ x: scalar(1) }) },
      bob: { l: list(['a', 'b']), r: rec({ x: scalar(2) }) },
      server: { l: list(['b', 'a']) },
    })
    expect(computeVerdict(w, ['alice.doc', 'bob.doc'])).toEqual({ verdict: 'equal', rule: 'value' })
    expect(computeVerdict(w, ['alice.l', 'bob.l'])).toEqual({ verdict: 'equal', rule: 'value' })
    expect(computeVerdict(w, ['alice.r', 'bob.r'])).toEqual({ verdict: 'different', rule: 'value' })
    expect(computeVerdict(w, ['alice.l', 'bob.l', 'server.l'])).toEqual({
      verdict: 'different',
      rule: 'value',
    })
    expect(computeVerdict(w, ['alice.doc', 'bob.doc', 'alice.doc'])).toEqual({
      verdict: 'equal',
      rule: 'value',
    })
    expect(computeVerdict(clocks, ['alice.vc', 'bob.same', 'alice.vc'])).toEqual({
      verdict: 'equal',
      rule: 'clock',
    })
    expect(() => computeVerdict(w, ['alice', 'bob'])).toThrow(ReducerError)
    expect(() => computeVerdict(w, ['alice.doc'])).toThrow(/two paths/)
  })

  it('verdicts are computed on the end-of-step world and set on the mark', () => {
    const { world } = apply(
      fixtureWorld(),
      step(
        's01',
        { t: 'compare', paths: ['alice.n', 'bob.n'] },
        { t: 'set', path: 'bob.n', value: 4 },
      ),
    )
    expect(world.marks.find((m) => m.kind === 'compare')).toMatchObject({
      verdict: 'less',
      rule: 'number',
    })
  })

  it('expect: throw (default), warn, ignore — the frame still draws the computed verdict', () => {
    const s = step('s03', { t: 'compare', paths: ['alice.n', 'bob.doc'], expect: 'equal' })
    expect(() => apply(fixtureWorld(), s)).toThrow(
      /expected "equal" but the value rule says "different"/,
    )
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { world } = apply(fixtureWorld(), s, { assertMode: 'warn' })
    expect(warn).toHaveBeenCalledTimes(1)
    expect(world.marks.find((m) => m.kind === 'compare')).toMatchObject({
      verdict: 'different',
      rule: 'value',
    })
    warn.mockClear()
    apply(fixtureWorld(), s, { assertMode: 'ignore' })
    expect(warn).not.toHaveBeenCalled()
    // a matching expect passes silently
    expect(() =>
      apply(
        fixtureWorld(),
        step('s01', { t: 'compare', paths: ['alice.doc', 'bob.doc'], expect: 'equal' }),
      ),
    ).not.toThrow()
  })

  it('a sticky compare is re-verdicted in later steps (removed + added with the same id)', () => {
    const s1 = apply(
      fixtureWorld(),
      step(
        's01',
        { t: 'set', path: 'bob.n', value: 4 },
        { t: 'compare', paths: ['alice.n', 'bob.n'], sticky: true, id: 'cmp' },
      ),
    )
    expect(s1.world.marks.find((m) => m.id === 'cmp')).toEqual({
      id: 'cmp',
      kind: 'compare',
      paths: ['alice.n', 'bob.n'],
      verdict: 'less',
      rule: 'number',
      sticky: true,
    })
    const s2 = apply(s1.world, step('s02', { t: 'set', path: 'bob.n', value: 1 }))
    expect(s2.world.marks.find((m) => m.id === 'cmp')).toMatchObject({
      verdict: 'equal',
      rule: 'number',
    })
    expect(
      s2.changes
        .filter((c) => c.kind === 'mark' && c.id === 'cmp')
        .map((c) => (c.kind === 'mark' ? c.op : '')),
    ).toEqual(['removed', 'added'])
  })
})
