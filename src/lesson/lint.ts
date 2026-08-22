/**
 * Content lints (docs/animation-dsl.md §13, "Lints (content style)") over a built `Topic` and,
 * optionally, its frames from the reducer. The schema enforces the hard shape rules; these lints
 * catch the judgment calls of docs/content-style-guide.md and report them as
 * `{ level, topicId, sceneId?, stepId?, rule, message }`.
 *
 * Rules:
 *   say-length          error    `say` has > 2 sentences or > 160 characters (sayStats)
 *   narration-values    warning  an id-/clock-/value-shaped token in `say` (`alice:1`, `t=3`,
 *                                `{alice 2}`, a quoted or code-span value, a hex run) is not among
 *                                the frame's plain values (`plainValueAt` over every resolvable
 *                                path); needs `frames`, skipped otherwise
 *   whoops              error    `say` starts with "Whoops" but the step carries no conflict /
 *                                cross / danger-tone mark, or it is the last step of its scene
 *   simplified          warning  `crdt.gc { unsafe }` or `crdt.send { mode: 'delta' }` without
 *                                "(simplified)" in `say`
 *   glossary            error    `**Term**` has no entry in src/content/glossary.ts
 *   undelivered         error    a message with a statically known id is still flying at the end
 *                                of its scene (warning when it is parked). Only explicit ids are
 *                                tracked: `send`/`crdt.send` with `id` (fan-out ⇒ `${id}@${to}`),
 *                                `crdt.broadcast` with `id` and recipients known from `to` or the
 *                                slot's `crdt.init`/`crdt.doc` actors, `duplicate`, `relay` copies.
 *                                Generated ids (`m1`…), broadcasts without `id` and
 *                                `crdt.sync { mode: 'ops' }` cannot be checked statically
 *   narration-only      info     more than 30% of a scene's steps have `do: []`
 *   compare-then-write  warning  a `compare`/`same` whose paths a later command in the same step
 *                                writes (the verdict is computed on the end-of-step world)
 *   hidden-clock        warning  `tick`/`skew` in a scene whose clock HUD is hidden
 *   mixed-sync          warning  one slot driven state-style (`crdt.send`/`merge`/`sync`) and
 *                                op-style (`crdt.broadcast`/`sync { mode: 'ops' }`) in one scene
 *                                lineage (a scene plus the scenes it `startFrom`s)
 */
import { lookupTerm } from '@/content/glossary'
import { ACTOR_SELECTORS, META_SELECTORS, parsePath, plainValueAt } from './path'
import { sayStats } from './schema'
import {
  LIMITS,
  type Command,
  type Frame,
  type Path,
  type Scene,
  type Step,
  type Topic,
  type Value,
  type World,
} from './types'

export type LintLevel = 'error' | 'warning' | 'info'
export type LintRule =
  | 'say-length'
  | 'narration-values'
  | 'whoops'
  | 'simplified'
  | 'glossary'
  | 'undelivered'
  | 'narration-only'
  | 'compare-then-write'
  | 'hidden-clock'
  | 'mixed-sync'
export type LintIssue = {
  level: LintLevel
  topicId: string
  sceneId?: string
  stepId?: string
  rule: LintRule
  message: string
}

export const LINT_RULES: readonly LintRule[] = [
  'say-length',
  'narration-values',
  'whoops',
  'simplified',
  'glossary',
  'undelivered',
  'narration-only',
  'compare-then-write',
  'hidden-clock',
  'mixed-sync',
]

/** Lint a built topic; pass the reducer's frames to enable the narration-values rule. */
export function lintTopic(topic: Topic, frames?: ReadonlyArray<Frame>): LintIssue[] {
  const issues: LintIssue[] = []
  const scenesById = new Map(topic.scenes.map((s) => [s.id, s]))
  const frameOf = (scene: Scene, step: Step): Frame | undefined =>
    frames?.find((f) => f.sceneId === scene.id && f.step.id === step.id)

  for (const scene of topic.scenes) {
    const push = (level: LintLevel, rule: LintRule, message: string, stepId?: string): void => {
      issues.push(
        compactIssue({ level, topicId: topic.id, sceneId: scene.id, stepId, rule, message }),
      )
    }
    const lineage = lineageOf(scene, scenesById)
    const clockShown = lineage.some((s) => s.world?.clock?.show === true)
    const tracker = new MessageTracker(lineage)
    const styles = slotStyles(lineage.slice(0, -1))
    let narrationOnly = 0
    let hiddenClockReported = false

    scene.steps.forEach((step, index) => {
      const last = index === scene.steps.length - 1
      if (step.do.length === 0) narrationOnly += 1

      // say-length
      const { sentences, chars } = sayStats(step.say)
      if (sentences > LIMITS.maxSaySentences) {
        push(
          'error',
          'say-length',
          `say has ${sentences} sentences; the limit is ${LIMITS.maxSaySentences} (split the step)`,
          step.id,
        )
      }
      if (chars > LIMITS.maxSayChars) {
        push(
          'error',
          'say-length',
          `say is ${chars} characters; the limit is ${LIMITS.maxSayChars}`,
          step.id,
        )
      }

      // glossary
      for (const term of boldTerms(step.say)) {
        if (!lookupTerm(term)) {
          push(
            'error',
            'glossary',
            `**${term}** has no glossary entry (src/content/glossary.ts)`,
            step.id,
          )
        }
      }

      // whoops
      if (/^\s*whoops\b/i.test(step.say)) {
        if (!step.do.some(isDangerMark)) {
          push(
            'error',
            'whoops',
            'a "Whoops" step carries a conflict, cross or danger-tone highlight/callout',
            step.id,
          )
        }
        if (last) {
          push(
            'error',
            'whoops',
            'a "Whoops" step is not the last step of its scene ("The fix:" follows)',
            step.id,
          )
        }
      }

      // simplified
      const saysSimplified = step.say.includes('(simplified)')
      for (const cmd of step.do) {
        if (cmd.t === 'crdt.gc' && cmd.unsafe === true && !saysSimplified) {
          push(
            'warning',
            'simplified',
            'crdt.gc { unsafe } skips the stability proof; say "(simplified)"',
            step.id,
          )
        }
        if (cmd.t === 'crdt.send' && cmd.mode === 'delta' && !saysSimplified) {
          push(
            'warning',
            'simplified',
            'a delta send is a small state the same merge() accepts; say "(simplified)"',
            step.id,
          )
        }
      }

      // hidden-clock
      if (
        !clockShown &&
        !hiddenClockReported &&
        step.do.some((c) => c.t === 'tick' || c.t === 'skew')
      ) {
        hiddenClockReported = true
        push(
          'warning',
          'hidden-clock',
          'tick/skew in a scene whose clock HUD is hidden (set world.clock.show: true)',
          step.id,
        )
      }

      // compare-then-write
      const local = stepTargets(step)
      const lookup = (id: string): Path | undefined => local.get(id) ?? tracker.target(id)
      step.do.forEach((cmd, i) => {
        if (cmd.t !== 'compare') return
        const later = step.do.slice(i + 1).flatMap((c) => writeTargets(c, lookup))
        for (const path of cmd.paths) {
          const hit = later.find((w) => overlaps(path, w))
          if (hit !== undefined) {
            push(
              'warning',
              'compare-then-write',
              `compare over "${path}" is followed by a write to "${hit}" in the same step; the verdict is computed on the end-of-step world — move the compare to the next step`,
              step.id,
            )
            break
          }
        }
      })

      // mixed-sync
      for (const cmd of step.do) {
        const use = syncStyle(cmd)
        if (!use) continue
        const seen = styles.get(use.slot) ?? new Set<SyncStyle>()
        const before = seen.size
        seen.add(use.style)
        styles.set(use.slot, seen)
        if (seen.size === 2 && before === 1) {
          push(
            'warning',
            'mixed-sync',
            `slot "${use.slot}" is driven both state-style (send/merge/sync) and op-style (broadcast/sync ops); pick one`,
            step.id,
          )
        }
      }

      // narration-values
      const frame = frameOf(scene, step)
      if (frame) {
        const atoms = frameAtoms(frame.world)
        for (const token of sayTokens(step.say)) {
          if (!atoms.has(token)) {
            push(
              'warning',
              'narration-values',
              `say mentions ${JSON.stringify(token.text)} but no value on the stage shows it at this step`,
              step.id,
            )
          }
        }
      }

      // undelivered (tracking)
      for (const cmd of step.do) tracker.apply(cmd, step.id)
    })

    for (const m of tracker.live.values()) {
      if (m.state === 'parked') {
        push(
          'warning',
          'undelivered',
          `message "${m.id}" (sent in ${m.stepId}) is still parked when the scene ends`,
          m.stepId,
        )
      } else {
        push(
          'error',
          'undelivered',
          `message "${m.id}" (sent in ${m.stepId}) is never delivered or dropped before the scene ends`,
          m.stepId,
        )
      }
    }

    if (scene.steps.length > 0 && narrationOnly / scene.steps.length > 0.3) {
      push(
        'info',
        'narration-only',
        `${narrationOnly} of ${scene.steps.length} steps are narration-only (do: []); more than 30% of the scene`,
      )
    }
  }
  return issues
}

/** One line per issue: `error lww-register/update-and-merge/s03 [rule] message`. */
export function formatLint(issues: ReadonlyArray<LintIssue>): string {
  return issues
    .map((i) => {
      const where = [i.topicId, i.sceneId, i.stepId].filter((x) => x !== undefined).join('/')
      return `${i.level} ${where} [${i.rule}] ${i.message}`
    })
    .join('\n')
}

// ─── Helpers ──────────────────────────────────────────────────────────────────────────────────

function compactIssue(issue: LintIssue): LintIssue {
  const out: LintIssue = {
    level: issue.level,
    topicId: issue.topicId,
    rule: issue.rule,
    message: issue.message,
  }
  if (issue.sceneId !== undefined) out.sceneId = issue.sceneId
  if (issue.stepId !== undefined) out.stepId = issue.stepId
  return out
}

/** The scene plus every ancestor it `startFrom`s, oldest first. */
function lineageOf(scene: Scene, byId: ReadonlyMap<string, Scene>): Scene[] {
  const chain: Scene[] = [scene]
  const seen = new Set<string>([scene.id])
  let cur = scene
  while (cur.startFrom !== undefined) {
    const parent = byId.get(cur.startFrom)
    if (!parent || seen.has(parent.id)) break
    chain.unshift(parent)
    seen.add(parent.id)
    cur = parent
  }
  return chain
}

const BOLD_TERM = /\*\*([^*]+)\*\*/g
function boldTerms(say: string): string[] {
  return [...say.matchAll(BOLD_TERM)].map((m) => (m[1] ?? '').trim()).filter((t) => t.length > 0)
}

function isDangerMark(cmd: Command): boolean {
  if (cmd.t === 'conflict' || cmd.t === 'cross') return true
  if (cmd.t === 'highlight' || cmd.t === 'callout') return cmd.tone === 'danger'
  return false
}

// ─── Sync styles ──────────────────────────────────────────────────────────────────────────────

type SyncStyle = 'state' | 'op'
function syncStyle(cmd: Command): { slot: string; style: SyncStyle } | undefined {
  switch (cmd.t) {
    case 'crdt.send':
    case 'crdt.merge':
      return { slot: cmd.slot, style: 'state' }
    case 'crdt.sync':
      return { slot: cmd.slot, style: cmd.mode === 'ops' ? 'op' : 'state' }
    case 'crdt.broadcast':
      return { slot: cmd.slot, style: 'op' }
    default:
      return undefined
  }
}
function slotStyles(scenes: ReadonlyArray<Scene>): Map<string, Set<SyncStyle>> {
  const out = new Map<string, Set<SyncStyle>>()
  for (const scene of scenes) {
    for (const step of scene.steps) {
      for (const cmd of step.do) {
        const use = syncStyle(cmd)
        if (!use) continue
        const set = out.get(use.slot) ?? new Set<SyncStyle>()
        set.add(use.style)
        out.set(use.slot, set)
      }
    }
  }
  return out
}

// ─── Message tracking (static) ────────────────────────────────────────────────────────────────

type Tracked = {
  id: string
  from: string
  to: string
  slot?: string
  into?: Path
  state: 'flying' | 'parked'
  stepId: string
}

/**
 * Follows messages with statically known ids through a scene. Ancestor scenes contribute their
 * slot holders and actor online state; their own message bookkeeping is checked when they are
 * linted themselves.
 */
class MessageTracker {
  readonly live = new Map<string, Tracked>()
  private readonly holders = new Map<string, Set<string>>()
  private readonly offline = new Set<string>()

  constructor(lineage: ReadonlyArray<Scene>) {
    for (const scene of lineage) {
      for (const actor of scene.world?.actors ?? []) {
        if (actor.online === false) this.offline.add(actor.id)
      }
    }
    for (const scene of lineage.slice(0, -1)) {
      for (const step of scene.steps) for (const cmd of step.do) this.track(cmd)
    }
  }

  private track(cmd: Command): void {
    switch (cmd.t) {
      case 'crdt.init':
      case 'crdt.doc': {
        const set = this.holders.get(cmd.slot) ?? new Set<string>()
        for (const a of cmd.actors) set.add(a)
        this.holders.set(cmd.slot, set)
        break
      }
      case 'offline':
        this.offline.add(cmd.actor)
        break
      case 'online':
        this.offline.delete(cmd.actor)
        break
      case 'spawn':
        if (cmd.actor.online === false) this.offline.add(cmd.actor.id)
        else this.offline.delete(cmd.actor.id)
        break
      default:
        break
    }
  }

  /** The `to` actor(s) of a live message: `<to>.<slot>` for CRDT messages, `into` for plain ones. */
  target(id: string): Path | undefined {
    const m = this.live.get(id) ?? this.byBareOpId(id)
    if (!m) return undefined
    if (m.slot !== undefined) return `${m.to}.${m.slot}`
    return m.into
  }

  private byBareOpId(id: string): Tracked | undefined {
    if (id.includes('@')) return undefined
    const hits = [...this.live.values()].filter((m) => m.id.startsWith(`${id}@`))
    return hits.length === 1 ? hits[0] : undefined
  }

  private add(m: Omit<Tracked, 'state'>): void {
    this.live.set(m.id, { ...m, state: this.offline.has(m.to) ? 'parked' : 'flying' })
  }

  private consume(id: string): Tracked | undefined {
    const m = this.live.get(id) ?? this.byBareOpId(id)
    if (m) this.live.delete(m.id)
    return m
  }

  apply(cmd: Command, stepId: string): void {
    this.track(cmd)
    switch (cmd.t) {
      case 'send': {
        if (cmd.id === undefined) return
        const id = cmd.id
        if (typeof cmd.to === 'string')
          this.add({ id, from: cmd.from, to: cmd.to, into: cmd.into, stepId })
        else
          for (const to of cmd.to)
            this.add({ id: `${id}@${to}`, from: cmd.from, to, into: cmd.into, stepId })
        return
      }
      case 'crdt.send': {
        if (cmd.id === undefined) return
        const id = cmd.id
        if (typeof cmd.to === 'string')
          this.add({ id, from: cmd.from, to: cmd.to, slot: cmd.slot, stepId })
        else
          for (const to of cmd.to)
            this.add({ id: `${id}@${to}`, from: cmd.from, to, slot: cmd.slot, stepId })
        return
      }
      case 'crdt.broadcast': {
        if (cmd.id === undefined) return
        const recipients =
          cmd.to ?? [...(this.holders.get(cmd.slot) ?? [])].filter((a) => a !== cmd.from)
        if (recipients.length === 0) return // holders unknown statically (inherited world)
        for (const to of recipients) {
          this.add({ id: `${cmd.id}@${to}`, from: cmd.from, to, slot: cmd.slot, stepId })
        }
        return
      }
      case 'deliver': {
        if (cmd.park === true) {
          const m = this.live.get(cmd.message) ?? this.byBareOpId(cmd.message)
          if (m) m.state = 'parked'
          return
        }
        this.consume(cmd.message)
        return
      }
      case 'drop':
        this.consume(cmd.message)
        return
      case 'duplicate': {
        const m = this.live.get(cmd.message)
        if (m) this.add({ id: cmd.id, from: m.from, to: m.to, slot: m.slot, into: m.into, stepId })
        return
      }
      case 'relay': {
        const m = this.consume(cmd.message)
        if (!m) return
        const at = m.id.indexOf('@')
        const base = at < 0 ? m.id : m.id.slice(0, at)
        const tos = typeof cmd.to === 'string' ? [cmd.to] : cmd.to
        for (const to of tos) {
          this.add({
            id: `${base}@${to}`,
            from: m.to,
            to,
            slot: m.slot,
            into: cmd.into ?? m.into,
            stepId,
          })
        }
        return
      }
      case 'remove': {
        for (const m of [...this.live.values()]) {
          if (m.from === cmd.actor || m.to === cmd.actor) this.live.delete(m.id)
        }
        return
      }
      default:
        return
    }
  }
}

// ─── compare-then-write ───────────────────────────────────────────────────────────────────────

/** Where the messages sent in this step land: `<to>.<slot>` for CRDT messages, `into` for plain ones. */
function stepTargets(step: Step): Map<string, Path> {
  const out = new Map<string, Path>()
  for (const cmd of step.do) {
    if (cmd.t === 'send' && cmd.id !== undefined && cmd.into !== undefined) {
      if (typeof cmd.to === 'string') out.set(cmd.id, cmd.into)
      else for (const to of cmd.to) out.set(`${cmd.id}@${to}`, cmd.into)
    } else if (cmd.t === 'crdt.send' && cmd.id !== undefined) {
      if (typeof cmd.to === 'string') out.set(cmd.id, `${cmd.to}.${cmd.slot}`)
      else for (const to of cmd.to) out.set(`${cmd.id}@${to}`, `${to}.${cmd.slot}`)
    } else if (cmd.t === 'crdt.broadcast' && cmd.id !== undefined && cmd.to !== undefined) {
      for (const to of cmd.to) out.set(`${cmd.id}@${to}`, `${to}.${cmd.slot}`)
    }
  }
  return out
}

/** The value paths a command writes (prefixes: `<actor>.<slot>` for CRDT slots, `<actor>` for engines). */
function writeTargets(cmd: Command, target: (id: string) => Path | undefined): Path[] {
  switch (cmd.t) {
    case 'set':
    case 'patch':
    case 'insert':
    case 'delete':
    case 'move':
    case 'sort':
    case 'annotate':
    case 'unannotate':
    case 'view':
      return [cmd.path]
    case 'crdt.update':
    case 'crdt.gc':
      return [`${cmd.actor}.${cmd.slot}`]
    case 'crdt.merge':
      return [`${cmd.into}.${cmd.slot}`]
    case 'crdt.sync':
      return [`${cmd.a}.${cmd.slot}`, `${cmd.b}.${cmd.slot}`]
    case 'regex.init':
    case 'regex.advance':
      return [cmd.actor]
    case 'note':
    case 'removeBoard':
      return [`board.${'id' in cmd ? cmd.id : cmd.board}`]
    case 'deliver': {
      if (cmd.park === true) return []
      const t = cmd.into ?? target(cmd.message)
      return t === undefined ? [] : [t]
    }
    case 'relay': {
      const t = target(cmd.message)
      return t === undefined ? [] : [t]
    }
    case 'remove':
      return [cmd.actor]
    default:
      return []
  }
}

function stripSelector(path: Path): Path {
  const at = path.indexOf('@')
  return at < 0 ? path : path.slice(0, at)
}

/** True when one path is the other or lies under it (`alice.doc` vs `alice.doc.title`, `alice.list[milk]`). */
function overlaps(a: Path, b: Path): boolean {
  const x = stripSelector(a)
  const y = stripSelector(b)
  if (x === y) return true
  const under = (child: string, parent: string): boolean =>
    child.startsWith(`${parent}.`) || child.startsWith(`${parent}[`)
  return under(x, y) || under(y, x)
}

// ─── narration-values ─────────────────────────────────────────────────────────────────────────

type SayToken = { text: string; kind: 'exact' | 'contains' | 'hex' }

const DOT_TOKEN = /(?<![\w-])[A-Za-z][A-Za-z0-9_-]*:\d+(?![\w:])/g
const CLOCK_TOKEN = /\bt=\d+\b/g
const BRACES = /\{([^{}]*)\}/g
const PAIR = /^([A-Za-z][A-Za-z0-9_-]*)[\s:]+(\d+)$/
const CODE_SPAN = /`([^`]+)`/g
const DOUBLE_QUOTED = /"([^"]+)"/g
const SINGLE_QUOTED = /(?:^|[\s(])'([^']+)'(?=[\s.,;:!?)]|$)/g
const CANONICAL_UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/g
const HEX_RUN = /\b(?=[0-9a-f]*[a-f])[0-9a-f]{8,}\b/g
const SPACED_HEX = /\b(?=(?:[0-9a-f]{2} )*[0-9a-f]*[a-f])(?:[0-9a-f]{2} ){2,}[0-9a-f]{2}\b/g

/** The tokens of a `say` that must be visible on the stage (§13). */
export function sayTokens(say: string): SayToken[] {
  const out: SayToken[] = []
  const seen = new Set<string>()
  const add = (text: string, kind: SayToken['kind']): void => {
    const key = `${kind}:${text}`
    if (seen.has(key)) return
    seen.add(key)
    out.push({ text, kind })
  }
  const plain = say.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/\*\*/g, '')
  for (const m of plain.matchAll(DOT_TOKEN)) add(m[0], 'exact')
  for (const m of plain.matchAll(CLOCK_TOKEN)) add(m[0], 'exact')
  for (const m of plain.matchAll(BRACES)) {
    for (const part of (m[1] ?? '').split(',')) {
      const pair = PAIR.exec(part.trim())
      if (pair) add(`${pair[1]}:${pair[2]}`, 'exact')
    }
  }
  for (const m of plain.matchAll(CODE_SPAN)) add((m[1] ?? '').trim(), 'contains')
  for (const m of plain.matchAll(DOUBLE_QUOTED)) add((m[1] ?? '').trim(), 'contains')
  for (const m of plain.matchAll(SINGLE_QUOTED)) add((m[1] ?? '').trim(), 'contains')
  for (const m of plain.matchAll(CANONICAL_UUID)) add(m[0].replaceAll('-', ''), 'hex')
  for (const m of plain.matchAll(HEX_RUN)) add(m[0], 'hex')
  for (const m of plain.matchAll(SPACED_HEX)) add(m[0].replaceAll(' ', ''), 'hex')
  return out.filter((t) => t.text.length > 0)
}

/** What the stage shows in a frame: every plain value, sidecar, id, label and clock, as strings. */
class FrameAtoms {
  readonly exact = new Set<string>()
  readonly texts: string[] = []
  readonly hex: string[] = []

  add(v: unknown, path?: Path): void {
    if (v === null || v === undefined) {
      if (v === null) this.exact.add('null')
      return
    }
    if (typeof v === 'string') {
      this.exact.add(v)
      this.texts.push(v)
      if (/^[0-9a-f]{8,}$/.test(v)) this.hex.push(v)
      return
    }
    if (typeof v === 'number' || typeof v === 'boolean') {
      this.exact.add(String(v))
      if (path !== undefined && /@(ts|addTs|removeTs|clock)$/.test(path))
        this.exact.add(`t=${String(v)}`)
      return
    }
    if (Array.isArray(v)) {
      for (const item of v) this.add(item, path)
      return
    }
    if (typeof v === 'object') {
      for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
        this.exact.add(k)
        if (typeof val === 'number') {
          this.exact.add(`${k}:${String(val)}`)
          this.exact.add(`${k} ${String(val)}`)
        }
        this.add(val, path)
      }
    }
  }

  has(token: SayToken): boolean {
    if (this.exact.has(token.text)) return true
    if (token.kind === 'contains') return this.texts.some((t) => t.includes(token.text))
    if (token.kind === 'hex') return this.hex.some((h) => h.includes(token.text))
    return false
  }
}

/** Every path that resolves in a world (§3), so `plainValueAt` can read each of them. */
export function enumeratePaths(world: World): Path[] {
  const out: Path[] = []
  const metaSelectors = (v: Value, base: Path): void => {
    if (!v.meta) return
    for (const [selector, key] of Object.entries(META_SELECTORS)) {
      if (selector === 'tomb') continue // alias of @tombstone
      if (v.meta[key] !== undefined) out.push(`${base}@${selector}`)
    }
  }
  const walk = (v: Value, base: Path): void => {
    out.push(base)
    metaSelectors(v, base)
    switch (v.kind) {
      case 'record':
        for (const f of v.fields) walk(f.value, `${base}.${f.key}`)
        break
      case 'list':
      case 'set':
        for (const it of v.items) walk(it.value, `${base}[${it.id}]`)
        break
      case 'counter':
        for (const r of v.rows) {
          out.push(`${base}[${r.node}]`, `${base}[${r.node}]@inc`)
          if (r.dec !== undefined) out.push(`${base}[${r.node}]@dec`)
        }
        break
      case 'clock':
        for (const node of Object.keys(v.entries)) out.push(`${base}.${node}`)
        break
      case 'table':
        for (const c of v.columns) out.push(`${base}.${c.key}`)
        for (const r of v.rows) {
          out.push(`${base}[${r.id}]`)
          for (const [key, cell] of Object.entries(r.cells)) walk(cell, `${base}[${r.id}].${key}`)
        }
        break
      case 'bytes':
        v.bytes.forEach((_, i) => out.push(`${base}[${i}]`))
        if (v.bytes.length > 0) out.push(`${base}[0..${v.bytes.length}]`)
        break
      case 'text':
        if (v.cursor !== undefined) out.push(`${base}@cursor`)
        break
      case 'pattern':
        for (const t of v.tokens) out.push(`${base}[${t.id}]`)
        if (v.cursor !== undefined) out.push(`${base}@cursor`)
        break
      case 'scalar':
      case 'meter':
        break
    }
  }
  for (const actor of Object.values(world.actors)) {
    for (const sel of ACTOR_SELECTORS) {
      if (sel === 'clock' && actor.skew === undefined) continue
      if (sel === 'status' && actor.status === undefined) continue
      out.push(`${actor.id}@${sel}`)
    }
    for (const [slot, value] of Object.entries(actor.holds)) walk(value, `${actor.id}.${slot}`)
  }
  for (const board of Object.values(world.boards)) walk(board.value, `board.${board.id}`)
  return out.filter((p) => {
    try {
      parsePath(p)
      return true
    } catch {
      return false
    }
  })
}

function frameAtoms(world: World): FrameAtoms {
  const atoms = new FrameAtoms()
  for (const path of enumeratePaths(world)) {
    try {
      atoms.add(plainValueAt(world, path), path)
    } catch {
      // a path enumerated but not resolvable (e.g. a byte range beyond the value): ignore
    }
  }
  atoms.add(world.clock.now, '@clock')
  for (const actor of Object.values(world.actors)) {
    atoms.add(actor.id)
    atoms.add(actor.label)
    if (actor.subtitle !== undefined) atoms.add(actor.subtitle)
    for (const chip of actor.outbox) {
      atoms.add(chip.id)
      atoms.add(chip.label)
    }
    for (const v of Object.values(actor.holds)) annotationAtoms(v, atoms)
  }
  for (const board of Object.values(world.boards)) {
    atoms.add(board.id)
    if (board.label !== undefined) atoms.add(board.label)
    annotationAtoms(board.value, atoms)
  }
  for (const m of world.messages) {
    atoms.add(m.id)
    if (m.label !== undefined) atoms.add(m.label)
    if (m.size !== undefined) atoms.add(m.size)
    atoms.add(plainOf(m.payload))
    annotationAtoms(m.payload, atoms)
  }
  for (const mark of world.marks) {
    if (mark.kind === 'callout') atoms.add(mark.text)
    if (mark.kind === 'compare') atoms.add(mark.verdict)
  }
  return atoms
}

/** Plain value of a free-standing Value (message payloads are not addressable by path). */
function plainOf(v: Value): unknown {
  const world: World = {
    layout: { preset: 'row' },
    clock: { now: 0, show: false, format: 'counter' },
    actors: {
      x: {
        id: 'x',
        kind: 'person',
        label: 'x',
        color: 'neutral',
        online: true,
        holds: { v },
        outbox: [],
      },
    },
    boards: {},
    messages: [],
    marks: [],
    replicas: {},
    engines: {},
    ids: 0,
  }
  try {
    const out: unknown[] = []
    for (const path of enumeratePaths(world)) out.push(plainValueAt(world, path))
    return out
  } catch {
    return undefined
  }
}

/** Annotation labels, meter labels, canonical bytes text and meta footnotes/sidecar ids. */
function annotationAtoms(v: Value, atoms: FrameAtoms): void {
  if (v.meta) {
    if (v.meta.note !== undefined) atoms.add(v.meta.note)
    if (v.meta.tag !== undefined) atoms.add(v.meta.tag)
    if (v.meta.node !== undefined) atoms.add(v.meta.node)
    if (v.meta.ts !== undefined) atoms.add(v.meta.ts, '@ts')
    for (const t of v.meta.tags ?? []) atoms.add(t.tag)
    for (const d of v.meta.applied ?? []) atoms.add(d)
    if (v.meta.vc) atoms.add(v.meta.vc)
    if (v.meta.hlc) atoms.add(v.meta.hlc)
  }
  switch (v.kind) {
    case 'bytes': {
      for (const a of v.annotations) if (a.label !== undefined) atoms.add(a.label)
      const hex = v.bytes.map((b) => b.toString(16).padStart(2, '0')).join('')
      atoms.add(hex)
      if (v.bytes.length === 16) {
        atoms.add(
          `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`,
        )
      }
      break
    }
    case 'text':
      for (const a of v.annotations) if (a.label !== undefined) atoms.add(a.label)
      break
    case 'meter':
      if (v.label !== undefined) atoms.add(v.label)
      break
    case 'record':
      for (const f of v.fields) annotationAtoms(f.value, atoms)
      break
    case 'list':
    case 'set':
      for (const it of v.items) {
        atoms.add(it.id)
        annotationAtoms(it.value, atoms)
      }
      break
    case 'table':
      for (const c of v.columns) atoms.add(c.label)
      for (const r of v.rows)
        for (const cell of Object.values(r.cells)) annotationAtoms(cell, atoms)
      break
    case 'pattern':
      for (const t of v.tokens) {
        atoms.add(t.src)
        if (t.label !== undefined) atoms.add(t.label)
      }
      break
    default:
      break
  }
}
