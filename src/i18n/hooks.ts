/**
 * React hooks for UI strings: useI18n() for the full context, useT() for the common case.
 */
import { useContext } from 'react'
import { I18nContext, type I18n } from './context'

export function useI18n(): I18n {
  return useContext(I18nContext)
}

/** Shortcut: `const t = useT(); t('player.play')`. */
export function useT(): I18n['t'] {
  return useContext(I18nContext).t
}
