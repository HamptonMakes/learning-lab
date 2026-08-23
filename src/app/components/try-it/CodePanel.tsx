/**
 * CodePanel — "show the code": the real `src/crdt/` function(s) the last sandbox action ran, printed
 * from the source file (docs/animation-dsl.md §11). One line says what ran and where
 * ("This ran: orSet.prepare → orSet.effect · Alice built op alice:3"); under it, each function is
 * printed with its file lines, the function body highlighted, its doc comment kept as context.
 * Delivery-layer actions (offline, broadcast …) call nothing in the CRDT: the panel says so and
 * keeps the last function that did run. Before anything ran, it shows the function the wire will
 * call (`merge` for state sync, `effect` for op delivery) as a reference.
 */
import { useMemo, type ReactNode } from 'react'
import { useI18n } from '@/i18n'
import {
  whatRan,
  whyNothingRan,
  wireFn,
  type RanCall,
  type ReplicaType,
  type UiText,
} from '@/lesson/sandbox'
import type { Frame, Replica, World } from '@/lesson/types'
import { cn } from '@/lib/utils'
import { codeFor, type CodeBlock } from './crdt-source'

export interface CodePanelProps {
  /** The sandbox history: the start frame first, the current frame last. */
  history: readonly Frame[]
  className?: string
}

/** The most recent step that ran something in src/crdt/ (often the current one). */
function lastRun(history: readonly Frame[]): { calls: RanCall[]; isCurrent: boolean } | undefined {
  for (let i = history.length - 1; i >= 1; i--) {
    const frame = history[i]
    if (!frame) continue
    const calls = whatRan(frame)
    if (calls.length > 0) return { calls, isCurrent: i === history.length - 1 }
  }
  return undefined
}

/** The first CRDT replica of a world: the reference type before anything ran. */
function primaryReplica(world: World): { type: ReplicaType; replica: Replica } | undefined {
  for (const slots of Object.values(world.replicas)) {
    for (const replica of Object.values(slots)) return { type: replica.type, replica }
  }
  return undefined
}

export function CodePanel({ history, className }: CodePanelProps) {
  const { t } = useI18n()
  const text = (ui: UiText): string => ('text' in ui ? ui.text : t(ui.key, ui.vars))
  const current = history[history.length - 1]
  const start = history[0]

  const ran = lastRun(history)

  if (!current || !start) return null

  let headline: ReactNode
  let note: string | undefined
  let blocks: Array<{ block: CodeBlock; details: UiText[] }>
  if (ran) {
    if (!ran.isCurrent) note = text(whyNothingRan(current))
    headline = (
      <>
        {t(ran.isCurrent ? 'tryIt.code.ran' : 'tryIt.code.last')}{' '}
        {ran.calls.map((c, i) => (
          <span key={`${c.type}.${c.fn}.${c.slot}`}>
            {i > 0 && <span className="text-ink-3"> → </span>}
            <FnName call={c} />
          </span>
        ))}
      </>
    )
    blocks = ran.calls.map((c) => ({ block: codeFor(c.type, c.fn), details: c.details }))
  } else {
    const primary = primaryReplica(start.world)
    if (history.length > 1) note = text(whyNothingRan(current))
    const ref = primary ? codeFor(primary.type, wireFn(primary.replica)) : undefined
    const wire = primary?.replica.args.wire === 'ops' ? 'ops' : 'state'
    headline = (
      <>
        {history.length === 1 && <>{t('tryIt.code.start')} </>}
        {ref && t(`tryIt.code.reference.${wire}`, { fn: ref.label })}
      </>
    )
    blocks = ref ? [{ block: ref, details: [] }] : []
  }

  return (
    <section
      data-testid="try-it-code"
      aria-label={t('tryIt.code')}
      className={cn('flex flex-col gap-2 rounded-lg border border-line bg-card p-3', className)}
    >
      {note !== undefined && (
        <p className="text-sm text-ink-2" data-testid="try-it-code-note">
          {note}
        </p>
      )}
      <p className="text-sm text-ink" data-testid="try-it-code-headline">
        {headline}
      </p>
      {blocks.map(({ block, details }) => (
        <figure key={block.label} data-testid="try-it-code-block" data-fn={block.label}>
          <figcaption className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-xs text-ink-3">
            <code className="font-mono text-[12px] font-medium text-ink">{block.label}</code>
            <span>
              {block.extracted
                ? t('tryIt.code.file', {
                    file: block.file,
                    start: block.extracted.start,
                    end: block.extracted.end,
                  })
                : t('tryIt.code.whole', { fn: block.label, file: block.file })}
            </span>
            {details.length > 0 && (
              <span className="text-ink-2">· {details.map(text).join(' · ')}</span>
            )}
          </figcaption>
          <Source block={block} />
        </figure>
      ))}
    </section>
  )
}

function FnName({ call }: { call: RanCall }) {
  return (
    <code className="rounded-sm bg-paper-2 px-1 py-0.5 font-mono text-[12px] text-ink">
      {codeFor(call.type, call.fn).label}
    </code>
  )
}

// ─── Source printing ──────────────────────────────────────────────────────────────────────────

type TokKind = 'kw' | 'str' | 'cm' | 'num' | 'id' | 'punct' | 'ws'
type Tok = { kind: TokKind; text: string }

const KEYWORDS = new Set([
  'as',
  'async',
  'await',
  'break',
  'case',
  'catch',
  'const',
  'continue',
  'default',
  'delete',
  'else',
  'export',
  'false',
  'for',
  'from',
  'function',
  'if',
  'import',
  'in',
  'instanceof',
  'interface',
  'let',
  'new',
  'null',
  'of',
  'readonly',
  'return',
  'switch',
  'this',
  'throw',
  'true',
  'try',
  'type',
  'typeof',
  'undefined',
  'var',
  'void',
  'while',
])

const TOKEN =
  /\/\/.*|\/\*[\s\S]*?(?:\*\/|$)|'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"|`(?:\\.|[^`\\])*`|\d+(?:\.\d+)?|[A-Za-z_$][\w$]*|\s+|[^\sA-Za-z_$\d]/g

/** Tokenize one line; `inComment` carries an open block comment from the previous line. */
function tokenize(line: string, inComment: boolean): { toks: Tok[]; inComment: boolean } {
  const toks: Tok[] = []
  let rest = line
  if (inComment) {
    const close = rest.indexOf('*/')
    if (close === -1) return { toks: [{ kind: 'cm', text: rest }], inComment: true }
    toks.push({ kind: 'cm', text: rest.slice(0, close + 2) })
    rest = rest.slice(close + 2)
    inComment = false
  }
  for (const m of rest.matchAll(TOKEN)) {
    const s = m[0]
    if (s.startsWith('//')) toks.push({ kind: 'cm', text: s })
    else if (s.startsWith('/*')) {
      toks.push({ kind: 'cm', text: s })
      if (!s.endsWith('*/')) inComment = true
    } else if (/^['"`]/.test(s)) toks.push({ kind: 'str', text: s })
    else if (/^\d/.test(s)) toks.push({ kind: 'num', text: s })
    else if (/^[A-Za-z_$]/.test(s)) toks.push({ kind: KEYWORDS.has(s) ? 'kw' : 'id', text: s })
    else if (/^\s/.test(s)) toks.push({ kind: 'ws', text: s })
    else toks.push({ kind: 'punct', text: s })
  }
  return { toks, inComment }
}

const TOK_CLASS: Record<TokKind, string | undefined> = {
  kw: 'text-teal',
  str: 'text-ok',
  cm: 'text-ink-3 italic',
  num: 'text-actor-c',
  id: undefined,
  punct: 'text-ink-2',
  ws: undefined,
}

function Source({ block }: { block: CodeBlock }) {
  const lines = useMemo(() => {
    const out: Array<{ n: number; toks: Tok[]; hot: boolean }> = []
    let inComment = false
    const first = block.extracted?.start ?? 1
    const bodyStart = block.extracted?.bodyStart ?? 1
    block.text.split('\n').forEach((line, i) => {
      const r = tokenize(line, inComment)
      inComment = r.inComment
      const n = first + i
      out.push({ n, toks: r.toks, hot: block.extracted !== undefined && n >= bodyStart })
    })
    return out
  }, [block])
  const whole = block.extracted === undefined
  return (
    <pre
      className={cn(
        'mt-1 overflow-auto rounded-md border border-line bg-paper-2/50 py-2 font-mono text-[12px] leading-5 text-ink',
        whole ? 'max-h-80' : 'max-h-96',
      )}
      dir="ltr"
    >
      <code>
        {lines.map((l) => (
          <span
            key={l.n}
            data-hot={l.hot ? '' : undefined}
            className={cn('block px-3', l.hot && 'bg-teal-soft/40')}
          >
            <span
              aria-hidden
              className="me-3 inline-block w-7 text-end text-ink-3 tabular-nums select-none"
            >
              {l.n}
            </span>
            {l.toks.map((tok, j) => (
              <span key={j} className={TOK_CLASS[tok.kind]}>
                {tok.text}
              </span>
            ))}
            {'\n'}
          </span>
        ))}
      </code>
    </pre>
  )
}
