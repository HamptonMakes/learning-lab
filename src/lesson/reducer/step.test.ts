import { afterEach, describe, expect, it, vi } from 'vitest'
import { ReducerError, type Change, type World } from '../types'
import { makeAssert, reduce } from './index'
import { apply, bytesOf, counter, ctx, fixtureWorld, list, rec, scalar, step } from './test-utils'

const slots = (
  w: World,
  actor: string,
  holds: Record<string, ReturnType<typeof scalar>>,
): World => {
  const a = w.actors[actor]
  if (!a) throw new Error(actor)
  return { ...w, actors: { ...w.actors, [actor]: { ...a, holds: { ...a.holds, ...holds } } } }
}
const autoPaths = (w: World) =>
  w.marks
    .filter((m) => m.kind === 'highlight' && m.auto)
    .map((m) => (m.kind === 'highlight' ? m.paths[0] : ''))
const ofKind = <K extends Change['kind']>(changes: Change[], kind: K) =>
  changes.filter((c): c is Extract<Change, { kind: K }> => c.kind === kind)

describe('applyStep: auto-highlights (§6 step 4)', () => {
  it('adds one transient auto highlight per changed value path, with fresh ids each step', () => {
    const s1 = apply(
      fixtureWorld(),
      step(
        's01',
        { t: 'set', path: 'alice.doc', value: 'x' },
        { t: 'set', path: 'bob.new', value: 1 },
      ),
    )
    expect(s1.world.marks).toEqual([
      { id: 'k1', kind: 'highlight', paths: ['alice.doc'], tone: 'change', auto: true },
      { id: 'k2', kind: 'highlight', paths: ['bob.new'], tone: 'change', auto: true },
    ])
    expect(s1.changes).toEqual([
      { kind: 'value', path: 'alice.doc', op: 'changed', action: { key: 'stage.op.setPlain' } },
      { kind: 'value', path: 'bob.new', op: 'added', action: { key: 'stage.op.setPlain' } },
      { kind: 'mark', id: 'k1', op: 'added' },
      { kind: 'mark', id: 'k2', op: 'added' },
    ])
    const s2 = apply(s1.world, step('s02', { t: 'set', path: 'alice.doc', value: 'y' }))
    expect(s2.world.marks).toEqual([
      { id: 'k3', kind: 'highlight', paths: ['alice.doc'], tone: 'change', auto: true },
    ])
    // transient marks of s1 are not reported as removed: the diff runs against prev with transients cleared
    expect(s2.changes).toEqual([
      { kind: 'value', path: 'alice.doc', op: 'changed', action: { key: 'stage.op.setPlain' } },
      { kind: 'mark', id: 'k3', op: 'added' },
    ])
    const s3 = apply(s2.world, step('s03', { t: 'tick' }))
    expect(s3.world.marks).toEqual([])
    expect(s3.changes).toEqual([{ kind: 'clock', from: 0, to: 1 }])
  })

  it('skips quiet writes, autoHighlight:false, removed paths and @outbox/@inbox', () => {
    const w = slots(fixtureWorld(), 'alice', { l: list(['a', 'b']) })
    const quiet = apply(
      w,
      step(
        's01',
        { t: 'set', path: 'alice.doc', value: 'x', quiet: true },
        { t: 'delete', path: 'alice.l[a]' },
        { t: 'set', path: 'alice.n', value: 9 },
      ),
    )
    expect(autoPaths(quiet.world)).toEqual(['alice.n'])
    const off = apply(w, {
      ...step('s01', { t: 'set', path: 'alice.doc', value: 'x' }),
      autoHighlight: false,
    })
    expect(off.world.marks).toEqual([])
    expect(off.changes).toEqual([
      { kind: 'value', path: 'alice.doc', op: 'changed', action: { key: 'stage.op.setPlain' } },
    ])
    const parked = apply(
      w,
      step(
        's01',
        { t: 'offline', actor: 'bob' },
        { t: 'send', from: 'alice', to: 'bob', payload: 1 },
      ),
    )
    expect(autoPaths(parked.world)).toEqual([])
    expect(ofKind(parked.changes, 'value')).toEqual([
      { kind: 'value', path: 'bob@inbox', op: 'changed' },
    ])
  })

  it('quiet paths cover everything under them (a quiet set of a record silences its fields)', () => {
    const w = slots(fixtureWorld(), 'alice', { r: rec({ a: scalar(1), b: scalar(2) }) })
    const s = apply(
      w,
      step('s01', {
        t: 'set',
        path: 'alice.r',
        value: rec({ a: scalar(1), b: scalar(3) }),
        quiet: true,
      }),
    )
    expect(s.world.marks).toEqual([])
    expect(ofKind(s.changes, 'value')).toEqual([
      { kind: 'value', path: 'alice.r.b', op: 'changed', action: { key: 'stage.op.setPlain' } },
    ])
  })

  it('a user mark on the same branch suppresses the auto highlight (either direction); callouts do not', () => {
    const w = slots(fixtureWorld(), 'alice', { r: rec({ a: scalar(1) }), id: bytesOf('0011') })
    const marked = apply(
      w,
      step(
        's01',
        { t: 'highlight', path: 'alice.r.a', tone: 'warn' },
        { t: 'set', path: 'alice.r.a', value: 2 },
      ),
    )
    expect(autoPaths(marked.world)).toEqual([])
    const container = apply(
      w,
      step('s01', { t: 'check', path: 'alice.r' }, { t: 'set', path: 'alice.r.a', value: 2 }),
    )
    expect(autoPaths(container.world)).toEqual([])
    const sub = apply(
      w,
      step(
        's01',
        { t: 'view', path: 'alice.id', display: 'canonical' },
        { t: 'highlight', path: 'alice.id[1]' },
      ),
    )
    expect(autoPaths(sub.world)).toEqual([])
    const callout = apply(
      w,
      step(
        's01',
        { t: 'callout', at: 'alice.r.a', text: 'x' },
        { t: 'set', path: 'alice.r.a', value: 2 },
      ),
    )
    expect(autoPaths(callout.world)).toEqual(['alice.r.a'])
    const other = apply(
      w,
      step('s01', { t: 'highlight', path: 'alice.doc' }, { t: 'set', path: 'alice.n', value: 2 }),
    )
    expect(autoPaths(other.world)).toEqual(['alice.n'])
  })

  it('meta-only changes are highlighted once per path', () => {
    const s = apply(
      fixtureWorld(),
      step('s01', { t: 'patch', path: 'alice.doc', meta: { ts: 1, node: 'alice' } }),
    )
    expect(autoPaths(s.world)).toEqual(['alice.doc'])
    expect(ofKind(s.changes, 'value')).toEqual([{ kind: 'value', path: 'alice.doc', op: 'meta' }])
  })
})

describe('applyStep: reconcile (§6 step 5)', () => {
  it('same-step send + deliver: transient sent/delivered events, then the landed value with via', () => {
    const s = apply(
      fixtureWorld(),
      step(
        's01',
        {
          t: 'send',
          from: 'alice',
          to: 'server',
          payload: { ref: 'alice.doc' },
          id: 'm3',
          into: 'server.doc',
          label: 'save',
        },
        { t: 'deliver', message: 'm3' },
      ),
    )
    expect(s.world.messages).toEqual([])
    expect(s.changes).toEqual([
      {
        kind: 'message',
        op: 'sent',
        message: expect.objectContaining({ id: 'm3', state: 'flying' }),
        transient: true,
      },
      {
        kind: 'message',
        op: 'delivered',
        message: expect.objectContaining({ id: 'm3' }),
        transient: true,
      },
      {
        kind: 'value',
        path: 'server.doc',
        op: 'added',
        via: 'm3',
        action: { key: 'stage.op.setPlain', by: 'alice' },
      },
      { kind: 'mark', id: 'k1', op: 'added' },
    ])
  })

  it('via folds into the deepest changes under the landed slot; a consumed control message folds into nothing', () => {
    const w = slots(fixtureWorld(), 'server', { doc: rec({ a: scalar(1), b: scalar(2) }) })
    const s1 = apply(
      w,
      step('s01', {
        t: 'send',
        from: 'alice',
        to: 'server',
        payload: rec({ a: scalar(1), b: scalar(3) }),
        id: 'm1',
        into: 'server.doc',
      }),
    )
    expect(ofKind(s1.changes, 'message').map((c) => [c.op, c.transient])).toEqual([
      ['sent', undefined],
    ])
    const s2 = apply(
      s1.world,
      step(
        's02',
        { t: 'deliver', message: 'm1' },
        { t: 'send', from: 'server', to: 'bob', payload: 'ok', id: 'm2' },
        { t: 'deliver', message: 'm2' },
        { t: 'set', path: 'bob.doc', value: 'touched' },
      ),
    )
    expect(s2.changes).toEqual([
      { kind: 'message', op: 'delivered', message: expect.objectContaining({ id: 'm1' }) },
      {
        kind: 'message',
        op: 'sent',
        message: expect.objectContaining({ id: 'm2' }),
        transient: true,
      },
      {
        kind: 'message',
        op: 'delivered',
        message: expect.objectContaining({ id: 'm2' }),
        transient: true,
      },
      { kind: 'value', path: 'bob.doc', op: 'changed', action: { key: 'stage.op.setPlain' } },
      {
        kind: 'value',
        path: 'server.doc.b',
        op: 'changed',
        via: 'm1',
        action: { key: 'stage.op.setPlain', by: 'alice' },
      },
      { kind: 'mark', id: 'k1', op: 'added' },
      { kind: 'mark', id: 'k2', op: 'added' },
    ])
  })

  it('a parked-then-dropped message and a sync event keep log order; message snapshots carry the state at the time', () => {
    const w = fixtureWorld()
    const s = apply(
      w,
      step(
        's01',
        { t: 'offline', actor: 'bob' },
        { t: 'send', from: 'alice', to: 'bob', payload: 1, id: 'm1' },
        { t: 'drop', message: 'm1' },
      ),
    )
    expect(ofKind(s.changes, 'message').map((c) => [c.op, c.message.state, c.transient])).toEqual([
      ['sent', 'parked', true],
      ['parked', 'parked', true],
      ['dropped', 'parked', true],
    ])
    expect(ofKind(s.changes, 'actor')).toEqual([{ kind: 'actor', id: 'bob', op: 'offline' }])
  })
})

describe('applyStep: errors carry the step id and command', () => {
  it('wraps path errors from the lenses', () => {
    let err: unknown
    try {
      apply(
        fixtureWorld(),
        step('s05', { t: 'tick' }, { t: 'set', path: 'alice.doc.title', value: 'x' }),
      )
    } catch (e) {
      err = e
    }
    expect(err).toBeInstanceOf(ReducerError)
    expect((err as ReducerError).ctx).toEqual({
      stepId: 's05',
      command: { t: 'set', path: 'alice.doc.title', value: 'x' },
      path: 'alice.doc.title',
    })
  })

  it('reduce itself adds context for callers without applyStep', () => {
    let err: unknown
    try {
      reduce(fixtureWorld(), { t: 'drop', message: 'x' }, ctx({ stepId: 's02' }))
    } catch (e) {
      err = e
    }
    expect((err as ReducerError).ctx).toMatchObject({
      stepId: 's02',
      command: { t: 'drop', message: 'x' },
    })
  })

  it('never mutates prev', () => {
    const prev = fixtureWorld()
    const json = JSON.stringify(prev)
    apply(
      prev,
      step(
        's01',
        { t: 'set', path: 'alice.doc', value: 'x' },
        { t: 'send', from: 'alice', to: 'bob', payload: 1 },
        { t: 'highlight', path: 'bob' },
      ),
    )
    expect(JSON.stringify(prev)).toBe(json)
  })
})

describe('expect / makeAssert (§4.5)', () => {
  afterEach(() => vi.restoreAllMocks())

  const w = slots(fixtureWorld(), 'alice', {
    txt: list(['w', 'h', 'a', 't'], 'text'),
    c: counter({ alice: 1, bob: 1 }),
    stamped: scalar('v', { ts: 2, node: 'bob' }),
    id: bytesOf('01a028e9b500'),
    r: rec({ a: scalar(1), b: list(['x']) }),
  })

  it('passes on plain-value equality; display:text lists also accept the joined string', () => {
    const ok = [
      { t: 'expect' as const, path: 'alice.doc', equals: 'hello' },
      { t: 'expect' as const, path: 'alice.txt', equals: ['w', 'h', 'a', 't'] },
      { t: 'expect' as const, path: 'alice.txt', equals: 'what' },
      { t: 'expect' as const, path: 'alice.c', equals: 2 },
      { t: 'expect' as const, path: 'alice.stamped@ts', equals: 2 },
      { t: 'expect' as const, path: 'alice.stamped@node', equals: 'bob' },
      { t: 'expect' as const, path: 'alice.id', equals: '01a028e9b500' },
      { t: 'expect' as const, path: 'alice.id[0..2]', equals: '01a0' },
      { t: 'expect' as const, path: 'alice.r', equals: { a: 1, b: ['x'] } },
    ]
    expect(() => apply(w, step('s01', ...ok))).not.toThrow()
    expect(apply(w, step('s01', ...ok)).changes).toEqual([])
  })

  it('throw mode: a failed or unresolvable expect is a ReducerError with the path', () => {
    let err: unknown
    try {
      apply(w, step('s04', { t: 'expect', path: 'alice.c', equals: 3 }))
    } catch (e) {
      err = e
    }
    expect(err).toBeInstanceOf(ReducerError)
    expect((err as ReducerError).message).toMatch(/expected 3, got 2/)
    expect((err as ReducerError).ctx).toMatchObject({ stepId: 's04', path: 'alice.c' })
    expect(() => apply(w, step('s04', { t: 'expect', path: 'alice.nope', equals: 1 }))).toThrow(
      ReducerError,
    )
    expect(() => apply(w, step('s04', { t: 'expect', path: 'alice.txt', equals: 'wha' }))).toThrow(
      ReducerError,
    )
  })

  it('warn mode logs and continues; ignore mode does nothing', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { world } = apply(
      w,
      step(
        's04',
        { t: 'expect', path: 'alice.c', equals: 3 },
        { t: 'expect', path: 'zed.x', equals: 1 },
      ),
      { assertMode: 'warn' },
    )
    expect(world).toEqual(w)
    expect(warn).toHaveBeenCalledTimes(2)
    warn.mockClear()
    apply(w, step('s04', { t: 'expect', path: 'alice.c', equals: 3 }), { assertMode: 'ignore' })
    expect(warn).not.toHaveBeenCalled()
    const assert = makeAssert('ignore')
    expect(assert(w, { t: 'expect', path: 'nope.nope', equals: 1 })).toBe(w)
  })
})

describe('applyStep: action labels folded into changes (§14 Change.action)', () => {
  const valuesOf = (changes: Change[]) => ofKind(changes, 'value')

  it('an action lands on the change at its path; a set of a record lands on the fields that changed', () => {
    const w = slots(fixtureWorld(), 'alice', { r: rec({ a: scalar(1), b: scalar(2) }) })
    const s = apply(
      w,
      step(
        's01',
        { t: 'set', path: 'alice.n', value: 2 },
        { t: 'set', path: 'alice.r', value: rec({ a: scalar(1), b: scalar(3) }) },
      ),
    )
    expect(valuesOf(s.changes)).toEqual([
      { kind: 'value', path: 'alice.n', op: 'changed', action: { key: 'stage.op.setPlain' } },
      { kind: 'value', path: 'alice.r.b', op: 'changed', action: { key: 'stage.op.setPlain' } },
    ])
  })

  it('a move / a range set (no change at their own path) ride on the nearest ancestor change', () => {
    const w = slots(fixtureWorld(), 'alice', { l: list(['a', 'b']), id: bytesOf('0011') })
    const s = apply(
      w,
      step(
        's01',
        { t: 'move', path: 'alice.l[b]', to: 0 },
        { t: 'set', path: 'alice.id[0..1]', value: [0xff] as never },
      ),
    )
    expect(valuesOf(s.changes)).toEqual([
      {
        kind: 'value',
        path: 'alice.l',
        op: 'changed',
        action: { key: 'stage.op.move', vars: { value: 'b' } },
      },
      { kind: 'value', path: 'alice.id', op: 'changed', action: { key: 'stage.op.setPlain' } },
    ])
  })

  it('the last action on a path wins; a CRDT op lands on the row it touched, in its actor', () => {
    const s = apply(
      fixtureWorld(),
      step(
        's01',
        { t: 'crdt.init', actors: ['alice', 'bob'], slot: 'views', type: 'g-counter' },
        { t: 'crdt.update', actor: 'alice', slot: 'views', op: 'inc' },
        { t: 'crdt.update', actor: 'alice', slot: 'views', op: 'inc', args: [2] },
        { t: 'set', path: 'alice.n', value: 5 },
        { t: 'set', path: 'alice.n', value: 6 },
      ),
    )
    expect(valuesOf(s.changes)).toEqual([
      { kind: 'value', path: 'alice.n', op: 'changed', action: { key: 'stage.op.setPlain' } },
      {
        kind: 'value',
        path: 'alice.views',
        op: 'added',
        action: { key: 'stage.op.inc', vars: { n: 2 }, by: 'alice' },
      },
      { kind: 'value', path: 'bob.views', op: 'added' },
    ])
  })

  it('a whole-slot merge folds into every change under the slot; an unchanged side gets none', () => {
    const w0 = apply(
      fixtureWorld(),
      step(
        's00',
        { t: 'crdt.init', actors: ['alice', 'bob'], slot: 'cart', type: 'or-set' },
        { t: 'crdt.update', actor: 'alice', slot: 'cart', op: 'add', args: ['milk'] },
        { t: 'crdt.update', actor: 'alice', slot: 'cart', op: 'add', args: ['eggs'] },
      ),
    ).world
    const s = apply(w0, step('s01', { t: 'crdt.sync', a: 'alice', b: 'bob', slot: 'cart' }))
    expect(valuesOf(s.changes)).toEqual([
      {
        kind: 'value',
        path: 'bob.cart[eggs]',
        op: 'added',
        action: { key: 'stage.op.merge', by: 'alice' },
      },
      {
        kind: 'value',
        path: 'bob.cart[milk]',
        op: 'added',
        action: { key: 'stage.op.merge', by: 'alice' },
      },
    ])
  })
})
