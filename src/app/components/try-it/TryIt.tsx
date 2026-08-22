/**
 * TryIt — the "Try it" panel: a compact "Open sandbox" button that opens a bottom sheet with a
 * live <Stage> driven by the real reducer (docs/animation-dsl.md §11). The sandbox starts from the
 * lesson's current frame; its controls are derived from the world (or a scene's TryIt override).
 * Every button builds DSL commands, runs them through `applyStep`, and narrates what happened.
 * Prompts are inline inputs (never window.prompt). Undo / Reset rewind the sandbox history.
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
} from 'react'
import { LayoutGroup } from 'motion/react'
import { FlaskConical, Radio, RotateCcw, Undo2, Wifi, WifiOff } from 'lucide-react'
import { track, type TopicRef } from '@/analytics'
import { useI18n } from '@/i18n'
import {
  useSandbox,
  deriveControls,
  type SandboxControl,
  type SandboxInput,
  type UiText,
} from '@/lesson/sandbox'
import type { Frame, SceneId, TryIt as TryItDecl } from '@/lesson/types'
import { cn } from '@/lib/utils'
import { useSetting } from '@/settings'
import { useSound } from '@/sound'
import { Stage, actorHueStyle } from '@/stage'
import { Badge } from '@/ui/badge'
import { Button } from '@/ui/button'
import { Input } from '@/ui/input'
import { Kbd } from '@/ui/kbd'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/ui/sheet'

export interface TryItProps {
  /** The lesson's current frame: the sandbox starts from its world. */
  frame: Frame
  topicRef: TopicRef
  sceneId: SceneId
  /** The scene's optional TryIt declaration (restricts the derived controls). */
  tryIt?: TryItDecl
  className?: string
}

export function TryIt({ frame, topicRef: ref, sceneId, tryIt, className }: TryItProps) {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  const { module, unit, topic } = ref
  const topicRef = useMemo<TopicRef>(() => ({ module, unit, topic }), [module, unit, topic])
  const onOpenChange = (next: boolean) => {
    setOpen(next)
    track('try_it', { ...topicRef, action: next ? 'open' : 'close' })
  }
  return (
    <div className={cn('flex flex-col gap-2', className)} data-testid="try-it-panel">
      <p className="text-sm leading-snug text-ink-2">{t('tryIt.blurb')}</p>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetTrigger asChild>
          <Button variant="outline" size="sm" className="self-start" data-testid="try-it-open">
            <FlaskConical data-icon="inline-start" /> {t('tryIt.open')}
          </Button>
        </SheetTrigger>
        <SheetContent
          side="bottom"
          className="max-h-[92svh] gap-0 overflow-y-auto bg-paper p-0"
          data-testid="try-it-sheet"
        >
          <div className="mx-auto flex w-full max-w-6xl flex-col gap-3 px-4 pb-5 md:px-6">
            <SheetHeader className="px-0 pb-0">
              <SheetTitle className="flex items-center gap-2 text-ink">
                <FlaskConical className="size-4 text-actor-c" /> {t('tryIt.title')}
              </SheetTitle>
              <SheetDescription className="text-ink-3">{t('tryIt.hint')}</SheetDescription>
            </SheetHeader>
            {open && (
              <Sandbox
                startFrame={frame}
                sceneId={sceneId}
                topicRef={topicRef}
                {...(tryIt ? { tryIt } : {})}
              />
            )}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  )
}

// ─── Sandbox ──────────────────────────────────────────────────────────────────────────────────

function Sandbox({
  startFrame,
  sceneId,
  topicRef,
  tryIt,
}: {
  startFrame: Frame
  sceneId: SceneId
  topicRef: TopicRef
  tryIt?: TryItDecl
}) {
  const { t, dir } = useI18n()
  const [speed] = useSetting('speed')
  const [reducedPref] = useSetting('reducedMotion')
  const { play } = useSound()
  const sandbox = useSandbox(startFrame, { sceneId, topicId: topicRef.topic })
  const { frame, move, lastError, canUndo, run, undo, reset } = sandbox
  const controls = useMemo(() => deriveControls(frame.world, tryIt), [frame.world, tryIt])
  const [pending, setPending] = useState<SandboxControl | null>(null)
  const text = useCallback((ui: UiText) => ('text' in ui ? ui.text : t(ui.key, ui.vars)), [t])

  const fire = useCallback(
    (control: SandboxControl, input?: SandboxInput) => {
      setPending(null)
      const result = run(control.commands(input), text(control.say(input)))
      track('try_it', { ...topicRef, action: control.action })
      if (!result.ok) return
      play('tick')
      if (result.frame.changes.some((c) => c.kind === 'message' && c.op === 'delivered')) {
        play('bloop', { volume: 0.5 })
      }
    },
    [play, run, text, topicRef],
  )
  const press = (control: SandboxControl) => {
    if (control.prompt) setPending((p) => (p?.id === control.id ? null : control))
    else fire(control)
  }
  const onUndo = () => {
    setPending(null)
    undo()
    track('try_it', { ...topicRef, action: 'undo' })
  }
  const onReset = () => {
    setPending(null)
    reset()
    track('try_it', { ...topicRef, action: 'reset' })
  }

  const fromStep = startFrame.index + 1
  const say = sandbox.history.length > 1 ? frame.step.say : t('tryIt.say.start', { step: fromStep })

  const renderButtons = (list: SandboxControl[]) =>
    list.map((c) => (
      <ControlButton
        key={c.id}
        control={c}
        label={text(c.label)}
        reason={c.disabled ? text(c.disabled) : undefined}
        expanded={pending?.id === c.id}
        onPress={() => press(c)}
      />
    ))
  const promptFor = (list: SandboxControl[]): ReactNode =>
    pending && list.some((c) => c.id === pending.id) ? (
      <PromptForm
        key={pending.id}
        control={pending}
        text={text}
        onSubmit={(input) => fire(pending, input)}
        onCancel={() => setPending(null)}
      />
    ) : null

  return (
    <div className="flex flex-col gap-3 lg:flex-row lg:items-start" data-testid="try-it-sandbox">
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <LayoutGroup id="sandbox">
          <Stage
            frame={frame}
            speed={speed}
            reducedSetting={reducedPref === 'on'}
            instant={move !== 'run'}
            dir={dir}
            className="min-h-(--stage-min-h)"
          />
        </LayoutGroup>
        <div
          className="min-h-10 rounded-lg border border-line bg-card px-4 py-2 text-sm leading-relaxed text-ink"
          data-testid="try-it-say"
          data-step={frame.step.id}
          aria-live="polite"
          aria-atomic="true"
        >
          {say}
        </div>
        {lastError !== undefined && (
          <div
            role="alert"
            data-testid="try-it-error"
            className="rounded-lg border border-warn/40 bg-warn-soft px-3 py-2 text-sm text-ink"
          >
            <span className="font-medium">{t('tryIt.errorTitle')}</span>{' '}
            <span className="font-mono text-xs break-words text-ink-2">{lastError}</span>
          </div>
        )}
      </div>

      <aside
        className="flex w-full flex-col gap-2 lg:w-80 lg:shrink-0"
        aria-label={t('tryIt.controls')}
      >
        {controls.empty ? (
          <p className="text-sm text-ink-3" data-testid="try-it-empty">
            {t('tryIt.empty')}
          </p>
        ) : (
          controls.actors.map((ac) => (
            <section
              key={ac.actor.id}
              data-testid={`try-it-actor-${ac.actor.id}`}
              data-online={ac.actor.online}
              style={actorHueStyle(ac.actor.color)}
              className="rounded-lg border border-s-2 border-line border-s-(--card-hue) bg-card p-2.5"
            >
              <header className="mb-1.5 flex items-center justify-between gap-2">
                <span className="flex items-center gap-1.5 text-sm font-medium text-ink">
                  <span aria-hidden className="size-2 rounded-full bg-(--card-hue)" />
                  {ac.actor.label}
                </span>
                {ac.actor.online ? (
                  <Wifi className="size-3.5 text-ink-3" aria-hidden />
                ) : (
                  <Badge variant="outline" className="gap-1 text-ink-2">
                    <WifiOff /> {t('stage.offline')}
                  </Badge>
                )}
              </header>
              {ac.slots.map((sc) => (
                <div key={sc.slot} className="mb-1.5 flex flex-wrap items-center gap-1">
                  <span className="me-1 font-mono text-xs text-ink-3">{sc.slot}</span>
                  {renderButtons(sc.ops)}
                </div>
              ))}
              {ac.network.length > 0 && (
                <div className="flex flex-wrap items-center gap-1">{renderButtons(ac.network)}</div>
              )}
              {promptFor([...ac.slots.flatMap((s) => s.ops), ...ac.network])}
            </section>
          ))
        )}

        {controls.network.length > 0 && (
          <section
            className="rounded-lg border border-line bg-card p-2.5"
            data-testid="try-it-network"
          >
            <header className="mb-1.5 flex items-center gap-1.5 text-sm font-medium text-ink">
              <Radio className="size-3.5 text-ink-3" aria-hidden /> {t('tryIt.network')}
            </header>
            <div className="flex flex-wrap items-center gap-1">
              {renderButtons(controls.network)}
            </div>
            {promptFor(controls.network)}
          </section>
        )}

        <div className="flex items-center gap-1.5">
          <Button
            variant="outline"
            size="sm"
            onClick={onUndo}
            disabled={!canUndo}
            data-testid="try-it-undo"
          >
            <Undo2 data-icon="inline-start" /> {t('tryIt.undo')}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={onReset}
            disabled={!canUndo}
            data-testid="try-it-reset"
          >
            <RotateCcw data-icon="inline-start" /> {t('tryIt.reset')}
          </Button>
          <span className="ms-auto text-xs text-ink-3">
            <Kbd>Esc</Kbd> {t('common.close')}
          </span>
        </div>
      </aside>
    </div>
  )
}

// ─── Pieces ───────────────────────────────────────────────────────────────────────────────────

function ControlButton({
  control,
  label,
  reason,
  expanded,
  onPress,
}: {
  control: SandboxControl
  label: string
  reason: string | undefined
  expanded: boolean
  onPress: () => void
}) {
  return (
    <Button
      variant={expanded ? 'secondary' : 'outline'}
      size="xs"
      onClick={onPress}
      disabled={reason !== undefined}
      title={reason}
      aria-expanded={control.prompt ? expanded : undefined}
      data-testid={`try-it-${control.id}`}
      data-action={control.action}
      className="font-normal"
    >
      {label}
      {control.prompt && <span aria-hidden>…</span>}
    </Button>
  )
}

function PromptForm({
  control,
  text,
  onSubmit,
  onCancel,
}: {
  control: SandboxControl
  text: (ui: UiText) => string
  onSubmit: (input: SandboxInput) => void
  onCancel: () => void
}) {
  const { t } = useI18n()
  const prompt = control.prompt
  const [value, setValue] = useState('')
  const [key, setKey] = useState('')
  const first = useRef<HTMLInputElement>(null)
  useEffect(() => first.current?.focus(), [])
  if (!prompt) return null

  if (prompt.kind === 'choice') {
    return (
      <div
        className="mt-2 flex flex-wrap items-center gap-1 border-t border-line pt-2"
        data-testid="try-it-prompt"
      >
        <span className="me-1 text-xs text-ink-3">{t('tryIt.prompt.choose')}</span>
        {prompt.options.map((o) => (
          <Button
            key={o.id}
            variant="secondary"
            size="xs"
            className="font-mono"
            onClick={() => onSubmit({ choice: o.id })}
            data-testid={`try-it-choice-${o.id}`}
          >
            {o.label}
          </Button>
        ))}
        <Button variant="ghost" size="xs" onClick={onCancel} data-testid="try-it-prompt-cancel">
          {t('common.cancel')}
        </Button>
      </div>
    )
  }

  const numeric = prompt.kind === 'number'
  const valid =
    (prompt.kind !== 'field' || key.trim() !== '') &&
    (numeric ? Number.isFinite(Number(value)) && value.trim() !== '' : value !== '')
  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (!valid) return
    onSubmit(prompt.kind === 'field' ? { key: key.trim(), value } : { value })
  }
  /** Esc cancels the prompt (and does not reach the sheet, which would close). */
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      e.stopPropagation()
      onCancel()
    }
  }
  return (
    <form
      onSubmit={submit}
      className="mt-2 flex flex-wrap items-center gap-1.5 border-t border-line pt-2"
      data-testid="try-it-prompt"
    >
      {prompt.kind === 'field' && (
        <Input
          ref={first}
          value={key}
          onChange={(e) => setKey(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={t('tryIt.prompt.key')}
          aria-label={t('tryIt.prompt.key')}
          className="h-7 w-24 font-mono text-xs md:text-xs"
          data-testid="try-it-prompt-key"
        />
      )}
      <Input
        ref={prompt.kind === 'field' ? undefined : first}
        type={numeric ? 'number' : 'text'}
        inputMode={numeric ? 'numeric' : 'text'}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder={prompt.kind === 'field' ? t('tryIt.prompt.value') : text(prompt.label)}
        aria-label={prompt.kind === 'field' ? t('tryIt.prompt.value') : text(prompt.label)}
        className="h-7 w-32 flex-1 font-mono text-xs md:text-xs"
        data-testid="try-it-prompt-value"
      />
      <Button type="submit" size="xs" disabled={!valid} data-testid="try-it-prompt-confirm">
        {t('tryIt.prompt.go')}
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="xs"
        onClick={onCancel}
        data-testid="try-it-prompt-cancel"
      >
        {t('common.cancel')}
      </Button>
    </form>
  )
}
