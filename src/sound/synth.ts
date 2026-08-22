/**
 * playSound(): the one entry point for making noise in the app.
 *
 * Reads the sound/volume settings, respects document visibility, lazily spins up the audio graph
 * (after a user gesture unlocked it) and runs the recipe for the requested sound. Sound is
 * decoration, so this never throws — any failure is swallowed silently.
 */
import { settingsStore } from '@/settings'
import { getAudioGraph, resumeAudio } from './context'
import { RECIPES, type SoundName } from './recipes'

export type { SoundName } from './recipes'
export { SOUND_NAMES, MAX_SOUND_SECONDS } from './recipes'
export { unlockAudio, installAudioUnlock, isAudioSupported, isAudioUnlocked } from './context'

export interface PlayOptions {
  /** Per-play volume multiplier, 0..1, applied on top of the volume setting. Default 1. */
  volume?: number
}

/** Clamp to the 0..1 range; NaN becomes 0. */
export function clamp01(value: number): number {
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0
}

export function playSound(name: SoundName, opts: PlayOptions = {}): void {
  try {
    const settings = settingsStore.get()
    if (!settings.sound) return
    if (typeof document !== 'undefined' && document.hidden) return

    const graph = getAudioGraph()
    if (!graph) return
    const { ctx, master } = graph
    resumeAudio()

    master.gain.value = clamp01(settings.volume)
    const voice = ctx.createGain()
    voice.gain.value = clamp01(opts.volume ?? 1)
    voice.connect(master)

    RECIPES[name](ctx, voice, ctx.currentTime)
  } catch {
    /* sound must never break the app */
  }
}
