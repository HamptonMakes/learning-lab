import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from '@tanstack/react-router'
import { configureAnalytics, createDefaultProvider } from '@/analytics'
import { router } from '@/app/router'
import '@/styles/globals.css'

// Analytics must be configured before the first render so the landing pageview is not lost.
configureAnalytics(createDefaultProvider())

const rootEl = document.getElementById('root')
if (!rootEl) throw new Error('Missing #root element')

createRoot(rootEl).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
)
