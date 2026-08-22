/**
 * Shared helpers for the builders. Not part of the public `@/lesson/builders` surface.
 */
import type { Command, CommandT, Scalar, Value } from '../types'

/** The command variant with discriminant `T` (`Cmd<'set'>`). */
export type Cmd<T extends CommandT> = Extract<Command, { t: T }>

const VALUE_KINDS: ReadonlySet<string> = new Set([
  'scalar',
  'record',
  'list',
  'set',
  'counter',
  'clock',
  'table',
  'bytes',
  'text',
  'pattern',
  'meter',
])

export function isScalar(v: unknown): v is Scalar {
  return v === null || typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean'
}

/** True for an object that already is a DSL `Value` (has a known `kind`). */
export function isValue(v: unknown): v is Value {
  return (
    typeof v === 'object' &&
    v !== null &&
    !Array.isArray(v) &&
    typeof (v as { kind?: unknown }).kind === 'string' &&
    VALUE_KINDS.has((v as { kind: string }).kind)
  )
}

/**
 * Drop keys whose value is `undefined`, so builder output equals the literal a human would write
 * (goldens and overlay keys never see `tone: undefined`).
 */
export function compact<T extends object>(obj: T): T {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(obj)) if (v !== undefined) out[k] = v
  return out as T
}
