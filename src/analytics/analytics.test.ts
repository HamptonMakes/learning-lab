/** The singleton: provider swap, routing of calls, and never throwing. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AnalyticsProvider } from './provider'
import { configureAnalytics, getAnalytics, pageview, track } from './analytics'
import { noopProvider } from './noop'

function fakeProvider(name = 'fake') {
  return {
    name,
    init: vi.fn(),
    track: vi.fn(),
    pageview: vi.fn(),
  } satisfies AnalyticsProvider
}

describe('analytics singleton', () => {
  afterEach(() => {
    configureAnalytics(noopProvider)
    vi.restoreAllMocks()
  })

  it('starts with the noop provider', () => {
    expect(getAnalytics().name).toBe('noop')
    expect(() => track('sound_toggle', { enabled: true })).not.toThrow()
  })

  it('configure() activates the provider and runs init() once', () => {
    const a = fakeProvider('a')
    configureAnalytics(a)
    expect(getAnalytics()).toBe(a)
    expect(a.init).toHaveBeenCalledTimes(1)
  })

  it('routes track() and pageview() to the active provider, and swaps cleanly', () => {
    const a = fakeProvider('a')
    const b = fakeProvider('b')
    configureAnalytics(a)
    track('sidebar_toggle', { open: true })
    pageview('/en')
    expect(a.track).toHaveBeenCalledWith('sidebar_toggle', { open: true })
    expect(a.pageview).toHaveBeenCalledWith('/en')

    configureAnalytics(b)
    track('sound_toggle', { enabled: false })
    pageview('/fr')
    expect(b.track).toHaveBeenCalledWith('sound_toggle', { enabled: false })
    expect(b.pageview).toHaveBeenCalledWith('/fr')
    expect(a.track).toHaveBeenCalledTimes(1)
    expect(a.pageview).toHaveBeenCalledTimes(1)
  })

  it('never throws when a provider does; it warns instead', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const bad: AnalyticsProvider = {
      name: 'bad',
      init: () => {
        throw new Error('init')
      },
      track: () => {
        throw new Error('track')
      },
      pageview: () => {
        throw new Error('pageview')
      },
    }
    expect(() => configureAnalytics(bad)).not.toThrow()
    expect(() => track('error', { where: 'x', message: 'y' })).not.toThrow()
    expect(() => pageview('/en')).not.toThrow()
    expect(warn).toHaveBeenCalledTimes(3)
  })
})
