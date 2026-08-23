/** The flow: an autopilot that pokes copies, syncs them, and lets the learner watch a CRDT converge. */
export {
  beatFor,
  inputFor,
  mulberry32,
  planFlowStep,
  seedOf,
  type FlowBeat,
  type FlowPlan,
  type Rng,
} from './autopilot'
export { useFlow, BEAT_MS, type FlowApi, type FlowEvent, type FlowOptions } from './useFlow'
