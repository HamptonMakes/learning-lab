/* oxlint-disable no-underscore-dangle -- `window.__lab` is the test hook name fixed by stage-architecture §9.3 */
/**
 * `window.__lab` — the test hook Playwright drives (stage-architecture §9.3). Installed only when
 * the topic page asks for it (`?lab=1`, dev builds). `goto/next/prev` resolve after React has
 * committed the move and the stage has settled (fonts loaded, two frames painted, every running
 * animation finished).
 */
import { useEffect, useRef } from 'react'
import type { Change } from '@/lesson/types'
import { moves, type PlayerEvent } from './machine'
import type { PlayerApi } from './usePlayer'

export interface LabCurrent {
  index: number
  stepId: string
  sceneId: string
  say: string
  changes: Change[]
}

export interface LabApi {
  total: number
  current(): LabCurrent
  /** Instant seek; resolves after the commit + settle(). */
  goto(index: number): Promise<void>
  next(): Promise<void>
  prev(): Promise<void>
}

export interface Lab extends LabApi {
  ready: true
  /** fonts.ready → 2 rAF → every running document animation finished. */
  settle(): Promise<void>
}

declare global {
  interface Window {
    __lab?: Lab
  }
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => resolve())
    else setTimeout(resolve, 16)
  })
}

export async function settle(doc: Document = document): Promise<void> {
  const fonts = (doc as { fonts?: { ready: Promise<unknown> } }).fonts
  if (fonts?.ready) await fonts.ready.catch(() => undefined)
  await nextFrame()
  await nextFrame()
  if (typeof doc.getAnimations === 'function') {
    const running = doc.getAnimations().filter((a) => a.playState === 'running')
    await Promise.all(running.map((a) => a.finished.catch(() => undefined)))
  }
}

/** Sets `window.__lab` (wrapping `goto/next/prev` so they also settle); returns the uninstaller. */
export function installLab(api: LabApi): () => void {
  const lab: Lab = {
    ready: true,
    get total() {
      return api.total
    },
    current: () => api.current(),
    goto: async (index) => {
      await api.goto(index)
      await settle()
    },
    next: async () => {
      await api.next()
      await settle()
    },
    prev: async () => {
      await api.prev()
      await settle()
    },
    settle: () => settle(),
  }
  window.__lab = lab
  return () => {
    if (window.__lab === lab) delete window.__lab
  }
}

/**
 * Installs `window.__lab` on top of a player while `enabled`. Moves resolve after the React commit
 * that applied them (a no-op move resolves at once).
 */
export function useLabHook(api: PlayerApi, { enabled }: { enabled: boolean }): void {
  const apiRef = useRef(api)
  const waitersRef = useRef<Array<() => void>>([])
  const { total } = api.state

  // After every commit: refresh the api, then release the moves that were waiting for a commit
  // (a dispatched move is part of the very next commit — React batches it in).
  useEffect(() => {
    apiRef.current = api
    const waiters = waitersRef.current
    waitersRef.current = []
    for (const resolve of waiters) resolve()
  })

  useEffect(() => {
    if (!enabled) return
    const move = (e: PlayerEvent): Promise<void> =>
      new Promise((resolve) => {
        const cur = apiRef.current
        if (!moves(cur.state, e)) {
          resolve()
          return
        }
        waitersRef.current.push(resolve)
        cur.dispatch(e)
      })
    return installLab({
      total,
      current: () => {
        const { state, frame } = apiRef.current
        return {
          index: state.index,
          stepId: frame?.step.id ?? '',
          sceneId: frame?.sceneId ?? '',
          say: frame?.step.say ?? '',
          changes: frame?.changes ?? [],
        }
      },
      goto: (index) => move({ t: 'seek', index }),
      next: () => move({ t: 'next', source: 'user' }),
      prev: () => move({ t: 'prev' }),
    })
  }, [enabled, total])
}
