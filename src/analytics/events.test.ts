/** Compile-time checks for the event catalog: valid calls type-check, invalid ones do not. */
import { describe, expect, it, vi } from 'vitest'
import type { AnalyticsProvider } from './provider'
import type { EventName, EventProps } from './events'
import { configureAnalytics, track } from './analytics'

function fakeProvider() {
  return {
    name: 'fake',
    init: vi.fn(),
    track: vi.fn(),
    pageview: vi.fn(),
  } satisfies AnalyticsProvider
}

describe('event catalog typing', () => {
  it('accepts every declared event with its props', () => {
    const fake = fakeProvider()
    configureAnalytics(fake)

    track('page_view', { path: '/en', locale: 'en' })
    track('topic_view', { module: 'crdts', unit: 'state', topic: 'lww', locale: 'en' })
    track('step_view', {
      module: 'crdts',
      unit: 'state',
      topic: 'lww',
      scene: 's1',
      step: 'st1',
      index: 0,
      total: 5,
    })
    track('topic_complete', {
      module: 'crdts',
      unit: 'state',
      topic: 'lww',
      locale: 'fr',
      seconds: 42,
    })
    track('unit_complete', { module: 'crdts', unit: 'state', locale: 'es' })
    track('module_complete', { module: 'crdts', locale: 'ar' })
    track('player', { action: 'play', module: 'crdts', unit: 'state', topic: 'lww', index: 3 })
    track('speed_change', { speed: 1.5 })
    track('sound_toggle', { enabled: true })
    track('theme_change', { theme: 'dark' })
    track('locale_change', { from: 'en', to: 'zh' })
    track('sidebar_toggle', { open: false })
    track('try_it', { module: 'crdts', unit: 'state', topic: 'lww', action: 'reset' })
    track('error', { where: 'stage', message: 'boom' })

    expect(fake.track).toHaveBeenCalledTimes(14)
  })

  it('rejects unknown names, missing props and wrong literal types', () => {
    const fake = fakeProvider()
    configureAnalytics(fake)

    // @ts-expect-error unknown event name
    track('nope', {})
    // @ts-expect-error missing `locale`
    track('page_view', { path: '/en' })
    // @ts-expect-error not a player action
    track('player', { action: 'dance', module: 'm', unit: 'u', topic: 't', index: 0 })
    // @ts-expect-error speed must be one of SPEEDS
    track('speed_change', { speed: 7 })

    const name: EventName = 'sound_toggle'
    const props: EventProps<typeof name> = { enabled: false }
    track(name, props)
    expect(fake.track).toHaveBeenLastCalledWith('sound_toggle', { enabled: false })
  })
})
