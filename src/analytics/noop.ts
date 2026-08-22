/** Provider that discards everything. Active in production when Umami is not configured. */
import type { AnalyticsProvider } from './provider'

export const noopProvider: AnalyticsProvider = {
  name: 'noop',
  init() {},
  track() {},
  pageview() {},
}

export function createNoopProvider(): AnalyticsProvider {
  return noopProvider
}
