/**
 * Byte ↔ text helpers for UUIDs (RFC 9562). Pure functions over plain `number[]` byte arrays; no
 * dependency on the lesson DSL. Everything throws `RangeError` on malformed input so a lesson that
 * hand-types a wrong byte fails at build/test time, not on stage.
 */

/** A UUID is always 16 bytes (128 bits). */
export const UUID_BYTES = 16

/** The RFC 9562 variant field (top bits of byte 8). */
export type UuidVariant = 'ncs' | 'rfc4122' | 'microsoft' | 'future'

const HEX_RE = /^[0-9a-f]*$/i
const CANONICAL_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Throws unless every entry is an integer in 0..255. */
export function assertBytes(bytes: readonly number[]): void {
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i]
    if (!Number.isInteger(b) || b === undefined || b < 0 || b > 255) {
      throw new RangeError(`byte ${i} is ${String(b)}; expected an integer in 0..255`)
    }
  }
}

/** Throws unless `bytes` is exactly 16 valid bytes. */
export function assertUuidBytes(bytes: readonly number[]): void {
  if (bytes.length !== UUID_BYTES) {
    throw new RangeError(`a UUID is ${UUID_BYTES} bytes; got ${bytes.length}`)
  }
  assertBytes(bytes)
}

/** Throws unless `hex` is exactly `length` hex characters (either case). */
export function assertHex(hex: string, length: number, what = 'hex'): void {
  if (typeof hex !== 'string' || hex.length !== length || !HEX_RE.test(hex)) {
    throw new RangeError(
      `${what} must be exactly ${length} hex characters; got ${JSON.stringify(hex)}`,
    )
  }
}

/** Lower-case hex, two characters per byte, no separators. */
export function bytesToHex(bytes: readonly number[]): string {
  assertBytes(bytes)
  let out = ''
  for (const b of bytes) out += b.toString(16).padStart(2, '0')
  return out
}

/** Parses an even-length hex string (either case) into bytes. */
export function hexToBytes(hex: string): number[] {
  if (typeof hex !== 'string' || hex.length % 2 !== 0 || !HEX_RE.test(hex)) {
    throw new RangeError(`expected an even-length hex string; got ${JSON.stringify(hex)}`)
  }
  const out: number[] = []
  for (let i = 0; i < hex.length; i += 2) out.push(parseInt(hex.slice(i, i + 2), 16))
  return out
}

/** The canonical text form, lower-case, `8-4-4-4-12`. */
export function canonical(bytes: readonly number[]): string {
  assertUuidBytes(bytes)
  const h = bytesToHex(bytes)
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`
}

/** Parses the canonical `8-4-4-4-12` form (either case) into 16 bytes. */
export function parseCanonical(str: string): number[] {
  if (typeof str !== 'string' || !CANONICAL_RE.test(str)) {
    throw new RangeError(`expected a canonical UUID (8-4-4-4-12 hex); got ${JSON.stringify(str)}`)
  }
  return hexToBytes(str.replaceAll('-', ''))
}

/** The version nibble: the top 4 bits of byte 6 (bits 48–51). */
export function versionOf(bytes: readonly number[]): number {
  assertUuidBytes(bytes)
  return (byteAt(bytes, 6) >> 4) & 0x0f
}

/**
 * The variant, read from the top bits of byte 8 (bits 64–66):
 * `0xx` → 'ncs' (legacy), `10x` → 'rfc4122' (every RFC 9562 UUID), `110` → 'microsoft', `111` → 'future'.
 */
export function variantOf(bytes: readonly number[]): UuidVariant {
  assertUuidBytes(bytes)
  const b = byteAt(bytes, 8)
  if ((b & 0x80) === 0) return 'ncs'
  if ((b & 0xc0) === 0x80) return 'rfc4122'
  if ((b & 0xe0) === 0xc0) return 'microsoft'
  return 'future'
}

/**
 * The 48-bit big-endian Unix millisecond timestamp in bytes 0–5. This is the v7 `unix_ts_ms`
 * field; it reads the bytes as-is and does not check the version, so a lesson can show the time
 * field before the version nibble has been written.
 */
export function msOf(v7bytes: readonly number[]): number {
  assertUuidBytes(v7bytes)
  let ms = 0
  for (let i = 0; i < 6; i++) ms = ms * 256 + byteAt(v7bytes, i) // 48 bits < 2^53, stays exact
  return ms
}

/**
 * The bits in [from, to) as a string of `0`/`1`, indexed from the MSB of byte 0
 * (bit 0 = 0x80 of byte 0; bit 8 = 0x80 of byte 1; …).
 */
export function bitsOf(bytes: readonly number[], from: number, to: number): string {
  assertBytes(bytes)
  const max = bytes.length * 8
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to > max || from > to) {
    throw new RangeError(`bit range [${from}, ${to}) is outside 0..${max}`)
  }
  let out = ''
  for (let i = from; i < to; i++) {
    const b = byteAt(bytes, i >> 3)
    out += (b >> (7 - (i & 7))) & 1 ? '1' : '0'
  }
  return out
}

/** Reads `bytes[i]` with the array length already checked (keeps `noUncheckedIndexedAccess` happy). */
function byteAt(bytes: readonly number[], i: number): number {
  const b = bytes[i]
  if (b === undefined) throw new RangeError(`byte ${i} is out of range`)
  return b
}
