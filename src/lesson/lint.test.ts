import { describe, expect, it } from 'vitest'
import {
  alice,
  bob,
  callout,
  check,
  compare,
  conflict,
  crdt,
  cross,
  deliver,
  drop,
  duplicate,
  highlight,
  lww,
  offline,
  relay,
  remove,
  same,
  scalar,
  scene,
  send,
  set,
  skew,
  step,
  tick,
  topic,
} from './builders'
import { fixtureTopics } from './fixtures'
import { LINT_RULES, enumeratePaths, formatLint, lintTopic, sayTokens, type LintRule } from './lint'
import type { Frame, Scene, Step, Topic, World } from './types'

/** A one-scene topic around `steps` (clock shown so tick/skew do not trip the hidden-clock rule). */
function topicOf(steps: Step[], opts?: { clockShown?: boolean; scenes?: Scene[] }): Topic {
  return topic({
    id: 't',
    title: 'T',
    goal: 'g',
    whenToUse: ['a'],
    whenNotToUse: ['b'],
    realWorld: 'r',
    scenes: opts?.scenes ?? [
      scene(
        'main',
        { layout: 'pair', clock: { show: opts?.clockShown ?? true }, actors: [alice(), bob()] },
        steps,
      ),
    ],
  })
}
const rulesOf = (t: Topic, frames?: Frame[]): LintRule[] => lintTopic(t, frames).map((i) => i.rule)
const only = (t: Topic, rule: LintRule, frames?: Frame[]) =>
  lintTopic(t, frames).filter((i) => i.rule === rule)

describe('lintTopic', () => {
  it('returns nothing for a clean scene and lists every rule name', () => {
    expect(lintTopic(topicOf([step('s01', 'One thing happens.', tick())]))).toEqual([])
    expect(LINT_RULES).toHaveLength(10)
  })

  it('say-length: more than two sentences or 160 characters is an error', () => {
    const long = topicOf([step('s01', 'One. Two. Three.', tick())])
    const issues = only(long, 'say-length')
    expect(issues).toHaveLength(1)
    expect(issues[0]).toMatchObject({
      level: 'error',
      topicId: 't',
      sceneId: 'main',
      stepId: 's01',
    })
    expect(only(topicOf([step('s01', `${'x'.repeat(161)}.`, tick())]), 'say-length')).toHaveLength(
      1,
    )
    expect(
      only(
        topicOf([step('s01', 'Alice writes alice:1 at t=2; e.g. 0.5 is fine.', tick())]),
        'say-length',
      ),
    ).toEqual([])
  })

  it('whoops: needs a conflict / cross / danger mark and a following step', () => {
    const noMark = topicOf([
      step('s01', 'Whoops: both wrote.', tick()),
      step('s02', 'The fix: merge.', tick()),
    ])
    expect(only(noMark, 'whoops').map((i) => i.message)).toEqual([
      expect.stringContaining('conflict, cross or danger-tone'),
    ])
    const lastStep = topicOf([
      step('s01', 'Alice writes.', set('alice.x', 1)),
      step('s02', 'Whoops — both wrote.', set('bob.x', 2), conflict('alice.x', 'bob.x')),
    ])
    expect(only(lastStep, 'whoops').map((i) => i.message)).toEqual([
      expect.stringContaining('last step'),
    ])
    for (const mark of [
      conflict('alice.x', 'bob.x'),
      cross('alice.x'),
      highlight('alice.x', { tone: 'danger' }),
      callout('alice.x', 'no', { tone: 'danger' }),
    ]) {
      const ok = topicOf([
        step('s01', 'Whoops, a race.', set('alice.x', 1), mark),
        step('s02', 'The fix.', tick()),
      ])
      expect(only(ok, 'whoops')).toEqual([])
    }
  })

  it('simplified: crdt.gc { unsafe } and delta sends want "(simplified)" in say', () => {
    const t = topicOf([
      step('s01', 'Init.', crdt.init(['alice', 'bob'], 'text', 'rga')),
      step('s02', 'Compact.', crdt.gc('alice', 'text', { unsafe: true })),
      step(
        's03',
        'Delta.',
        crdt.send('alice', 'bob', 'text', { id: 'm1', mode: 'delta' }),
        deliver('m1'),
      ),
    ])
    expect(only(t, 'simplified').map((i) => [i.stepId, i.level])).toEqual([
      ['s02', 'warning'],
      ['s03', 'warning'],
    ])
    const ok = topicOf([
      step('s01', 'Init.', crdt.init(['alice', 'bob'], 'text', 'rga')),
      step('s02', 'Compact (simplified).', crdt.gc('alice', 'text', { unsafe: true })),
      step(
        's03',
        'Send only the pending ops (simplified).',
        crdt.send('alice', 'bob', 'text', { id: 'm1', mode: 'delta' }),
        deliver('m1'),
      ),
      step('s04', 'A safe gc.', crdt.gc('alice', 'text', { upTo: { alice: 0 } })),
    ])
    expect(only(ok, 'simplified')).toEqual([])
  })

  it('glossary: **Term** must exist in src/content/glossary.ts', () => {
    const bad = topicOf([step('s01', 'A **Frobnicator** holds a value.', tick())])
    expect(only(bad, 'glossary')).toEqual([
      {
        level: 'error',
        topicId: 't',
        sceneId: 'main',
        stepId: 's01',
        rule: 'glossary',
        message: '**Frobnicator** has no glossary entry (src/content/glossary.ts)',
      },
    ])
    expect(
      only(
        topicOf([step('s01', 'An **LWW register** and a **vector clock**.', tick())]),
        'glossary',
      ),
    ).toEqual([])
  })

  it('undelivered: explicit message ids must be delivered or dropped before the scene ends', () => {
    const flying = topicOf([step('s01', 'Send.', send('alice', 'bob', 'hi', { id: 'm1' }))])
    expect(only(flying, 'undelivered')).toEqual([
      expect.objectContaining({
        level: 'error',
        stepId: 's01',
        message: expect.stringContaining('"m1"'),
      }),
    ])
    const fanOut = topicOf([
      step('s01', 'Send.', send('alice', ['bob', 'alice'], 'hi', { id: 'm1' }), deliver('m1@bob')),
    ])
    expect(only(fanOut, 'undelivered').map((i) => i.message)).toEqual([
      expect.stringContaining('"m1@alice"'),
    ])
    const crdtSend = topicOf([
      step('s01', 'Init.', crdt.init(['alice', 'bob'], 'x', 'g-counter')),
      step('s02', 'Send.', crdt.send('alice', 'bob', 'x', { id: 'm2' })),
    ])
    expect(only(crdtSend, 'undelivered')).toHaveLength(1)
    const broadcast = topicOf([
      step('s01', 'Init.', crdt.init(['alice', 'bob'], 'x', 'g-counter')),
      step('s02', 'Broadcast.', crdt.broadcast('alice', 'x', { id: 'alice:1' })),
    ])
    expect(only(broadcast, 'undelivered').map((i) => i.message)).toEqual([
      expect.stringContaining('"alice:1@bob"'),
    ])
    const parked = topicOf([
      step('s01', 'Offline.', offline('bob'), send('alice', 'bob', 'hi', { id: 'm1' })),
    ])
    expect(only(parked, 'undelivered')).toEqual([expect.objectContaining({ level: 'warning' })])
    const ok = topicOf([
      step('s01', 'Init.', crdt.init(['alice', 'bob'], 'x', 'g-counter')),
      step('s02', 'Plain.', send('alice', 'bob', 'hi', { id: 'm1' }), deliver('m1')),
      step(
        's03',
        'Retry and drop.',
        send('alice', 'bob', 'hi', { id: 'm2' }),
        duplicate('m2', 'm2-retry'),
        drop('m2-retry'),
        deliver('m2'),
      ),
      step(
        's04',
        'Relay.',
        send('alice', 'bob', 'hi', { id: 'm3' }),
        relay('m3', ['alice']),
        deliver('m3@alice'),
      ),
      step(
        's05',
        'Bare op id.',
        crdt.broadcast('alice', 'x', { id: 'alice:1' }),
        deliver('alice:1'),
      ),
      step('s06', 'Generated ids are not tracked.', send('alice', 'bob', 'hi')),
      step(
        's07',
        'Removed actor drops its mail.',
        send('alice', 'bob', 'hi', { id: 'm4' }),
        remove('bob'),
      ),
    ])
    expect(only(ok, 'undelivered')).toEqual([])
  })

  it('narration-only: more than 30% of a scene is an info', () => {
    const t = topicOf([step('s01', 'Talk.'), step('s02', 'Talk more.'), step('s03', 'Do.', tick())])
    expect(only(t, 'narration-only')).toEqual([
      expect.objectContaining({
        level: 'info',
        sceneId: 'main',
        message: expect.stringContaining('2 of 3'),
      }),
    ])
    expect(only(t, 'narration-only')[0]).not.toHaveProperty('stepId')
    expect(
      only(
        topicOf([
          step('s01', 'Talk.'),
          step('s02', 'Do.', tick()),
          step('s03', 'Do.', tick()),
          step('s04', 'Do.', tick()),
        ]),
        'narration-only',
      ),
    ).toEqual([])
  })

  it('compare-then-write: a later write in the same step to a compared path is a warning', () => {
    const t = topicOf([
      step('s01', 'Init.', crdt.init(['alice', 'bob'], 'x', 'lww-register')),
      step('s02', 'Compare then merge.', same('alice.x', 'bob.x'), crdt.merge('bob', 'alice', 'x')),
      step(
        's03',
        'Compare then set under it.',
        compare(['alice.doc', 'bob.doc']),
        set('alice.doc.title', 'y'),
      ),
      step(
        's04',
        'Compare a meta then update.',
        same('alice.x@ts', 'bob.x@ts'),
        lww('x').set('alice', 'v'),
      ),
      step(
        's05',
        'Compare then deliver into.',
        send('alice', 'bob', 'v', { id: 'm1', into: 'bob.doc' }),
        same('alice.doc', 'bob.doc'),
        deliver('m1'),
      ),
    ])
    expect(only(t, 'compare-then-write').map((i) => i.stepId)).toEqual(['s02', 's03', 's04', 's05'])
    const ok = topicOf([
      step('s01', 'Init.', crdt.init(['alice', 'bob'], 'x', 'lww-register')),
      step(
        's02',
        'Write first, then compare.',
        crdt.merge('bob', 'alice', 'x'),
        same('alice.x', 'bob.x'),
        check('alice.x'),
      ),
      step('s03', 'Unrelated write.', same('alice.x', 'bob.x'), set('alice.other', 1)),
    ])
    expect(only(ok, 'compare-then-write')).toEqual([])
  })

  it('hidden-clock: tick/skew with the HUD hidden is a warning (inherited through startFrom)', () => {
    const hidden = topicOf([step('s01', 'Tick.', tick()), step('s02', 'Skew.', skew('alice', 1))], {
      clockShown: false,
    })
    expect(only(hidden, 'hidden-clock')).toEqual([
      expect.objectContaining({ level: 'warning', stepId: 's01' }),
    ])
    expect(only(topicOf([step('s01', 'Tick.', tick())]), 'hidden-clock')).toEqual([])
    const inherited = topicOf([], {
      scenes: [
        scene('a', { layout: 'pair', clock: { show: true }, actors: [alice(), bob()] }, [
          step('s01', 'Go.', tick()),
        ]),
        scene('b', null, [step('s01', 'Tick again.', tick())], { startFrom: 'a' }),
      ],
    })
    expect(only(inherited, 'hidden-clock')).toEqual([])
  })

  it('mixed-sync: one slot driven state- and op-style is a warning', () => {
    const t = topicOf([
      step('s01', 'Init.', crdt.init(['alice', 'bob'], 'x', 'g-counter')),
      step('s02', 'State.', crdt.send('alice', 'bob', 'x', { id: 'm1' }), deliver('m1')),
      step('s03', 'Ops.', crdt.broadcast('alice', 'x', { id: 'alice:1' }), deliver('alice:1@bob')),
    ])
    expect(only(t, 'mixed-sync')).toEqual([
      expect.objectContaining({ level: 'warning', stepId: 's03' }),
    ])
    const ok = topicOf([
      step(
        's01',
        'Init.',
        crdt.init(['alice', 'bob'], 'x', 'g-counter'),
        crdt.init(['alice', 'bob'], 'y', 'g-counter'),
      ),
      step('s02', 'State on x.', crdt.sync('alice', 'bob', 'x'), crdt.merge('bob', 'alice', 'x')),
      step('s03', 'Ops on y.', crdt.sync('alice', 'bob', 'y', { mode: 'ops' })),
    ])
    expect(only(ok, 'mixed-sync')).toEqual([])
  })

  describe('narration-values (needs frames)', () => {
    const world: World = {
      layout: { preset: 'pair' },
      clock: { now: 2, show: true, format: 'counter' },
      actors: {
        alice: {
          id: 'alice',
          kind: 'person',
          label: 'Alice',
          color: 'a',
          online: true,
          holds: {
            status: scalar('Lunch', { ts: 2, node: 'bob' }),
            cart: {
              kind: 'set',
              items: [
                { id: 'milk', value: scalar('milk', { tags: [{ tag: 'alice:1', alive: true }] }) },
              ],
            },
            vc: { kind: 'clock', entries: { alice: 2, bob: 1 } },
            id: {
              kind: 'bytes',
              bytes: [
                0x01, 0xa0, 0x28, 0xe9, 0xb5, 0x00, 0x74, 0x71, 0xad, 0x66, 0xc0, 0x15, 0x8a, 0xf3,
                0x41, 0x02,
              ],
              display: 'hex',
              annotations: [{ from: 0, to: 6, label: 'unix ms (48 bits)' }],
            },
          },
          outbox: [],
        },
      },
      boards: {},
      messages: [],
      marks: [],
      replicas: {},
      engines: {},
      ids: 0,
    }
    const frameFor = (t: Topic): Frame[] =>
      t.scenes.flatMap((s) =>
        s.steps.map((st, i) => ({
          index: i,
          sceneId: s.id,
          sceneIndex: 0,
          step: st,
          world,
          prev: world,
          changes: [],
        })),
      )

    it('accepts ids, clock values, braces, quoted values and hex that the frame shows', () => {
      const t = topicOf([
        step(
          's01',
          'Bob wrote "Lunch" at t=2 (tag alice:1); the clock reads {alice 2, bob 1}.',
          tick(),
        ),
        step(
          's02',
          'Bytes 01 a0 28 e9 b5 00 then `Lunch`; canonical 01a028e9-b500-7471-ad66-c0158af34102.',
          tick(),
        ),
        step('s03', "Alice's status was lost; the label 'unix ms (48 bits)' stays.", tick()),
      ])
      expect(only(t, 'narration-values', frameFor(t))).toEqual([])
    })

    it('warns about tokens no value on the stage shows, and is skipped without frames', () => {
      const t = topicOf([
        step('s01', 'Bob wrote "Dinner" at t=9 with tag carol:4 and {alice 7}.', tick()),
      ])
      const issues = only(t, 'narration-values', frameFor(t))
      expect(issues.map((i) => i.level)).toEqual(['warning', 'warning', 'warning', 'warning'])
      expect(issues.map((i) => i.message)).toEqual([
        expect.stringContaining('"carol:4"'),
        expect.stringContaining('"t=9"'),
        expect.stringContaining('"alice:7"'),
        expect.stringContaining('"Dinner"'),
      ])
      expect(only(t, 'narration-values')).toEqual([])
    })

    it('sayTokens ignores plain numbers and prose; enumeratePaths reaches every value node', () => {
      expect(sayTokens('Start with 16 random bytes, like a v4 id.')).toEqual([])
      expect(sayTokens('Alice adds milk. The add gets the tag alice:1.')).toEqual([
        { text: 'alice:1', kind: 'exact' },
      ])
      expect(sayTokens('See [t=3](/crdts/x) and **alice:2**.').map((t) => t.text)).toEqual([
        'alice:2',
        't=3',
      ])
      const paths = enumeratePaths(world)
      expect(paths).toEqual(
        expect.arrayContaining([
          'alice.status',
          'alice.status@ts',
          'alice.status@node',
          'alice.cart',
          'alice.cart[milk]',
          'alice.cart[milk]@tags',
          'alice.vc',
          'alice.vc.alice',
          'alice.id[5]',
          'alice.id[0..16]',
          'alice@outbox',
          'alice@inbox',
        ]),
      )
      expect(paths).not.toContain('alice@clock')
    })
  })

  it('formatLint prints one line per issue', () => {
    const t = topicOf([step('s01', 'One. Two. Three.', tick())])
    expect(formatLint(lintTopic(t))).toBe(
      'error t/main/s01 [say-length] say has 3 sentences; the limit is 2 (split the step)',
    )
    expect(formatLint([])).toBe('')
  })

  it('the §15 fixtures and the kitchen sink are clean (errors and warnings)', () => {
    for (const t of fixtureTopics) {
      const issues = lintTopic(t).filter((i) => i.level !== 'info')
      expect(issues, formatLint(issues)).toEqual([])
      expect(rulesOf(t).filter((r) => r !== 'narration-only')).toEqual([])
    }
  })
})
