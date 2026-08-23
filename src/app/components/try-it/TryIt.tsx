/**
 * TryIt — the "Try it" sandbox (docs/animation-dsl.md §11): a trigger (the default compact
 * `<TryItTrigger>` button, or whatever `renderTrigger` places) opens a bottom sheet with three
 * parts: LEFT the live <Stage> (the data) with the narration of the last action under it and a
 * "Code" panel on demand, RIGHT a narrow actions column ("Try this" suggestions, then verb-first
 * buttons grouped "Alice can…" / "Network", then Undo / Reset). Every button builds DSL commands,
 * runs them through `applyStep` and narrates what happened; the Code panel prints the real
 * `src/crdt/` function that ran. Prompts are inline (never window.prompt); undo / reset rewind.
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
} from 'react'
import { LayoutGroup } from 'motion/react'
import {
  ArrowLeftRight,
  Circle,
  CircleCheck,
  CircleMinus,
  CirclePlus,
  Clock,
  CodeXml,
  Delete,
  Eraser,
  FlaskConical,
  Inbox,
  Keyboard,
  Lightbulb,
  Minus,
  Pencil,
  Plus,
  Radio,
  RotateCcw,
  Send,
  SquarePen,
  Timer,
  Trash2,
  Undo2,
  Wifi,
  WifiOff,
  type LucideIcon,
} from 'lucide-react'
import { track, type TopicRef } from '@/analytics'
import { useI18n } from '@/i18n'
import {
  useSandbox,
  deriveControls,
  suggestExperiments,
  type SandboxActorControls,
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
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/ui/sheet'
import { CodePanel } from './CodePanel'

// ─── Trigger ──────────────────────────────────────────────────────────────────────────────────

export type TryItTriggerProps = Omit<ComponentProps<typeof Button>, 'onClick' | 'children'> & {
  onClick: () => void
}

/**
 * The compact "Open sandbox" button (flask icon + label). Usable anywhere the page wants an entry
 * point — the transport bar, next to the stage — while the sheet itself stays in <TryIt>.
 */
export function TryItTrigger({
  onClick,
  className,
  variant = 'key',
  size = 'sm',
  ...props
}: TryItTriggerProps) {
  const { t } = useI18n()
  return (
    <Button
      variant={variant}
      size={size}
      onClick={onClick}
      className={className}
      data-testid="try-it-open"
      {...props}
    >
      <FlaskConical data-icon="inline-start" /> {t('tryIt.open')}
    </Button>
  )
}

// ─── Root ─────────────────────────────────────────────────────────────────────────────────────

export interface TryItProps {
  /** The lesson's current frame: the sandbox starts from its world. */
  frame: Frame
  topicRef: TopicRef
  sceneId: SceneId
  /** The scene's optional TryIt declaration (restricts the derived controls). */
  tryIt?: TryItDecl
  /**
   * Place a custom trigger (or several) instead of the default blurb + button; `open()` opens the
   * sheet. The sheet is always rendered by <TryIt>.
   */
  renderTrigger?: (open: () => void) => ReactNode
  className?: string
}

export function TryIt({
  frame,
  topicRef: ref,
  sceneId,
  tryIt,
  renderTrigger,
  className,
}: TryItProps) {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  const { module, unit, topic } = ref
  const topicRef = useMemo<TopicRef>(() => ({ module, unit, topic }), [module, unit, topic])
  const onOpenChange = useCallback(
    (next: boolean) => {
      setOpen(next)
      track('try_it', { ...topicRef, action: next ? 'open' : 'close' })
    },
    [topicRef],
  )
  const openSheet = useCallback(() => onOpenChange(true), [onOpenChange])

  return (
    <>
      {renderTrigger ? (
        renderTrigger(openSheet)
      ) : (
        <div className={cn('flex flex-col gap-2', className)} data-testid="try-it-panel">
          <p className="text-sm leading-snug text-ink-2">{t('tryIt.blurb')}</p>
          <TryItTrigger onClick={openSheet} className="self-start" />
        </div>
      )}
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent
          side="bottom"
          className="max-h-[94svh] gap-0 overflow-y-auto bg-paper p-0"
          data-testid="try-it-sheet"
        >
          <div className="mx-auto flex w-full max-w-6xl flex-col gap-3 px-4 pb-5 md:px-6">
            <SheetHeader className="px-0 pe-10 pb-0">
              <SheetTitle className="flex items-center gap-2 text-ink">
                <FlaskConical className="size-4 text-actor-c" /> {t('tryIt.title')}
              </SheetTitle>
              <SheetDescription className="text-ink-3">{t('tryIt.intro')}</SheetDescription>
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
    </>
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
  const { frame, history, move, lastError, canUndo, run, undo, reset } = sandbox
  const controls = useMemo(() => deriveControls(frame.world, tryIt), [frame.world, tryIt])
  const suggestions = useMemo(
    () => suggestExperiments(startFrame.world, tryIt),
    [startFrame.world, tryIt],
  )
  const [pending, setPending] = useState<SandboxControl | null>(null)
  const [showCode, setShowCode] = useState(false)
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
  const toggleCode = () => {
    setShowCode((v) => !v)
    track('try_it', { ...topicRef, action: showCode ? 'codeHide' : 'codeShow' })
  }

  const fromStep = startFrame.index + 1
  const say = history.length > 1 ? frame.step.say : t('tryIt.say.start', { step: fromStep })
  const manySlots = new Set(controls.actors.flatMap((a) => a.slots.map((s) => s.slot))).size > 1

  const renderButtons = (list: SandboxControl[]) =>
    list.map((c) => (
      <ControlButton
        key={c.id}
        control={c}
        label={text(c.label)}
        reason={c.disabled ? text(c.disabled) : undefined}
        expanded={pending?.id === c.id}
        caption={manySlots && c.slot !== undefined && c.action === 'sync' ? c.slot : undefined}
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
    <div
      className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_18rem] lg:items-start"
      data-testid="try-it-sandbox"
    >
      {/* LEFT: the data */}
      <section
        className="flex min-w-0 flex-col gap-2"
        data-testid="try-it-stage"
        aria-label={t('tryIt.stage')}
      >
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
        <div className="flex items-stretch gap-2">
          <div
            className="min-h-10 flex-1 rounded-lg border border-line bg-card px-4 py-2 text-sm leading-relaxed text-ink"
            data-testid="try-it-say"
            data-step={frame.step.id}
            aria-live="polite"
            aria-atomic="true"
          >
            {say}
          </div>
          <Button
            variant={showCode ? 'secondary' : 'outline'}
            size="sm"
            onClick={toggleCode}
            aria-pressed={showCode}
            aria-label={showCode ? t('tryIt.code.hide') : t('tryIt.code.show')}
            title={showCode ? t('tryIt.code.hide') : t('tryIt.code.show')}
            className="h-auto self-stretch"
            data-testid="try-it-code-toggle"
          >
            <CodeXml data-icon="inline-start" /> {t('tryIt.code')}
          </Button>
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
        {showCode && <CodePanel history={history} />}
      </section>

      {/* RIGHT: the actions */}
      <aside
        className="flex w-full min-w-0 flex-col gap-3"
        data-testid="try-it-actions"
        aria-label={t('tryIt.actions')}
      >
        {suggestions.length > 0 && <TryThis suggestions={suggestions} history={history} />}

        {controls.empty ? (
          <p className="text-sm text-ink-3" data-testid="try-it-empty">
            {t('tryIt.empty')}
          </p>
        ) : (
          controls.actors.map((ac) => (
            <ActorGroup
              key={ac.actor.id}
              group={ac}
              renderButtons={renderButtons}
              prompt={promptFor([...ac.slots.flatMap((s) => s.ops), ...ac.network])}
            />
          ))
        )}

        {controls.network.length > 0 && (
          <section
            className="flex flex-col gap-1.5"
            data-testid="try-it-network"
            aria-label={t('tryIt.network')}
          >
            <GroupHeading icon={<Radio className="size-3.5 text-ink-3" aria-hidden />}>
              {t('tryIt.network')}
            </GroupHeading>
            <div className="grid gap-1 sm:grid-cols-2 lg:grid-cols-1">
              {renderButtons(controls.network)}
            </div>
            {promptFor(controls.network)}
          </section>
        )}

        <div className="flex items-center gap-1.5 border-t border-line pt-2">
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

// ─── Actions column pieces ────────────────────────────────────────────────────────────────────

function GroupHeading({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <h3 className="flex items-center gap-1.5 text-sm font-semibold text-ink">
      {icon}
      {children}
    </h3>
  )
}

function ActorGroup({
  group: ac,
  renderButtons,
  prompt,
}: {
  group: SandboxActorControls
  renderButtons: (list: SandboxControl[]) => ReactNode
  prompt: ReactNode
}) {
  const { t } = useI18n()
  return (
    <section
      data-testid={`try-it-actor-${ac.actor.id}`}
      data-online={ac.actor.online}
      style={actorHueStyle(ac.actor.color)}
      className="flex flex-col gap-1.5"
      aria-label={t('tryIt.actorCan', { actor: ac.actor.label })}
    >
      <div className="flex items-center justify-between gap-2">
        <GroupHeading icon={<span aria-hidden className="size-2 rounded-full bg-(--card-hue)" />}>
          {t('tryIt.actorCan', { actor: ac.actor.label })}
        </GroupHeading>
        {!ac.actor.online && (
          <Badge variant="outline" className="gap-1 text-ink-2">
            <WifiOff /> {t('stage.offline')}
          </Badge>
        )}
      </div>
      {ac.slots.map((sc) => (
        <div key={sc.slot} className="flex flex-col gap-1">
          <p className="text-[11px] leading-none text-ink-3">
            <span className="font-mono">{sc.slot}</span>
            <span aria-hidden> · </span>
            <span>{sc.type === 'doc' ? 'doc' : t(`stage.type.${sc.type}`)}</span>
          </p>
          <div className="grid gap-1 sm:grid-cols-2 lg:grid-cols-1">{renderButtons(sc.ops)}</div>
        </div>
      ))}
      {ac.network.length > 0 && (
        <div className="grid gap-1 sm:grid-cols-2 lg:grid-cols-1">{renderButtons(ac.network)}</div>
      )}
      {prompt}
    </section>
  )
}

const ICONS: Record<string, LucideIcon> = {
  set: Pencil,
  setField: Pencil,
  removeField: Eraser,
  inc: Plus,
  dec: Minus,
  add: CirclePlus,
  remove: CircleMinus,
  type: Keyboard,
  deleteLast: Delete,
  tick: Timer,
  offline: WifiOff,
  online: Wifi,
  broadcast: Radio,
  send: Send,
  sync: ArrowLeftRight,
  deliverAll: Inbox,
  dropAll: Trash2,
}

function ControlButton({
  control,
  label,
  reason,
  expanded,
  caption,
  onPress,
}: {
  control: SandboxControl
  label: string
  reason: string | undefined
  expanded: boolean
  /** A muted trailing caption (the slot name, when several slots share a verb). */
  caption: string | undefined
  onPress: () => void
}) {
  const Icon = control.id === 'net-tick' ? Clock : (ICONS[control.action] ?? SquarePen)
  return (
    <Button
      variant={expanded ? 'secondary' : 'outline'}
      size="sm"
      onClick={onPress}
      disabled={reason !== undefined}
      title={reason}
      aria-expanded={control.prompt ? expanded : undefined}
      data-testid={`try-it-${control.id}`}
      data-action={control.action}
      className="w-full justify-start font-normal"
    >
      <Icon data-icon="inline-start" className="text-ink-2" />
      <span className="truncate">
        {label}
        {control.prompt && <span aria-hidden>…</span>}
      </span>
      {caption !== undefined && (
        <span className="ms-auto ps-2 font-mono text-[11px] text-ink-3">{caption}</span>
      )}
    </Button>
  )
}

function TryThis({
  suggestions,
  history,
}: {
  suggestions: ReturnType<typeof suggestExperiments>
  history: readonly Frame[]
}) {
  const { t } = useI18n()
  const done = useMemo(() => suggestions.map((s) => s.done(history)), [suggestions, history])
  return (
    <section
      className="rounded-lg border border-teal-line/50 bg-teal-soft/40 p-3"
      data-testid="try-it-suggestions"
      aria-label={t('tryIt.tryThis')}
    >
      <GroupHeading icon={<Lightbulb className="size-4 text-teal" aria-hidden />}>
        {t('tryIt.tryThis')}
      </GroupHeading>
      <p className="mt-0.5 text-xs text-ink-3">{t('tryIt.tryThis.hint')}</p>
      <ul className="mt-2 flex flex-col gap-1.5">
        {suggestions.map((s, i) => {
          const isDone = done[i] === true
          return (
            <li
              key={s.id}
              className="flex gap-2 text-[13px] leading-snug text-ink-2"
              data-testid={`try-it-suggestion-${s.id}`}
              data-done={isDone}
            >
              {isDone ? (
                <CircleCheck className="mt-0.5 size-4 shrink-0 text-ok" aria-hidden />
              ) : (
                <Circle className="mt-0.5 size-4 shrink-0 text-ink-3" aria-hidden />
              )}
              <span className={cn(isDone && 'text-ink-3')}>
                {'text' in s.text ? s.text.text : t(s.text.key, s.text.vars)}
                {isDone && <span className="sr-only"> ({t('tryIt.tryThis.done')})</span>}
              </span>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

// ─── Prompt ───────────────────────────────────────────────────────────────────────────────────

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
        className="flex flex-wrap items-center gap-1 rounded-md border border-line bg-paper-2/60 p-2"
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
      className="flex flex-wrap items-center gap-1.5 rounded-md border border-line bg-paper-2/60 p-2"
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
        className="h-7 w-24 flex-1 font-mono text-xs md:text-xs"
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
