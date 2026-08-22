/** Dev provider: prints events compactly to the browser console. Never selected in production. */
import type { AnalyticsProvider } from './provider'

export type Logger = (...args: unknown[]) => void

function debug(...args: unknown[]): void {
  // oxlint-disable-next-line no-console
  console.debug(...args)
}

export function createConsoleProvider(log: Logger = debug): AnalyticsProvider {
  return {
    name: 'console',
    init() {
      log('[analytics] console provider active')
    },
    track(name, props) {
      log(`[analytics] ${name}`, props)
    },
    pageview(path) {
      log('[analytics] pageview', path)
    },
  }
}
