import { Link } from '@tanstack/react-router'
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/ui/breadcrumb'
import { Button } from '@/ui/button'
import { SidebarTrigger } from '@/ui/sidebar'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/tooltip'
import { useI18n } from '@/i18n'
import { BrandMark } from './brand'
import { SettingsMenu } from './settings-menu'
import { useLocationParts } from './use-location-parts'

export function SiteHeader() {
  const { t } = useI18n()
  const { locale, module, ref } = useLocationParts()

  return (
    <header
      className="sticky top-0 z-30 flex h-(--header-h) items-center gap-2 border-b border-line-2 bg-paper-2 px-3"
      data-testid="site-header"
    >
      <Tooltip>
        <TooltipTrigger asChild>
          <SidebarTrigger aria-label={t('nav.contents')} data-testid="sidebar-trigger" />
        </TooltipTrigger>
        <TooltipContent>{t('nav.contents')}</TooltipContent>
      </Tooltip>

      <Link
        to="/$locale"
        params={{ locale }}
        className="flex items-center gap-2 rounded-md py-1 ps-1 pe-2 text-sm font-semibold text-ink hover:bg-paper-3"
        aria-label={t('app.title')}
      >
        <BrandMark className="text-ink" />
        <span className="hidden sm:inline">{t('app.short')}</span>
      </Link>

      <Breadcrumb className="ms-2 min-w-0 flex-1" data-testid="breadcrumb">
        <BreadcrumbList className="flex-nowrap overflow-hidden">
          {module && (
            <>
              <BreadcrumbSeparator />
              <BreadcrumbItem className="min-w-0">
                {ref ? (
                  <BreadcrumbLink asChild className="truncate">
                    <Link to="/$locale/$module" params={{ locale, module: module.id }}>
                      {module.short}
                    </Link>
                  </BreadcrumbLink>
                ) : (
                  <BreadcrumbPage className="truncate">{module.short}</BreadcrumbPage>
                )}
              </BreadcrumbItem>
            </>
          )}
          {ref && (
            <>
              <BreadcrumbSeparator />
              <BreadcrumbItem className="hidden min-w-0 md:inline-flex">
                <span className="truncate text-ink-2">
                  <span className="me-1 font-mono text-xs text-ink-3">{ref.unit.numeral}</span>
                  {ref.unit.title}
                </span>
              </BreadcrumbItem>
              <BreadcrumbSeparator className="hidden md:block" />
              <BreadcrumbItem className="min-w-0">
                <BreadcrumbPage className="truncate">{ref.topic.title}</BreadcrumbPage>
              </BreadcrumbItem>
            </>
          )}
        </BreadcrumbList>
      </Breadcrumb>

      <div className="flex items-center gap-1">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" asChild>
              <a
                href="https://github.com/HamptonMakes/learning-lab"
                target="_blank"
                rel="noreferrer"
                aria-label="GitHub"
              >
                <GitHubMark />
              </a>
            </Button>
          </TooltipTrigger>
          <TooltipContent>GitHub</TooltipContent>
        </Tooltip>
        <SettingsMenu />
      </div>
    </header>
  )
}

function GitHubMark() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className="size-4" fill="currentColor">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
    </svg>
  )
}
