/**
 * Renders narration (`Step.say`) with its tiny markup:
 *   **Term**              → a first-use glossary term (<strong data-term>)
 *   [text](/module/unit/topic) → an in-app link (must start with "/")
 *   `code`                → inline code
 * Everything else is plain text. No HTML is ever interpreted.
 */
import type { ReactNode } from 'react'
import { Link } from '@tanstack/react-router'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/tooltip'
import { lookupTerm } from '@/content/glossary'

export type SayPart =
  | { kind: 'text'; text: string }
  | { kind: 'term'; text: string }
  | { kind: 'code'; text: string }
  | { kind: 'link'; text: string; href: string }

const TOKEN = /\*\*([^*]+)\*\*|\[([^\]]+)\]\((\/[^)\s]*)\)|`([^`]+)`/g

export function parseSay(say: string): SayPart[] {
  const parts: SayPart[] = []
  let last = 0
  for (const m of say.matchAll(TOKEN)) {
    const start = m.index ?? 0
    if (start > last) parts.push({ kind: 'text', text: say.slice(last, start) })
    if (m[1] !== undefined) parts.push({ kind: 'term', text: m[1] })
    else if (m[2] !== undefined && m[3] !== undefined)
      parts.push({ kind: 'link', text: m[2], href: m[3] })
    else if (m[4] !== undefined) parts.push({ kind: 'code', text: m[4] })
    last = start + m[0].length
  }
  if (last < say.length) parts.push({ kind: 'text', text: say.slice(last) })
  return parts
}

/** Plain text version (for aria labels, tests, and the number lint). */
export function sayToText(say: string): string {
  return parseSay(say)
    .map((p) => p.text)
    .join('')
}

export function SayMarkup({ say, locale }: { say: string; locale: string }): ReactNode {
  return parseSay(say).map((p, i) => {
    switch (p.kind) {
      case 'term': {
        const entry = lookupTerm(p.text)
        if (!entry) {
          return (
            <strong key={i} data-term={p.text} className="font-semibold text-ink">
              {p.text}
            </strong>
          )
        }
        return (
          <Tooltip key={i}>
            <TooltipTrigger asChild>
              <button
                type="button"
                data-term={p.text}
                className="inline cursor-help appearance-none border-0 bg-transparent p-0 font-semibold text-ink underline decoration-ink-3 decoration-dotted underline-offset-4 hover:decoration-teal focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
              >
                {p.text}
              </button>
            </TooltipTrigger>
            <TooltipContent className="max-w-72 text-pretty">{entry.definition}</TooltipContent>
          </Tooltip>
        )
      }
      case 'code':
        return (
          <code key={i} className="rounded bg-paper-3 px-1 font-mono text-[0.9em]">
            {p.text}
          </code>
        )
      case 'link':
        return (
          <Link
            key={i}
            to={`/${locale}${p.href}` as '/'}
            className="text-teal underline decoration-teal-line underline-offset-2 hover:decoration-teal"
          >
            {p.text}
          </Link>
        )
      default:
        return <span key={i}>{p.text}</span>
    }
  })
}
