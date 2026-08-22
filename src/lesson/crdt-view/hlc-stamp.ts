/**
 * How an HLC reading becomes one LWW stamp (DSL §5.1 Time): `ts = wall * 65536 + counter`. Valid
 * because 'time' clocks count minutes from `start` and counters stay small, so the stamp orders
 * exactly like `hlcCompare` (wall first, then counter). The reducer encodes when a slot's
 * `args.clock` names an HLC; the views decode it back into `Meta.hlc` for the badge.
 */
export const HLC_STAMP_BASE = 65536

export function encodeHlcStamp(h: { wall: number; counter: number }): number {
  return h.wall * HLC_STAMP_BASE + h.counter
}

export function decodeHlcStamp(ts: number): { wall: number; counter: number } {
  const wall = Math.floor(ts / HLC_STAMP_BASE)
  return { wall, counter: ts - wall * HLC_STAMP_BASE }
}
