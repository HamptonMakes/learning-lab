/**
 * BoardGutter — the board column (inline-end on a wide stage, below the actor grid on a narrow
 * one; see stage.css). Always in the DOM so a removed board can animate out; `:empty` hides it.
 */
import { AnimatePresence } from 'motion/react'
import { useT } from '@/i18n'
import { useStageMotion } from '../motion/StageMotionProvider'
import { useStageFrame } from '../StageContext'
import { BoardCard } from './BoardCard'

export function BoardGutter() {
  const { world } = useStageFrame()
  const { instant } = useStageMotion()
  const t = useT()
  const boards = Object.values(world.boards)
  return (
    <aside className="stage-boards" data-boards={boards.length} aria-label={t('stage.board')}>
      <AnimatePresence initial={!instant}>
        {boards.map((board) => (
          <BoardCard key={board.id} board={board} />
        ))}
      </AnimatePresence>
    </aside>
  )
}
