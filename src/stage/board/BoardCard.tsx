/**
 * BoardCard — a free-standing card in the gutter: a rule/note (`text`), a decision table, a schema
 * tree… Its value is drawn by ValueView under the path `board.<id>`; the card itself is the anchor
 * for that path and carries `data-board` / `data-path`. Text boards read as light, borderless sticky
 * notes (paper-2, small mono); other boards are paper cards like the actors; a `tone` draws a
 * start-edge accent.
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
        'relative flex min-w-0 flex-col gap-1.5 rounded-xl p-3.5 text-sm text-ink',
        isText
          ? 'bg-paper-2 font-mono leading-5 [--value-fs:12.5px]'
          : 'bg-card shadow-(--shadow-card) ring-1 ring-(--stage-card-ring)',
        board.tone && 'border-s-2 border-s-(--tone)',
      )}
    >
      {board.label && (
        <div data-board-label className="font-sans text-[11px] leading-4 font-medium text-ink-3">
          {board.label}
        </div>
      )}
      <ValueView path={path} value={board.value} depth={0} />
    </motion.div>
  )
}
