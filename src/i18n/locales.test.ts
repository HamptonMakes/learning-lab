import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_LOCALE, LOCALES, detectLocale, dirFor, isLocale } from './locales'

function stubLanguages(languages: readonly string[]): void {
  vi.spyOn(navigator, 'languages', 'get').mockReturnValue(languages as string[])
}

describe('isLocale / dirFor', () => {
  it('accepts only the supported locales', () => {
    for (const locale of LOCALES) expect(isLocale(locale)).toBe(true)
    expect(isLocale('en-US')).toBe(false)
    expect(isLocale('')).toBe(false)
    expect(isLocale(undefined)).toBe(false)
  })

  it('marks Arabic as RTL and everything else LTR', () => {
    expect(dirFor('ar')).toBe('rtl')
    for (const locale of LOCALES.filter((l) => l !== 'ar')) expect(dirFor(locale)).toBe('ltr')
  })
})

describe('detectLocale', () => {
  afterEach(() => vi.restoreAllMocks())

  it('prefers the saved setting when it is a supported locale', () => {
    stubLanguages(['fr-FR'])
    expect(detectLocale('ar')).toBe('ar')
  })

  it('ignores an unknown saved value and matches the first supported browser language', () => {
    stubLanguages(['de-DE', 'zh-Hans-CN', 'en'])
    expect(detectLocale('klingon')).toBe('zh')
    expect(detectLocale(undefined)).toBe('zh')
  })

  it('falls back to the default locale', () => {
    stubLanguages(['de-DE'])
    expect(detectLocale()).toBe(DEFAULT_LOCALE)
  })
})
