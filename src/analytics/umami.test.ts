/** Umami provider: script injection, queue-before-load, flush-after-load, never throwing. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createUmamiProvider, type UmamiTracker } from './umami'

const OPTIONS = { scriptUrl: 'https://umami.example/script.js', websiteId: 'site-1' }
type Payload = Record<string, unknown>
const BASE: Payload = { website: 'site-1', hostname: 'lab.test', language: 'en-US' }

/** A fake `window.umami` that records the payloads our callback form would produce. */
function installUmami() {
  const sent: Payload[] = []
  const track = vi.fn((build: (base: Payload) => Payload) => {
    sent.push(build({ ...BASE }))
    return Promise.resolve()
  })
  window.umami = { track } as UmamiTracker
  return { sent, track }
}

function injectedScripts(): HTMLScriptElement[] {
  return Array.from(document.querySelectorAll<HTMLScriptElement>('script[data-website-id]'))
}

describe('umami provider', () => {
  beforeEach(() => {
    document.title = 'Lab'
  })
  afterEach(() => {
    delete window.umami
    injectedScripts().forEach((s) => s.remove())
    vi.useRealTimers()
  })

  it('init() injects the tracker script once, with auto-track off', () => {
    const p = createUmamiProvider({ ...OPTIONS, hostUrl: 'https://collect.example' })
    p.init()
    p.init()
    createUmamiProvider(OPTIONS).init() // a second instance must not add a second tag
    const scripts = injectedScripts()
    expect(scripts).toHaveLength(1)
    const script = scripts[0]
    expect(script?.src).toBe(OPTIONS.scriptUrl)
    expect(script?.defer).toBe(true)
    expect(script?.dataset.websiteId).toBe('site-1')
    expect(script?.dataset.autoTrack).toBe('false')
    expect(script?.dataset.hostUrl).toBe('https://collect.example')
    expect(p.name).toBe('umami')
  })

  it('queues calls before the script loads and flushes them, in order, on load', () => {
    vi.useFakeTimers()
    const p = createUmamiProvider(OPTIONS)
    p.init()
    p.pageview('/en/crdts')
    p.track('sound_toggle', { enabled: true })

    const { sent, track } = installUmami()
    expect(track).not.toHaveBeenCalled()

    injectedScripts()[0]?.dispatchEvent(new Event('load'))
    expect(track).toHaveBeenCalledTimes(2)
    expect(sent[0]).toEqual({ ...BASE, url: '/en/crdts', title: 'Lab' })
    expect(sent[1]).toEqual({
      ...BASE,
      url: '/en/crdts',
      name: 'sound_toggle',
      data: { enabled: true },
    })

    // later calls go straight through
    p.track('sidebar_toggle', { open: false })
    expect(track).toHaveBeenCalledTimes(3)
    expect(sent[2]).toMatchObject({ name: 'sidebar_toggle', data: { open: false } })
  })

  it('falls back to polling when no load event arrives', () => {
    vi.useFakeTimers()
    const p = createUmamiProvider(OPTIONS)
    p.init()
    p.pageview('/en')
    const { track } = installUmami()
    expect(track).not.toHaveBeenCalled()
    vi.advanceTimersByTime(300)
    expect(track).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(5_000) // polling has stopped; nothing duplicated
    expect(track).toHaveBeenCalledTimes(1)
  })

  it('flushes queued calls before a new call when the tracker appeared silently', () => {
    const p = createUmamiProvider(OPTIONS)
    p.init()
    p.pageview('/en/a')
    const { sent } = installUmami()
    p.pageview('/en/b')
    expect(sent.map((s) => s.url)).toEqual(['/en/a', '/en/b'])
  })

  it('uses the browser path for events sent before any pageview', () => {
    installUmami()
    const { sent } = installUmami()
    createUmamiProvider(OPTIONS).track('theme_change', { theme: 'light' })
    expect(sent[0]?.url).toBe(window.location.pathname)
  })

  it('caps the queue and drops it if the script fails to load', () => {
    vi.useFakeTimers()
    const p = createUmamiProvider(OPTIONS)
    p.init()
    for (let i = 0; i < 250; i++) p.track('sound_toggle', { enabled: i % 2 === 0 })
    const { track } = installUmami()
    injectedScripts()[0]?.dispatchEvent(new Event('load'))
    expect(track).toHaveBeenCalledTimes(200)

    delete window.umami
    const q = createUmamiProvider({ ...OPTIONS, websiteId: 'site-2' })
    q.init()
    q.pageview('/en')
    injectedScripts()
      .find((s) => s.dataset.websiteId === 'site-2')
      ?.dispatchEvent(new Event('error'))
    const { track: later } = installUmami()
    vi.advanceTimersByTime(11_000)
    expect(later).not.toHaveBeenCalled()
  })

  it('never throws, even when umami.track throws or rejects', async () => {
    const p = createUmamiProvider(OPTIONS)
    window.umami = {
      track: () => {
        throw new Error('boom')
      },
    }
    expect(() => p.pageview('/en')).not.toThrow()
    expect(() => p.track('sound_toggle', { enabled: true })).not.toThrow()
    window.umami = { track: () => Promise.reject(new Error('offline')) }
    expect(() => p.pageview('/en')).not.toThrow()
    await Promise.resolve()
  })
})
