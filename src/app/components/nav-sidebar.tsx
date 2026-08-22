import { Link } from '@tanstack/react-router'
import { Check, ChevronRight, Circle, CircleDot } from 'lucide-react'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from '@/ui/sidebar'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/ui/collapsible'
import { modules } from '@/content/catalog'
import { useProgress, topicKey } from '@/settings'
import { useI18n } from '@/i18n'
import { cn } from '@/lib/utils'
import type { ModuleMeta, UnitMeta } from '@/lesson/catalog'
import { useLocationParts } from './use-location-parts'

export function NavSidebar() {
  const { t, locale } = useI18n()
  const { module: current, ref } = useLocationParts()
  const progress = useProgress()

  return (
    <Sidebar
      collapsible="offcanvas"
      className="top-(--header-h) h-[calc(100svh-var(--header-h))] border-e border-line"
    >
      <SidebarContent className="gap-0">
        {modules.map((m) => (
          <ModuleGroup
            key={m.id}
            module={m}
            locale={locale}
            active={current?.id === m.id}
            activeUnit={ref?.unit.id}
            activeTopic={ref?.topic.id}
            completed={(unitId, topicId) =>
              progress.topics[topicKey(m.id, unitId, topicId)]?.completed ?? false
            }
            t={t}
          />
        ))}
      </SidebarContent>
      <SidebarFooter className="border-t border-line text-xs text-ink-3">
        <a
          href="https://hamptonmakes.com"
          className="hover:text-ink"
          target="_blank"
          rel="noreferrer"
        >
          {t('footer.madeBy')}
        </a>
      </SidebarFooter>
    </Sidebar>
  )
}

function ModuleGroup({
  module,
  locale,
  active,
  activeUnit,
  activeTopic,
  completed,
  t,
}: {
  module: ModuleMeta
  locale: string
  active: boolean
  activeUnit?: string
  activeTopic?: string
  completed: (unitId: string, topicId: string) => boolean
  t: (key: string) => string
}) {
  const soon = module.status === 'coming-soon'
  return (
    <SidebarGroup className="py-1">
      <SidebarGroupLabel
        asChild
        className="h-8 text-[0.8rem] font-semibold text-ink hover:bg-paper-3"
      >
        <Link
          to="/$locale/$module"
          params={{ locale, module: module.id }}
          data-testid={`nav-module-${module.id}`}
        >
          <span className="truncate">{module.short}</span>
          {module.status !== 'live' && (
            <span className="ms-auto rounded-sm bg-paper-3 px-1.5 py-0.5 text-[0.65rem] font-medium tracking-wide text-ink-3 uppercase">
              {module.status === 'prototype' ? t('nav.prototype') : t('nav.comingSoon')}
            </span>
          )}
        </Link>
      </SidebarGroupLabel>
      {!soon && (
        <SidebarGroupContent>
          <SidebarMenu>
            {module.units.map((unit) => (
              <UnitItem
                key={unit.id}
                module={module}
                unit={unit}
                locale={locale}
                open={
                  active
                    ? activeUnit === unit.id || activeUnit === undefined
                    : unit === module.units[0] && false
                }
                activeTopic={activeUnit === unit.id ? activeTopic : undefined}
                completed={completed}
              />
            ))}
          </SidebarMenu>
        </SidebarGroupContent>
      )}
    </SidebarGroup>
  )
}

function UnitItem({
  module,
  unit,
  locale,
  open,
  activeTopic,
  completed,
}: {
  module: ModuleMeta
  unit: UnitMeta
  locale: string
  open: boolean
  activeTopic?: string
  completed: (unitId: string, topicId: string) => boolean
}) {
  const done = unit.topics.filter((tp) => completed(unit.id, tp.id)).length
  return (
    <Collapsible
      asChild
      defaultOpen={open}
      key={`${unit.id}-${open ? 'o' : 'c'}`}
      className="group/unit"
    >
      <SidebarMenuItem>
        <CollapsibleTrigger asChild>
          <SidebarMenuButton
            className="text-[0.8rem]"
            data-testid={`nav-unit-${module.id}-${unit.id}`}
          >
            <span className="w-5 shrink-0 font-mono text-[0.7rem] text-ink-3">{unit.numeral}</span>
            <span className="truncate">{unit.title}</span>
            <ChevronRight className="ms-auto size-3.5 text-ink-3 transition-transform group-data-[state=open]/unit:rotate-90" />
          </SidebarMenuButton>
        </CollapsibleTrigger>
        {done > 0 && (
          <SidebarMenuBadge className="end-7 text-[0.65rem] text-ink-3">
            {done}/{unit.topics.length}
          </SidebarMenuBadge>
        )}
        <CollapsibleContent>
          <SidebarMenuSub className="me-0 border-line ps-2">
            {unit.topics.map((topic) => {
              const isActive = activeTopic === topic.id
              const isDone = completed(unit.id, topic.id)
              return (
                <SidebarMenuSubItem key={topic.id}>
                  <SidebarMenuSubButton asChild isActive={isActive} className="h-7 text-[0.8rem]">
                    <Link
                      to="/$locale/$module/$unit/$topic"
                      params={{ locale, module: module.id, unit: unit.id, topic: topic.id }}
                      data-testid={`nav-topic-${topic.id}`}
                      title={topic.summary}
                    >
                      <ProgressDot active={isActive} done={isDone} />
                      <span className="truncate">{topic.title}</span>
                    </Link>
                  </SidebarMenuSubButton>
                </SidebarMenuSubItem>
              )
            })}
          </SidebarMenuSub>
        </CollapsibleContent>
      </SidebarMenuItem>
    </Collapsible>
  )
}

function ProgressDot({ active, done }: { active: boolean; done: boolean }) {
  if (done) return <Check className={cn('size-3.5 shrink-0 text-ok')} aria-label="done" />
  if (active) return <CircleDot className="size-3.5 shrink-0 text-teal" aria-hidden="true" />
  return <Circle className="size-3.5 shrink-0 text-ink-3/60" aria-hidden="true" />
}
