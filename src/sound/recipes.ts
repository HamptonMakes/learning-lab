/**
 * Sound recipes: how each UI sound is synthesized.
 *
 * A recipe schedules a few oscillators / noise sources with gain envelopes on a given AudioContext
 * and connects them to `out`. Every sound is short (<= MAX_SOUND_SECONDS) and synthesized — there
 * are no audio assets. Recipes never touch settings; playSound() handles gating and volume.
 */

export const SOUND_NAMES = [
  'bloop',
  'tick',
  'whoosh',
  'pop',
  'merge',
  'conflict',
  'success',
  'toggle',
] as const
export type SoundName = (typeof SOUND_NAMES)[number]

/** Hard ceiling on how long any recipe may sound, in seconds. Tests enforce it. */
export const MAX_SOUND_SECONDS = 0.4

export type Recipe = (ctx: AudioContext, out: AudioNode, t0: number) => void

/** Where exponential ramps end; exponentialRampToValueAtTime cannot reach 0. */
const SILENCE = 0.0001

interface ToneSpec {
  type: OscillatorType
  /** Start frequency in Hz. */
  freq: number
  /** Optional glide target frequency, reached `glide` seconds after the tone starts. */
  glideTo?: number
  glide?: number
  /** Offset from t0 in seconds. */
  at?: number
  /** Total length in seconds (attack + decay). */
  dur: number
  /** Envelope peak, 0..1. */
  peak: number
  /** Attack length in seconds (default 5 ms). */
  attack?: number
}

/** One oscillator with an attack → exponential-decay envelope. The building block of most sounds. */
function tone(ctx: AudioContext, out: AudioNode, t0: number, spec: ToneSpec): void {
  const start = t0 + (spec.at ?? 0)
  const end = start + spec.dur
  const attack = Math.min(spec.attack ?? 0.005, spec.dur / 2)

  const osc = ctx.createOscillator()
  osc.type = spec.type
  osc.frequency.setValueAtTime(spec.freq, start)
  if (spec.glideTo !== undefined) {
    osc.frequency.exponentialRampToValueAtTime(spec.glideTo, start + (spec.glide ?? spec.dur))
  }

  const env = ctx.createGain()
  env.gain.setValueAtTime(0, start)
  env.gain.linearRampToValueAtTime(spec.peak, start + attack)
  env.gain.exponentialRampToValueAtTime(SILENCE, end)

  osc.connect(env)
  env.connect(out)
  osc.start(start)
  osc.stop(end)
}

/** White noise buffer, one per context, built on demand. */
const noiseBuffers = new WeakMap<AudioContext, AudioBuffer>()
function noiseBuffer(ctx: AudioContext): AudioBuffer {
  const cached = noiseBuffers.get(ctx)
  if (cached) return cached
  const length = Math.ceil(ctx.sampleRate * MAX_SOUND_SECONDS)
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate)
  const data = buffer.getChannelData(0)
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1
  noiseBuffers.set(ctx, buffer)
  return buffer
}

/** A sine blip with a quick pitch drop — "something arrived". */
const bloop: Recipe = (ctx, out, t0) => {
  tone(ctx, out, t0, { type: 'sine', freq: 620, glideTo: 310, glide: 0.12, dur: 0.18, peak: 0.5 })
}

/** A very short, quiet click — "one step". */
const tick: Recipe = (ctx, out, t0) => {
  tone(ctx, out, t0, { type: 'triangle', freq: 2200, dur: 0.035, peak: 0.25, attack: 0.002 })
}

/** Filtered noise sweeping upward — "something flew by". */
const whoosh: Recipe = (ctx, out, t0) => {
  const end = t0 + 0.32
  const src = ctx.createBufferSource()
  src.buffer = noiseBuffer(ctx)

  const filter = ctx.createBiquadFilter()
  filter.type = 'bandpass'
  filter.Q.value = 1.2
  filter.frequency.setValueAtTime(300, t0)
  filter.frequency.exponentialRampToValueAtTime(2400, t0 + 0.22)

  const env = ctx.createGain()
  env.gain.setValueAtTime(0, t0)
  env.gain.linearRampToValueAtTime(0.35, t0 + 0.08)
  env.gain.exponentialRampToValueAtTime(SILENCE, end)

  src.connect(filter)
  filter.connect(env)
  env.connect(out)
  src.start(t0)
  src.stop(end)
}

/** A tiny bright pop — "appeared". */
const pop: Recipe = (ctx, out, t0) => {
  tone(ctx, out, t0, { type: 'sine', freq: 1000, glideTo: 500, glide: 0.04, dur: 0.07, peak: 0.45 })
}

/** Two tones gliding into one pitch — "two states became one". */
const merge: Recipe = (ctx, out, t0) => {
  const meet = 493.88 // B4
  tone(ctx, out, t0, { type: 'sine', freq: 392, glideTo: meet, glide: 0.18, dur: 0.3, peak: 0.3 })
  tone(ctx, out, t0, {
    type: 'sine',
    freq: 587.33,
    glideTo: meet,
    glide: 0.18,
    dur: 0.3,
    peak: 0.3,
  })
}

/** A soft, beating minor-second buzz through a low-pass — "these disagree". */
const conflict: Recipe = (ctx, out, t0) => {
  const lowpass = ctx.createBiquadFilter()
  lowpass.type = 'lowpass'
  lowpass.frequency.value = 700
  lowpass.connect(out)
  tone(ctx, lowpass, t0, { type: 'sawtooth', freq: 220, dur: 0.3, peak: 0.14, attack: 0.01 })
  tone(ctx, lowpass, t0, { type: 'sawtooth', freq: 233.08, dur: 0.3, peak: 0.14, attack: 0.01 })
}

/** A quick rising major triad (C5 E5 G5) — "topic complete". */
const success: Recipe = (ctx, out, t0) => {
  const notes = [523.25, 659.25, 783.99]
  notes.forEach((freq, i) => {
    tone(ctx, out, t0, { type: 'triangle', freq, at: i * 0.07, dur: 0.26, peak: 0.3 })
  })
}

/** A short rising blip — "switch flipped". */
const toggle: Recipe = (ctx, out, t0) => {
  tone(ctx, out, t0, { type: 'sine', freq: 740, glideTo: 1100, glide: 0.06, dur: 0.09, peak: 0.35 })
}

export const RECIPES: Record<SoundName, Recipe> = {
  bloop,
  tick,
  whoosh,
  pop,
  merge,
  conflict,
  success,
  toggle,
}
