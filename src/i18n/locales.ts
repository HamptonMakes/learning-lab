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

/** Best-effort locale detection: saved setting → browser languages → default. */
export function detectLocale(): Locale {
  try {
    const saved = JSON.parse(localStorage.getItem('cs-lab:settings') ?? '{}') as { locale?: string }
    if (isLocale(saved.locale)) return saved.locale
  } catch {
    /* ignore */
  }
  for (const lang of navigator.languages ?? []) {
    const base = lang.toLowerCase().split('-')[0]
    if (isLocale(base)) return base
  }
  return DEFAULT_LOCALE
}
