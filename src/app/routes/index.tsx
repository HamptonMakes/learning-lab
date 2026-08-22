import { createFileRoute, redirect } from '@tanstack/react-router'
import { detectLocale } from '@/i18n/locales'
import { settingsStore } from '@/settings'

export const Route = createFileRoute('/')({
  beforeLoad: () => {
    const locale = detectLocale(settingsStore.get().locale)
    throw redirect({ to: '/$locale', params: { locale } })
  },
})
