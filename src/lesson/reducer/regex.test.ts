import { describe, expect, it } from 'vitest'
import { plainValueAt } from '../path'
import { ReducerError } from '../types'
import { fixtureWorld, run } from './test-utils'

describe('regex commands', () => {
  it('regex.init creates the five engine slots and stores the VM state', () => {
    const { world } = run(fixtureWorld(), [
      { t: 'regex.init', actor: 'alice', pattern: 'a+b', input: 'xaab' },
    ])
    const holds = world.actors.alice?.holds ?? {}
    expect(Object.keys(holds)).toEqual([
      'doc',
      'n',
      'pattern',
      'text',
      'stack',
      'captures',
      'tries',
    ])
    expect(holds.pattern?.kind).toBe('pattern')
    expect(holds.text?.kind).toBe('text')
    expect(holds.stack?.kind).toBe('list')
    expect(holds.captures?.kind).toBe('record')
    expect(holds.tries?.kind).toBe('meter')
    expect(plainValueAt(world, 'alice.pattern')).toBe('a+b')
    expect(plainValueAt(world, 'alice.text')).toBe('xaab')
    expect(plainValueAt(world, 'alice.tries')).toBe(0)
    expect(world.engines.alice).toBeDefined()
  })

  it('regex.advance runs the VM and refreshes the slots; a finished engine is a no-op', () => {
    const init = run(fixtureWorld(), [
      { t: 'regex.init', actor: 'alice', pattern: 'a+b', input: 'xaab' },
    ]).world
    const stepped = run(init, [{ t: 'regex.advance', actor: 'alice', until: 'step' }]).world
    expect(plainValueAt(stepped, 'alice.tries')).toBe(1)
    const done = run(init, [{ t: 'regex.advance', actor: 'alice', until: 'end' }]).world
    expect(plainValueAt(done, 'alice.text@cursor')).toBe(4)
    expect((plainValueAt(done, 'alice.tries') as number) > 1).toBe(true)
    expect(run(done, [{ t: 'regex.advance', actor: 'alice', until: 'step' }]).world).toBe(done)
  })

  it('value commands on engine slots throw; re-init resets; errors are ReducerErrors', () => {
    const init = run(fixtureWorld(), [
      { t: 'regex.init', actor: 'alice', pattern: 'a+b', input: 'xaab' },
    ]).world
    expect(() => run(init, [{ t: 'set', path: 'alice.text', value: 'nope' }])).toThrow(
      /regex engine/,
    )
    expect(() => run(init, [{ t: 'annotate', path: 'alice.text', from: 0, to: 1 }])).toThrow(
      /regex engine/,
    )
    // a non-engine slot on the same actor is still writable
    expect(() => run(init, [{ t: 'set', path: 'alice.doc', value: 'fine' }])).not.toThrow()
    const advanced = run(init, [{ t: 'regex.advance', actor: 'alice', until: 'end' }]).world
    const reset = run(advanced, [
      { t: 'regex.init', actor: 'alice', pattern: 'b', input: 'ab' },
    ]).world
    expect(plainValueAt(reset, 'alice.tries')).toBe(0)
    expect(plainValueAt(reset, 'alice.pattern')).toBe('b')
    expect(Object.keys(reset.actors.alice?.holds ?? {})).toEqual([
      'doc',
      'n',
      'pattern',
      'text',
      'stack',
      'captures',
      'tries',
    ])
    expect(() =>
      run(fixtureWorld(), [{ t: 'regex.advance', actor: 'alice', until: 'step' }]),
    ).toThrow(/no regex engine/)
    expect(() =>
      run(fixtureWorld(), [{ t: 'regex.init', actor: 'alice', pattern: '(', input: 'x' }]),
    ).toThrow(ReducerError)
    expect(() =>
      run(fixtureWorld(), [{ t: 'regex.init', actor: 'zed', pattern: 'a', input: 'x' }]),
    ).toThrow(/no actor/)
    const crdt = { ...fixtureWorld(), replicas: { alice: { text: {} as never } } }
    expect(() =>
      run(crdt, [{ t: 'regex.init', actor: 'alice', pattern: 'a', input: 'x' }]),
    ).toThrow(/CRDT-managed/)
  })
})
