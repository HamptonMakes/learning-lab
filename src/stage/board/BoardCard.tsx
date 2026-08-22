/**
 * BoardCard — a free-standing card in the gutter: a rule/note (`text`), a decision table, a schema
 * tree… Its value is drawn by ValueView under the path `board.<id>`; the card itself is the anchor
 * for that path and carries `data-board` / `data-path`. Text boards read as calm rule cards (mono,
 * muted paper); a `tone` draws a start-edge accent.
 */
import type { CSSProperties } from 'react'
import { motion } from 'motion/react'
import type { Board } from '@/lesson/types'
import { cn } from '@/lib/utils'
import { useAnchor } from '../geometry/AnchorRegistry'
import { useStageMotion } from '../motion/StageMotionProvider'
import { useStageFrame } from '../StageContext'
import { ValueView } from '../value/ValueView'
import { toneVar } from '../actor/tone'

export function BoardCard({ board }: { board: Board }) {
  const { frame } = useStageFrame()
  const { tr, instant } = useStageMotion()
  const path = `board.${board.id}`
  const ref = useAnchor(path)
  const isText = board.value.kind === 'text'
  const style = board.tone ? ({ '--tone': toneVar(board.tone) } as CSSProperties) : undefined
  return (
    <motion.div
      ref={ref}
      layout="position"
      layoutId={path}
      layoutDependency={frame.index}
      initial={instant ? false : { opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.96, transition: tr('exit') }}
      transition={{ ...tr('enter'), layout: tr('layout') }}
      role="note"
      aria-label={board.label}
      data-board={board.id}
      data-path={path}
      data-board-kind={board.value.kind}
      data-tone={board.tone}
      style={style}
      className={cn(
        'relative flex min-w-0 flex-col gap-1.5 rounded-xl border border-line bg-card p-3 text-sm text-ink shadow-xs',
        board.tone && 'border-s-2 border-s-(--tone)',
        isText && 'bg-paper-2 font-mono',
      )}
    >
      {board.label && (
        <div data-board-label className="text-xs font-medium text-ink-2">
          {board.label}
        </div>
      )}
      <ValueView path={path} value={board.value} depth={0} />
    </motion.div>
  )
}
