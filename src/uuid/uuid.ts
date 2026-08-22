/**
 * UUID v4 and v7 builders (RFC 9562) for the `uuids` lessons (docs/animation-dsl.md §5.4, §15.3).
 *
 * Lessons never hand-type a UUID's bytes: they pass the random hex (and, for v7, the Unix ms) they
 * want to show, and these builders lay the bytes out, force the version and variant bits exactly
 * as a real generator would, and return a `bytes` Value pre-annotated with the fields:
 *
 *   id      bytes / bits            label                 tone
 *   time    bytes 0–5 (v7 only)     'unix ms (48 bits)'   change
 *   ver     bits 48–52              'version = 4' | '= 7' info
 *   var     bits 64–66              'variant = 10'        info
 *   rand    every other bit range   'random'              info   (one annotation per band)
 *
 * Layout (bit indices from the MSB of byte 0):
 *   v4:  [0,48) rand · [48,52) ver=0100 · [52,64) rand · [64,66) var=10 · [66,128) rand   → 122 random bits
 *   v7:  [0,48) unix_ts_ms · [48,52) ver=0111 · [52,64) rand · [64,66) var=10 · [66,128) rand → 74 random bits
 *
 * `unannotate(path, id)` in a lesson clears all annotations that share an id, so the three/two
 * `rand` bands disappear together.
 */
import { assertHex, hexToBytes, UUID_BYTES } from './format'
import type { Annotation, BytesValue } from './types'

/** Largest Unix millisecond value that fits the v7 48-bit timestamp field. */
export const MAX_UNIX_MS_48 = 2 ** 48 - 1

/** The bit positions of the fixed fields (half-open ranges). */
export const VERSION_BITS: [number, number] = [48, 52]
export const VARIANT_BITS: [number, number] = [64, 66]

export type UuidV7Input = {
  /** Unix time in milliseconds, an integer in 0..2^48-1. */
  ms: number
  /** 20 hex characters → bytes 6–15 (74 random bits survive once version/variant are forced). */
  rand20hex: string
}

/**
 * A version-4 UUID from 32 hex characters (16 bytes). The version nibble (byte 6, top 4 bits =
 * 0100) and the variant bits (byte 8, top 2 bits = 10) overwrite whatever the hex had there.
 */
export function uuidV4(rand32hex: string): BytesValue {
  assertHex(rand32hex, 32, 'uuidV4 rand32hex')
  const bytes = hexToBytes(rand32hex)
  forceVersionAndVariant(bytes, 4)
  return {
    kind: 'bytes',
    bytes,
    display: 'hex',
    annotations: [
      bitNote('ver', VERSION_BITS, 'version = 4', 'info'),
      bitNote('var', VARIANT_BITS, 'variant = 10', 'info'),
      bitNote('rand', [0, 48], 'random', 'info'),
      bitNote('rand', [52, 64], 'random', 'info'),
      bitNote('rand', [66, 128], 'random', 'info'),
    ],
  }
}

/**
 * A version-7 UUID: bytes 0–5 are the Unix milliseconds, big-endian (48 bits); bytes 6–15 come
 * from the 20 hex characters; then the version nibble (0111) and variant bits (10) are forced.
 */
export function uuidV7({ ms, rand20hex }: UuidV7Input): BytesValue {
  if (!Number.isInteger(ms) || ms < 0 || ms > MAX_UNIX_MS_48) {
    throw new RangeError(`uuidV7 ms must be an integer in 0..${MAX_UNIX_MS_48}; got ${String(ms)}`)
  }
  assertHex(rand20hex, 20, 'uuidV7 rand20hex')
  const bytes = [...msToBytes48(ms), ...hexToBytes(rand20hex)]
  forceVersionAndVariant(bytes, 7)
  return {
    kind: 'bytes',
    bytes,
    display: 'hex',
    annotations: [
      { id: 'time', from: 0, to: 6, unit: 'byte', label: 'unix ms (48 bits)', tone: 'change' },
      bitNote('ver', VERSION_BITS, 'version = 7', 'info'),
      bitNote('var', VARIANT_BITS, 'variant = 10', 'info'),
      bitNote('rand', [52, 64], 'random', 'info'),
      bitNote('rand', [66, 128], 'random', 'info'),
    ],
  }
}

/** The 48-bit big-endian byte layout of a Unix millisecond value (already range-checked). */
function msToBytes48(ms: number): number[] {
  const out = new Array<number>(6)
  let rest = ms
  for (let i = 5; i >= 0; i--) {
    out[i] = rest % 256
    rest = Math.floor(rest / 256) // stays exact: 48 bits < 2^53
  }
  return out
}

/** In place, on a fresh 16-byte array: byte 6 high nibble ← version, byte 8 top two bits ← 10. */
function forceVersionAndVariant(bytes: number[], version: 4 | 7): void {
  if (bytes.length !== UUID_BYTES) throw new RangeError(`expected ${UUID_BYTES} bytes`)
  const b6 = bytes[6] ?? 0
  const b8 = bytes[8] ?? 0
  bytes[6] = (b6 & 0x0f) | (version << 4)
  bytes[8] = (b8 & 0x3f) | 0x80
}

function bitNote(
  id: string,
  [from, to]: readonly [number, number],
  label: string,
  tone: Annotation['tone'],
): Annotation {
  return { id, from, to, unit: 'bit', label, tone }
}
