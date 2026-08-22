import type { ReactNode } from 'react'
import { SidebarInset, SidebarProvider } from '@/ui/sidebar'
import { TooltipProvider } from '@/ui/tooltip'
import { I18nProvider } from '@/i18n'
import { SoundProvider } from '@/sound'
import { useSetting, useTheme } from '@/settings'
import type { Locale } from '@/i18n/locales'
import { track } from '@/analytics'
import { SiteHeader } from './site-header'
import { NavSidebar } from './nav-sidebar'

export function AppShell({ locale, children }: { locale: Locale; children: ReactNode }) {
  useTheme()
  const [sidebarOpen, setSidebarOpen] = useSetting('sidebarOpen')

  return (
    <I18nProvider locale={locale}>
      <TooltipProvider delayDuration={300}>
        <SoundProvider>
          <SidebarProvider
            open={sidebarOpen}
            onOpenChange={(open) => {
              setSidebarOpen(open)
              track('sidebar_toggle', { open })
            }}
            className="flex-col"
            style={{ '--sidebar-width': 'var(--sidebar-w)' } as React.CSSProperties}
          >
            <SiteHeader />
            <div className="flex min-h-0 flex-1">
              <NavSidebar />
              <SidebarInset className="min-w-0 bg-paper">{children}</SidebarInset>
            </div>
          </SidebarProvider>
        </SoundProvider>
      </TooltipProvider>
    </I18nProvider>
  )
}
