/**
 * Sends a page view each time the router settles on a new pathname (deduped, so search/hash
 * changes and StrictMode double-effects do not double count). Mount once inside <RouterProvider>.
 */
import { useEffect, useRef } from 'react'
import { useRouterState } from '@tanstack/react-router'
import { pageview, track } from './analytics'
import { localeFromPath } from './locale-from-path'

export function AnalyticsRouteTracker(): null {
  const path = useRouterState({ select: (state) => state.resolvedLocation?.pathname })
  const last = useRef<string | undefined>(undefined)

  useEffect(() => {
    if (path === undefined || path === last.current) return
    last.current = path
    pageview(path)
    track('page_view', { path, locale: localeFromPath(path) })
  }, [path])

  return null
}
