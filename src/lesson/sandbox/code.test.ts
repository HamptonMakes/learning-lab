/**
 * `extractFunction` pulls one function out of a real CRDT source file (free functions, object
 * methods, arrows, references, factory methods), `whatRan` names the CRDT functions a sandbox
 * step called, `whyNothingRan` explains delivery-layer steps. Sources come in through Vite `?raw`.
 */
/* oxlint-disable import/default -- `?raw` imports are Vite text modules; the import plugin cannot see their default export */
import { describe, expect, it } from 'vitest'
import gCounterSrc from '@/crdt/g-counter.ts?raw'
import gSetSrc from '@/crdt/g-set.ts?raw'
import hlcSrc from '@/crdt/hlc.ts?raw'
import lamportSrc from '@/crdt/lamport-clock.ts?raw'
import lwwRegisterSrc from '@/crdt/lww-register.ts?raw'
import mvRegisterSrc from '@/crdt/mv-register.ts?raw'
import vectorClockSrc from '@/crdt/vector-clock.ts?raw'
import { crdt, deliver, offline, tick } from '../builders'
import { applyStep, initWorld, makeReduceCtx, reduce } from '../reducer'
import type { Command, Frame, World } from '../types'
import { extractFunction, whatRan, whyNothingRan, wireFn } from './code'

// ─── extractFunction ─────────────────────────────────────────────────────────────────────────

describe('extractFunction', () => {
  it('extracts `merge` from lww-register (a free function with its doc comment)', () => {
    const fn = extractFunction(lwwRegisterSrc, 'merge')
    expect(fn).toBeDefined()
    if (!fn) return
    expect(fn.text).toContain('function merge<V>(a: LwwRegisterState<V>, b: LwwRegisterState<V>)')
    expect(fn.text).toContain('return compareStamp(b, a) > 0 ? b : a')
    expect(fn.text.trimEnd().endsWith('}')).toBe(true)
    // The doc comment above is kept as context, and `bodyStart` points at the declaration.
    expect(fn.text.startsWith('/** Returns the winning side itself')).toBe(true)
    expect(fn.bodyStart).toBe(fn.start + 1)
    expect(fn.end).toBeGreaterThan(fn.bodyStart)
    // Only this function: not its neighbours.
    expect(fn.text).not.toContain('function value')
    expect(fn.text).not.toContain('function update')
    // Line numbers match the file.
    const lines = lwwRegisterSrc.split('\n')
    expect(lines[fn.bodyStart - 1]).toContain('function merge<V>')
    expect(lines[fn.end - 1]).toBe('}')
  })

  it('skips interface properties named like the function (`value: V | null`) and finds the real one', () => {
    const fn = extractFunction(lwwRegisterSrc, 'value')
    expect(fn?.text).toContain('function value<V>(state: LwwRegisterState<V>)')
    expect(fn?.text).toContain('return state.value')
    const mv = extractFunction(mvRegisterSrc, 'value')
    expect(mv?.text).toContain('function value<V>(state: MvRegisterState<V>)')
  })

  it('extracts a multi-line parameter list (`prepare` in lww-register)', () => {
    const fn = extractFunction(lwwRegisterSrc, 'prepare')
    expect(fn?.text).toContain('function prepare<V>(')
    expect(fn?.text).toContain('return { set: u.set, ts: ctx.ts, node: ctx.node }')
    expect(fn?.text.trimEnd().endsWith('}')).toBe(true)
  })

  it('extracts object methods (g-counter) and dedents them; the trailing comma is dropped', () => {
    const fn = extractFunction(gCounterSrc, 'merge')
    expect(fn?.text.split('\n')[0]).toMatch(/^(\/\*\*|merge\()/)
    expect(fn?.text).toContain('merge(a: GCounterState, b: GCounterState): GCounterState {')
    expect(fn?.text.trimEnd().endsWith('}')).toBe(true)
    expect(fn?.text).not.toContain('value(state')
  })

  it('extracts methods of a factory (`gSetType<E>()`: 4-space indented)', () => {
    const fn = extractFunction(gSetSrc, 'effect')
    expect(fn?.text).toContain('effect(state: GSetState<E>, op: GSetOp<E>): GSetState<E> {')
    expect(fn?.text).toContain('if (Object.hasOwn(state.items, k)) return state')
    expect(fn?.text.trimEnd().endsWith('}')).toBe(true)
  })

  it('extracts arrow methods: one-line (lamport) and multi-line (hlc)', () => {
    const one = extractFunction(lamportSrc, 'merge')
    expect(one?.text.trim()).toBe('merge: (a, b) => Math.max(a, b)')
    expect(one?.start).toBe(one?.end)
    const multi = extractFunction(hlcSrc, 'effect')
    expect(multi?.text).toContain('effect: (state: Hlc, op: HlcOp) => {')
    expect(multi?.text.trimEnd().endsWith('}')).toBe(true)
  })

  it('follows a `name: otherFn,` reference (vector-clock merge → vcMerge)', () => {
    const fn = extractFunction(vectorClockSrc, 'merge')
    expect(fn?.text).toContain(
      'export function vcMerge(a: VectorClock, b: VectorClock): VectorClock {',
    )
    expect(fn?.text.trimEnd().endsWith('}')).toBe(true)
  })

  it('returns undefined when there is no declaration with a body', () => {
    expect(extractFunction(lwwRegisterSrc, 'nope')).toBeUndefined()
    expect(extractFunction('interface X {\n  merge(a: A, b: A): A\n}\n', 'merge')).toBeUndefined()
    expect(extractFunction('const merge = other(1)\n', 'merge')).toBeUndefined()
  })
})

// ─── whatRan / whyNothingRan ─────────────────────────────────────────────────────────────────

function world(cmds: Command[]): World {
  let w = initWorld({
    layout: 'pair',
    actors: [
      { id: 'alice', kind: 'person', label: 'Alice' },
      { id: 'bob', kind: 'person', label: 'Bob' },
    ],
  })
  const ctx = makeReduceCtx({ sceneId: 's', stepId: 't' })
  for (const c of cmds) w = reduce(w, c, ctx)
  return w
}

/** Run `cmds` as one sandbox-like step on `w` and return its frame. */
function step(w: World, cmds: Command[]): Frame {
  const s = { id: 'x1', say: '', do: cmds }
  const { world: next, changes } = applyStep(w, s, { sceneId: 's', stepId: 'x1' })
  return { index: 1, sceneId: 's', sceneIndex: 0, step: s, world: next, prev: w, changes }
}

describe('whatRan', () => {
  const base = world([
    crdt.init(['alice', 'bob'], 'status', 'lww-register', {
      seed: [{ op: 'set', args: ['Offline'] }],
    }),
    crdt.init(['alice', 'bob'], 'likes', 'op-counter', { wire: 'ops' }),
  ])

  it('crdt.update → prepare then effect of that type, naming the op id', () => {
    const f = step(base, [tick(), crdt.update('alice', 'status', 'set', 'Lunch')])
    expect(whatRan(f)).toEqual([
      {
        type: 'lww-register',
        fn: 'prepare',
        slot: 'status',
        details: [{ key: 'tryIt.code.detail.prepared', vars: { actor: 'Alice', id: 'alice:1' } }],
      },
      {
        type: 'lww-register',
        fn: 'effect',
        slot: 'status',
        details: [{ key: 'tryIt.code.detail.applied', vars: { actor: 'Alice', id: 'alice:1' } }],
      },
    ])
  })

  it('crdt.sync → merge, both directions merged into one block', () => {
    const f = step(base, [crdt.sync('alice', 'bob', 'status')])
    expect(whatRan(f)).toEqual([
      {
        type: 'lww-register',
        fn: 'merge',
        slot: 'status',
        details: [
          { key: 'tryIt.code.detail.merged', vars: { into: 'Alice', from: 'Bob' } },
          { key: 'tryIt.code.detail.merged', vars: { into: 'Bob', from: 'Alice' } },
        ],
      },
    ])
  })

  it('a delivered op → effect at the recipient; a delivered state → merge', () => {
    const w1 = world([
      crdt.init(['alice', 'bob'], 'likes', 'op-counter', { wire: 'ops' }),
      crdt.update('alice', 'likes', 'inc', 1),
      crdt.broadcast('alice', 'likes', { id: 'm1' }),
      crdt.init(['alice', 'bob'], 'status', 'lww-register'),
      crdt.send('alice', 'bob', 'status', { id: 'm2' }),
    ])
    const f = step(w1, [deliver('m1@bob'), deliver('m2')])
    expect(whatRan(f)).toEqual([
      {
        type: 'op-counter',
        fn: 'effect',
        slot: 'likes',
        details: [{ key: 'tryIt.code.detail.applied', vars: { actor: 'Bob', id: 'alice:1' } }],
      },
      {
        type: 'lww-register',
        fn: 'merge',
        slot: 'status',
        details: [{ key: 'tryIt.code.detail.merged', vars: { into: 'Bob', from: 'Alice' } }],
      },
    ])
  })

  it('delivery-layer steps run nothing, and whyNothingRan says which', () => {
    const sent = step(
      world([
        crdt.init(['alice', 'bob'], 'likes', 'op-counter', { wire: 'ops' }),
        crdt.update('alice', 'likes', 'inc', 1),
      ]),
      [crdt.broadcast('alice', 'likes')],
    )
    expect(whatRan(sent)).toEqual([])
    expect(whyNothingRan(sent)).toEqual({ key: 'tryIt.code.none.sent' })
    const off = step(base, [offline('bob')])
    expect(whatRan(off)).toEqual([])
    expect(whyNothingRan(off)).toEqual({ key: 'tryIt.code.none.network' })
    const clock = step(base, [tick()])
    expect(whyNothingRan(clock)).toEqual({ key: 'tryIt.code.none.tick' })
  })

  it('wireFn: merge for a state-wired slot, effect for an ops-wired one', () => {
    expect(wireFn(base.replicas.alice?.status)).toBe('merge')
    expect(wireFn(base.replicas.alice?.likes)).toBe('effect')
    expect(wireFn(undefined)).toBe('merge')
  })
})
