import { describe, expect, it } from 'vitest'
import { EN_CATALOG, EN_MESSAGES, loadUiCatalog, peekUiCatalog } from './catalog'
import { LOCALES } from './locales'

/** A locale that has no src/locales/<lang>/ui.json yet (skips the test once every locale has one). */
const files = import.meta.glob('../locales/*/ui.json')
const missing = LOCALES.find((locale) => !(`../locales/${locale}/ui.json` in files))

describe('catalog', () => {
  it('bundles English eagerly with the expected shape', () => {
    expect(EN_CATALOG.locale).toBe('en')
    expect(EN_MESSAGES['app.title']).toBe("Hampton's CS Concept Lab")
    for (const [key, value] of Object.entries(EN_MESSAGES)) {
      expect(typeof value, key).toBe('string')
      expect(value.trim(), key).not.toBe('')
    }
  })

  it('resolves English synchronously via peek and asynchronously via load', async () => {
    expect(peekUiCatalog('en')).toBe(EN_CATALOG)
    await expect(loadUiCatalog('en')).resolves.toBe(EN_CATALOG)
  })

  it.skipIf(!missing)(
    'resolves an empty catalog for a locale without a file, and caches it',
    async () => {
      if (!missing) return
      expect(peekUiCatalog(missing)).toBeUndefined()
      const first = loadUiCatalog(missing)
      expect(loadUiCatalog(missing)).toBe(first)
      const catalog = await first
      expect(catalog).toEqual({ locale: missing, messages: {} })
      expect(peekUiCatalog(missing)).toBe(catalog)
      await expect(loadUiCatalog(missing)).resolves.toBe(catalog)
    },
  )
})
