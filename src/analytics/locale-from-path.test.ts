import { describe, expect, it } from 'vitest'
import { localeFromPath, UNKNOWN_LOCALE } from './locale-from-path'

describe('localeFromPath', () => {
  it('reads the first segment when it is a known locale', () => {
    expect(localeFromPath('/en')).toBe('en')
    expect(localeFromPath('/ar/crdts/state-based/lww-register')).toBe('ar')
    expect(localeFromPath('fr/x')).toBe('fr')
  })
  it('returns "unknown" otherwise', () => {
    expect(localeFromPath('/')).toBe(UNKNOWN_LOCALE)
    expect(localeFromPath('')).toBe(UNKNOWN_LOCALE)
    expect(localeFromPath('/design')).toBe(UNKNOWN_LOCALE)
    expect(localeFromPath('/english/x')).toBe(UNKNOWN_LOCALE)
  })
})
