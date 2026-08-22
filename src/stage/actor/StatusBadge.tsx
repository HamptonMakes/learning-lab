/**
 * StatusBadge — icon + word for `Actor.status` (lock / waiting / busy / error). Anchored and
 * addressable as `<actor>@status` (DSL §3).
 */
import { Hourglass, LoaderCircle, Lock, TriangleAlert, type LucideIcon } from 'lucide-react'
import type { Actor, ActorStatus } from '@/lesson/types'
import { useT } from '@/i18n'
import { useAnchor } from '../geometry/AnchorRegistry'
import { Pill, type PillTone } from './Pill'

const STATUS: Record<ActorStatus, { icon: LucideIcon; tone: PillTone }> = {
  lock: { icon: Lock, tone: 'accent' },
  waiting: { icon: Hourglass, tone: 'neutral' },
  busy: { icon: LoaderCircle, tone: 'warn' },
  error: { icon: TriangleAlert, tone: 'danger' },
}

export function StatusBadge({ actor, status }: { actor: Actor; status: ActorStatus }) {
  const t = useT()
  const path = `${actor.id}@status`
  const ref = useAnchor(path)
  const { icon, tone } = STATUS[status]
  return (
    <Pill ref={ref} data-path={path} data-status={status} tone={tone} icon={icon}>
      {t(`stage.status.${status}`)}
    </Pill>
  )
}
