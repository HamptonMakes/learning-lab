import { createRootRoute, HeadContent, Outlet } from '@tanstack/react-router'
import { AnalyticsRouteTracker } from '@/analytics'
import { SITE_NAME } from '@/app/seo'

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { title: SITE_NAME },
      {
        name: 'description',
        content:
          'Animated, step-by-step lessons on CRDTs and the computer science ideas working programmers usually skip. Real implementations, free and open source.',
      },
    ],
  }),
  component: () => (
    <>
      <HeadContent />
      <AnalyticsRouteTracker />
      <Outlet />
    </>
  ),
})
