import { describe, expect, it } from 'vitest'
import { CRDT_NAMES, crdtRegistry, getCrdtType, isCrdtName, makeCtx, type CrdtName } from './index'

describe('crdt registry', () => {
  it('every registry key equals the implementation name', () => {
    for (const name of CRDT_NAMES) {
      expect(crdtRegistry[name].name).toBe(name)
    }
    expect(Object.keys(crdtRegistry).sort()).toEqual([...CRDT_NAMES].sort())
  })

  it('isCrdtName / getCrdtType agree with the registry', () => {
    for (const name of CRDT_NAMES) {
      expect(isCrdtName(name)).toBe(true)
      expect(getCrdtType(name)).toBe(crdtRegistry[name])
    }
    expect(isCrdtName('hlc')).toBe(false)
    expect(isCrdtName('')).toBe(false)
  })

  it('every registered type can init, update and merge through the erased interface', () => {
    const sample: Record<CrdtName, { args: unknown; update: unknown }> = {
      'lww-register': { args: undefined, update: { set: 'x' } },
      'lww-map': { args: undefined, update: { key: 'k', set: 'x' } },
      'mv-register': { args: undefined, update: { set: 'x' } },
      'g-counter': { args: undefined, update: { inc: 1 } },
      'pn-counter': { args: undefined, update: { dec: 1 } },
      'op-counter': { args: undefined, update: { add: 2 } },
      'g-set': { args: undefined, update: { add: 'milk' } },
      'two-phase-set': { args: undefined, update: { add: 'milk' } },
      'lww-element-set': { args: { bias: 'add' }, update: { add: 'milk' } },
      'or-set': { args: undefined, update: { add: 'milk' } },
      rga: { args: undefined, update: { insertAt: 0, value: 'a' } },
      'lamport-clock': { args: undefined, update: { tick: true } },
      'vector-clock': { args: undefined, update: { tick: true } },
    }
    for (const name of CRDT_NAMES) {
      const type = crdtRegistry[name]
      const { args, update } = sample[name]
      const a = type.init('alice', args)
      const b = type.init('bob', args)
      const ctx = makeCtx('alice', 1)
      const a1 = type.update(a, update, ctx)
      const op = type.prepare(a, update, makeCtx('alice', 1))
      const a2 = type.effect(a, op)
      expect(JSON.stringify(type.value(a2))).toBe(JSON.stringify(type.value(a1)))
      expect(() => type.merge(a1, b)).not.toThrow()
      expect(JSON.parse(JSON.stringify(a1))).toEqual(a1)
    }
  })
})
