/**
 * translate() and tn(): look a key up in a catalog with {name} interpolation, falling back
 * locale → English → the key itself. Plurals pick `key.<category>` (then `key.other`) using
 * Intl.PluralRules for the catalog's locale.
 */
import { EN_CATALOG, type Catalog, type UiKey } from './catalog'
import type { Locale } from './locales'

export type Vars = Readonly<Record<string, string | number>>

/** Any English key (for autocomplete), or any other string (overlay-only or test keys). */
export type MessageKey = UiKey | (string & Record<never, never>)

const PLACEHOLDER = /\{(\w+)\}/g

/** Replace `{name}` with vars.name. Unknown placeholders are left visible on purpose. */
export function interpolate(template: string, vars?: Vars): string {
  if (!vars) return template
  return template.replace(PLACEHOLDER, (match: string, name: string) => {
    const value = vars[name]
    return value === undefined ? match : String(value)
  })
}

export function translate(catalog: Catalog, key: MessageKey, vars?: Vars): string {
  const found = catalog.messages[key] ?? EN_CATALOG.messages[key]
  if (found === undefined) {
    warnMissing(key)
    return key
  }
  return interpolate(found, vars)
}

const rulesCache = new Map<Locale, Intl.PluralRules>()

export function pluralCategory(locale: Locale, count: number): Intl.LDMLPluralRule {
  let rules = rulesCache.get(locale)
  if (!rules) {
    rules = new Intl.PluralRules(locale)
    rulesCache.set(locale, rules)
  }
  return rules.select(count)
}

function pickPlural(catalog: Catalog, key: string, count: number): string | undefined {
  const category = pluralCategory(catalog.locale, count)
  return catalog.messages[`${key}.${category}`] ?? catalog.messages[`${key}.other`]
}

/** Plural-aware translate. `{count}` is always available in the template. */
export function tn(catalog: Catalog, key: MessageKey, count: number, vars?: Vars): string {
  const found = pickPlural(catalog, key, count) ?? pickPlural(EN_CATALOG, key, count)
  if (found === undefined) {
    warnMissing(`${key}.other`)
    return key
  }
  return interpolate(found, { count, ...vars })
}

const warned = new Set<string>()

function warnMissing(key: string): void {
  if (!import.meta.env.DEV || warned.has(key)) return
  warned.add(key)
  console.warn(`[i18n] Missing UI string "${key}". Add it to src/locales/en/ui.json.`)
}

/** Test helper: forget which missing keys were already reported. */
export function resetMissingKeyWarnings(): void {
  warned.clear()
}
