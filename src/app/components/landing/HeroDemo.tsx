/**
 * HeroDemo — the landing page's proof: a small stage running the LWW-register lesson world
 * (src/lesson/fixtures/lww-register — the same data as topic II.2) on the flow autopilot. Two real
 * copies, the real merge code, converging while you read the headline. Scaled down by overriding
 * the stage dimension tokens on the wrapper (tokens.css keeps them inheritable); a "LIVE" LED tag
 * sits in the corner and doubles as the pause/run key. Autoplay respects reduced motion (setting
 * and OS) — the tag then reads "demo" and a click starts it.
 */
import { useCallback, useMemo } from 'react'
import { Stage } from '@/stage'
import { useI18n } from '@/i18n'
import { useReducedMotion, useSetting } from '@/settings'
import { cn } from '@/lib/utils'
import type { Frame } from '@/lesson/types'
import type { UiText } from '@/lesson/sandbox'
import { buildTimeline } from '@/lesson/reducer/timeline'
import { lwwRegisterTopic } from '@/lesson/fixtures/lww-register'
import { useFlow } from '@/lesson/flow'

export function HeroDemo() {
  const { t, dir } = useI18n()
  const [reducedPref] = useSetting('reducedMotion')
  const reduced = useReducedMotion()
  const text = useCallback((ui: UiText) => ('text' in ui ? ui.text : t(ui.key, ui.vars)), [t])
  const start = useMemo<Frame>(() => {
    const frames = buildTimeline(lwwRegisterTopic, { assertMode: 'warn' })
    const last = frames[frames.length - 1] as Frame
    // the lesson's marks belong to its last step, not to the demo
    return { ...last, world: { ...last.world, marks: [] }, prev: { ...last.world, marks: [] } }
  }, [])
  const flow = useFlow(start, {
    ctx: { sceneId: 'hero', topicId: 'landing-hero' },
    speed: 1,
    autoStart: !reduced,
    text,
  })
  return (
    <div
      data-testid="hero-demo"
      className="[--stage-clock-h:2.5rem] [--stage-gap:1.125rem] [--stage-min-h:19rem] [--stage-pad:1rem] [--value-fs:14px]"
    >
      <Stage
        frame={flow.frame}
        speed={1}
        reducedSetting={reducedPref === 'on'}
        instant={flow.move !== 'run'}
        dir={dir}
        hud={<LiveTag running={flow.running} onToggle={flow.toggle} />}
      />
      <p className="mt-2 text-center font-mono text-xs text-ink-3">{t('landing.demoCaption')}</p>
    </div>
  )
}

function LiveTag({ running, onToggle }: { running: boolean; onToggle: () => void }) {
  const { t } = useI18n()
  return (
    <div data-flow-hud="" className="absolute inset-x-(--stage-pad) bottom-(--stage-pad) z-20">
      <button
        type="button"
        onClick={onToggle}
        aria-pressed={running}
        aria-label={t(running ? 'flow.pause' : 'flow.run')}
        data-testid="hero-demo-toggle"
        className="flex items-center gap-1.5 rounded-sm bg-led-panel px-2 py-1 font-mono text-[10px] tracking-widest text-led uppercase"
      >
        <span
          aria-hidden
          className={cn(
            'size-1.5 rounded-full',
            running ? 'bg-led-amber shadow-[0_0_5px_var(--led-amber)]' : 'bg-ink-3',
          )}
        />
        {t(running ? 'landing.live' : 'landing.demoPaused')}
      </button>
    </div>
  )
}
