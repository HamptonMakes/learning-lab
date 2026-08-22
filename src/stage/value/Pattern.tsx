/**
 * Pattern — one chip per regex token (`${path}[${id}]`, `data-value` = its source, kind styling,
 * label in `title`), the token at `cursor` emphasised, and a caret (`${path}@cursor`) before it.
 * The pattern's `data-value` is its source. An LTR island (DSL §9).
 */
import { Fragment } from 'react'
import type { Path, PatternToken, ValueOf } from '@/lesson/types'
import { cn } from '@/lib/utils'
import { Caret, Ltr } from './chips'
import { dataValueOf } from './format'
import { MetaBadges } from './MetaBadges'
import { NodeBox } from './NodeBox'
import { isTokenPath, itemPath, metaPath } from './paths'

const KIND_CLASS: Record<PatternToken['kind'], string> = {
  literal: 'border-line bg-card text-ink',
  any: 'border-line bg-paper-2 text-ink',
  class: 'border-actor-c/50 bg-actor-c-soft text-ink',
  quant: 'border-warn/60 bg-warn-soft text-ink',
  group: 'border-line-2 bg-card text-ink-2',
  anchor: 'border-actor-b/50 bg-actor-b-soft text-ink',
  alt: 'border-line-2 bg-paper-3 text-ink-2',
}

export function Pattern({
  path,
  value,
  depth,
}: {
  path: Path
  value: ValueOf<'pattern'>
  depth: number
}) {
  const { tokens, cursor } = value
  const shared = !isTokenPath(path)
  const caret = (at: number) => (
    <Caret path={path} index={at} layoutId={shared ? metaPath(path, 'cursor') : undefined} />
  )
  return (
    <NodeBox
      path={path}
      kind="pattern"
      dataValue={dataValueOf(value)}
      tombstone={value.meta?.tombstone}
      attrs={{ 'data-cursor': cursor }}
      className={cn(
        'inline-flex max-w-full min-w-0 flex-col gap-1 rounded-sm font-mono text-[13px]',
        depth === 0 && 'px-0.5',
      )}
    >
      <Ltr className="inline-flex flex-wrap items-center gap-0.5">
        {tokens.map((tok, i) => (
          <Fragment key={tok.id}>
            {cursor === i && caret(i)}
            <NodeBox
              as="span"
              path={itemPath(path, tok.id)}
              kind="token"
              dataValue={tok.src}
              title={tok.label}
              attrs={{
                'data-token-kind': tok.kind,
                'data-current': cursor === i ? 'true' : undefined,
              }}
              layout="position"
              className={cn(
                'inline-flex h-5 items-center rounded-sm border px-1 leading-none whitespace-pre',
                KIND_CLASS[tok.kind],
                cursor === i && 'ring-2 ring-teal',
              )}
            >
              {tok.src}
            </NodeBox>
          </Fragment>
        ))}
        {cursor !== undefined && cursor >= tokens.length && caret(cursor)}
      </Ltr>
      <MetaBadges path={path} meta={value.meta} />
    </NodeBox>
  )
}
