/**
 * UI string catalogs. English is bundled eagerly (it is also the fallback for every other locale);
 * other locales live in src/locales/<lang>/ui.json, are code-split by Vite, and load on demand.
 */
import en from '@/locales/en/ui.json'
import { DEFAULT_LOCALE, type Locale } from './locales'

/** Flat key → string map. Keys use dots for grouping, e.g. "player.play". */
export type Messages = Readonly<Record<string, string>>

/** A catalog pairs messages with the locale they are written in (this drives plural rules). */
export interface Catalog {
  readonly locale: Locale
  readonly messages: Messages
}

/** Every key in the English catalog. Gives `t()` autocomplete and catches typos. */
export type UiKey = keyof typeof en

export const EN_MESSAGES: Messages = en
export const EN_CATALOG: Catalog = { locale: DEFAULT_LOCALE, messages: EN_MESSAGES }

export function createCatalog(locale: Locale, messages: Messages): Catalog {
  return { locale, messages }
}

interface CatalogModule {
  default: Messages
}

/** One lazy loader per locale file, keyed by its path relative to this file (English is bundled). */
const loaders = import.meta.glob<CatalogModule>(['../locales/*/ui.json', '!../locales/en/ui.json'])

const loaded = new Map<Locale, Catalog>([[DEFAULT_LOCALE, EN_CATALOG]])
const pending = new Map<Locale, Promise<Catalog>>()

/** Synchronous lookup of an already-loaded catalog. English is always available. */
export function peekUiCatalog(locale: Locale): Catalog | undefined {
  return loaded.get(locale)
}

/**
 * Load (and cache) the UI catalog for a locale. A locale that has no file yet resolves to an
 * empty catalog, so every key falls back to English. A failed load is not cached, so it can retry.
 */
export function loadUiCatalog(locale: Locale): Promise<Catalog> {
  const ready = loaded.get(locale)
  if (ready) return Promise.resolve(ready)
  const inFlight = pending.get(locale)
  if (inFlight) return inFlight

  const load = loaders[`../locales/${locale}/ui.json`]
  const messages: Promise<Messages> = load ? load().then((m) => m.default) : Promise.resolve({})
  const promise = messages
    .then((m) => {
      const catalog = createCatalog(locale, m)
      loaded.set(locale, catalog)
      return catalog
    })
    .catch((error: unknown) => {
      console.warn(`[i18n] Could not load the "${locale}" UI catalog; using English.`, error)
      return createCatalog(locale, {})
    })
    .finally(() => pending.delete(locale))
  pending.set(locale, promise)
  return promise
}
