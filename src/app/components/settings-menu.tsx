import {
  Settings2,
  Moon,
  Sun,
  Monitor,
  Volume2,
  VolumeX,
  Languages,
  Accessibility,
  RotateCcw,
} from 'lucide-react'
import { useNavigate, useRouterState } from '@tanstack/react-router'
import { Button } from '@/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/tooltip'
import { useSettings, resetProgress, type Settings } from '@/settings'
import { useI18n } from '@/i18n'
import { LOCALES, LOCALE_NAMES, isLocale, type Locale } from '@/i18n/locales'
import { track } from '@/analytics'
import { useSound } from '@/sound'

export function SettingsMenu() {
  const { t, locale } = useI18n()
  const [settings, patch] = useSettings()
  const sound = useSound()
  const navigate = useNavigate()
  const pathname = useRouterState({ select: (s) => s.location.pathname })

  const setTheme = (theme: Settings['theme']) => {
    patch({ theme })
    track('theme_change', { theme })
  }
  const setSound = (enabled: boolean) => {
    sound.setEnabled(enabled) // also unlocks audio inside the click gesture
    track('sound_toggle', { enabled })
    if (enabled) sound.play('toggle')
  }
  const setMotion = (reducedMotion: Settings['reducedMotion']) => patch({ reducedMotion })
  const setLocale = (next: Locale) => {
    if (next === locale) return
    patch({ locale: next })
    track('locale_change', { from: locale, to: next })
    const rest = pathname.replace(/^\/[^/]+/, '')
    void navigate({ to: `/${next}${rest}` as '/' })
  }

  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              aria-label={t('settings.title')}
              data-testid="settings-trigger"
            >
              <Settings2 />
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent>{t('settings.title')}</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel>{t('settings.theme')}</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={settings.theme}
          onValueChange={(v) => setTheme(v as Settings['theme'])}
        >
          <DropdownMenuRadioItem value="system">
            <Monitor /> {t('settings.theme.system')}
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="light">
            <Sun /> {t('settings.theme.light')}
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="dark">
            <Moon /> {t('settings.theme.dark')}
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem
            onSelect={(e) => {
              e.preventDefault()
              setSound(!settings.sound)
            }}
            data-testid="settings-sound"
          >
            {settings.sound ? <Volume2 /> : <VolumeX />}
            {t('settings.sound')}
            <span className="ms-auto text-xs text-ink-3">
              {settings.sound ? t('settings.on') : t('settings.off')}
            </span>
          </DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <Accessibility /> {t('settings.reducedMotion')}
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            <DropdownMenuRadioGroup
              value={settings.reducedMotion}
              onValueChange={(v) => setMotion(v as Settings['reducedMotion'])}
            >
              <DropdownMenuRadioItem value="system">
                {t('settings.reducedMotion.system')}
              </DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="on">
                {t('settings.reducedMotion.on')}
              </DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="off">
                {t('settings.reducedMotion.off')}
              </DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <Languages /> {t('settings.language')}
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            <DropdownMenuRadioGroup
              value={locale}
              onValueChange={(v) => isLocale(v) && setLocale(v)}
            >
              {LOCALES.map((l) => (
                <DropdownMenuRadioItem key={l} value={l} lang={l}>
                  {LOCALE_NAMES[l]}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onSelect={() => resetProgress()}>
          <RotateCcw /> {t('settings.resetProgress')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
