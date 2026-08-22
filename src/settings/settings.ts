import { z } from 'zod'
import { LOCALES } from '@/i18n/locales'
import { createLocalStore } from './store'

export const SPEEDS = [0.5, 0.75, 1, 1.5, 2, 3] as const
export type Speed = (typeof SPEEDS)[number]

export const SettingsSchema = z.object({
  theme: z.enum(['system', 'light', 'dark']).default('system'),
  sound: z.boolean().default(true),
  volume: z.number().min(0).max(1).default(0.5),
  speed: z
    .union(
      SPEEDS.map((s) => z.literal(s)) as [
        z.ZodLiteral<Speed>,
        z.ZodLiteral<Speed>,
        ...z.ZodLiteral<Speed>[],
      ],
    )
    .default(1),
  locale: z.enum(LOCALES).optional(),
  reducedMotion: z.enum(['system', 'on', 'off']).default('system'),
  sidebarOpen: z.boolean().default(true),
})
export type Settings = z.infer<typeof SettingsSchema>

export const DEFAULT_SETTINGS: Settings = SettingsSchema.parse({})

/** Key is mirrored by the inline theme script in index.html. */
export const SETTINGS_KEY = 'cs-lab:settings'

export const settingsStore = createLocalStore<Settings>(
  SETTINGS_KEY,
  SettingsSchema,
  DEFAULT_SETTINGS,
)

export type Theme = Settings['theme']

export function resolveTheme(theme: Theme, systemDark: boolean): 'light' | 'dark' {
  return theme === 'system' ? (systemDark ? 'dark' : 'light') : theme
}

export function resolveReducedMotion(
  pref: Settings['reducedMotion'],
  systemReduced: boolean,
): boolean {
  return pref === 'system' ? systemReduced : pref === 'on'
}
