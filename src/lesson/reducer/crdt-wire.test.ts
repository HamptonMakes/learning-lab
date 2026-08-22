import { describe, expect, it } from 'vitest'
import { initWorld } from './world'
import { applyStep } from './index'
import type { Step, World } from '../types'

const world0 = () =>
  initWorld({
    layout: 'pair',
    actors: [
      { id: 'alice', kind: 'person', label: 'Alice' },
      { id: 'bob', kind: 'person', label: 'Bob' },
    ],
  })

const run = (w: World, id: string, ...cmds: Step['do']) =>
  applyStep(w, { id, say: 'x', do: cmds }, { sceneId: 'sc', stepId: id, assertMode: 'throw' })

describe('wire: outbox chips and sync mode ops', () => {
  it('draws outbox chips only for slots declared wire: ops', () => {
    let w = world0()
    w = run(w, 's01', {
      t: 'crdt.init',
      actors: ['alice', 'bob'],
      slot: 'likes',
      type: 'g-counter',
    }).world
    w = run(w, 's02', {
      t: 'crdt.update',
      actor: 'alice',
      slot: 'likes',
      op: 'inc',
      args: [1],
    }).world
    expect(w.actors.alice?.outbox).toEqual([]) // state-driven: bookkeeping only
    let v = world0()
    v = run(v, 's01', {
      t: 'crdt.init',
      actors: ['alice', 'bob'],
      slot: 'likes',
      type: 'g-counter',
      args: { wire: 'ops' },
    }).world
    v = run(v, 's02', {
      t: 'crdt.update',
      actor: 'alice',
      slot: 'likes',
      op: 'inc',
      args: [1],
    }).world
    expect(v.actors.alice?.outbox).toEqual([{ slot: 'likes', id: 'alice:1', label: 'inc 1' }])
    v = run(v, 's03', { t: 'crdt.broadcast', from: 'alice', slot: 'likes' }).world
    expect(v.actors.alice?.outbox).toEqual([])
    expect(v.messages.map((m) => m.id)).toEqual(['alice:1@bob'])
  })

  it('routes crdt.sync mode ops through the message layer', () => {
    let w = world0()
    w = run(w, 's01', {
      t: 'crdt.init',
      actors: ['alice', 'bob'],
      slot: 'cart',
      type: 'or-set',
      args: { wire: 'ops' },
    }).world
    w = run(w, 's02', {
      t: 'crdt.update',
      actor: 'alice',
      slot: 'cart',
      op: 'add',
      args: ['milk'],
    }).world
    w = run(w, 's03', {
      t: 'crdt.update',
      actor: 'bob',
      slot: 'cart',
      op: 'add',
      args: ['eggs'],
    }).world
    const r = run(w, 's04', { t: 'crdt.sync', a: 'alice', b: 'bob', slot: 'cart', mode: 'ops' })
    expect(r.world.messages.map((m) => m.id).sort()).toEqual(['alice:1@bob', 'bob:1@alice'])
    expect(r.changes.filter((c) => c.kind === 'message' && c.op === 'sent')).toHaveLength(2)
    const done = run(
      r.world,
      's05',
      { t: 'deliver', message: 'alice:1@bob' },
      { t: 'deliver', message: 'bob:1@alice' },
    )
    expect(done.world.messages).toEqual([])
    const plain = (actor: string) => {
      const v = done.world.actors[actor]?.holds.cart
      return v?.kind === 'set'
        ? v.items
            .filter((i) => !i.value.meta?.tombstone)
            .map((i) => i.id)
            .sort()
        : null
    }
    expect(plain('alice')).toEqual(['eggs', 'milk'])
    expect(plain('bob')).toEqual(['eggs', 'milk'])
  })
})
