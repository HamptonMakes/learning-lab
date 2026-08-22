/**
 * OfflineBadge — "no connection" for an actor with `online: false`. The card body is dimmed by
 * ActorCard; this badge stays crisp so the state reads at a glance.
 */
import { WifiOff } from 'lucide-react'
import { useT } from '@/i18n'
import { Pill } from './Pill'

export function OfflineBadge() {
  const t = useT()
  return (
    <Pill data-offline="" tone="warn" icon={WifiOff}>
      {t('stage.offline')}
    </Pill>
  )
}
