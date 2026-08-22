import { describe, expect, it } from 'vitest'
import type { Actor } from '@/lesson/types'
import { hubOf, placeActors } from './presets'

const actor = (id: string, kind: Actor['kind'] = 'person'): Actor => ({
  id,
  kind,
  label: id,
  color: 'a',
  online: true,
  holds: {},
  outbox: [],
})

const slotsOf = (placements: ReturnType<typeof placeActors>) =>
  placements.map((p) => `${p.actor.id}:${p.slot}`)

describe('placeActors', () => {
  const alice = actor('alice')
  const bob = actor('bob')
  const carol = actor('carol')
  const server = actor('server', 'server')

  it('assigns s1… in insertion order for row / pair / triangle / grid', () => {
    for (const preset of ['row', 'pair', 'triangle', 'grid'] as const) {
      expect(slotsOf(placeActors([alice, bob, carol], { preset }))).toEqual([
        'alice:s1',
        'bob:s2',
        'carol:s3',
      ])
    }
  })

  it('ignores layout.hub outside hub / ring presets', () => {
    expect(slotsOf(placeActors([alice, bob], { preset: 'pair', hub: 'bob' }))).toEqual([
      'alice:s1',
      'bob:s2',
    ])
  })

  it('gives the hub slot to layout.hub and numbers the rest in order', () => {
    expect(slotsOf(placeActors([alice, bob, server], { preset: 'hub', hub: 'bob' }))).toEqual([
      'alice:s1',
      'bob:hub',
      'server:s2',
    ])
  })

  it('defaults the hub to the first server / service', () => {
    expect(slotsOf(placeActors([alice, server, bob], { preset: 'ring' }))).toEqual([
      'alice:s1',
      'server:hub',
      'bob:s2',
    ])
    const service = actor('api', 'service')
    expect(slotsOf(placeActors([alice, service, server], { preset: 'hub' }))).toEqual([
      'alice:s1',
      'api:hub',
      'server:s2',
    ])
  })

  it('falls back to the first actor when there is no server and no valid layout.hub', () => {
    expect(slotsOf(placeActors([alice, bob], { preset: 'hub' }))).toEqual(['alice:hub', 'bob:s1'])
    expect(slotsOf(placeActors([alice, bob], { preset: 'hub', hub: 'ghost' }))).toEqual([
      'alice:hub',
      'bob:s1',
    ])
  })

  it('handles an empty world', () => {
    expect(placeActors([], { preset: 'hub' })).toEqual([])
    expect(hubOf([], { preset: 'hub' })).toBeUndefined()
  })
})
