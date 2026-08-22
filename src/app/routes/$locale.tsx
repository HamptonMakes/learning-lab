import { createFileRoute, notFound, Outlet } from '@tanstack/react-router'
import { isLocale } from '@/i18n/locales'

export const Route = createFileRoute('/$locale')({
  beforeLoad: ({ params }) => {
    if (!isLocale(params.locale)) throw notFound()
  },
  component: () => <Outlet />,
})
