/** Provider selection from the environment. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createDefaultProvider, readAnalyticsEnv } from './default-provider'

describe('createDefaultProvider', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    document.querySelectorAll('script[data-website-id]').forEach((s) => s.remove())
  })

  it('picks Umami when both env vars are set (via vi.stubEnv)', () => {
    vi.stubEnv('VITE_UMAMI_SCRIPT_URL', 'https://umami.example/script.js')
    vi.stubEnv('VITE_UMAMI_WEBSITE_ID', 'site-1')
    expect(readAnalyticsEnv().umamiWebsiteId).toBe('site-1')
    expect(createDefaultProvider().name).toBe('umami')
  })

  it('picks the console provider in dev when Umami is not configured', () => {
    vi.stubEnv('VITE_UMAMI_SCRIPT_URL', 'https://umami.example/script.js')
    vi.stubEnv('VITE_UMAMI_WEBSITE_ID', '')
    vi.stubEnv('DEV', true)
    expect(createDefaultProvider().name).toBe('console')
  })

  it('picks noop in production without Umami', () => {
    vi.stubEnv('VITE_UMAMI_SCRIPT_URL', '')
    vi.stubEnv('VITE_UMAMI_WEBSITE_ID', '')
    vi.stubEnv('DEV', false)
    expect(createDefaultProvider().name).toBe('noop')
  })

  it('accepts an explicit env (whitespace-only values count as unset)', () => {
    expect(
      createDefaultProvider({ umamiScriptUrl: ' ', umamiWebsiteId: 'x', dev: false }).name,
    ).toBe('noop')
    expect(createDefaultProvider({ dev: true }).name).toBe('console')
    expect(
      createDefaultProvider({ umamiScriptUrl: 'https://u/s.js', umamiWebsiteId: 'id', dev: true })
        .name,
    ).toBe('umami')
  })
})
