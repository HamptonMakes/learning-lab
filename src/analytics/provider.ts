/**
 * The contract every analytics backend implements. The app talks only to `track()`/`pageview()`
 * from this module; providers are swapped with `configureAnalytics()`.
 */
import type { EventName, EventProps } from './events'

export interface AnalyticsProvider {
  /** Short identifier: 'umami' | 'console' | 'noop' | … */
  readonly name: string
  /** One-time setup (inject scripts, …). Must be idempotent and must never throw. */
  init(): void
  /** Record a catalog event. Must never throw. */
  track<N extends EventName>(name: N, props: EventProps<N>): void
  /** Record a page view for an in-app path such as `/en/crdts/state-based/lww-register`. */
  pageview(path: string): void
}
