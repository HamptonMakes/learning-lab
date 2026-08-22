/**
 * The strip under the transport: "When to use", "When not to use", "In the real world", and a
 * "Try it" slot. Pure presentation over the Topic data.
 */
import { Check, X, Globe, FlaskConical } from 'lucide-react'
import type { ReactNode } from 'react'
import { useI18n } from '@/i18n'
import { cn } from '@/lib/utils'

export interface TopicPanelsProps {
  whenToUse: string[]
  whenNotToUse: string[]
  realWorld: string
  tryIt?: ReactNode
  className?: string
}

export function TopicPanels({
  whenToUse,
  whenNotToUse,
  realWorld,
  tryIt,
  className,
}: TopicPanelsProps) {
  const { t } = useI18n()
  return (
    <section
      className={cn('grid gap-4 md:grid-cols-2 xl:grid-cols-4', className)}
      data-testid="topic-panels"
    >
      <Panel icon={<Check className="text-ok" />} title={t('topic.whenToUse')} testId="when-to-use">
        <Bullets items={whenToUse} tone="ok" />
      </Panel>
      <Panel
        icon={<X className="text-danger" />}
        title={t('topic.whenNotToUse')}
        testId="when-not-to-use"
      >
        <Bullets items={whenNotToUse} tone="danger" />
      </Panel>
      <Panel
        icon={<Globe className="text-teal" />}
        title={t('topic.realWorld')}
        testId="real-world"
      >
        <p className="text-sm leading-relaxed text-ink-2">{realWorld}</p>
      </Panel>
      <Panel
        icon={<FlaskConical className="text-actor-c" />}
        title={t('topic.tryIt')}
        testId="try-it"
      >
        {tryIt ?? <p className="text-sm text-ink-3">{t('topic.tryItSoon')}</p>}
      </Panel>
    </section>
  )
}

function Panel({
  icon,
  title,
  testId,
  children,
}: {
  icon: ReactNode
  title: string
  testId: string
  children: ReactNode
}) {
  return (
    <div className="rounded-xl border border-line bg-card p-4" data-testid={testId}>
      <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-ink [&_svg]:size-4">
        {icon} {title}
      </h3>
      {children}
    </div>
  )
}

function Bullets({ items, tone }: { items: string[]; tone: 'ok' | 'danger' }) {
  return (
    <ul className="space-y-1.5 text-sm leading-snug text-ink-2">
      {items.map((item, i) => (
        <li key={i} className="flex gap-2">
          <span
            className={cn(
              'mt-2 size-1.5 shrink-0 rounded-full',
              tone === 'ok' ? 'bg-ok' : 'bg-danger',
            )}
            aria-hidden="true"
          />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  )
}
