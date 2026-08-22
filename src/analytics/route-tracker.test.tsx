/** <AnalyticsRouteTracker/> against a real TanStack router with memory history. */
import { StrictMode, act } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, waitFor } from '@testing-library/react'
import {
  Outlet,
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from '@tanstack/react-router'
import type { AnalyticsProvider } from './provider'
import { configureAnalytics } from './analytics'
import { noopProvider } from './noop'
import { AnalyticsRouteTracker } from './route-tracker'

function makeRouter(initialPath: string) {
  const rootRoute = createRootRoute({
    component: () => (
      <>
        <AnalyticsRouteTracker />
        <Outlet />
      </>
    ),
  })
  const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/',
    component: () => <p>home</p>,
  })
  const localeRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/$locale',
    component: () => <Outlet />,
  })
  const topicRoute = createRoute({
    getParentRoute: () => localeRoute,
    path: '/$topic',
    component: () => <p>topic</p>,
  })
  return createRouter({
    routeTree: rootRoute.addChildren([indexRoute, localeRoute.addChildren([topicRoute])]),
    history: createMemoryHistory({ initialEntries: [initialPath] }),
  })
}

function fakeProvider() {
  return {
    name: 'fake',
    init: vi.fn(),
    track: vi.fn(),
    pageview: vi.fn(),
  } satisfies AnalyticsProvider
}

describe('AnalyticsRouteTracker', () => {
  afterEach(() => {
    cleanup()
    configureAnalytics(noopProvider)
  })

  it('sends a page view (with locale) for the initial and each resolved navigation, deduped by path', async () => {
    const fake = fakeProvider()
    configureAnalytics(fake)
    const router = makeRouter('/en/lww')
    render(<RouterProvider router={router} />)

    await waitFor(() => expect(fake.pageview).toHaveBeenCalledWith('/en/lww'))
    expect(fake.track).toHaveBeenCalledWith('page_view', { path: '/en/lww', locale: 'en' })

    // history.push is what the browser back/forward buttons (and Link) end up driving
    await act(async () => {
      router.history.push('/fr/g-counter')
    })
    await waitFor(() => expect(fake.pageview).toHaveBeenCalledWith('/fr/g-counter'))
    expect(fake.track).toHaveBeenLastCalledWith('page_view', {
      path: '/fr/g-counter',
      locale: 'fr',
    })

    // same path, different hash → no new page view
    await act(async () => {
      router.history.push('/fr/g-counter#when-to-use')
    })
    await act(async () => {
      router.history.push('/')
    })
    await waitFor(() => expect(fake.pageview).toHaveBeenCalledWith('/'))
    expect(fake.pageview).toHaveBeenCalledTimes(3)
    expect(fake.track).toHaveBeenLastCalledWith('page_view', { path: '/', locale: 'unknown' })
  })

  it('does not double count under StrictMode', async () => {
    const fake = fakeProvider()
    configureAnalytics(fake)
    const router = makeRouter('/es/lww')
    render(
      <StrictMode>
        <RouterProvider router={router} />
      </StrictMode>,
    )
    await waitFor(() => expect(fake.pageview).toHaveBeenCalledWith('/es/lww'))
    await act(async () => {
      await Promise.resolve()
    })
    expect(fake.pageview).toHaveBeenCalledTimes(1)
    expect(fake.track).toHaveBeenCalledTimes(1)
  })
})
