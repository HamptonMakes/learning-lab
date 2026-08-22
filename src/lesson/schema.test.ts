import { describe, expect, expectTypeOf, it } from 'vitest'
import type { z } from 'zod'
import {
  ActorSchema,
  ActorSpecSchema,
  AnnotationSchema,
  BoardSchema,
  COMMAND_TS,
  CommandSchema,
  LOCALIZABLE_FIELDS,
  MetaSchema,
  SceneSchema,
  SceneWorldSchema,
  StepSchema,
  TopicSchema,
  TryItSchema,
  ValueSchema,
  ValueUnionSchema,
  isLocalizable,
  sayStats,
  validateTopic,
} from './schema'
import {
  ACTOR_COLORS,
  ACTOR_ICONS,
  ACTOR_KINDS,
  ACTOR_STATUSES,
  COMPARE_RULES,
  CRDT_NAMES,
  HOLDS,
  LAYOUT_PRESETS,
  TONES,
  VERDICTS,
  type ActorColor,
  type ActorIcon,
  type ActorKind,
  type ActorSpec,
  type ActorStatus,
  type Command,
  type CommandT,
  type CompareRule,
  type CrdtName,
  type Hold,
  type LayoutPreset,
  type Scene,
  type SceneWorld,
  type Step,
  type Tone,
  type Topic,
  type Value,
  type Verdict,
} from './types'

// ─── Fixture: a valid mini topic ──────────────────────────────────────────────────────────────

const topic: Topic = {
  id: 'lww-register',
  title: 'LWW Register',
  goal: 'Pick an LWW register for a single field and explain which write wins and why.',
  whenToUse: ['Single-value fields where "the newest edit wins" is what users expect.'],
  whenNotToUse: ['Two edits should both survive.'],
  realWorld: 'A status line set from phone and laptop.',
  scenes: [
    {
      id: 'update-and-merge',
      world: {
        layout: 'pair',
        clock: { show: true },
        actors: [
          { id: 'alice', kind: 'person', label: 'Alice', icon: 'phone' },
          { id: 'bob', kind: 'person', label: 'Bob', icon: 'laptop' },
        ],
        boards: [
          { id: 'rule', value: { kind: 'text', text: 'merge: newer ts wins', annotations: [] } },
        ],
      },
      steps: [
        {
          id: 's01',
          say: 'An **LWW register** holds a value and a timestamp. The sidecar also remembers who wrote it.',
          do: [
            {
              t: 'crdt.init',
              actors: ['alice', 'bob'],
              slot: 'status',
              type: 'lww-register',
              args: { seed: [{ op: 'set', args: ['Offline'] }] },
            },
            { t: 'highlight', path: ['alice.status@ts', 'alice.status@node'] },
          ],
        },
        {
          id: 's02',
          say: 'Time moves to 1. Alice sets her status; her copy records the value, t=1, node alice.',
          do: [
            { t: 'tick' },
            { t: 'crdt.update', actor: 'alice', slot: 'status', op: 'set', args: ['In a meeting'] },
            { t: 'expect', path: 'alice.status@ts', equals: 1 },
          ],
          hold: 'long',
        },
      ],
      tryIt: {
        slot: 'status',
        ops: [{ op: 'set', label: 'Set', args: 'prompt' }],
        network: ['sync'],
      },
    },
    {
      id: 'tie-break',
      startFrom: 'update-and-merge',
      steps: [
        {
          id: 's01',
          say: 'Whoops: both wrote at t=2.',
          do: [{ t: 'conflict', a: 'alice.status', b: 'bob.status' }],
        },
      ],
    },
  ],
}

/** A deep clone with one edit applied (the fixture stays pristine). */
function edited(f: (t: Topic) => void): unknown {
  const copy = JSON.parse(JSON.stringify(topic)) as Topic
  f(copy)
  return copy
}
const scene0 = (t: Topic) => t.scenes[0] as Scene
const world0 = (t: Topic) => scene0(t).world as SceneWorld
const actor0 = (t: Topic, i: number) => world0(t).actors[i] as ActorSpec
const step = (t: Topic, i: number) => scene0(t).steps[i] as Step

function issuesOf(input: unknown): string[] {
  const r = validateTopic(input)
  expect(r.ok).toBe(false)
  return r.ok ? [] : r.issues
}
const expectIssue = (input: unknown, pattern: RegExp) => {
  const issues = issuesOf(input)
  expect(
    issues.some((i) => pattern.test(i)),
    issues.join('\n'),
  ).toBe(true)
  return issues
}

// ─── Topic level ──────────────────────────────────────────────────────────────────────────────

describe('validateTopic', () => {
  it('accepts a valid mini topic and returns it typed', () => {
    const r = validateTopic(topic)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.topic).toEqual(topic)
  })

  it('a scene declares exactly one of world / startFrom', () => {
    expectIssue(
      edited((t) => {
        ;(t.scenes[1] as Scene).world = { actors: [] }
      }),
      /scenes\[1:tie-break\]: a scene declares exactly one of world \/ startFrom/,
    )
    expectIssue(
      edited((t) => {
        delete (t.scenes[1] as Scene).startFrom
      }),
      /exactly one of world \/ startFrom/,
    )
  })

  it('startFrom must name an earlier scene', () => {
    expectIssue(
      edited((t) => {
        ;(t.scenes[1] as Scene).startFrom = 'nope'
      }),
      /scenes\[1:tie-break\]\.startFrom: startFrom "nope" must name an earlier scene/,
    )
  })

  it('step ids are s\\d\\d and unique per scene', () => {
    expectIssue(
      edited((t) => {
        step(t, 1).id = 's01'
      }),
      /scenes\[0:update-and-merge\]\.steps\[1:s01\]: duplicate step id "s01"/,
    )
    for (const bad of ['s1', 'S01', 's001', '01', 'step1']) {
      expectIssue(
        edited((t) => {
          step(t, 1).id = bad
        }),
        /steps\[1:.*\]\.id: step ids are "s01"/,
      )
    }
  })

  it('scene ids are unique per topic', () => {
    expectIssue(
      edited((t) => {
        ;(t.scenes[1] as Scene).id = 'update-and-merge'
      }),
      /scenes\[1:update-and-merge\]: duplicate scene id/,
    )
  })

  it('narration: ≤ 2 sentences, ≤ 160 characters, straight quotes only', () => {
    expectIssue(
      edited((t) => {
        step(t, 0).say = 'One. Two. Three.'
      }),
      /steps\[0:s01\]\.say: say has 3 sentences; the limit is 2/,
    )
    expectIssue(
      edited((t) => {
        step(t, 0).say = 'A'.repeat(161)
      }),
      /say is 161 characters; the limit is 160/,
    )
    expectIssue(
      edited((t) => {
        step(t, 0).say = 'Bob said “hi” and left.'
      }),
      /straight quotes only/,
    )
    expectIssue(
      edited((t) => {
        step(t, 0).say = 'Alice’s copy wins.'
      }),
      /straight quotes only/,
    )
    expectIssue(
      edited((t) => {
        step(t, 0).say = ''
      }),
      /say: Too small/,
    )
  })

  it('world: ≤ 5 actors, no reserved ids, unique ids, labels ≤ 12, hub is an actor', () => {
    expectIssue(
      edited((t) => {
        world0(t).actors = ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => ({
          id,
          kind: 'person' as const,
          label: id,
        }))
      }),
      /scenes\[0:update-and-merge\]\.world\.actors: a world holds at most 5 actors/,
    )
    for (const id of ['board', 'msg']) {
      expectIssue(
        edited((t) => {
          actor0(t, 0).id = id
        }),
        /world\.actors\[0:(board|msg)\]\.id: "board" and "msg" are reserved/,
      )
    }
    expectIssue(
      edited((t) => {
        actor0(t, 1).id = 'alice'
      }),
      /world\.actors\[1:alice\]: duplicate actor id "alice"/,
    )
    expectIssue(
      edited((t) => {
        actor0(t, 0).label = 'Alice Wonderland'
      }),
      /world\.actors\[0:alice\]\.label: a label is at most 12 characters/,
    )
    expectIssue(
      edited((t) => {
        world0(t).hub = 'carol'
      }),
      /world\.hub: hub "carol" is not an actor/,
    )
    expectIssue(
      edited((t) => {
        world0(t).clock = { format: 'time' }
      }),
      /world\.clock\.start: format "time" needs a start/,
    )
  })

  it('unknown keys are rejected everywhere', () => {
    expectIssue(
      edited((t) => {
        ;(step(t, 1).do[0] as Record<string, unknown>).extra = true
      }),
      /steps\[1:s02\]\.do\[0:tick\]: Unrecognized key: "extra"/,
    )
    expectIssue(
      edited((t) => {
        ;(t as unknown as Record<string, unknown>).bogus = 1
      }),
      /\(topic\): Unrecognized key: "bogus"/,
    )
    expectIssue(
      edited((t) => {
        ;(actor0(t, 0) as Record<string, unknown>).colour = 'a'
      }),
      /world\.actors\[0:alice\]: Unrecognized key: "colour"/,
    )
  })

  it('paths are checked against the grammar, with the parse reason', () => {
    expectIssue(
      edited((t) => {
        step(t, 1).do[2] = { t: 'expect', path: 'alice..status', equals: 1 }
      }),
      /steps\[1:s02\]\.do\[2:expect\]\.path: malformed path "alice\.\.status": expected a key after "\."/,
    )
    expectIssue(
      edited((t) => {
        step(t, 0).do[1] = { t: 'highlight', path: ['alice.status', 'board'] }
      }),
      /do\[1:highlight\]\.path\[1\]: malformed path "board": "board" is a reserved root/,
    )
  })

  it('values: record ≤ 6 fields, ≤ 8 visible items, text ≤ 96, bytes in range, ids unique', () => {
    const scalar = (value: string): Value => ({ kind: 'scalar', value })
    const fields = (n: number) =>
      Array.from({ length: n }, (_, i) => ({ key: `k${i}`, value: scalar('v') }))
    const items = (n: number, tomb = 0) =>
      Array.from({ length: n }, (_, i) => ({
        id: `i${i}`,
        value:
          i < tomb
            ? ({ kind: 'scalar', value: 'v', meta: { tombstone: true } } as Value)
            : scalar('v'),
      }))
    const withBoard = (value: unknown) =>
      edited((t) => {
        world0(t).boards = [{ id: 'b', value: value as Value }]
      })
    expectIssue(
      withBoard({ kind: 'record', fields: fields(7) }),
      /boards\[0:b\]\.value\.fields: a record shows at most 6 fields/,
    )
    expect(validateTopic(withBoard({ kind: 'record', fields: fields(6) })).ok).toBe(true)
    expectIssue(
      withBoard({ kind: 'list', items: items(9) }),
      /value\.items: a list shows at most 8 visible items/,
    )
    expect(validateTopic(withBoard({ kind: 'list', items: items(10, 2) })).ok).toBe(true) // 8 visible + 2 tombstones
    expectIssue(withBoard({ kind: 'set', items: items(9) }), /a set shows at most 8 visible items/)
    expectIssue(
      withBoard({ kind: 'set', items: [...items(1), ...items(1)] }),
      /value\.items\[1:i0\]: duplicate item id "i0"/,
    )
    expectIssue(
      withBoard({ kind: 'text', text: 'x'.repeat(97), annotations: [] }),
      /text is at most 96 characters/,
    )
    expectIssue(
      withBoard({
        kind: 'bytes',
        bytes: [1, 2, 3],
        display: 'bits',
        range: [2, 5],
        annotations: [],
      }),
      /value\.range: range \[from, to\) must satisfy from < to <= 3/,
    )
    expectIssue(
      withBoard({ kind: 'bytes', bytes: [256], display: 'hex', annotations: [] }),
      /bytes\[0\]: Too big/,
    )
    expectIssue(
      withBoard({
        kind: 'record',
        fields: [
          { key: 'a', value: scalar('1') },
          { key: 'a', value: scalar('2') },
        ],
      }),
      /fields\[1\]: duplicate record field "a"/,
    )
    expectIssue(
      withBoard({
        kind: 'table',
        columns: [{ key: 'how', label: 'How' }],
        rows: [{ id: 'r1', cells: { use: scalar('x') } }],
      }),
      /rows\[0:r1\]\.cells\.use: cell "use" has no column/,
    )
    expectIssue(
      withBoard({ kind: 'list', items: [{ id: 'a]b', value: scalar('x') }] }),
      /items\[0:a\]b\]\.id: an item id never contains "\]"/,
    )
    expectIssue(
      withBoard({ kind: 'scalar', value: 'x', meta: { tag: 'nodot' } }),
      /value\.meta\.tag: expected a dot "node:seq"/,
    )
  })

  it('commands: scalar insert items with "]" are rejected; compare needs two paths', () => {
    expectIssue(
      edited((t) => {
        step(t, 1).do[2] = { t: 'insert', path: 'alice.list', item: 'a]b' }
      }),
      /do\[2:insert\]\.item: a scalar item becomes its own id and may not contain "\]"/,
    )
    expectIssue(
      edited((t) => {
        step(t, 1).do[2] = { t: 'compare', paths: ['alice.status'] }
      }),
      /do\[2:compare\]\.paths: compare needs at least two paths/,
    )
    expectIssue(
      edited((t) => {
        step(t, 1).do[2] = { t: 'annotate', path: 'alice.id', from: 4, to: 4 }
      }),
      /do\[2:annotate\]: annotate needs from < to/,
    )
    expectIssue(
      edited((t) => {
        step(t, 1).do[2] = { t: 'sort', path: 'alice.list', by: ['@'] as never }
      }),
      /do\[2:sort\]\.by\[0\]: /,
    )
  })

  it('an unknown command t names the discriminator', () => {
    expectIssue(
      edited((t) => {
        step(t, 1).do[2] = { t: 'crdt.apply', message: 'm1' } as never
      }),
      /do\[2:crdt\.apply\]\.t: Invalid discriminator value/,
    )
  })
})

// ─── Commands ─────────────────────────────────────────────────────────────────────────────────

/** One minimal valid sample per command; the mapped type makes this exhaustive at compile time. */
const samples: { [T in CommandT]: Extract<Command, { t: T }> } = {
  spawn: { t: 'spawn', actor: { id: 'carol', kind: 'person', label: 'Carol' } },
  remove: { t: 'remove', actor: 'carol' },
  removeBoard: { t: 'removeBoard', board: 'rule' },
  layout: { t: 'layout', preset: 'ring', hub: 'server' },
  tick: { t: 'tick', by: 150 },
  skew: { t: 'skew', actor: 'alice', by: 0 },
  offline: { t: 'offline', actor: 'alice' },
  online: { t: 'online', actor: 'alice' },
  status: { t: 'status', actor: 'alice', status: null },
  note: { t: 'note', id: 'rule', text: 'merge(a, b) = max(a, b)', tone: 'info', label: 'rule' },
  set: { t: 'set', path: 'alice.doc.title', value: 'Q3 plan v2' },
  patch: { t: 'patch', path: 'bob.likes', meta: { tag: 'alice:1' }, quiet: true },
  insert: { t: 'insert', path: 'alice.list', item: 'milk', index: 1 },
  delete: { t: 'delete', path: 'alice.list[milk]', tombstone: true },
  move: { t: 'move', path: 'bob.inbox[alice:2]', to: 1 },
  sort: { t: 'sort', path: 'server.chat', by: ['@ts', '.price', 'value', 'id'] },
  annotate: {
    t: 'annotate',
    path: 'laptop.id',
    from: 48,
    to: 52,
    unit: 'bit',
    label: 'version = 4',
    tone: 'change',
  },
  unannotate: { t: 'unannotate', path: 'laptop.id' },
  view: { t: 'view', path: 'laptop.id', display: 'bits', range: [6, 9] },
  send: {
    t: 'send',
    from: 'alice',
    to: ['server', 'bob'],
    payload: { ref: 'alice.doc' },
    id: 'm3',
    label: 'save',
    into: 'server.doc',
    stamp: 'clock',
  },
  deliver: { t: 'deliver', message: 'm3', into: 'server.doc', park: false, recv: 'clock' },
  drop: { t: 'drop', message: 'm1' },
  duplicate: { t: 'duplicate', message: 'op1', id: 'op1-retry' },
  relay: { t: 'relay', message: 'm-l@icloud', to: ['phone'], into: 'phone.doc' },
  highlight: { t: 'highlight', path: 'bob.status@ts', tone: 'warn', sticky: true, id: 'h1' },
  callout: {
    t: 'callout',
    at: 'server.doc.title',
    text: 'last write silently won',
    tone: 'warn',
    textId: 'won',
  },
  conflict: { t: 'conflict', a: 'alice.doc.title', b: 'bob.doc.title' },
  compare: { t: 'compare', paths: ['alice.A', 'bob.B'], expect: 'concurrent' },
  check: { t: 'check', path: 'bob.status' },
  cross: { t: 'cross', path: 'bob.status', sticky: true },
  clearMarks: { t: 'clearMarks' },
  unmark: { t: 'unmark', id: 'c1' },
  expect: { t: 'expect', path: 'alice.likes', equals: 2 },
  'crdt.init': {
    t: 'crdt.init',
    actors: ['alice', 'bob'],
    slot: 'status',
    type: 'max-register',
    args: { seed: [{ by: 'alice', op: 'set', args: [3], ts: 1 }], expose: ['vc'] },
  },
  'crdt.doc': {
    t: 'crdt.doc',
    actors: ['alice'],
    slot: 'list',
    fields: {
      title: 'lww-register',
      items: { set: { map: { name: { type: 'lww-register' }, qty: 'pn-counter' } } },
    },
  },
  'crdt.update': {
    t: 'crdt.update',
    actor: 'alice',
    slot: 'list',
    path: 'items[alice:1].qty',
    op: 'inc',
    args: [2],
  },
  'crdt.send': {
    t: 'crdt.send',
    from: 'alice',
    to: 'bob',
    slot: 'status',
    id: 'm1',
    mode: 'delta',
    label: 'state',
  },
  'crdt.broadcast': { t: 'crdt.broadcast', from: 'alice', slot: 'likes', to: ['server'] },
  'crdt.merge': { t: 'crdt.merge', into: 'bob', from: 'alice', slot: 'status' },
  'crdt.sync': { t: 'crdt.sync', a: 'alice', b: 'server', slot: 'note', mode: 'ops' },
  'crdt.gc': { t: 'crdt.gc', actor: 'alice', slot: 'text', upTo: { alice: 4, bob: 0 } },
  'regex.init': {
    t: 'regex.init',
    actor: 'matcher',
    pattern: 'c.t',
    input: 'the cat sat',
    flags: 'i',
  },
  'regex.advance': { t: 'regex.advance', actor: 'matcher', until: 'backtrack' },
}

describe('CommandSchema', () => {
  const expectedTs: CommandT[] = [
    'spawn',
    'remove',
    'removeBoard',
    'layout',
    'tick',
    'skew',
    'offline',
    'online',
    'status',
    'note',
    'set',
    'patch',
    'insert',
    'delete',
    'move',
    'sort',
    'annotate',
    'unannotate',
    'view',
    'send',
    'deliver',
    'drop',
    'duplicate',
    'relay',
    'highlight',
    'callout',
    'conflict',
    'compare',
    'check',
    'cross',
    'clearMarks',
    'unmark',
    'expect',
    'crdt.init',
    'crdt.doc',
    'crdt.update',
    'crdt.send',
    'crdt.broadcast',
    'crdt.merge',
    'crdt.sync',
    'crdt.gc',
    'regex.init',
    'regex.advance',
  ]

  it('has 43 commands, each t exactly once, in §4–§5 order', () => {
    expect(COMMAND_TS).toEqual(expectedTs)
    expect(COMMAND_TS).toHaveLength(43)
    expect(new Set(COMMAND_TS).size).toBe(43)
    expect(Object.keys(samples).sort()).toEqual([...expectedTs].sort())
  })

  it.each(Object.entries(samples))('accepts a valid %s', (_t, cmd) => {
    const r = CommandSchema.safeParse(cmd)
    expect(r.success, JSON.stringify(r.error?.issues)).toBe(true)
    expect(r.data).toEqual(cmd)
  })

  it.each(Object.entries(samples))('rejects an unknown key on %s', (_t, cmd) => {
    const r = CommandSchema.safeParse({ ...cmd, bogus: 1 })
    expect(r.success).toBe(false)
    expect(JSON.stringify(r.error?.issues)).toContain('bogus')
  })

  it('rejects a second t-less object and a missing required field', () => {
    expect(CommandSchema.safeParse({ path: 'alice.doc' }).success).toBe(false)
    expect(CommandSchema.safeParse({ t: 'set', path: 'alice.doc' }).success).toBe(false)
    expect(CommandSchema.safeParse({ t: 'crdt.update', actor: 'alice', slot: 's' }).success).toBe(
      false,
    )
    expect(CommandSchema.safeParse({ t: 'expect', path: 'alice.doc' }).success).toBe(false)
  })

  it('payloads accept values, scalars and refs', () => {
    const send = (payload: unknown) =>
      CommandSchema.safeParse({ t: 'send', from: 'a', to: 'b', payload }).success
    expect(send('wait')).toBe(true)
    expect(send(null)).toBe(true)
    expect(send({ ref: 'alice.doc' })).toBe(true)
    expect(send({ kind: 'scalar', value: 1 })).toBe(true)
    expect(send({ ref: 'alice..doc' })).toBe(false)
    expect(send({ kind: 'nope' })).toBe(false)
    expect(send([1])).toBe(false)
  })

  it('nested crdt.doc schemas are validated recursively', () => {
    const doc = (fields: unknown) =>
      CommandSchema.safeParse({ t: 'crdt.doc', actors: ['a'], slot: 's', fields }).success
    expect(doc({ a: { list: { map: { b: 'rga' } } } })).toBe(true)
    expect(doc({ a: { list: { map: { b: 'nope' } } } })).toBe(false)
    expect(doc({ a: { const: 'Lunch?' } })).toBe(true)
    expect(doc({ a: { const: { x: 1 } } })).toBe(false)
  })
})

// ─── Narration stats (§13) ────────────────────────────────────────────────────────────────────

describe('sayStats', () => {
  it.each<[string, number]>([
    ['An LWW register holds a value and a timestamp. The sidecar also remembers who wrote it.', 2],
    ['Take the current time as milliseconds since 1970: 1787392800000 (2026-08-22 10:00 UTC).', 1],
    [
      'One millisecond later, a new id starts with …b501. The time part is bigger, so the text sorts after.',
      2,
    ],
    ['Canonical text: 01a028e9-b500-7471-ad66-c0158af34102. The 7 shows the version.', 2],
    ["They sync. Bob's remove only covered alice:1, so alice:2 survives and milk is in.", 2],
    ['Use `a.*b` to match. It is greedy.', 2],
    ['Speed 0.5 is slow, e.g. on phones. Okay.', 2],
    ['Alice sets t=1. Bob sets t=2. Carol waits.', 3],
    ['Whoops — now we have a problem.', 1],
    ['Is it safe? Yes!', 2],
    ['He said "hi." Then left.', 2],
    ['It is safe (simplified).', 1],
    ['See [LWW](/crdts/state-based/lww-register) for more.', 1],
  ])('%s → %i sentences', (say, n) => {
    expect(sayStats(say).sentences).toBe(n)
  })

  it('counts visible characters (link targets and ** markup excluded)', () => {
    expect(sayStats('See [LWW](/crdts/state-based/lww-register) for more.').chars).toBe(
      'See LWW for more.'.length,
    )
    expect(sayStats('An **LWW register** holds `x`.').chars).toBe('An LWW register holds x.'.length)
  })
})

// ─── i18n marks (§12) ─────────────────────────────────────────────────────────────────────────

describe('LOCALIZABLE_FIELDS', () => {
  const option = (t: CommandT) => CommandSchema.options.find((o) => o.shape.t.value === t)
  const shapeOf = (t: CommandT) => option(t)?.shape as Record<string, z.ZodType> | undefined
  const valueVariant = (kind: Value['kind']) =>
    ValueUnionSchema.options.find((o) => o.shape.kind.value === kind)

  it('lists §12 and every listed field carries the Zod mark', () => {
    expect(LOCALIZABLE_FIELDS).toEqual([
      { kind: 'step', field: 'say' },
      { t: 'callout', field: 'text' },
      { t: 'note', field: 'text' },
      { t: 'note', field: 'label' },
      { t: 'send', field: 'label' },
      { t: 'crdt.send', field: 'label' },
      { kind: 'actor', field: 'label' },
      { kind: 'actor', field: 'subtitle' },
      { kind: 'board', field: 'label' },
      { kind: 'table', field: 'columns[].label' },
      { kind: 'annotation', field: 'label' },
      { kind: 'meta', field: 'note' },
      { kind: 'meter', field: 'label' },
      { kind: 'tryIt', field: 'ops[].label' },
    ])
    for (const entry of LOCALIZABLE_FIELDS) {
      if ('t' in entry) {
        const shape = shapeOf(entry.t)
        expect(shape?.[entry.field], `${entry.t}.${entry.field}`).toBeDefined()
        expect(isLocalizable(shape?.[entry.field] as z.ZodType), `${entry.t}.${entry.field}`).toBe(
          true,
        )
      }
    }
    expect(isLocalizable(StepSchema.shape.say)).toBe(true)
    expect(isLocalizable(ActorSpecSchema.shape.label)).toBe(true)
    expect(isLocalizable(ActorSpecSchema.shape.subtitle)).toBe(true)
    expect(isLocalizable(ActorSchema.shape.label)).toBe(true)
    expect(isLocalizable(BoardSchema.shape.label)).toBe(true)
    expect(isLocalizable(AnnotationSchema.shape.label)).toBe(true)
    expect(isLocalizable(MetaSchema.shape.note)).toBe(true)
    expect(isLocalizable(TryItSchema.shape.ops.element.shape.label)).toBe(true)
    const table = valueVariant('table')?.shape as {
      columns: z.ZodArray<z.ZodObject<{ label: z.ZodType }>>
    }
    expect(isLocalizable(table.columns.element.shape.label)).toBe(true)
    const meter = valueVariant('meter')?.shape as { label: z.ZodType }
    expect(isLocalizable(meter.label)).toBe(true)
  })

  it('data fields are not marked', () => {
    expect(isLocalizable(shapeOf('expect')?.path as z.ZodType)).toBe(false)
    expect(isLocalizable(shapeOf('regex.init')?.pattern as z.ZodType)).toBe(false)
    expect(isLocalizable(ActorSpecSchema.shape.id)).toBe(false)
    expect(isLocalizable(StepSchema.shape.id)).toBe(false)
  })
})

// ─── Structure schemas on their own ───────────────────────────────────────────────────────────

describe('pieces', () => {
  it('SceneWorldSchema / SceneSchema / StepSchema work standalone', () => {
    expect(SceneWorldSchema.safeParse({ actors: [] }).success).toBe(true)
    expect(SceneSchema.safeParse({ id: 's', world: { actors: [] }, steps: [] }).success).toBe(false) // needs a step
    expect(StepSchema.safeParse({ id: 's01', say: 'Hi.', do: [] }).success).toBe(true)
    expect(StepSchema.safeParse({ id: 's01', say: 'Hi.', do: [], hold: 'soon' }).success).toBe(
      false,
    )
  })
  it('ValueSchema accepts every kind', () => {
    const ok = (v: Value) => expect(ValueSchema.safeParse(v).success, v.kind).toBe(true)
    ok({ kind: 'scalar', value: null })
    ok({ kind: 'record', fields: [], display: 'tree' })
    ok({ kind: 'list', items: [{ id: 'a', value: { kind: 'scalar', value: 1 } }], display: 'text' })
    ok({ kind: 'set', items: [] })
    ok({ kind: 'counter', rows: [{ node: 'alice', inc: 2, dec: 1 }], total: 1 })
    ok({ kind: 'clock', entries: { alice: 2 } })
    ok({
      kind: 'table',
      columns: [{ key: 'a', label: 'A' }],
      rows: [{ id: 'r', cells: { a: { kind: 'scalar', value: 1 } } }],
    })
    ok({
      kind: 'bytes',
      bytes: [0, 255],
      display: 'bits',
      range: [0, 2],
      annotations: [{ from: 0, to: 4, unit: 'bit' }],
    })
    ok({ kind: 'text', text: 'cat', cursor: 1, annotations: [{ from: 0, to: 1, tone: 'ok' }] })
    ok({ kind: 'pattern', tokens: [{ id: 'p0', src: 'c', kind: 'literal' }], cursor: 0 })
    ok({ kind: 'meter', value: 6, max: 24, label: 'values read' })
    expect(ValueSchema.safeParse({ kind: 'tree', nodes: [] }).success).toBe(false)
  })
})

// ─── Type-level contract: schemas infer the spec types; const lists cover their unions ────────

describe('types', () => {
  it('compile-time checks hold', () => {
    // The inferred schema types and the spec types are mutually assignable (expect-type's identity
    // check is stricter than TypeScript's own `?:` handling, so both directions are asserted).
    expectTypeOf<z.infer<typeof CommandSchema>>().toExtend<Command>()
    expectTypeOf<Command>().toExtend<z.infer<typeof CommandSchema>>()
    expectTypeOf<z.infer<typeof TopicSchema>>().toExtend<Topic>()
    expectTypeOf<Topic>().toExtend<z.infer<typeof TopicSchema>>()
    expectTypeOf<z.infer<typeof ValueSchema>>().toExtend<Value>()
    expectTypeOf<Value>().toExtend<z.infer<typeof ValueSchema>>()
    expectTypeOf<(typeof TONES)[number]>().toEqualTypeOf<Tone>()
    expectTypeOf<(typeof VERDICTS)[number]>().toEqualTypeOf<Verdict>()
    expectTypeOf<(typeof COMPARE_RULES)[number]>().toEqualTypeOf<CompareRule>()
    expectTypeOf<(typeof LAYOUT_PRESETS)[number]>().toEqualTypeOf<LayoutPreset>()
    expectTypeOf<(typeof ACTOR_KINDS)[number]>().toEqualTypeOf<ActorKind>()
    expectTypeOf<(typeof ACTOR_ICONS)[number]>().toEqualTypeOf<ActorIcon>()
    expectTypeOf<(typeof ACTOR_COLORS)[number]>().toEqualTypeOf<ActorColor>()
    expectTypeOf<(typeof ACTOR_STATUSES)[number]>().toEqualTypeOf<ActorStatus>()
    expectTypeOf<(typeof CRDT_NAMES)[number]>().toEqualTypeOf<CrdtName>()
    expectTypeOf<(typeof HOLDS)[number]>().toEqualTypeOf<Hold>()
    expect(CRDT_NAMES).toContain('max-register')
    expect(CRDT_NAMES).toContain('hlc')
    expect(CRDT_NAMES).toHaveLength(15)
  })
})
