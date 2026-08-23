/**
 * FlowStage — the "Watch it flow" frame, live. Wraps the lesson's last world in a sandbox driven by
 * the autopilot (`useFlow`): updates poke the copies, the copies sync, a copy drops offline and
 * comes back, and the real CRDT code computes every value. The Stage draws it like any step; this
 * component adds the HUD along the bottom edge — a status line with the last beats and two keys
 * (Run/Pause, Shuffle). Autoplay is off under instant (verify) and reduced motion; the Run key
 * still works there. The player's speed multiplier scales the beat.
 */
import { useCallback, useMemo } from 'react'
import { useReducedMotion } from 'motion/react'
import { Pause, Play, Shuffle } from 'lucide-react'
import { Stage } from '@/stage'
import { Button } from '@/ui/button'
import { useI18n } from '@/i18n'
import { cn } from '@/lib/utils'
import type { Frame } from '@/lesson/types'
import type { UiText } from '@/lesson/sandbox'
import { useFlow, type FlowApi } from '@/lesson/flow'

export interface FlowStageProps {
  /** The presentation's flow frame (`slide.kind === 'flow'`, world = the lesson's last world). */
  frame: Frame
  speed: number
  reducedSetting: boolean
  /** The player's instant flag for this paint (a seek lands instantly; the beats still animate). */
  instant: boolean
  /** False under verify / forced-instant pages: the flow waits for the Run key. */
  autoStart: boolean
  dir: 'ltr' | 'rtl'
  topicId: string
}

export function FlowStage({
  frame,
  speed,
  reducedSetting,
  instant,
  autoStart,
  dir,
  topicId,
}: FlowStageProps) {
  const { t } = useI18n()
  const osReduced = useReducedMotion() === true
  const text = useCallback((ui: UiText) => ('text' in ui ? ui.text : t(ui.key, ui.vars)), [t])
  // The sandbox starts from the frame's world, drawn as a plain stage (no slide).
  const start = useMemo<Frame>(() => {
    const { slide: _slide, ...rest } = frame
    return rest
  }, [frame])
  const flow = useFlow(start, {
    ctx: { sceneId: frame.sceneId, topicId },
    speed,
    autoStart: autoStart && !reducedSetting && !osReduced,
    text,
  })
  return (
    <Stage
      frame={flow.frame}
      speed={speed}
      reducedSetting={reducedSetting}
      instant={instant || flow.move !== 'run'}
      dir={dir}
      hud={<FlowHud flow={flow} />}
    />
  )
}

function FlowHud({ flow }: { flow: FlowApi }) {
  const { t } = useI18n()
  const last = flow.log[flow.log.length - 1]
  const earlier = flow.log.slice(0, -1).slice(-1)
  return (
    <div
      data-flow-hud=""
      data-flow-n={flow.n}
      data-flow-running={flow.running ? '' : undefined}
      className="pointer-events-none absolute inset-x-(--stage-pad) bottom-(--stage-pad) z-20 flex items-end justify-between gap-3"
    >
      <output
        aria-label={t('flow.status')}
        aria-live="polite"
        className="pointer-events-auto flex max-w-[72%] min-w-0 items-center gap-2 rounded-sm bg-led-panel px-2.5 py-1.5 font-mono text-[12px] leading-4 text-screen"
        data-testid="flow-status"
      >
        <span
          aria-hidden
          className={cn(
            'size-2 shrink-0 rounded-full',
            flow.running ? 'bg-led-amber shadow-[0_0_6px_var(--led-amber)]' : 'bg-ink-3',
          )}
        />
        {last ? (
          <span className="flex min-w-0 items-baseline gap-2 truncate">
            {earlier.map((e) => (
              <span key={e.n} className="truncate text-screen/55">
                {e.text}
              </span>
            ))}
            <span className="shrink-0" data-flow-last data-flow-beat={last.beat}>
              {last.text}
            </span>
          </span>
        ) : (
          <span className="truncate text-screen/80">{t('flow.idle')}</span>
        )}
      </output>
      <div className="pointer-events-auto flex shrink-0 items-center gap-1.5">
        <Button
          variant="key"
          size="sm"
          onClick={flow.toggle}
          aria-pressed={flow.running}
          data-testid="flow-toggle"
        >
          {flow.running ? (
            <Pause data-icon="inline-start" className="fill-current" />
          ) : (
            <Play data-icon="inline-start" className="fill-current" />
          )}
          {flow.running ? t('flow.pause') : t('flow.run')}
        </Button>
        <Button variant="key" size="sm" onClick={flow.shuffle} data-testid="flow-shuffle">
          <Shuffle data-icon="inline-start" /> {t('flow.shuffle')}
        </Button>
      </div>
    </div>
  )
}
