/**
 * The I18n context value: locale, direction, and bound t()/tn()/formatters.
 * The default value is English, so components render sensibly even without a provider.
 */
import { createContext } from 'react'
import { EN_CATALOG, type Catalog } from './catalog'
import { DEFAULT_LOCALE, dirFor, type Locale } from './locales'
import { translate, tn, type MessageKey, type Vars } from './t'

export interface I18n {
  readonly locale: Locale
  readonly dir: 'ltr' | 'rtl'
  readonly isRtl: boolean
  readonly t: (key: MessageKey, vars?: Vars) => string
  readonly tn: (key: MessageKey, count: number, vars?: Vars) => string
  readonly formatNumber: (value: number, options?: Intl.NumberFormatOptions) => string
  readonly formatDate: (
    value: Date | number | string,
    options?: Intl.DateTimeFormatOptions,
  ) => string
}

export function createI18n(locale: Locale, catalog: Catalog): I18n {
  const dir = dirFor(locale)
  return {
    locale,
    dir,
    isRtl: dir === 'rtl',
    t: (key, vars) => translate(catalog, key, vars),
    tn: (key, count, vars) => tn(catalog, key, count, vars),
    formatNumber: (value, options) => new Intl.NumberFormat(locale, options).format(value),
    formatDate: (value, options = { dateStyle: 'medium' }) =>
      new Intl.DateTimeFormat(locale, options).format(
        value instanceof Date ? value : new Date(value),
      ),
  }
}

export const I18nContext = createContext<I18n>(createI18n(DEFAULT_LOCALE, EN_CATALOG))
