import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createCatalog, EN_CATALOG } from './catalog'
import { interpolate, pluralCategory, resetMissingKeyWarnings, tn, translate } from './t'

const fr = createCatalog('fr', {
  'player.play': 'Lecture',
  greeting: 'Bonjour {name}',
  'items.one': '{count} élément',
  'items.other': '{count} éléments',
})

describe('interpolate', () => {
  it('replaces {name} placeholders with strings and numbers', () => {
    expect(interpolate('Step {n} of {total}', { n: 2, total: 5 })).toBe('Step 2 of 5')
    expect(interpolate('Hi {name}!', { name: 'Ada' })).toBe('Hi Ada!')
  })

  it('leaves unknown placeholders visible and ignores extra vars', () => {
    expect(interpolate('Hi {name}', {})).toBe('Hi {name}')
    expect(interpolate('Hi', { name: 'x' })).toBe('Hi')
    expect(interpolate('Hi {name}')).toBe('Hi {name}')
  })
})

describe('translate', () => {
  beforeEach(() => {
    resetMissingKeyWarnings()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })
  afterEach(() => vi.restoreAllMocks())

  it('returns the English string with interpolation', () => {
    expect(translate(EN_CATALOG, 'player.play')).toBe('Play')
    expect(translate(EN_CATALOG, 'player.step_of', { n: 3, total: 9 })).toBe('Step 3 of 9')
  })

  it('prefers the locale catalog and falls back to English per key', () => {
    expect(translate(fr, 'player.play')).toBe('Lecture')
    expect(translate(fr, 'greeting', { name: 'Ada' })).toBe('Bonjour Ada')
    expect(translate(fr, 'player.pause')).toBe('Pause')
    expect(console.warn).not.toHaveBeenCalled()
  })

  it('falls back to the key when missing everywhere and warns once per key', () => {
    expect(translate(fr, 'nope.missing')).toBe('nope.missing')
    expect(translate(fr, 'nope.missing')).toBe('nope.missing')
    expect(translate(EN_CATALOG, 'nope.missing')).toBe('nope.missing')
    expect(console.warn).toHaveBeenCalledTimes(1)
    expect(vi.mocked(console.warn).mock.calls[0]?.[0]).toContain('nope.missing')
    expect(translate(EN_CATALOG, 'nope.other')).toBe('nope.other')
    expect(console.warn).toHaveBeenCalledTimes(2)
  })
})

describe('pluralCategory', () => {
  it('follows CLDR rules for the given locale', () => {
    expect(pluralCategory('en', 1)).toBe('one')
    expect(pluralCategory('en', 0)).toBe('other')
    expect(pluralCategory('fr', 0)).toBe('one')
    expect(pluralCategory('ar', 2)).toBe('two')
    expect(pluralCategory('zh', 5)).toBe('other')
  })
})

describe('tn', () => {
  beforeEach(() => {
    resetMissingKeyWarnings()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })
  afterEach(() => vi.restoreAllMocks())

  it('picks key.one / key.other for English and injects {count}', () => {
    expect(tn(EN_CATALOG, 'topic.steps', 1)).toBe('1 step')
    expect(tn(EN_CATALOG, 'topic.steps', 4)).toBe('4 steps')
    expect(tn(EN_CATALOG, 'topic.steps', 0)).toBe('0 steps')
  })

  it("uses the catalog locale's plural rules", () => {
    expect(tn(fr, 'items', 0)).toBe('0 élément')
    expect(tn(fr, 'items', 2)).toBe('2 éléments')
  })

  it('falls back to key.other when the exact category is missing', () => {
    const ar = createCatalog('ar', { 'things.other': '{count} أشياء', 'things.one': 'شيء واحد' })
    expect(tn(ar, 'things', 2)).toBe('2 أشياء')
    expect(tn(ar, 'things', 1)).toBe('شيء واحد')
  })

  it('falls back to English plurals, then the key', () => {
    expect(tn(fr, 'topic.steps', 1)).toBe('1 step')
    expect(tn(fr, 'topic.steps', 2)).toBe('2 steps')
    expect(tn(fr, 'nope', 3)).toBe('nope')
    expect(console.warn).toHaveBeenCalledTimes(1)
  })

  it('lets vars extend and override count', () => {
    expect(tn(EN_CATALOG, 'progress.topics', 2, { count: 'two' })).toBe('two topics')
  })
})
