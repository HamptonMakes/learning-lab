import { createRootRoute, Outlet } from '@tanstack/react-router'
import { AnalyticsRouteTracker } from '@/analytics'

export const Route = createRootRoute({
  component: () => (
    <>
      <AnalyticsRouteTracker />
      <Outlet />
    </>
  ),
})
