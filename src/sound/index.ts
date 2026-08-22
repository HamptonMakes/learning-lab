/**
 * Public surface of the sound module. Import from '@/sound' — never construct AudioContext elsewhere.
 */
export {
  playSound,
  clamp01,
  unlockAudio,
  installAudioUnlock,
  isAudioSupported,
  isAudioUnlocked,
  SOUND_NAMES,
  MAX_SOUND_SECONDS,
  type SoundName,
  type PlayOptions,
} from './synth'
export { useSound, SoundProvider, type SoundApi } from './hooks'
