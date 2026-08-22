/**
 * Test harness for the value views: a hand-built Frame (world with Alice / Bob / Server, marks,
 * changes) and a renderer that wraps in StageMotionProvider + StageFrameProvider + a minimal
 * AnchorRegistryProvider (container ref to a div). Not a test file itself.
 */
import { useRef, type ReactNode } from 'react'
import { render, type RenderResult } from '@testing-library/react'
import type {
  Actor,
  ActorId,
  Change,
  Clock as ClockState,
  Frame,
  Mark,
  Message,
  Path,
  SlotId,
  Tone,
  Value,
  World,
} from '@/lesson/types'
import { AnchorRegistryProvider } from '../geometry/AnchorRegistry'
import { StageMotionProvider } from '../motion/StageMotionProvider'
import { StageFrameProvider } from '../StageContext'
import { ValueView } from './ValueView'

export function actor(id: ActorId, over: Partial<Actor> = {}): Actor {
  const colors: Record<string, Actor['color']> = {
    alice: 'a',
    bob: 'b',
    carol: 'c',
    server: 'server',
  }
  const labels: Record<string, string> = {
    alice: 'Alice',
    bob: 'Bob',
    carol: 'Carol',
    server: 'Server',
  }
  return {
    id,
    kind: id === 'server' ? 'server' : 'person',
    label: labels[id] ?? id,
    color: colors[id] ?? 'neutral',
    online: true,
    holds: {},
    outbox: [],
    ...over,
  }
}

export interface WorldOpts {
  actors?: Actor[]
  holds?: Record<ActorId, Record<SlotId, Value>>
  marks?: Mark[]
  clock?: Partial<ClockState>
  messages?: Message[]
}

export function makeWorld(opts: WorldOpts = {}): World {
  const actors = opts.actors ?? [actor('alice'), actor('bob'), actor('server')]
  const byId: Record<ActorId, Actor> = {}
  for (const a of actors)
    byId[a.id] = { ...a, holds: { ...a.holds, ...(opts.holds?.[a.id] ?? {}) } }
  return {
    layout: { preset: 'row' },
    clock: { now: 0, show: false, format: 'counter', ...opts.clock },
    actors: byId,
    boards: {},
    messages: opts.messages ?? [],
    marks: opts.marks ?? [],
    replicas: {},
    engines: {},
    ids: 0,
  }
}

export interface FrameOpts extends WorldOpts {
  changes?: Change[]
  index?: number
}

export function makeFrame(opts: FrameOpts = {}): Frame {
  const world = makeWorld(opts)
  return {
    index: opts.index ?? 0,
    sceneId: 'test',
    sceneIndex: 0,
    step: { id: 's01', say: 'test', do: [] },
    world,
    prev: world,
    changes: opts.changes ?? [],
  }
}

/** A frame whose world marks highlight `hl`, check `check`, and whose changes say `via` landed through a message from `from`. */
export function markedFrame(opts: {
  highlight?: Array<{ path: Path; tone?: Tone }>
  check?: Path[]
  cross?: Path[]
  changed?: Path[]
  via?: { path: Path; from: ActorId; message?: string }
  holds?: FrameOpts['holds']
  clock?: Partial<ClockState>
}): Frame {
  const marks: Mark[] = []
  let k = 0
  for (const h of opts.highlight ?? []) {
    marks.push({ id: `k${++k}`, kind: 'highlight', paths: [h.path], tone: h.tone ?? 'change' })
  }
  for (const p of opts.check ?? []) marks.push({ id: `k${++k}`, kind: 'check', path: p })
  for (const p of opts.cross ?? []) marks.push({ id: `k${++k}`, kind: 'cross', path: p })
  const changes: Change[] = (opts.changed ?? []).map((path) => ({
    kind: 'value',
    path,
    op: 'changed',
  }))
  if (opts.via) {
    const id = opts.via.message ?? 'm1'
    const message: Message = {
      id,
      from: opts.via.from,
      to: 'bob',
      payload: { kind: 'scalar', value: 'x' },
      state: 'flying',
    }
    changes.push({ kind: 'message', op: 'sent', message, transient: true })
    changes.push({ kind: 'message', op: 'delivered', message, transient: true })
    changes.push({ kind: 'value', path: opts.via.path, op: 'changed', via: id })
  }
  return makeFrame({ marks, changes, holds: opts.holds, clock: opts.clock })
}

export interface RenderOpts {
  frame?: Frame
  dir?: 'ltr' | 'rtl'
  /** Motion off (instant + reduced) — the default for static DOM assertions. */
  off?: boolean
  speed?: number
}

export function renderStage(ui: ReactNode, opts: RenderOpts = {}): RenderResult {
  const frame = opts.frame ?? makeFrame()
  const dir = opts.dir ?? 'ltr'
  const off = opts.off ?? true
  const speed = opts.speed ?? 1
  // The harness: motion + frame + anchor registry (container ref to a div), like <Stage> does.
  const Wrapper = ({ children }: { children: ReactNode }) => {
    const container = useRef<HTMLDivElement>(null)
    return (
      <StageMotionProvider speed={speed} reducedSetting={off} instant={off} dir={dir}>
        <StageFrameProvider frame={frame}>
          <AnchorRegistryProvider container={container}>
            <div ref={container} dir={dir} data-stage="">
              {children}
            </div>
          </AnchorRegistryProvider>
        </StageFrameProvider>
      </StageMotionProvider>
    )
  }
  return render(ui, { wrapper: Wrapper })
}

export function renderValue(path: Path, value: Value, opts: RenderOpts = {}): RenderResult {
  return renderStage(<ValueView path={path} value={value} />, opts)
}

/** `[data-path="…"]` lookup that throws when missing (keeps assertions short). */
export function node(container: HTMLElement, path: Path): HTMLElement {
  const el = container.querySelector<HTMLElement>(`[data-path="${cssEscape(path)}"]`)
  if (!el) throw new Error(`no node for path ${path}`)
  return el
}

export function nodes(container: HTMLElement, path: Path): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(`[data-path="${cssEscape(path)}"]`))
}

function cssEscape(s: string): string {
  return s.replace(/["\\]/g, (c) => `\\${c}`)
}

export const s = (value: string | number | boolean | null, meta?: Value['meta']): Value =>
  meta ? { kind: 'scalar', value, meta } : { kind: 'scalar', value }

/** Asserts that no Tailwind `transition-*` / `animate-*` / `duration-*` utility leaked into the DOM. */
export function forbiddenMotionClasses(container: HTMLElement): string[] {
  const bad: string[] = []
  for (const el of Array.from(container.querySelectorAll('*'))) {
    for (const cls of Array.from(el.classList)) {
      if (/^(transition|animate|duration|ease)-/.test(cls) || cls === 'transition') bad.push(cls)
    }
  }
  return bad
}
