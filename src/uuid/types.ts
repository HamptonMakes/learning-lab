/**
 * Local copies of the `bytes` Value and `Annotation` types from docs/animation-dsl.md §2.
 *
 * `src/uuid/` is pure data + arithmetic and must not import from `src/lesson/` (it is one of the
 * inputs the lesson reducer consumes, not a consumer of it). These shapes are kept structurally
 * identical to the DSL types so a `BytesValue` built here is assignable to the lesson's `Value`
 * without a cast. The DSL's optional `meta` sidecar is omitted: UUID bytes carry no CRDT metadata.
 */
export type Tone = 'change' | 'info' | 'ok' | 'warn' | 'danger'

export type Annotation = {
  id?: string
  /** Inclusive. Unit 'byte' (default) or 'bit' (bit index counted from the MSB of byte 0). */
  from: number
  /** Exclusive. */
  to: number
  unit?: 'byte' | 'bit'
  /** Localizable. */
  label?: string
  tone?: Tone
}

export type BytesDisplay = 'hex' | 'bits' | 'canonical' | 'dec'

export type BytesValue = {
  kind: 'bytes'
  bytes: number[]
  display: BytesDisplay
  /** Bytes expanded in 'bits' display, half-open [from, to); absent ⇒ all bytes. */
  range?: [number, number]
  annotations: Annotation[]
}
