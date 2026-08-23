/**
 * Narration panel under the stage: the current step's sentence(s), announced politely to screen
 * readers. Keyed by step id so the text swap is crisp (no cross-fade: legibility first).
 */
import { useI18n } from '@/i18n'
import { cn } from '@/lib/utils'
import { SayMarkup } from './say-markup'

export function Narration({
  say,
  stepId,
  className,
}: {
  say: string
  stepId: string
  className?: string
}) {
  const { t, locale } = useI18n()
  return (
    <div
      className={cn(
        'min-h-14 rounded-lg border border-line-2 bg-card px-5 py-3 text-[1.05rem] leading-relaxed text-ink',
        className,
      )}
      data-testid="narration"
      data-step={stepId}
      aria-label={t('a11y.narration')}
      aria-live="polite"
      aria-atomic="true"
    >
      <p key={stepId} className="text-balance">
        <SayMarkup say={say} locale={locale} />
      </p>
    </div>
  )
}
