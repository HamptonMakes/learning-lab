/**
 * Transport bar: prev / play-pause / next, progress dots, step counter, speed menu.
 * Pure presentation — the player hook owns the state; this component only calls back.
 */
import { ChevronLeft, ChevronRight, Gauge, Pause, Play, RotateCcw } from 'lucide-react'
import type { ReactNode } from 'react'
import { Button } from '@/ui/button'
import { Kbd } from '@/ui/kbd'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/tooltip'
import { useI18n } from '@/i18n'
import { SPEEDS, type Speed } from '@/settings'
import { cn } from '@/lib/utils'

export interface TransportProps {
  index: number
  total: number
  status: 'paused' | 'playing' | 'ended'
  speed: Speed
  onPrev: () => void
  onNext: () => void
  onToggle: () => void
  onRestart: () => void
  onSeek: (index: number) => void
  onSpeed: (speed: Speed) => void
  /** Optional step ids for dot tooltips / test ids. */
  stepIds?: string[]
  className?: string
  /** Extra controls rendered at the end (e.g. the Try-it trigger). */
  extra?: ReactNode
}

export function TransportBar(p: TransportProps) {
  const { t, isRtl } = useI18n()
  const atStart = p.index <= 0
  const atEnd = p.index >= p.total - 1
  const playing = p.status === 'playing'
  const Prev = isRtl ? ChevronRight : ChevronLeft
  const Next = isRtl ? ChevronLeft : ChevronRight

  return (
    <div
      role="toolbar"
      aria-label={t('player.controls')}
      data-testid="transport"
      data-status={p.status}
      className={cn(
        'flex flex-wrap items-center gap-2 rounded-lg border border-line-2 bg-paper-2 px-3 py-2 shadow-[inset_0_1px_0_var(--key)]',
        p.className,
      )}
    >
      <div className="flex items-center gap-1">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              onClick={p.onRestart}
              aria-label={t('player.restart')}
              data-testid="transport-restart"
              disabled={atStart && !playing}
            >
              <RotateCcw />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{t('player.restart')}</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="key"
              size="icon"
              onClick={p.onPrev}
              aria-label={t('player.prev')}
              data-testid="transport-prev"
              disabled={atStart}
            >
              <Prev />
            </Button>
          </TooltipTrigger>
          <TooltipContent className="flex items-center gap-2">
            {t('player.prev')} <Kbd>{isRtl ? '→' : '←'}</Kbd>
          </TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="power"
              size="icon-lg"
              onClick={p.onToggle}
              aria-label={playing ? t('player.pause') : t('player.play')}
              aria-pressed={playing}
              data-testid="transport-play"
              className="mx-0.5"
            >
              {playing ? (
                <Pause className="fill-current" />
              ) : (
                <Play className="translate-x-px fill-current" />
              )}
            </Button>
          </TooltipTrigger>
          <TooltipContent className="flex items-center gap-2">
            {playing ? t('player.pause') : t('player.play')} <Kbd>Space</Kbd>
          </TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="key"
              size="icon"
              onClick={p.onNext}
              aria-label={t('player.next')}
              data-testid="transport-next"
              disabled={atEnd}
            >
              <Next />
            </Button>
          </TooltipTrigger>
          <TooltipContent className="flex items-center gap-2">
            {t('player.next')} <Kbd>{isRtl ? '←' : '→'}</Kbd>
          </TooltipContent>
        </Tooltip>
      </div>

      <ProgressDots index={p.index} total={p.total} onSeek={p.onSeek} stepIds={p.stepIds} />

      <span
        className="ms-auto font-mono text-xs text-ink-2 tabular-nums"
        data-testid="transport-counter"
        aria-live="off"
      >
        {t('player.step_of', { n: p.index + 1, total: p.total })}
      </span>

      <DropdownMenu>
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <Button
                variant="key"
                size="sm"
                aria-label={t('player.speed')}
                data-testid="transport-speed"
                className="font-mono tabular-nums"
              >
                <Gauge /> {t('player.speedValue', { speed: p.speed })}
              </Button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent className="flex items-center gap-2">
            {t('player.speed')} <Kbd>,</Kbd> <Kbd>.</Kbd>
          </TooltipContent>
        </Tooltip>
        <DropdownMenuContent align="end" className="min-w-28">
          <DropdownMenuRadioGroup
            value={String(p.speed)}
            onValueChange={(v) => p.onSpeed(Number(v) as Speed)}
          >
            {SPEEDS.map((s) => (
              <DropdownMenuRadioItem
                key={s}
                value={String(s)}
                className="font-mono tabular-nums"
                data-testid={`speed-${s}`}
              >
                {t('player.speedValue', { speed: s })}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      {p.extra}
    </div>
  )
}

function ProgressDots({
  index,
  total,
  onSeek,
  stepIds,
}: {
  index: number
  total: number
  onSeek: (i: number) => void
  stepIds?: string[]
}) {
  const { t } = useI18n()
  if (total <= 0) return null
  // Many steps: a slim scrubber instead of dots (32 dots is what fits beside the keys at 1280px).
  if (total > 32) {
    return (
      <input
        type="range"
        min={0}
        max={total - 1}
        value={index}
        onChange={(e) => onSeek(Number(e.currentTarget.value))}
        aria-label={t('a11y.currentStep')}
        data-testid="transport-progress"
        className="mx-2 h-1 w-40 accent-(--accent)"
      />
    )
  }
  return (
    <ol
      className="mx-2 flex items-center gap-1"
      data-testid="transport-progress"
      aria-label={t('a11y.currentStep')}
    >
      {Array.from({ length: total }, (_, i) => {
        const done = i < index
        const active = i === index
        return (
          <li key={i} className="flex">
            <button
              type="button"
              onClick={() => onSeek(i)}
              aria-label={t('player.step_of', { n: i + 1, total })}
              aria-current={active ? 'step' : undefined}
              title={stepIds?.[i]}
              data-testid={`step-dot-${i}`}
              className={cn(
                'h-2.5 rounded-full transition-[width,background-color] duration-200 ease-out',
                active
                  ? 'w-5 bg-led-amber shadow-[0_0_6px_var(--led-amber)]'
                  : done
                    ? 'w-2.5 bg-ink-3/70 hover:bg-ink-2'
                    : 'w-2.5 bg-line-2 hover:bg-ink-3/60',
              )}
            />
          </li>
        )
      })}
    </ol>
  )
}
