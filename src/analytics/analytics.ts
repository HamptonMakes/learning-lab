/**
 * Module-level analytics singleton: one active provider, swappable at runtime.
 * The rest of the app imports `track()` / `pageview()` from '@/analytics' and nothing else.
 * Starts as noop so calls before configuration are safe.
 */
import type { EventName, EventProps } from './events'
import type { AnalyticsProvider } from './provider'
import { noopProvider } from './noop'

let active: AnalyticsProvider = noopProvider

function guard(what: string, fn: () => void): void {
  try {
    fn()
  } catch (err) {
    console.warn(`[analytics] ${what} failed`, err)
  }
}

/** Makes `provider` the active one and runs its `init()`. Call once at startup (and in tests). */
export function configureAnalytics(provider: AnalyticsProvider): void {
  active = provider
  guard(`${provider.name}.init`, () => provider.init())
}

export function getAnalytics(): AnalyticsProvider {
  return active
}

export function track<N extends EventName>(name: N, props: EventProps<N>): void {
  guard(`${active.name}.track(${name})`, () => active.track(name, props))
}

export function pageview(path: string): void {
  guard(`${active.name}.pageview`, () => active.pageview(path))
}
