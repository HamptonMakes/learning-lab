import { describe, expect, it } from 'vitest'
import type { ActionLabel, Change } from '@/lesson/types'
import { frame, world } from './message/testing'
import { deriveStageFrame } from './StageContext'

const value = (
  path: string,
  op: 'added' | 'changed' | 'removed' | 'meta',
  action: ActionLabel,
): Change => ({
  kind: 'value',
  path,
  op,
  action,
})
const actionsOf = (changes: Change[]) =>
  Object.fromEntries(deriveStageFrame(frame(world({}), changes)).actions)

describe('deriveStageFrame — where action chips draw', () => {
  it('on the changed node itself', () => {
    const inc: ActionLabel = { key: 'stage.op.inc', vars: { n: 1 }, by: 'alice' }
    expect(actionsOf([value('alice.views[alice]', 'changed', inc)])).toEqual({
      'alice.views[alice]': inc,
    })
  })

  it("on a removed node's container (the node itself is gone)", () => {
    const del: ActionLabel = { key: 'stage.op.deletePlain', vars: { value: 'milk' } }
    expect(actionsOf([value('alice.cart[milk]', 'removed', del)])).toEqual({ 'alice.cart': del })
  })

  it('once on the slot root when one action was folded into several nodes of the slot', () => {
    const merge: ActionLabel = { key: 'stage.op.merge', by: 'alice' }
    expect(
      actionsOf([value('bob.cart[milk]', 'added', merge), value('bob.cart[eggs]', 'added', merge)]),
    ).toEqual({ 'bob.cart': merge })
    // different actions on sibling nodes each keep their node
    const milk: ActionLabel = { key: 'stage.op.addTag', vars: { value: 'milk', tag: 'a:1' } }
    const eggs: ActionLabel = { key: 'stage.op.addTag', vars: { value: 'eggs', tag: 'a:2' } }
    expect(
      actionsOf([value('bob.cart[milk]', 'added', milk), value('bob.cart[eggs]', 'added', eggs)]),
    ).toEqual({ 'bob.cart[milk]': milk, 'bob.cart[eggs]': eggs })
  })

  it('ignores changes without an action', () => {
    expect(actionsOf([{ kind: 'value', path: 'alice.doc', op: 'changed' }])).toEqual({})
  })
})
