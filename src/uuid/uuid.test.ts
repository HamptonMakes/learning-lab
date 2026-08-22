import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import { bitsOf, bytesToHex, canonical, msOf, parseCanonical, variantOf, versionOf } from './format'
import { MAX_UNIX_MS_48, uuidV4, uuidV7, VARIANT_BITS, VERSION_BITS } from './uuid'
import type { Annotation } from './types'

// RFC 9562 appendix A examples. (The often-quoted f81d4fae-7dec-11d0-a765-00a0c91e6bf6 is a v1.)
const RFC_V4 = '919108f7-52d1-4320-9bac-f847db4148a8'
const RFC_V7 = '017f22e2-79b0-7cc3-98c4-dc0c0c07398f'
const RFC_V7_MS = 1645557742000
const RFC_V7_RAND = '7cc398c4dc0c0c07398f' // bytes 6–15 of RFC_V7

const hex = (n: number) => fc.stringMatching(new RegExp(`^[0-9a-fA-F]{${n}}$`))
const hex32 = hex(32)
const hex20 = hex(20)
const ms48 = fc.integer({ min: 0, max: MAX_UNIX_MS_48 })

const bitNote = (id: string, from: number, to: number, label: string): Annotation => ({
  id,
  from,
  to,
  unit: 'bit',
  label,
  tone: 'info',
})

describe('uuidV4', () => {
  it('reproduces the RFC 9562 v4 example', () => {
    const v = uuidV4('919108f752d143209bacf847db4148a8')
    expect(canonical(v.bytes)).toBe(RFC_V4)
    expect(versionOf(v.bytes)).toBe(4)
    expect(variantOf(v.bytes)).toBe('rfc4122')
  })

  it('returns a hex-display bytes Value with the ver / var / rand annotations', () => {
    const v = uuidV4('919108f752d143209bacf847db4148a8')
    expect(v.kind).toBe('bytes')
    expect(v.display).toBe('hex')
    expect(v.range).toBeUndefined()
    expect(v.bytes).toHaveLength(16)
    expect(v.annotations).toEqual([
      bitNote('ver', 48, 52, 'version = 4'),
      bitNote('var', 64, 66, 'variant = 10'),
      bitNote('rand', 0, 48, 'random'),
      bitNote('rand', 52, 64, 'random'),
      bitNote('rand', 66, 128, 'random'),
    ])
    expect(v.annotations.find((a) => a.id === 'time')).toBeUndefined()
    // 122 random bits, as the lesson says.
    const randBits = v.annotations
      .filter((a) => a.id === 'rand')
      .reduce((n, a) => n + (a.to - a.from), 0)
    expect(randBits).toBe(122)
  })

  it('forces the version nibble and variant bits over whatever the hex had', () => {
    const zeros = uuidV4('0'.repeat(32))
    expect(bytesToHex(zeros.bytes)).toBe('00000000000040008000000000000000')
    expect(zeros.bytes[6]).toBe(0x40)
    expect(zeros.bytes[8]).toBe(0x80)

    const ones = uuidV4('f'.repeat(32))
    expect(bytesToHex(ones.bytes)).toBe('ffffffffffff4fffbfffffffffffffff')
    expect(ones.bytes[6]).toBe(0x4f)
    expect(ones.bytes[8]).toBe(0xbf)

    // The curriculum's "we rolled them once" bytes: 07 → 47, 2d → ad (unit-5 uuid-v4 s02/s03).
    const rolled = uuidV4('3fa85c129be407712d66c0158af341b9')
    expect(canonical(rolled.bytes)).toBe('3fa85c12-9be4-4771-ad66-c0158af341b9')
  })

  it('keeps every other bit exactly as given', () => {
    fc.assert(
      fc.property(hex32, (h) => {
        const v = uuidV4(h)
        const input = parseCanonicalLoose(h)
        expect(versionOf(v.bytes)).toBe(4)
        expect(variantOf(v.bytes)).toBe('rfc4122')
        expect(bitsOf(v.bytes, 0, 48)).toBe(bitsOf(input, 0, 48))
        expect(bitsOf(v.bytes, 52, 64)).toBe(bitsOf(input, 52, 64))
        expect(bitsOf(v.bytes, 66, 128)).toBe(bitsOf(input, 66, 128))
        expect(bitsOf(v.bytes, ...VERSION_BITS)).toBe('0100')
        expect(bitsOf(v.bytes, ...VARIANT_BITS)).toBe('10')
      }),
    )
  })

  it('accepts upper-case hex', () => {
    expect(uuidV4('919108F752D143209BACF847DB4148A8').bytes).toEqual(
      uuidV4('919108f752d143209bacf847db4148a8').bytes,
    )
  })

  it('rejects anything but 32 hex characters', () => {
    expect(() => uuidV4('')).toThrow(RangeError)
    expect(() => uuidV4('0'.repeat(31))).toThrow(RangeError)
    expect(() => uuidV4('0'.repeat(33))).toThrow(RangeError)
    expect(() => uuidV4('g'.repeat(32))).toThrow(RangeError)
    expect(() => uuidV4(RFC_V4)).toThrow(RangeError) // dashes are not hex
    expect(() => uuidV4(`0x${'0'.repeat(30)}`)).toThrow(RangeError)
  })

  it('is pure: equal inputs give equal, unshared results', () => {
    const a = uuidV4('919108f752d143209bacf847db4148a8')
    const b = uuidV4('919108f752d143209bacf847db4148a8')
    expect(a).toEqual(b)
    expect(a.bytes).not.toBe(b.bytes)
    expect(a.annotations).not.toBe(b.annotations)
  })
})

describe('uuidV7', () => {
  it('reproduces the RFC 9562 v7 example', () => {
    const v = uuidV7({ ms: RFC_V7_MS, rand20hex: RFC_V7_RAND })
    expect(canonical(v.bytes)).toBe(RFC_V7)
    expect(msOf(v.bytes)).toBe(RFC_V7_MS)
    expect(versionOf(v.bytes)).toBe(7)
    expect(variantOf(v.bytes)).toBe('rfc4122')
  })

  it('matches the docs/animation-dsl.md §15.3 worked example (s07)', () => {
    const v = uuidV7({ ms: 1787392800001, rand20hex: '1122b34455667788990a' })
    expect(bytesToHex(v.bytes)).toBe('01a028e9b5017122b34455667788990a')
    expect(canonical(v.bytes)).toBe('01a028e9-b501-7122-b344-55667788990a')
    expect(msOf(v.bytes)).toBe(1787392800001)
  })

  it('matches the §15.3 hand-built id (s02–s06): e4 → 74, 2d → ad', () => {
    // s02 random bytes 9c017e5502a1 e4712d66c0158af34102; bytes 6–15 are the rand half.
    const v = uuidV7({ ms: 1787392800000, rand20hex: 'e4712d66c0158af34102' })
    expect(bytesToHex(v.bytes)).toBe('01a028e9b5007471ad66c0158af34102')
    expect(canonical(v.bytes)).toBe('01a028e9-b500-7471-ad66-c0158af34102')
    expect(v.bytes.slice(0, 6)).toEqual([0x01, 0xa0, 0x28, 0xe9, 0xb5, 0x00])
  })

  it('returns a hex-display bytes Value with time / ver / var / rand annotations', () => {
    const v = uuidV7({ ms: RFC_V7_MS, rand20hex: RFC_V7_RAND })
    expect(v.kind).toBe('bytes')
    expect(v.display).toBe('hex')
    expect(v.range).toBeUndefined()
    expect(v.bytes).toHaveLength(16)
    expect(v.annotations).toEqual([
      { id: 'time', from: 0, to: 6, unit: 'byte', label: 'unix ms (48 bits)', tone: 'change' },
      bitNote('ver', 48, 52, 'version = 7'),
      bitNote('var', 64, 66, 'variant = 10'),
      bitNote('rand', 52, 64, 'random'),
      bitNote('rand', 66, 128, 'random'),
    ])
    const randBits = v.annotations
      .filter((a) => a.id === 'rand')
      .reduce((n, a) => n + (a.to - a.from), 0)
    expect(randBits).toBe(74)
  })

  it('forces the version nibble and variant bits over whatever the hex had', () => {
    const zeros = uuidV7({ ms: 0, rand20hex: '0'.repeat(20) })
    expect(bytesToHex(zeros.bytes)).toBe('00000000000070008000000000000000')
    const ones = uuidV7({ ms: 0, rand20hex: 'f'.repeat(20) })
    expect(bytesToHex(ones.bytes)).toBe('0000000000007fffbfffffffffffffff')
    // Version 4 in the input is overwritten with 7; variant bits 11 become 10.
    const fromV4 = uuidV7({ ms: 0, rand20hex: '4000c00000000000ffff' })
    expect(bytesToHex(fromV4.bytes)).toBe('0000000000007000800000000000ffff')
  })

  it('writes the milliseconds big-endian into bytes 0–5 across the whole 48-bit range', () => {
    expect(uuidV7({ ms: 0, rand20hex: '0'.repeat(20) }).bytes.slice(0, 6)).toEqual([
      0, 0, 0, 0, 0, 0,
    ])
    expect(uuidV7({ ms: 1, rand20hex: '0'.repeat(20) }).bytes.slice(0, 6)).toEqual([
      0, 0, 0, 0, 0, 1,
    ])
    expect(uuidV7({ ms: 256, rand20hex: '0'.repeat(20) }).bytes.slice(0, 6)).toEqual([
      0, 0, 0, 0, 1, 0,
    ])
    expect(uuidV7({ ms: MAX_UNIX_MS_48, rand20hex: '0'.repeat(20) }).bytes.slice(0, 6)).toEqual([
      0xff, 0xff, 0xff, 0xff, 0xff, 0xff,
    ])
    expect(uuidV7({ ms: 1787392800000, rand20hex: '0'.repeat(20) }).bytes.slice(0, 6)).toEqual([
      0x01, 0xa0, 0x28, 0xe9, 0xb5, 0x00,
    ])
  })

  it('round-trips ms and keeps the random bits for any input', () => {
    fc.assert(
      fc.property(ms48, hex20, (ms, h) => {
        const v = uuidV7({ ms, rand20hex: h })
        const rand = parseCanonicalLoose(`${'0'.repeat(12)}${h}`)
        expect(msOf(v.bytes)).toBe(ms)
        expect(versionOf(v.bytes)).toBe(7)
        expect(variantOf(v.bytes)).toBe('rfc4122')
        expect(bitsOf(v.bytes, 52, 64)).toBe(bitsOf(rand, 52, 64))
        expect(bitsOf(v.bytes, 66, 128)).toBe(bitsOf(rand, 66, 128))
      }),
    )
  })

  it('sorts by time as text: one millisecond later sorts after', () => {
    const a = uuidV7({ ms: 1787392800000, rand20hex: 'ffffffffffffffffffff' })
    const b = uuidV7({ ms: 1787392800001, rand20hex: '00000000000000000000' })
    expect(canonical(a.bytes) < canonical(b.bytes)).toBe(true)
    expect(bytesToHex(a.bytes) < bytesToHex(b.bytes)).toBe(true)
  })

  it('rejects ms outside 0..2^48-1 or not an integer', () => {
    const rand20hex = '0'.repeat(20)
    expect(() => uuidV7({ ms: -1, rand20hex })).toThrow(RangeError)
    expect(() => uuidV7({ ms: 2 ** 48, rand20hex })).toThrow(RangeError)
    expect(() => uuidV7({ ms: 1.5, rand20hex })).toThrow(RangeError)
    expect(() => uuidV7({ ms: Number.NaN, rand20hex })).toThrow(RangeError)
    expect(() => uuidV7({ ms: Number.POSITIVE_INFINITY, rand20hex })).toThrow(RangeError)
    expect(() => uuidV7({ ms: MAX_UNIX_MS_48, rand20hex })).not.toThrow()
  })

  it('rejects anything but 20 hex characters for the random half', () => {
    expect(() => uuidV7({ ms: 0, rand20hex: '' })).toThrow(RangeError)
    expect(() => uuidV7({ ms: 0, rand20hex: '0'.repeat(19) })).toThrow(RangeError)
    expect(() => uuidV7({ ms: 0, rand20hex: '0'.repeat(21) })).toThrow(RangeError)
    expect(() => uuidV7({ ms: 0, rand20hex: 'g'.repeat(20) })).toThrow(RangeError)
    expect(() => uuidV7({ ms: 0, rand20hex: '0'.repeat(32) })).toThrow(RangeError) // v4-sized
  })

  it('accepts upper-case hex', () => {
    expect(uuidV7({ ms: RFC_V7_MS, rand20hex: RFC_V7_RAND.toUpperCase() }).bytes).toEqual(
      uuidV7({ ms: RFC_V7_MS, rand20hex: RFC_V7_RAND }).bytes,
    )
  })
})

/** 32 hex chars (no dashes) → bytes, via the strict canonical parser. */
function parseCanonicalLoose(h: string): number[] {
  const s = h.toLowerCase()
  return parseCanonical(
    `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20, 32)}`,
  )
}
