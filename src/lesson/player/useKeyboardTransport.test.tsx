import { cleanup, renderHook } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createInitialState, type PlayerState } from './machine'
import {
  handleTransportKey,
  stepSpeed,
  useKeyboardTransport,
  type KeyboardTransportApi,
} from './useKeyboardTransport'

function fakeApi(over: Partial<PlayerState> = {}): KeyboardTransportApi & {
  /** Every call in chronological order, e.g. `seek(4)`. */
  calls: () => string[]
} {
  const log: string[] = []
  const spy =
    (name: string) =>
    (...args: unknown[]) => {
      log.push(args.length ? `${name}(${args.join(',')})` : `${name}()`)
    }
  return {
    state: { ...createInitialState({ total: 5 }), ...over },
    next: vi.fn(spy('next')),
    prev: vi.fn(spy('prev')),
    toggle: vi.fn(spy('toggle')),
    pause: vi.fn(spy('pause')),
    seek: vi.fn(spy('seek')),
    setSpeed: vi.fn(spy('setSpeed')),
    calls: () => [...log],
  }
}

const user = userEvent.setup()

afterEach(() => {
  cleanup() // vitest has no globals: RTL does not auto-clean, and stale listeners would swallow keys
  document.body.innerHTML = ''
})

describe('stepSpeed', () => {
  it('walks SPEEDS and clamps at both ends', () => {
    expect(stepSpeed(1, 1)).toBe(1.5)
    expect(stepSpeed(1, -1)).toBe(0.75)
    expect(stepSpeed(3, 1)).toBe(3)
    expect(stepSpeed(0.5, -1)).toBe(0.5)
  })
})

describe('useKeyboardTransport', () => {
  let api: ReturnType<typeof fakeApi>
  beforeEach(() => {
    api = fakeApi()
  })

  it('maps the keys in LTR', async () => {
    renderHook(() => useKeyboardTransport(api, { dir: 'ltr' }))
    await user.keyboard('{ArrowRight}{ArrowLeft} {Home}{End}.,{Escape}')
    expect(api.calls()).toEqual([
      'next()',
      'prev()',
      'toggle()',
      'seek(0)',
      'seek(4)',
      'setSpeed(1.5)',
      'setSpeed(0.75)',
      'pause()',
    ])
  })

  it('swaps the arrows in RTL', async () => {
    renderHook(() => useKeyboardTransport(api, { dir: 'rtl' }))
    await user.keyboard('{ArrowRight}{ArrowLeft}')
    expect(api.calls()).toEqual(['prev()', 'next()'])
  })

  it('prevents the default for handled keys (Space must not scroll) and not for others', () => {
    renderHook(() => useKeyboardTransport(api))
    const space = new KeyboardEvent('keydown', { key: ' ', cancelable: true, bubbles: true })
    window.dispatchEvent(space)
    expect(space.defaultPrevented).toBe(true)
    const other = new KeyboardEvent('keydown', { key: 'x', cancelable: true, bubbles: true })
    window.dispatchEvent(other)
    expect(other.defaultPrevented).toBe(false)
    expect(api.calls()).toEqual(['toggle()'])
  })

  it('ignores keys with meta / ctrl / alt held and already-handled events', async () => {
    renderHook(() => useKeyboardTransport(api))
    await user.keyboard('{Control>}{ArrowRight}{/Control}{Meta>}{ArrowLeft}{/Meta}{Alt>} {/Alt}')
    const handled = new KeyboardEvent('keydown', { key: 'ArrowRight', cancelable: true })
    handled.preventDefault()
    window.dispatchEvent(handled)
    expect(api.calls()).toEqual([])
  })

  it('ignores keys typed into inputs, textareas, selects and contenteditable', async () => {
    document.body.innerHTML = `
      <input id="i" /><textarea id="t"></textarea>
      <select id="s"><option>a</option></select>
      <div id="c" contenteditable="true"></div>
      <div id="p" tabindex="0"></div>`
    renderHook(() => useKeyboardTransport(api))
    for (const id of ['i', 't', 's', 'c']) {
      ;(document.getElementById(id) as HTMLElement).focus()
      await user.keyboard('{ArrowRight} {Escape}')
    }
    expect(api.calls()).toEqual([])
    ;(document.getElementById('p') as HTMLElement).focus()
    await user.keyboard('{ArrowRight}')
    expect(api.calls()).toEqual(['next()'])
  })

  it('leaves Space to a focused button or link, but still handles the arrows there', async () => {
    document.body.innerHTML = `<button id="b">play</button><a id="a" href="#">x</a>`
    renderHook(() => useKeyboardTransport(api))
    ;(document.getElementById('b') as HTMLElement).focus()
    await user.keyboard(' {ArrowRight}')
    ;(document.getElementById('a') as HTMLElement).focus()
    await user.keyboard(' {ArrowLeft}')
    expect(api.calls()).toEqual(['next()', 'prev()'])
  })

  it('ignores everything while a Radix dialog or popper is open', async () => {
    renderHook(() => useKeyboardTransport(api))
    document.body.innerHTML = `<div role="dialog" data-state="open"></div>`
    await user.keyboard('{ArrowRight}')
    document.body.innerHTML = `<div data-radix-popper-content-wrapper=""></div>`
    await user.keyboard('{ArrowRight}')
    expect(api.calls()).toEqual([])
    document.body.innerHTML = `<div role="dialog" data-state="closed"></div>`
    await user.keyboard('{ArrowRight}')
    expect(api.calls()).toEqual(['next()'])
  })

  it('does nothing when disabled and unsubscribes on unmount', async () => {
    const { rerender, unmount } = renderHook(
      ({ enabled }: { enabled: boolean }) => useKeyboardTransport(api, { enabled }),
      { initialProps: { enabled: false } },
    )
    await user.keyboard('{ArrowRight}')
    expect(api.calls()).toEqual([])
    rerender({ enabled: true })
    await user.keyboard('{ArrowRight}')
    expect(api.calls()).toEqual(['next()'])
    unmount()
    await user.keyboard('{ArrowRight}')
    expect(api.calls()).toEqual(['next()'])
  })

  it('handleTransportKey reports whether it handled the key', () => {
    const ev = (key: string) => new KeyboardEvent('keydown', { key, cancelable: true })
    expect(handleTransportKey(ev('ArrowRight'), api, 'ltr')).toBe(true)
    expect(handleTransportKey(ev('Enter'), api, 'ltr')).toBe(false)
    expect(handleTransportKey(ev('End'), fakeApi({ total: 0 }), 'ltr')).toBe(true)
    expect(api.calls()).toEqual(['next()'])
  })
})
