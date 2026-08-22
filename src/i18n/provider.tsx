/**
 * <I18nProvider locale> — owns the active UI catalog (English first, swapped in once the
 * locale's catalog has loaded), keeps <html lang dir> in sync, and provides I18nContext.
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { EN_CATALOG, loadUiCatalog, peekUiCatalog, type Catalog } from './catalog'
import { createI18n, I18nContext } from './context'
import { dirFor, type Locale } from './locales'

export interface I18nProviderProps {
  locale: Locale
  children: ReactNode
}

export function I18nProvider({ locale, children }: I18nProviderProps) {
  const [loaded, setLoaded] = useState<Catalog>(() => peekUiCatalog(locale) ?? EN_CATALOG)
  // While a locale's catalog is still loading, fall back to English (never to a stale locale).
  const catalog = loaded.locale === locale ? loaded : (peekUiCatalog(locale) ?? EN_CATALOG)

  useEffect(() => {
    let cancelled = false
    void loadUiCatalog(locale).then((next) => {
      if (!cancelled) setLoaded(next)
    })
    return () => {
      cancelled = true
    }
  }, [locale])

  const dir = dirFor(locale)
  useEffect(() => {
    const root = document.documentElement
    root.lang = locale
    root.dir = dir
  }, [locale, dir])

  const value = useMemo(() => createI18n(locale, catalog), [locale, catalog])
  return <I18nContext value={value}>{children}</I18nContext>
}
