/**
 * Locale constants and pure helpers shared by routing, settings, analytics and the UI catalogs.
 * Keep this file free of React and storage: src/settings imports it at module load, so it must
 * not import the settings store back (the saved locale is passed in to detectLocale instead).
 */
export const LOCALES = ['en', 'zh', 'hi', 'es', 'ar', 'fr'] as const
export type Locale = (typeof LOCALES)[number]
export const DEFAULT_LOCALE: Locale = 'en'
export const RTL_LOCALES: ReadonlySet<Locale> = new Set<Locale>(['ar'])

export const LOCALE_NAMES: Record<Locale, string> = {
  en: 'English',
  zh: '中文',
  hi: 'हिन्दी',
  es: 'Español',
  ar: 'العربية',
  fr: 'Français',
}

export function isLocale(value: string | undefined): value is Locale {
  return (LOCALES as readonly string[]).includes(value ?? '')
}

export function dirFor(locale: Locale): 'ltr' | 'rtl' {
  return RTL_LOCALES.has(locale) ? 'rtl' : 'ltr'
}

/**
 * Best-effort locale detection: saved setting → browser languages → default.
 * `saved` is the locale from the settings store (`settingsStore.get().locale`); this module never
 * reads localStorage itself.
 */
export function detectLocale(saved?: string): Locale {
  if (isLocale(saved)) return saved
  const languages = typeof navigator === 'undefined' ? [] : (navigator.languages ?? [])
  for (const lang of languages) {
    const base = lang.toLowerCase().split('-')[0]
    if (isLocale(base)) return base
  }
  return DEFAULT_LOCALE
}
