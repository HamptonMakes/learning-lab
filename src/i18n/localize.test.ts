import { describe, expect, it } from 'vitest'
import { applyOverlay, collectStrings, overlayKey } from './localize'

const topic = {
  id: 'lww',
  title: 'LWW register',
  summary: 'Last writer wins.',
  version: 2,
  tags: ['crdt', 'register'],
  meta: { title: 'not localizable: no id' },
  scenes: [
    {
      id: 'basic',
      title: 'Two writers',
      steps: [
        { id: 's1', say: 'Alice writes A.', do: [{ op: 'set', label: 'A' }] },
        { id: 's2', say: 'Bob writes B.', note: 'Timestamps differ.', do: [] },
      ],
    },
  ],
  callouts: [{ id: 'c1', text: 'Clocks can lie.' }],
}

describe('collectStrings', () => {
  it('lists localizable strings on id-bearing objects with their id-chain path', () => {
    expect(collectStrings(topic)).toEqual([
      { path: 'lww', field: 'title', value: 'LWW register' },
      { path: 'lww', field: 'summary', value: 'Last writer wins.' },
      { path: 'lww.basic', field: 'title', value: 'Two writers' },
      { path: 'lww.basic.s1', field: 'say', value: 'Alice writes A.' },
      { path: 'lww.basic.s2', field: 'say', value: 'Bob writes B.' },
      { path: 'lww.basic.s2', field: 'note', value: 'Timestamps differ.' },
      { path: 'lww.c1', field: 'text', value: 'Clocks can lie.' },
    ])
  })

  it('honours a custom field list', () => {
    expect(collectStrings(topic, ['summary'])).toEqual([
      { path: 'lww', field: 'summary', value: 'Last writer wins.' },
    ])
  })

  it('handles primitives and arrays at the root', () => {
    expect(collectStrings('hello')).toEqual([])
    expect(collectStrings([{ id: 'a', say: 'x' }, 3, null])).toEqual([
      { path: 'a', field: 'say', value: 'x' },
    ])
  })
})

describe('applyOverlay', () => {
  it('replaces only the fields present in the overlay', () => {
    const out = applyOverlay(topic, {
      'lww.title': 'Registre LWW',
      'lww.basic.s1.say': 'Alice écrit A.',
      'lww.c1.text': 'Les horloges mentent.',
      'lww.meta.title': 'should be ignored (meta has no id)',
    })
    expect(out.title).toBe('Registre LWW')
    expect(out.summary).toBe('Last writer wins.')
    expect(out.scenes[0]?.steps[0]?.say).toBe('Alice écrit A.')
    expect(out.scenes[0]?.steps[1]?.say).toBe('Bob writes B.')
    expect(out.callouts[0]?.text).toBe('Les horloges mentent.')
    expect(out.meta.title).toBe('not localizable: no id')
    expect(out.version).toBe(2)
    expect(out.tags).toEqual(['crdt', 'register'])
  })

  it('returns a deep copy and never mutates the input', () => {
    const before = JSON.stringify(topic)
    const out = applyOverlay(topic, { 'lww.basic.s1.say': 'changed' })
    expect(JSON.stringify(topic)).toBe(before)
    expect(out).not.toBe(topic)
    expect(out.scenes).not.toBe(topic.scenes)
    expect(out.scenes[0]).not.toBe(topic.scenes[0])
    expect(out.scenes[0]?.steps[0]?.do).not.toBe(topic.scenes[0]?.steps[0]?.do)

    const same = applyOverlay(topic, {})
    expect(same).toEqual(topic)
    expect(same).not.toBe(topic)
  })

  it('never replaces the id itself and ignores non-string fields', () => {
    const data = { id: 'x', title: 7, say: 'hi' }
    const out = applyOverlay(data, { 'x.id': 'y', 'x.title': 'seven', 'x.say': 'salut' })
    expect(out).toEqual({ id: 'x', title: 7, say: 'salut' })
  })

  it('round-trips through collectStrings', () => {
    const overlay: Record<string, string> = {}
    for (const { path, field, value } of collectStrings(topic)) {
      overlay[overlayKey(path, field)] = value.toUpperCase()
    }
    const translated = applyOverlay(topic, overlay)
    const after = collectStrings(translated)
    expect(after.map((s) => `${s.path}.${s.field}`)).toEqual(
      collectStrings(topic).map((s) => `${s.path}.${s.field}`),
    )
    expect(after.map((s) => s.value)).toEqual(
      collectStrings(topic).map((s) => s.value.toUpperCase()),
    )
  })
})
