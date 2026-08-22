import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Catalog } from './catalog'
import { useI18n, useT } from './hooks'
import type { Locale } from './locales'
import { I18nProvider } from './provider'

vi.mock('./catalog', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./catalog')>()
  const fr = actual.createCatalog('fr', { 'player.play': 'Lecture' })
  return {
    ...actual,
    loadUiCatalog: (locale: Locale): Promise<Catalog> =>
      locale === 'fr' ? Promise.resolve(fr) : actual.loadUiCatalog(locale),
  }
})

function Probe() {
  const { locale, dir, isRtl, t, tn, formatNumber, formatDate } = useI18n()
  return (
    <div>
      <span data-testid="locale">{locale}</span>
      <span data-testid="dir">{dir}</span>
      <span data-testid="rtl">{String(isRtl)}</span>
      <span data-testid="play">{t('player.play')}</span>
      <span data-testid="step">{t('player.step_of', { n: 2, total: 5 })}</span>
      <span data-testid="steps">{tn('topic.steps', 3)}</span>
      <span data-testid="number">{formatNumber(1234.5)}</span>
      <span data-testid="date">{formatDate(new Date(2026, 0, 15))}</span>
    </div>
  )
}

function PlayButton() {
  const t = useT()
  return <button>{t('player.play')}</button>
}

describe('I18nProvider', () => {
  afterEach(() => {
    cleanup()
    document.documentElement.lang = 'en'
    document.documentElement.dir = 'ltr'
  })

  it('sets <html lang dir> and exposes English strings + formatters', () => {
    render(
      <I18nProvider locale="en">
        <Probe />
      </I18nProvider>,
    )
    expect(document.documentElement.lang).toBe('en')
    expect(document.documentElement.dir).toBe('ltr')
    expect(screen.getByTestId('locale')).toHaveTextContent('en')
    expect(screen.getByTestId('rtl')).toHaveTextContent('false')
    expect(screen.getByTestId('play')).toHaveTextContent('Play')
    expect(screen.getByTestId('step')).toHaveTextContent('Step 2 of 5')
    expect(screen.getByTestId('steps')).toHaveTextContent('3 steps')
    expect(screen.getByTestId('number')).toHaveTextContent('1,234.5')
    expect(screen.getByTestId('date')).toHaveTextContent('2026')
  })

  it('marks RTL locales', () => {
    render(
      <I18nProvider locale="ar">
        <Probe />
      </I18nProvider>,
    )
    expect(document.documentElement.lang).toBe('ar')
    expect(document.documentElement.dir).toBe('rtl')
    expect(screen.getByTestId('dir')).toHaveTextContent('rtl')
    expect(screen.getByTestId('rtl')).toHaveTextContent('true')
  })

  it('starts with English and swaps once the locale catalog loads', async () => {
    render(
      <I18nProvider locale="fr">
        <PlayButton />
      </I18nProvider>,
    )
    expect(screen.getByRole('button')).toHaveTextContent('Play')
    expect(await screen.findByRole('button', { name: 'Lecture' })).toBeInTheDocument()
    expect(document.documentElement.lang).toBe('fr')
  })

  it('follows locale changes, falling back to English while loading', async () => {
    const { rerender } = render(
      <I18nProvider locale="fr">
        <PlayButton />
      </I18nProvider>,
    )
    await screen.findByRole('button', { name: 'Lecture' })
    rerender(
      <I18nProvider locale="es">
        <PlayButton />
      </I18nProvider>,
    )
    expect(screen.getByRole('button')).toHaveTextContent('Play')
    expect(document.documentElement.lang).toBe('es')
    rerender(
      <I18nProvider locale="fr">
        <PlayButton />
      </I18nProvider>,
    )
    expect(await screen.findByRole('button', { name: 'Lecture' })).toBeInTheDocument()
  })

  it('renders English without a provider (default context)', () => {
    render(<PlayButton />)
    expect(screen.getByRole('button')).toHaveTextContent('Play')
  })
})
