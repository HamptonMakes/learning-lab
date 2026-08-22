/**
 * AudioContext lifecycle for the sound module.
 *
 * One lazily created AudioContext (plus a master GainNode), gated behind a user-gesture "unlock"
 * because browsers refuse to start audio before the user interacts with the page. Everything here
 * is safe to call where Web Audio does not exist (jsdom, SSR): it simply no-ops. Nothing throws.
 */
import { settingsStore } from '@/settings'

type AudioContextCtor = new () => AudioContext

export interface AudioGraph {
  ctx: AudioContext
  /** Master gain, driven by the volume setting. Everything audible goes through it. */
  master: GainNode
}

const UNLOCK_EVENTS = ['pointerdown', 'keydown', 'touchstart'] as const

let graph: AudioGraph | null = null
let unlocked = false
let uninstallListeners: (() => void) | null = null

const noop = (): void => {}

function audioContextCtor(): AudioContextCtor | undefined {
  const g = globalThis as { AudioContext?: AudioContextCtor; webkitAudioContext?: AudioContextCtor }
  return g.AudioContext ?? g.webkitAudioContext
}

/** True when this environment has a usable Web Audio implementation. */
export function isAudioSupported(): boolean {
  return audioContextCtor() !== undefined
}

/** True once a user gesture (or an explicit unlockAudio() call) has allowed audio to start. */
export function isAudioUnlocked(): boolean {
  return unlocked
}

/**
 * The shared audio graph, created on first use. Returns null when Web Audio is unavailable, when
 * audio has not been unlocked yet, or when the browser refuses to construct a context.
 */
export function getAudioGraph(): AudioGraph | null {
  if (graph) return graph
  if (!unlocked) return null
  const Ctor = audioContextCtor()
  if (!Ctor) return null
  try {
    const ctx = new Ctor()
    const master = ctx.createGain()
    master.connect(ctx.destination)
    graph = { ctx, master }
    return graph
  } catch {
    return null
  }
}

/** Resume a suspended (or iOS "interrupted") context. Never throws, never rejects. */
export function resumeAudio(): void {
  const ctx = graph?.ctx
  if (!ctx || ctx.state === 'running') return
  try {
    void ctx.resume().catch(noop)
  } catch {
    /* ignore: resume is best-effort */
  }
}

/**
 * Mark audio as allowed to start. Call this from inside a user-gesture handler. When sound is
 * enabled in settings, the context is created and resumed right here — doing that inside the
 * gesture is what satisfies the strictest autoplay policies (WebKit). Otherwise the context is
 * created lazily by the first playSound() after sound is switched on.
 */
export function unlockAudio(): void {
  unlocked = true
  uninstallListeners?.()
  try {
    if (settingsStore.get().sound) {
      getAudioGraph()
      resumeAudio()
    }
  } catch {
    /* ignore: unlocking is best-effort */
  }
}

/**
 * Install once-listeners on window (pointerdown / keydown / touchstart) that unlock audio on the
 * first user gesture. Idempotent: calling it while listeners are already installed adds nothing.
 * Returns a function that removes the listeners (for effect cleanup).
 */
export function installAudioUnlock(): () => void {
  if (unlocked || typeof window === 'undefined') return noop
  if (uninstallListeners) return uninstallListeners

  const onGesture = (): void => unlockAudio()
  const options: AddEventListenerOptions = { once: true, passive: true, capture: true }
  for (const type of UNLOCK_EVENTS) window.addEventListener(type, onGesture, options)

  const uninstall = (): void => {
    for (const type of UNLOCK_EVENTS) window.removeEventListener(type, onGesture, options)
    if (uninstallListeners === uninstall) uninstallListeners = null
  }
  uninstallListeners = uninstall
  return uninstall
}

/** Test-only: forget the context and the unlock state so each test starts cold. */
export function resetAudioForTests(): void {
  uninstallListeners?.()
  uninstallListeners = null
  graph = null
  unlocked = false
}
