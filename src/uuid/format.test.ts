import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import {
  bitsOf,
  bytesToHex,
  canonical,
  hexToBytes,
  msOf,
  parseCanonical,
  UUID_BYTES,
  variantOf,
  versionOf,
} from './format'

// RFC 9562 appendix A examples.
const RFC_V1 = 'f81d4fae-7dec-11d0-a765-00a0c91e6bf6' // v1 (appears in many tutorials; not v4)
const RFC_V4 = '919108f7-52d1-4320-9bac-f847db4148a8'
const RFC_V7 = '017f22e2-79b0-7cc3-98c4-dc0c0c07398f'
const RFC_V7_MS = 1645557742000
const NIL = '00000000-0000-0000-0000-000000000000'
const MAX = 'ffffffff-ffff-ffff-ffff-ffffffffffff'

const bytes16 = fc.array(fc.integer({ min: 0, max: 255 }), { minLength: 16, maxLength: 16 })
const anyBytes = fc.array(fc.integer({ min: 0, max: 255 }), { maxLength: 40 })

describe('bytesToHex / hexToBytes', () => {
  it('writes two lower-case hex digits per byte', () => {
    expect(bytesToHex([0x00, 0x0f, 0xa0, 0xff])).toBe('000fa0ff')
    expect(bytesToHex([])).toBe('')
  })

  it('parses either case back to the same bytes', () => {
    expect(hexToBytes('000fa0ff')).toEqual([0x00, 0x0f, 0xa0, 0xff])
    expect(hexToBytes('000FA0FF')).toEqual([0x00, 0x0f, 0xa0, 0xff])
    expect(hexToBytes('')).toEqual([])
  })

  it('rejects odd lengths and non-hex characters', () => {
    expect(() => hexToBytes('abc')).toThrow(RangeError)
    expect(() => hexToBytes('zz')).toThrow(RangeError)
    expect(() => hexToBytes('0x00')).toThrow(RangeError)
    expect(() => hexToBytes(' 00')).toThrow(RangeError)
  })

  it('rejects numbers that are not bytes', () => {
    expect(() => bytesToHex([256])).toThrow(RangeError)
    expect(() => bytesToHex([-1])).toThrow(RangeError)
    expect(() => bytesToHex([1.5])).toThrow(RangeError)
    expect(() => bytesToHex([Number.NaN])).toThrow(RangeError)
  })

  it('round-trips any byte array', () => {
    fc.assert(
      fc.property(anyBytes, (b) => {
        expect(hexToBytes(bytesToHex(b))).toEqual(b)
      }),
    )
  })
})

describe('canonical / parseCanonical', () => {
  it('formats 16 bytes as lower-case 8-4-4-4-12', () => {
    expect(canonical(hexToBytes(RFC_V4.replaceAll('-', '')))).toBe(RFC_V4)
    expect(canonical(hexToBytes(RFC_V7.replaceAll('-', '')))).toBe(RFC_V7)
    expect(canonical(new Array<number>(16).fill(0))).toBe(NIL)
    expect(canonical(new Array<number>(16).fill(255))).toBe(MAX)
  })

  it('parses the canonical form in either case', () => {
    expect(parseCanonical(RFC_V4)).toEqual(hexToBytes('919108f752d143209bacf847db4148a8'))
    expect(parseCanonical(RFC_V4.toUpperCase())).toEqual(parseCanonical(RFC_V4))
    expect(parseCanonical(RFC_V4)).toHaveLength(UUID_BYTES)
  })

  it('rejects anything that is not exactly 8-4-4-4-12 hex', () => {
    expect(() => parseCanonical('919108f752d143209bacf847db4148a8')).toThrow(RangeError) // no dashes
    expect(() => parseCanonical('919108f7-52d1-4320-9bac-f847db4148a')).toThrow(RangeError) // short
    expect(() => parseCanonical('919108f7-52d1-4320-9bac-f847db4148a8a')).toThrow(RangeError) // long
    expect(() => parseCanonical('919108f7-52d1-4320-9bacf-847db4148a8')).toThrow(RangeError) // dash moved
    expect(() => parseCanonical('919108g7-52d1-4320-9bac-f847db4148a8')).toThrow(RangeError) // g
    expect(() => parseCanonical(`{${RFC_V4}}`)).toThrow(RangeError) // braces
    expect(() => parseCanonical(`urn:uuid:${RFC_V4}`)).toThrow(RangeError)
    expect(() => parseCanonical('')).toThrow(RangeError)
  })

  it('canonical() needs exactly 16 bytes', () => {
    expect(() => canonical([])).toThrow(RangeError)
    expect(() => canonical(new Array<number>(15).fill(0))).toThrow(RangeError)
    expect(() => canonical(new Array<number>(17).fill(0))).toThrow(RangeError)
    expect(() => canonical([...new Array<number>(15).fill(0), 256])).toThrow(RangeError)
  })

  it('round-trips any 16 bytes through the canonical form', () => {
    fc.assert(
      fc.property(bytes16, (b) => {
        const text = canonical(b)
        expect(text).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
        expect(parseCanonical(text)).toEqual(b)
      }),
    )
  })
})

describe('versionOf', () => {
  it('reads the top nibble of byte 6', () => {
    expect(versionOf(parseCanonical(RFC_V1))).toBe(1)
    expect(versionOf(parseCanonical(RFC_V4))).toBe(4)
    expect(versionOf(parseCanonical(RFC_V7))).toBe(7)
    expect(versionOf(parseCanonical(NIL))).toBe(0)
    expect(versionOf(parseCanonical(MAX))).toBe(15)
  })

  it('needs 16 bytes', () => {
    expect(() => versionOf([0x40])).toThrow(RangeError)
  })
})

describe('variantOf', () => {
  const withByte8 = (b8: number): number[] => {
    const b = new Array<number>(16).fill(0)
    b[8] = b8
    return b
  }

  it('classifies by the top bits of byte 8', () => {
    for (const b8 of [0x00, 0x3f, 0x7f]) expect(variantOf(withByte8(b8))).toBe('ncs')
    for (const b8 of [0x80, 0x9b, 0xaf, 0xbf]) expect(variantOf(withByte8(b8))).toBe('rfc4122')
    for (const b8 of [0xc0, 0xdf]) expect(variantOf(withByte8(b8))).toBe('microsoft')
    for (const b8 of [0xe0, 0xff]) expect(variantOf(withByte8(b8))).toBe('future')
  })

  it('reports rfc4122 for the RFC examples', () => {
    expect(variantOf(parseCanonical(RFC_V1))).toBe('rfc4122')
    expect(variantOf(parseCanonical(RFC_V4))).toBe('rfc4122')
    expect(variantOf(parseCanonical(RFC_V7))).toBe('rfc4122')
    expect(variantOf(parseCanonical(NIL))).toBe('ncs')
    expect(variantOf(parseCanonical(MAX))).toBe('future')
  })

  it('needs 16 bytes', () => {
    expect(() => variantOf([])).toThrow(RangeError)
  })
})

describe('msOf', () => {
  it('reads bytes 0–5 as a big-endian 48-bit millisecond count', () => {
    expect(msOf(parseCanonical(RFC_V7))).toBe(RFC_V7_MS)
    expect(msOf(hexToBytes('01a028e9b5007471ad66c0158af34102'))).toBe(1787392800000)
    expect(msOf(parseCanonical(NIL))).toBe(0)
    expect(msOf(parseCanonical(MAX))).toBe(2 ** 48 - 1)
    expect(msOf([0, 0, 0, 0, 1, 0, ...new Array<number>(10).fill(0xff)])).toBe(256)
  })

  it('does not depend on the version or the random bytes', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 2 ** 48 - 1 }),
        fc.array(fc.integer({ min: 0, max: 255 }), { minLength: 10, maxLength: 10 }),
        (ms, tail) => {
          const head: number[] = []
          let rest = ms
          for (let i = 0; i < 6; i++) {
            head.unshift(rest % 256)
            rest = Math.floor(rest / 256)
          }
          expect(msOf([...head, ...tail])).toBe(ms)
        },
      ),
    )
  })

  it('needs 16 bytes', () => {
    expect(() => msOf([1, 2, 3, 4, 5, 6])).toThrow(RangeError)
  })
})

describe('bitsOf', () => {
  it('indexes bits from the MSB of byte 0', () => {
    expect(bitsOf([0x80], 0, 1)).toBe('1')
    expect(bitsOf([0x01], 7, 8)).toBe('1')
    expect(bitsOf([0x01], 0, 7)).toBe('0000000')
    expect(bitsOf([0xa5, 0x0f], 0, 16)).toBe('1010010100001111')
    expect(bitsOf([0xa5, 0x0f], 4, 12)).toBe('01010000') // across the byte boundary
    expect(bitsOf([0xa5], 3, 3)).toBe('') // empty range
  })

  it('reads the version and variant fields of the RFC examples', () => {
    expect(bitsOf(parseCanonical(RFC_V4), 48, 52)).toBe('0100')
    expect(bitsOf(parseCanonical(RFC_V4), 64, 66)).toBe('10')
    expect(bitsOf(parseCanonical(RFC_V7), 48, 52)).toBe('0111')
    expect(bitsOf(parseCanonical(RFC_V7), 64, 66)).toBe('10')
  })

  it('rejects ranges outside the array or reversed', () => {
    expect(() => bitsOf([0xff], -1, 4)).toThrow(RangeError)
    expect(() => bitsOf([0xff], 0, 9)).toThrow(RangeError)
    expect(() => bitsOf([0xff], 5, 4)).toThrow(RangeError)
    expect(() => bitsOf([0xff], 0.5, 4)).toThrow(RangeError)
    expect(() => bitsOf([256], 0, 8)).toThrow(RangeError)
  })

  it('agrees with the binary expansion of every byte', () => {
    fc.assert(
      fc.property(anyBytes, (b) => {
        const expected = b.map((x) => x.toString(2).padStart(8, '0')).join('')
        expect(bitsOf(b, 0, b.length * 8)).toBe(expected)
      }),
    )
  })
})
