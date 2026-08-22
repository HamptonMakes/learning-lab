import { useParams } from '@tanstack/react-router'
import { findModule } from '@/content/catalog'
import { findTopic, type TopicRef } from '@/lesson/catalog'
import type { Locale } from '@/i18n/locales'
import type { ModuleMeta } from '@/lesson/catalog'

export interface LocationParts {
  locale: Locale
  module?: ModuleMeta
  ref?: TopicRef
}

/** Where am I? Derived from route params; safe to call from any component under /$locale. */
export function useLocationParts(): LocationParts {
  const params = useParams({ strict: false }) as {
    locale?: string
    module?: string
    unit?: string
    topic?: string
  }
  const locale = (params.locale ?? 'en') as Locale
  const module = params.module ? findModule(params.module) : undefined
  const ref =
    module && params.unit && params.topic ? findTopic(module, params.unit, params.topic) : undefined
  return { locale, module, ref }
}
