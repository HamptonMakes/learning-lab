import { describe, expect, it } from 'vitest'
import { plainValueAt } from '../path'
import { ReducerError, type Message, type World } from '../types'
import { findMessage } from './messages'
import { ctx, fixtureWorld, rec, run, scalar } from './test-utils'

const opMessage = (id: string, opId: string, to = 'bob'): Message => ({
  id,
  from: 'alice',
  to,
  payload: scalar('inc 1'),
  state: 'flying',
  data: {
    kind: 'op',
    slot: 'likes',
    op: { id: opId as `${string}:${number}`, op: {}, deps: {}, label: 'inc 1', ts: 0 },
  },
})

describe('send', () => {
  it('creates m1, m2… flying messages with scalar payloads and logs sent', () => {
    const c = ctx()
    const { world } = run(
      fixtureWorld(),
      [
        { t: 'send', from: 'alice', to: 'bob', payload: 'hi', label: 'say' },
        { t: 'send', from: 'bob', to: 'alice', payload: 2 },
      ],
      c,
    )
    expect(world.messages).toEqual([
      { id: 'm1', from: 'alice', to: 'bob', payload: scalar('hi'), state: 'flying', label: 'say' },
      { id: 'm2', from: 'bob', to: 'alice', payload: scalar(2), state: 'flying' },
    ])
    expect(world.ids).toBe(2)
    expect(
      c.log.events.map((e) => (e.kind === 'message' ? `${e.op}:${e.message.id}` : e.kind)),
    ).toEqual(['sent:m1', 'sent:m2'])
  })

  it('fans out with ids `${id}@${to}` (generated ids too) and keeps a Value payload', () => {
    const { world } = run(fixtureWorld(), [
      { t: 'send', from: 'alice', to: ['bob', 'server'], payload: rec({ a: scalar(1) }), id: 'x' },
      { t: 'send', from: 'alice', to: ['bob'], payload: 'y' },
    ])
    expect(world.messages.map((m) => m.id)).toEqual(['x@bob', 'x@server', 'm1@bob'])
    expect(world.messages[0]?.payload).toEqual(rec({ a: scalar(1) }))
  })

  it('snapshots { ref } payloads at send time (immutable afterwards)', () => {
    const { world } = run(fixtureWorld(), [
      {
        t: 'send',
        from: 'alice',
        to: 'bob',
        payload: { ref: 'alice.doc' },
        id: 'm1',
        into: 'bob.copy',
      },
      { t: 'set', path: 'alice.doc', value: 'changed' },
    ])
    expect(world.messages[0]?.payload).toEqual(scalar('hello'))
    expect(world.messages[0]?.into).toBe('bob.copy')
    expect(() =>
      run(fixtureWorld(), [{ t: 'send', from: 'alice', to: 'bob', payload: { ref: 'alice.zzz' } }]),
    ).toThrow(/ref "alice.zzz"/)
  })

  it('parks at an offline recipient: sent + parked in one step', () => {
    const c = ctx()
    const { world } = run(
      fixtureWorld(),
      [
        { t: 'offline', actor: 'bob' },
        { t: 'send', from: 'alice', to: ['bob', 'server'], payload: 'x', id: 'm' },
      ],
      c,
    )
    expect(world.messages.map((m) => [m.id, m.state])).toEqual([
      ['m@bob', 'parked'],
      ['m@server', 'flying'],
    ])
    expect(
      c.log.events.map((e) => (e.kind === 'message' ? `${e.op}:${e.message.id}` : e.kind)),
    ).toEqual(['sent:m@bob', 'parked:m@bob', 'sent:m@server'])
    expect(plainValueAt(world, 'bob@inbox')).toEqual(['m@bob'])
  })

  it('rejects collisions, self-sends, unknown actors and a mis-rooted into', () => {
    const w = run(fixtureWorld(), [
      { t: 'send', from: 'alice', to: 'bob', payload: 1, id: 'm1' },
    ]).world
    expect(() => run(w, [{ t: 'send', from: 'alice', to: 'bob', payload: 1, id: 'm1' }])).toThrow(
      /already in flight/,
    )
    expect(() => run(w, [{ t: 'send', from: 'alice', to: 'bob', payload: 1 }])).toThrow(
      /give "id" explicitly/,
    )
    expect(() => run(w, [{ t: 'send', from: 'alice', to: 'alice', payload: 1 }])).toThrow(/itself/)
    expect(() => run(w, [{ t: 'send', from: 'alice', to: 'zed', payload: 1 }])).toThrow(
      /no actor "zed"/,
    )
    expect(() => run(w, [{ t: 'send', from: 'zed', to: 'alice', payload: 1 }])).toThrow(
      /no actor "zed"/,
    )
    expect(() =>
      run(w, [{ t: 'send', from: 'alice', to: 'bob', payload: 1, id: 'x', into: 'server.doc' }]),
    ).toThrow(/must lie on the recipient/)
    expect(() =>
      run(w, [{ t: 'send', from: 'alice', to: 'bob', payload: 1, id: 'x', into: 'bob' }]),
    ).toThrow(/names a slot/)
    expect(() =>
      run(w, [{ t: 'send', from: 'alice', to: 'bob', payload: 1, id: 'x', into: 'bob@inbox' }]),
    ).toThrow(/selector/)
    expect(() =>
      run(w, [{ t: 'send', from: 'alice', to: 'bob', payload: 1, id: 'x', into: 'board.nope' }]),
    ).toThrow(/unknown board/)
    // a board is a fine destination
    expect(() =>
      run(w, [{ t: 'send', from: 'alice', to: 'bob', payload: 1, id: 'x', into: 'board.rule' }]),
    ).not.toThrow()
  })
})

describe('deliver', () => {
  it('writes a plain payload to into (creating the slot), logs delivered + via, and is transient in-step', () => {
    const c = ctx()
    const { world } = run(
      fixtureWorld(),
      [
        {
          t: 'send',
          from: 'alice',
          to: 'bob',
          payload: { ref: 'alice.doc' },
          id: 'm1',
          into: 'bob.copy',
        },
        { t: 'deliver', message: 'm1' },
      ],
      c,
    )
    expect(world.messages).toEqual([])
    expect(plainValueAt(world, 'bob.copy')).toBe('hello')
    expect(c.log.events).toEqual([
      {
        kind: 'message',
        op: 'sent',
        message: expect.objectContaining({ id: 'm1' }),
        transient: true,
      },
      {
        kind: 'message',
        op: 'delivered',
        message: expect.objectContaining({ id: 'm1' }),
        transient: true,
      },
      { kind: 'via', path: 'bob.copy', message: 'm1' },
      { kind: 'action', path: 'bob.copy', label: { key: 'stage.op.setPlain', by: 'alice' } },
    ])
  })

  it('is not transient across steps; deliver.into defaults to send.into and may be given when send had none', () => {
    const sent = run(fixtureWorld(), [
      { t: 'send', from: 'alice', to: 'bob', payload: 'v', id: 'm1' },
      { t: 'send', from: 'alice', to: 'bob', payload: 'w', id: 'm2', into: 'bob.w' },
    ]).world
    const c = ctx({ stepId: 's02' })
    const { world } = run(
      sent,
      [
        { t: 'deliver', message: 'm1', into: 'bob.v' },
        { t: 'deliver', message: 'm2' },
      ],
      c,
    )
    expect(plainValueAt(world, 'bob.v')).toBe('v')
    expect(plainValueAt(world, 'bob.w')).toBe('w')
    expect(c.log.events.every((e) => e.kind !== 'message' || e.transient === undefined)).toBe(true)
  })

  it('consumes a control message without into and logs via on the recipient card', () => {
    const c = ctx()
    const { world } = run(
      fixtureWorld(),
      [
        { t: 'send', from: 'server', to: 'bob', payload: 'wait', id: 'm4' },
        { t: 'deliver', message: 'm4' },
      ],
      c,
    )
    expect(world.messages).toEqual([])
    expect(world.actors.bob?.holds).toEqual(fixtureWorld().actors.bob?.holds)
    expect(c.log.events.at(-1)).toEqual({ kind: 'via', path: 'bob', message: 'm4' })
  })

  it('throws when deliver.into disagrees with send.into, when into is CRDT-managed, or the id is unknown', () => {
    const sent = run(fixtureWorld(), [
      { t: 'send', from: 'alice', to: 'bob', payload: 'v', id: 'm1', into: 'bob.a' },
    ]).world
    expect(() => run(sent, [{ t: 'deliver', message: 'm1', into: 'bob.b' }])).toThrow(/disagrees/)
    expect(() => run(sent, [{ t: 'deliver', message: 'm1', into: 'bob.a' }])).not.toThrow()
    const crdt: World = { ...sent, replicas: { bob: { a: {} as never } } }
    expect(() => run(crdt, [{ t: 'deliver', message: 'm1' }])).toThrow(/CRDT-managed/)
    expect(() => run(sent, [{ t: 'deliver', message: 'nope' }])).toThrow(/no message "nope"/)
  })

  it('park lands without effect; a later deliver applies a parked message', () => {
    const c1 = ctx()
    const parked = run(
      fixtureWorld(),
      [
        { t: 'send', from: 'alice', to: 'bob', payload: 'v', id: 'm1', into: 'bob.v' },
        { t: 'deliver', message: 'm1', park: true },
      ],
      c1,
    ).world
    expect(parked.messages.map((m) => [m.id, m.state])).toEqual([['m1', 'parked']])
    expect(parked.actors.bob?.holds.v).toBeUndefined()
    expect(c1.log.events.map((e) => (e.kind === 'message' ? e.op : e.kind))).toEqual([
      'sent',
      'parked',
    ])
    // parking twice is harmless
    expect(run(parked, [{ t: 'deliver', message: 'm1', park: true }]).world).toBe(parked)
    const c2 = ctx({ stepId: 's02' })
    const { world } = run(parked, [{ t: 'deliver', message: 'm1' }], c2)
    expect(plainValueAt(world, 'bob.v')).toBe('v')
    expect(world.messages).toEqual([])
    expect(c2.log.events[0]).toMatchObject({
      kind: 'message',
      op: 'delivered',
      message: { state: 'parked' },
    })
  })

  it('auto-parks a flying message whose recipient went offline; parked messages apply while offline', () => {
    const flying = run(fixtureWorld(), [
      { t: 'send', from: 'alice', to: 'bob', payload: 'v', id: 'm1', into: 'bob.v' },
    ]).world
    const c = ctx()
    const off = run(
      flying,
      [
        { t: 'offline', actor: 'bob' },
        { t: 'deliver', message: 'm1' },
      ],
      c,
    ).world
    expect(off.messages[0]?.state).toBe('parked')
    expect(c.log.events.map((e) => (e.kind === 'message' ? e.op : e.kind))).toEqual(['parked'])
    const applied = run(off, [{ t: 'deliver', message: 'm1' }]).world
    expect(plainValueAt(applied, 'bob.v')).toBe('v')
  })

  it('finds a message by bare op id when exactly one live message carries it', () => {
    const w: World = {
      ...fixtureWorld(),
      messages: [opMessage('alice:1@bob', 'alice:1'), opMessage('alice:2@bob', 'alice:2')],
    }
    expect(findMessage(w, 'alice:2', ctx(), undefined).id).toBe('alice:2@bob')
    expect(findMessage(w, 'alice:1@bob', ctx(), undefined).id).toBe('alice:1@bob')
    const dropped = run(w, [{ t: 'drop', message: 'alice:1' }]).world
    expect(dropped.messages.map((m) => m.id)).toEqual(['alice:2@bob'])
    const two: World = {
      ...w,
      messages: [
        opMessage('alice:1@bob', 'alice:1'),
        opMessage('alice:1@server', 'alice:1', 'server'),
      ],
    }
    expect(() => findMessage(two, 'alice:1', ctx(), undefined)).toThrow(/2 live messages/)
  })
})

describe('drop / duplicate / relay', () => {
  it('drop removes the message with a dropped event (transient when sent in-step)', () => {
    const c = ctx()
    const { world } = run(
      fixtureWorld(),
      [
        { t: 'send', from: 'alice', to: 'bob', payload: 1, id: 'm1' },
        { t: 'drop', message: 'm1' },
      ],
      c,
    )
    expect(world.messages).toEqual([])
    expect(c.log.events.map((e) => (e.kind === 'message' ? [e.op, e.transient] : e.kind))).toEqual([
      ['sent', true],
      ['dropped', true],
    ])
  })

  it('duplicate splits off a copy with a new id, same payload/into/label', () => {
    const c = ctx()
    const { world } = run(
      fixtureWorld(),
      [
        {
          t: 'send',
          from: 'alice',
          to: 'bob',
          payload: 'v',
          id: 'op1',
          into: 'bob.v',
          label: 'save',
        },
        { t: 'duplicate', message: 'op1', id: 'op1-retry' },
      ],
      c,
    )
    expect(world.messages).toEqual([
      {
        id: 'op1',
        from: 'alice',
        to: 'bob',
        payload: scalar('v'),
        state: 'flying',
        label: 'save',
        into: 'bob.v',
      },
      {
        id: 'op1-retry',
        from: 'alice',
        to: 'bob',
        payload: scalar('v'),
        state: 'flying',
        label: 'save',
        into: 'bob.v',
      },
    ])
    expect(
      c.log.events.map((e) => (e.kind === 'message' ? `${e.op}:${e.message.id}` : e.kind)),
    ).toEqual(['sent:op1', 'sent:op1-retry'])
    expect(() => run(world, [{ t: 'duplicate', message: 'op1', id: 'op1-retry' }])).toThrow(
      /already in flight/,
    )
  })

  it('relay delivers at the hub then forwards `${base}@${to}` copies with into rewritten to each recipient', () => {
    const c = ctx()
    const { world } = run(
      fixtureWorld(),
      [
        {
          t: 'send',
          from: 'alice',
          to: 'server',
          payload: { ref: 'alice.doc' },
          id: 'm-l@server',
          into: 'server.doc',
          label: 'save',
        },
        { t: 'relay', message: 'm-l@server', to: ['bob'] },
      ],
      c,
    )
    expect(plainValueAt(world, 'server.doc')).toBe('hello')
    expect(world.messages).toEqual([
      {
        id: 'm-l@bob',
        from: 'server',
        to: 'bob',
        payload: scalar('hello'),
        state: 'flying',
        label: 'save',
        into: 'bob.doc',
      },
    ])
    expect(
      c.log.events.map((e) =>
        e.kind === 'message'
          ? `${e.op}:${e.message.id}${e.transient ? '!' : ''}`
          : e.kind === 'via' || e.kind === 'action'
            ? `${e.kind}:${e.path}`
            : e.kind,
      ),
    ).toEqual([
      'sent:m-l@server!',
      'delivered:m-l@server!',
      'via:server.doc',
      'action:server.doc',
      'sent:m-l@bob',
    ])
  })

  it('relay keeps an id without the hub suffix as base, honours an explicit into, and needs an online hub', () => {
    const sent = run(fixtureWorld(), [
      { t: 'send', from: 'alice', to: 'server', payload: 'v', id: 'm1' },
    ]).world
    const { world } = run(sent, [{ t: 'relay', message: 'm1', to: 'bob', into: 'bob.inbound' }])
    expect(world.messages.map((m) => [m.id, m.into])).toEqual([['m1@bob', 'bob.inbound']])
    const off = run(sent, [{ t: 'offline', actor: 'server' }]).world
    expect(() => run(off, [{ t: 'relay', message: 'm1', to: 'bob' }])).toThrow(/offline/)
  })

  it('is deck-agnostic: many tokens on one arc are plain messages in creation order', () => {
    const cmds = [1, 2, 3, 4, 5, 6].map((n) => ({
      t: 'send' as const,
      from: 'alice',
      to: 'bob',
      payload: n,
    }))
    const { world } = run(fixtureWorld(), cmds)
    expect(world.messages.map((m) => m.id)).toEqual(['m1', 'm2', 'm3', 'm4', 'm5', 'm6'])
    expect(world.messages.every((m) => m.state === 'flying')).toBe(true)
  })

  it('wraps unknown ids in ReducerError with the command', () => {
    let err: unknown
    try {
      run(fixtureWorld(), [{ t: 'drop', message: 'ghost' }])
    } catch (e) {
      err = e
    }
    expect(err).toBeInstanceOf(ReducerError)
    expect((err as ReducerError).ctx).toMatchObject({
      stepId: 's01',
      command: { t: 'drop', message: 'ghost' },
    })
  })
})
