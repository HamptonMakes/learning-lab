/**
 * `fromJson(v)` (DSL §5.1/§5.2): a register payload as a `Value` tree — scalar → scalar, array →
 * list with index ids `0…`, object → record (fields in key order). `undefined` reads as null.
 */
import type { Value } from '../types'

export function fromJson(v: unknown): Value {
  if (v === null || v === undefined) return { kind: 'scalar', value: null }
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
    return { kind: 'scalar', value: v }
  }
  if (Array.isArray(v)) {
    return { kind: 'list', items: v.map((x, i) => ({ id: String(i), value: fromJson(x) })) }
  }
  if (typeof v === 'object') {
    const rec = v as Record<string, unknown>
    return {
      kind: 'record',
      fields: Object.keys(rec).map((key) => ({ key, value: fromJson(rec[key]) })),
    }
  }
  return { kind: 'scalar', value: String(v) }
}
