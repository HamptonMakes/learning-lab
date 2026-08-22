/** Pulls the locale out of an in-app path (`/en/crdts/…` → 'en'); 'unknown' when absent. */
import { isLocale } from '@/i18n/locales'

export const UNKNOWN_LOCALE = 'unknown'

export function localeFromPath(path: string): string {
  const first = path.split('/').find((segment) => segment.length > 0)
  return isLocale(first) ? first : UNKNOWN_LOCALE
}
