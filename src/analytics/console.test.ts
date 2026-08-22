/** Console provider: compact lines through an injectable logger. */
import { describe, expect, it, vi } from 'vitest'
import { createConsoleProvider } from './console'

describe('console provider', () => {
  it('logs init, events and page views', () => {
    const log = vi.fn()
    const p = createConsoleProvider(log)
    p.init()
    p.track('theme_change', { theme: 'dark' })
    p.pageview('/en/crdts')
    expect(p.name).toBe('console')
    expect(log).toHaveBeenNthCalledWith(1, '[analytics] console provider active')
    expect(log).toHaveBeenNthCalledWith(2, '[analytics] theme_change', { theme: 'dark' })
    expect(log).toHaveBeenNthCalledWith(3, '[analytics] pageview', '/en/crdts')
  })

  it('defaults to console.debug', () => {
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => undefined)
    createConsoleProvider().pageview('/en')
    expect(debug).toHaveBeenCalledWith('[analytics] pageview', '/en')
    debug.mockRestore()
  })
})
