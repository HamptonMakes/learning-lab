import { createFileRoute, notFound, Outlet } from '@tanstack/react-router'
import { isLocale } from '@/i18n/locales'
import { AppShell } from '@/app/components/app-shell'

export const Route = createFileRoute('/$locale')({
  beforeLoad: ({ params }) => {
    if (!isLocale(params.locale)) throw notFound()
  },
  component: LocaleLayout,
})

function LocaleLayout() {
  const { locale } = Route.useParams()
  if (!isLocale(locale)) return null
  return (
    <AppShell locale={locale}>
      <Outlet />
    </AppShell>
  )
}
