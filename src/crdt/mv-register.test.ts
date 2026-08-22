/** MV Register: siblings on concurrent writes, collapse on causal writes, merge laws, edge cases. */
import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import { makeCtx } from './types'
import { assertConvergence, assertMergeLaws, assertOpConvergence, canon } from './laws'
import { mvHasSiblings, mvRegister, mvRegisterClock, type MvRegisterType } from './mv-register'

const reg: MvRegisterType<string> = mvRegister

describe('mv-register: examples', () => {
  it('starts with no versions', () => {
    const s = reg.init('alice')
    expect(s).toEqual({ versions: [] })
    expect(reg.value(s)).toEqual([])
    expect(mvRegisterClock(s)).toEqual({})
    expect(mvHasSiblings(s)).toBe(false)
  })

  it('a write creates one version stamped with the writer’s clock', () => {
    const s = reg.update(reg.init('alice'), { set: 'cat' }, makeCtx('alice'))
    expect(s).toEqual({ versions: [{ value: 'cat', clock: { alice: 1 } }] })
    expect(reg.value(s)).toEqual(['cat'])
  })

  it('sequential writes on one replica replace each other (no siblings)', () => {
    const ctx = makeCtx('alice')
    const s1 = reg.update(reg.init('alice'), { set: 'cat' }, ctx)
    const s2 = reg.update(s1, { set: 'dog' }, ctx)
    expect(s2).toEqual({ versions: [{ value: 'dog', clock: { alice: 2 } }] })
    expect(mvHasSiblings(s2)).toBe(false)
  })

  it('concurrent writes become siblings after merge, in both directions', () => {
    const alice = reg.update(reg.init('alice'), { set: 'cat' }, makeCtx('alice'))
    const bob = reg.update(reg.init('bob'), { set: 'dog' }, makeCtx('bob'))
    const ab = reg.merge(alice, bob)
    const ba = reg.merge(bob, alice)
    expect(ab.versions).toEqual([
      { value: 'cat', clock: { alice: 1 } },
      { value: 'dog', clock: { bob: 1 } },
    ])
    expect(canon(ab)).toBe(canon(ba))
    expect(reg.value(ab)).toEqual(['cat', 'dog'])
    expect(mvHasSiblings(ab)).toBe(true)
    expect(mvRegisterClock(ab)).toEqual({ alice: 1, bob: 1 })
  })

  it('a write made after seeing both siblings collapses them into one version', () => {
    const alice = reg.update(reg.init('alice'), { set: 'cat' }, makeCtx('alice'))
    const bob = reg.update(reg.init('bob'), { set: 'dog' }, makeCtx('bob'))
    const aliceSeesBoth = reg.merge(alice, bob)
    const resolved = reg.update(aliceSeesBoth, { set: 'cat+dog' }, makeCtx('alice'))
    expect(resolved).toEqual({ versions: [{ value: 'cat+dog', clock: { alice: 2, bob: 1 } }] })
    // Bob, still holding his old write, merges and agrees — his version is dominated.
    expect(reg.merge(bob, resolved)).toEqual(resolved)
    expect(reg.merge(resolved, bob)).toEqual(resolved)
  })

  it('a write that saw only one sibling does NOT collapse the other', () => {
    const alice = reg.update(reg.init('alice'), { set: 'cat' }, makeCtx('alice'))
    const bob = reg.update(reg.init('bob'), { set: 'dog' }, makeCtx('bob'))
    const alice2 = reg.update(alice, { set: 'fish' }, makeCtx('alice'))
    const m = reg.merge(alice2, bob)
    expect(m.versions).toEqual([
      { value: 'fish', clock: { alice: 2 } },
      { value: 'dog', clock: { bob: 1 } },
    ])
    expect(reg.value(m)).toEqual(['fish', 'dog'])
  })

  it('three replicas: carol sees both siblings and resolves; everyone converges', () => {
    const alice = reg.update(reg.init('alice'), { set: 'cat' }, makeCtx('alice'))
    const bob = reg.update(reg.init('bob'), { set: 'dog' }, makeCtx('bob'))
    const carol = reg.merge(reg.merge(reg.init('carol'), alice), bob)
    expect(reg.value(carol)).toEqual(['cat', 'dog'])
    const carolResolved = reg.update(carol, { set: 'bird' }, makeCtx('carol'))
    expect(carolResolved.versions).toEqual([
      { value: 'bird', clock: { alice: 1, bob: 1, carol: 1 } },
    ])
    const aliceFinal = reg.merge(alice, carolResolved)
    const bobFinal = reg.merge(reg.merge(bob, alice), carolResolved)
    expect(canon(aliceFinal)).toBe(canon(carolResolved))
    expect(canon(bobFinal)).toBe(canon(carolResolved))
  })

  it('equal values written concurrently are still two siblings (two writes happened)', () => {
    const alice = reg.update(reg.init('alice'), { set: 'cat' }, makeCtx('alice'))
    const bob = reg.update(reg.init('bob'), { set: 'cat' }, makeCtx('bob'))
    const m = reg.merge(alice, bob)
    expect(m.versions).toHaveLength(2)
    expect(reg.value(m)).toEqual(['cat', 'cat'])
  })
})

describe('mv-register: op-based', () => {
  it('prepare builds the new version from the clocks it has seen; effect merges it in', () => {
    const alice = reg.update(reg.init('alice'), { set: 'cat' }, makeCtx('alice'))
    const bob = reg.update(reg.init('bob'), { set: 'dog' }, makeCtx('bob'))
    const both = reg.merge(alice, bob)
    const op = reg.prepare(both, { set: 'bird' }, makeCtx('carol'))
    expect(op).toEqual({ version: { value: 'bird', clock: { alice: 1, bob: 1, carol: 1 } } })
    expect(reg.effect(both, op)).toEqual(reg.update(both, { set: 'bird' }, makeCtx('carol')))
    // Delivered to a replica that only had Alice's write: Bob's is dominated too.
    expect(reg.effect(alice, op)).toEqual({ versions: [op.version] })
  })

  it('effects commute and a replayed op is a no-op', () => {
    const opA = reg.prepare(reg.init('alice'), { set: 'cat' }, makeCtx('alice'))
    const opB = reg.prepare(reg.init('bob'), { set: 'dog' }, makeCtx('bob'))
    const ab = reg.effect(reg.effect(reg.init('carol'), opA), opB)
    const ba = reg.effect(reg.effect(reg.init('carol'), opB), opA)
    expect(canon(ab)).toBe(canon(ba))
    expect(canon(reg.effect(ab, opA))).toBe(canon(ab))
    expect(canon(reg.effect(ab, opB))).toBe(canon(ab))
  })
})

const updateArb = () => fc.integer({ min: 0, max: 9 }).map((set) => ({ set }))

describe('mv-register: laws', () => {
  it('merge is commutative, associative, idempotent', () => {
    assertMergeLaws({ type: mvRegister, args: undefined, updateArb })
  })
  it('replicas converge under random updates and gossip', () => {
    assertConvergence({ type: mvRegister, args: undefined, updateArb })
  })
  it('op-based replicas converge under any causal delivery order', () => {
    assertOpConvergence({ type: mvRegister, args: undefined, updateArb })
  })

  it('siblings appear exactly when writes are concurrent; a write that saw all collapses them', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 4 }), fc.integer({ min: 1, max: 4 }), (na, nb) => {
        let alice = reg.init('alice')
        let bob = reg.init('bob')
        const ca = makeCtx('alice')
        const cb = makeCtx('bob')
        for (let i = 0; i < na; i++) alice = reg.update(alice, { set: `a${i}` }, ca)
        for (let i = 0; i < nb; i++) bob = reg.update(bob, { set: `b${i}` }, cb)
        const merged = reg.merge(alice, bob)
        expect(merged.versions).toHaveLength(2)
        expect(mvRegisterClock(merged)).toEqual({ alice: na, bob: nb })
        const resolved = reg.update(merged, { set: 'r' }, cb)
        expect(resolved.versions).toEqual([{ value: 'r', clock: { alice: na, bob: nb + 1 } }])
        expect(reg.merge(alice, resolved)).toEqual(resolved)
      }),
    )
  })
})

describe('mv-register: edge cases', () => {
  it('never mutates its inputs', () => {
    const s0 = reg.init('alice')
    Object.freeze(s0.versions)
    Object.freeze(s0)
    const s1 = reg.update(s0, { set: 'cat' }, makeCtx('alice'))
    expect(s0).toEqual({ versions: [] })
    Object.freeze(s1.versions)
    const v = s1.versions[0]
    if (v) Object.freeze(v.clock)
    const s2 = reg.update(s1, { set: 'dog' }, makeCtx('alice'))
    expect(s1).toEqual({ versions: [{ value: 'cat', clock: { alice: 1 } }] })
    const bob = reg.update(reg.init('bob'), { set: 'x' }, makeCtx('bob'))
    Object.freeze(bob.versions)
    const m = reg.merge(s2, bob)
    expect(s2.versions).toHaveLength(1)
    expect(m.versions).toHaveLength(2)
  })

  it('dominated and duplicate versions are dropped by merge', () => {
    const hand = {
      versions: [
        { value: 'old', clock: { alice: 1 } },
        { value: 'new', clock: { alice: 2 } },
        { value: 'new', clock: { alice: 2 } },
      ],
    }
    expect(reg.merge(hand, reg.init('bob'))).toEqual({
      versions: [{ value: 'new', clock: { alice: 2 } }],
    })
  })

  it('merge with an empty register is the identity; merge with itself is the identity', () => {
    const s = reg.update(
      reg.update(reg.init('alice'), { set: 'cat' }, makeCtx('alice')),
      { set: 'dog' },
      makeCtx('bob'),
    )
    expect(reg.merge(s, reg.init('carol'))).toEqual(s)
    expect(reg.merge(reg.init('carol'), s)).toEqual(s)
    expect(reg.merge(s, s)).toEqual(s)
  })

  it('clocks are canonical: sorted keys, no zero entries', () => {
    const bob = reg.update(reg.init('bob'), { set: 'dog' }, makeCtx('bob'))
    const alice = reg.update(reg.merge(reg.init('alice'), bob), { set: 'cat' }, makeCtx('alice'))
    expect(Object.keys(alice.versions[0]?.clock ?? {})).toEqual(['alice', 'bob'])
    const withZero = { versions: [{ value: 'z', clock: { zed: 0, alice: 1 } }] }
    expect(reg.update(withZero, { set: 'y' }, makeCtx('alice')).versions[0]?.clock).toEqual({
      alice: 2,
    })
  })

  it('a resolution write can be a JSON object; the value is kept by reference', () => {
    const t: MvRegisterType<{ n: number }> = mvRegister
    const obj = { n: 1 }
    const s = t.update(t.init('alice'), { set: obj }, makeCtx('alice'))
    expect(t.value(s)[0]).toBe(obj)
    expect(JSON.parse(JSON.stringify(s))).toEqual(s)
  })
})
