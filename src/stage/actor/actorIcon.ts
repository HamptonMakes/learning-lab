/**
 * ActorIcon → lucide glyph, with the default icon derived from the actor's kind (DSL §2).
 */
import {
  Cloud,
  Cog,
  Database,
  Globe,
  Laptop,
  Server,
  Smartphone,
  Tablet,
  User,
  type LucideIcon,
} from 'lucide-react'
import type { Actor, ActorIcon, ActorKind } from '@/lesson/types'

const ICONS: Record<ActorIcon, LucideIcon> = {
  person: User,
  phone: Smartphone,
  laptop: Laptop,
  tablet: Tablet,
  server: Server,
  cloud: Cloud,
  service: Cog,
  database: Database,
  region: Globe,
}

const DEFAULT_ICON: Record<ActorKind, ActorIcon> = {
  person: 'person',
  device: 'laptop',
  server: 'server',
  service: 'service',
}

export function actorIconName(actor: Pick<Actor, 'kind' | 'icon'>): ActorIcon {
  return actor.icon ?? DEFAULT_ICON[actor.kind]
}

export function actorIcon(actor: Pick<Actor, 'kind' | 'icon'>): LucideIcon {
  return ICONS[actorIconName(actor)]
}
