/**
 * Picks the provider from the environment: Umami when VITE_UMAMI_SCRIPT_URL and
 * VITE_UMAMI_WEBSITE_ID are both set, the console provider in dev, noop otherwise.
 */
import type { AnalyticsProvider } from './provider'
import { createConsoleProvider } from './console'
import { createUmamiProvider } from './umami'
import { noopProvider } from './noop'

declare global {
  interface ImportMetaEnv {
    readonly VITE_UMAMI_SCRIPT_URL?: string
    readonly VITE_UMAMI_WEBSITE_ID?: string
  }
}

export interface AnalyticsEnv {
  umamiScriptUrl?: string
  umamiWebsiteId?: string
  dev: boolean
}

export function readAnalyticsEnv(): AnalyticsEnv {
  return {
    umamiScriptUrl: import.meta.env.VITE_UMAMI_SCRIPT_URL,
    umamiWebsiteId: import.meta.env.VITE_UMAMI_WEBSITE_ID,
    dev: import.meta.env.DEV,
  }
}

export function createDefaultProvider(env: AnalyticsEnv = readAnalyticsEnv()): AnalyticsProvider {
  const scriptUrl = env.umamiScriptUrl?.trim()
  const websiteId = env.umamiWebsiteId?.trim()
  if (scriptUrl && websiteId) return createUmamiProvider({ scriptUrl, websiteId })
  if (env.dev) return createConsoleProvider()
  return noopProvider
}
