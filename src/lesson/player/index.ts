/** The lesson player: state machine, hold timing, the React hook, keyboard transport, lab hook. */
export {
  clamp,
  createInitialState,
  moves,
  transition,
  type InitialStateOptions,
  type MoveKind,
  type PlayerEvent,
  type PlayerMode,
  type PlayerState,
  type PlayerStatus,
  type Speed,
} from './machine'
export { ANIM_BUDGET, HOLD, animBudget, holdMs } from './hold'
export { usePlayer, type PlayerApi, type UsePlayerOptions } from './usePlayer'
export {
  handleTransportKey,
  stepSpeed,
  useKeyboardTransport,
  type KeyboardTransportApi,
  type KeyboardTransportOptions,
} from './useKeyboardTransport'
export { installLab, settle, useLabHook, type Lab, type LabApi, type LabCurrent } from './lab'
