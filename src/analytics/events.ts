/**
 * Typed analytics event catalog. Every event the app may emit is declared here once;
 * `track()` only accepts names from this interface with matching props. Add new events here
 * (and nowhere else) so providers, tests, and dashboards share one vocabulary.
 */
import type { Locale } from '@/i18n/locales'
import type { Speed, Theme } from '@/settings'

/** Where in the lesson tree an event happened (ids, not titles). */
export interface TopicRef {
  module: string
  unit: string
  topic: string
}

export type PlayerAction = 'play' | 'pause' | 'next' | 'prev' | 'seek' | 'restart'

export interface AnalyticsEvents {
  /** Sent by <AnalyticsRouteTracker/>. `locale` is the first URL segment, or 'unknown'. */
  page_view: { path: string; locale: string }
  topic_view: TopicRef & { locale: Locale }
  step_view: TopicRef & { scene: string; step: string; index: number; total: number }
  topic_complete: TopicRef & { locale: Locale; seconds: number }
  unit_complete: { module: string; unit: string; locale: Locale }
  module_complete: { module: string; locale: Locale }
  player: TopicRef & { action: PlayerAction; index: number }
  speed_change: { speed: Speed }
  sound_toggle: { enabled: boolean }
  theme_change: { theme: Theme }
  locale_change: { from: Locale; to: Locale }
  sidebar_toggle: { open: boolean }
  try_it: TopicRef & { action: string }
  error: { where: string; message: string }
}

export type EventName = keyof AnalyticsEvents
export type EventProps<N extends EventName> = AnalyticsEvents[N]
