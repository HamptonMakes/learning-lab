/**
 * Anchor registry: every addressable node on the stage registers its element under its DSL path
 * (`alice`, `alice.doc.title`, `alice.status@ts`, `alice@inbox`, `board.rule`, `msg:m1`). Overlay
 * layers read measured rects in stage-container coordinates. The registry measures; elements never
 * measure themselves. Re-measures after every commit, while layout animations are in flight, on
 * resize, and once fonts are ready.
 */
import {
  createContext,
  useContext,
  useLayoutEffect,
  useRef,
  useSyncExternalStore,
  type ReactNode,
  type RefObject,
} from 'react'
import { useAnimationFrame } from 'motion/react'
import type { Path } from '@/lesson/types'
import { sameRect, type Rect } from './measure'

export type AnchorKey = Path

export interface AnchorRegistry {
  readonly container: HTMLElement | null
  register(key: AnchorKey, el: Element | null): void
  has(key: AnchorKey): boolean
  readonly inFlight: number
  setInFlight(delta: number): void
  subscribe(cb: () => void): () => void
  snapshot(): ReadonlyMap<AnchorKey, Rect>
  measure(): void
}

const Ctx = createContext<AnchorRegistry | null>(null)

export function createAnchorRegistry(getContainer: () => HTMLElement | null): AnchorRegistry {
  const els = new Map<AnchorKey, Element>()
  const subs = new Set<() => void>()
  let snap: ReadonlyMap<AnchorKey, Rect> = new Map()
  let inFlight = 0
  return {
    get container() {
      return getContainer()
    },
    register(key, el) {
      if (el) els.set(key, el)
      else els.delete(key)
    },
    has: (key) => els.has(key),
    get inFlight() {
      return inFlight
    },
    setInFlight(d) {
      inFlight = Math.max(0, inFlight + d)
    },
    subscribe(cb) {
      subs.add(cb)
      return () => subs.delete(cb)
    },
    snapshot: () => snap,
    measure() {
      const c = getContainer()
      if (!c) return
      const cr = c.getBoundingClientRect()
      const next = new Map<AnchorKey, Rect>()
      for (const [k, el] of els) {
        const b = el.getBoundingClientRect()
        next.set(k, { x: b.left - cr.left, y: b.top - cr.top, w: b.width, h: b.height })
      }
      if (!sameSnapshot(snap, next)) {
        snap = next
        subs.forEach((s) => s())
      }
    },
  }
}

function sameSnapshot(a: ReadonlyMap<AnchorKey, Rect>, b: ReadonlyMap<AnchorKey, Rect>): boolean {
  if (a.size !== b.size) return false
  for (const [k, r] of a) if (!sameRect(r, b.get(k))) return false
  return true
}

export function AnchorRegistryProvider({
  container,
  children,
}: {
  container: RefObject<HTMLElement | null>
  children: ReactNode
}) {
  const ref = useRef<AnchorRegistry | null>(null)
  if (!ref.current) ref.current = createAnchorRegistry(() => container.current)
  const reg = ref.current
  const settle = useRef(0)

  // 1) after every commit (frame changed or a child re-rendered) + two settle frames
  useLayoutEffect(() => {
    reg.measure()
    settle.current = 2
  })
  // 2) while cards glide, track per animation frame
  useAnimationFrame(() => {
    if (reg.inFlight > 0 || settle.current > 0) {
      settle.current = Math.max(0, settle.current - 1)
      reg.measure()
    }
  })
  // 3) container / window resize, fonts
  useLayoutEffect(() => {
    const el = container.current
    if (!el) return
    const ro =
      typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => reg.measure()) : null
    ro?.observe(el)
    const onWin = () => reg.measure()
    window.addEventListener('resize', onWin)
    void document.fonts?.ready.then(() => reg.measure())
    return () => {
      ro?.disconnect()
      window.removeEventListener('resize', onWin)
    }
  }, [container, reg])

  return <Ctx.Provider value={reg}>{children}</Ctx.Provider>
}

/** Elements call this and pass the result as `ref`. React 19 calls it with null on unmount. */
export function useAnchor(key: AnchorKey): (el: Element | null) => void {
  const reg = useContext(Ctx)
  return (el) => reg?.register(key, el)
}

/** Layers call this; re-renders only when some rect actually changed. */
export function useGeometry(): ReadonlyMap<AnchorKey, Rect> {
  const reg = useContext(Ctx)
  if (!reg) throw new Error('useGeometry must be used inside <AnchorRegistryProvider>')
  return useSyncExternalStore(reg.subscribe, reg.snapshot, reg.snapshot)
}

export function useAnchorRegistry(): AnchorRegistry | null {
  return useContext(Ctx)
}

/** ActorCard wires Motion's layout lifecycle into the registry so arcs track gliding cards. */
export function useLayoutInFlight() {
  const reg = useContext(Ctx)
  return {
    onLayoutAnimationStart: () => reg?.setInFlight(+1),
    onLayoutAnimationComplete: () => reg?.setInFlight(-1),
  }
}
