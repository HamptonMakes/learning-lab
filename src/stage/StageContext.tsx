/**
 * Per-frame derived data shared by every stage primitive: the frame itself, which paths changed,
 * which landed via a message (for via chips), and the marks that anchor on each path. Computed once
 * per frame so value nodes and layers never re-derive it.
 */
import { createContext, useContext, useMemo, type ReactNode } from 'react'
import type {
  ActorColor,
  ActorId,
  Change,
  Frame,
  Mark,
  MessageId,
  Path,
  World,
} from '@/lesson/types'

export interface ViaInfo {
  message: MessageId
  from: ActorId
  color: ActorColor
}

export interface StageFrame {
  frame: Frame
  world: World
  changes: Change[]
  /** Paths with a `value` change this step (added / changed / removed / meta). */
  changedPaths: ReadonlySet<Path>
  /** Paths whose value landed via a message this step → draw the via chip. */
  via: ReadonlyMap<Path, ViaInfo>
  /** Marks anchored on a path (highlight / check / cross / callout / unchanged …). */
  marksByPath: ReadonlyMap<Path, Mark[]>
  /** Convenience: the strongest highlight tone on a path, if any. */
  highlightOf(path: Path): Extract<Mark, { kind: 'highlight' }> | undefined
}

const Ctx = createContext<StageFrame | null>(null)

export function deriveStageFrame(frame: Frame): StageFrame {
  const changedPaths = new Set<Path>()
  const via = new Map<Path, ViaInfo>()
  for (const c of frame.changes) {
    if (c.kind === 'value') {
      changedPaths.add(c.path)
      if (c.via) {
        const msg = frame.changes.find((x) => x.kind === 'message' && x.message.id === c.via)
        const from = msg && msg.kind === 'message' ? msg.message.from : undefined
        const fromActor = from ? frame.world.actors[from] : undefined
        if (from && fromActor) via.set(c.path, { message: c.via, from, color: fromActor.color })
      }
    }
  }
  const marksByPath = new Map<Path, Mark[]>()
  const add = (p: Path, m: Mark) => {
    const list = marksByPath.get(p)
    if (list) list.push(m)
    else marksByPath.set(p, [m])
  }
  for (const m of frame.world.marks) {
    switch (m.kind) {
      case 'highlight':
        m.paths.forEach((p) => add(p, m))
        break
      case 'callout':
        add(m.at, m)
        break
      case 'conflict':
        add(m.a, m)
        add(m.b, m)
        break
      case 'compare':
        m.paths.forEach((p) => add(p, m))
        break
      case 'check':
      case 'cross':
      case 'unchanged':
        add(m.path, m)
        break
      case 'flow':
        add(m.from, m)
        add(m.to, m)
        break
    }
  }
  const TONE_RANK = { danger: 4, warn: 3, change: 2, ok: 1, info: 0 } as const
  return {
    frame,
    world: frame.world,
    changes: frame.changes,
    changedPaths,
    via,
    marksByPath,
    highlightOf(path) {
      let best: Extract<Mark, { kind: 'highlight' }> | undefined
      for (const m of marksByPath.get(path) ?? []) {
        if (m.kind === 'highlight' && (!best || TONE_RANK[m.tone] > TONE_RANK[best.tone])) best = m
      }
      return best
    },
  }
}

export function StageFrameProvider({ frame, children }: { frame: Frame; children: ReactNode }) {
  const value = useMemo(() => deriveStageFrame(frame), [frame])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useStageFrame(): StageFrame {
  const v = useContext(Ctx)
  if (!v) throw new Error('useStageFrame must be used inside <StageFrameProvider>')
  return v
}
