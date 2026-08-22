/**
 * Compact, deterministic text for a payload on a token: a ≤ 24-character summary for the chip and
 * the full canonical string for `title` / `data-value`. Pure; mirrors the §4.5 plain-value rules so a
 * scalar reads the same on the token as on the node it lands in.
 */
import { LIMITS, type CrdtName, type Value, type VectorClock } from '@/lesson/types'

/** Middle ellipsis: `abcdefghijklmnopqrstuvwxyz` → `abcdefghijk…pqrstuvwxyz` (≤ max chars). */
export function middleEllipsis(s: string, max = LIMITS.maxScalarChars): string {
  if (s.length <= max) return s
  const keep = max - 1
  const head = Math.ceil(keep / 2)
  const tail = keep - head
  return `${s.slice(0, head)}…${tail ? s.slice(-tail) : ''}`
}

/** `a2 b1` — compact version vector (world order is the caller's concern; entries keep insertion order). */
export function compactClock(entries: VectorClock): string {
  return Object.entries(entries)
    .map(([node, n]) => `${node}${n}`)
    .join(' ')
}

function scalarText(v: Extract<Value, { kind: 'scalar' }>): string {
  return v.value === null ? 'null' : String(v.value)
}

/** Full canonical text of a value (no length limit). */
export function canonicalValue(v: Value, depth = 0): string {
  switch (v.kind) {
    case 'scalar':
      return scalarText(v)
    case 'record':
      return `{${v.fields.map((f) => `${f.key}: ${canonicalValue(f.value, depth + 1)}`).join(', ')}}`
    case 'list': {
      const live = v.items.filter((i) => !i.value.meta?.tombstone)
      if (v.display === 'text') return live.map((i) => canonicalValue(i.value, depth + 1)).join('')
      return `[${live.map((i) => canonicalValue(i.value, depth + 1)).join(', ')}]`
    }
    case 'set': {
      const live = v.items.filter((i) => !i.value.meta?.tombstone)
      return `{${live.map((i) => canonicalValue(i.value, depth + 1)).join(', ')}}`
    }
    case 'counter':
      return String(v.total)
    case 'clock':
      return compactClock(v.entries)
    case 'table':
      return `${v.rows.length}×${v.columns.length}`
    case 'bytes':
      return v.bytes.map((b) => b.toString(16).padStart(2, '0')).join('')
    case 'text':
      return v.text
    case 'pattern':
      return v.tokens.map((t) => t.src).join('')
    case 'meter':
      return v.max === undefined ? String(v.value) : `${v.value}/${v.max}`
  }
}

/** ≤ 24-character summary for the chip (nested collections collapse to `{…}` / `[…]`). */
export function summarizeValue(v: Value): string {
  let s: string
  switch (v.kind) {
    case 'record':
      s = `{${v.fields
        .map((f) => `${f.key}: ${f.value.kind === 'scalar' ? scalarText(f.value) : '…'}`)
        .join(', ')}}`
      break
    case 'list':
    case 'set': {
      const live = v.items.filter((i) => !i.value.meta?.tombstone)
      if (v.kind === 'list' && v.display === 'text') {
        s = live.map((i) => canonicalValue(i.value)).join('')
        break
      }
      const shown = live.slice(0, LIMITS.maxVisibleItems)
      const parts = shown.map((i) => (i.value.kind === 'scalar' ? scalarText(i.value) : '…'))
      if (live.length > shown.length) parts.push(`+${live.length - shown.length}`)
      s = v.kind === 'list' ? `[${parts.join(', ')}]` : `{${parts.join(', ')}}`
      break
    }
    default:
      s = canonicalValue(v)
  }
  return middleEllipsis(s)
}

/** Short type chip text ("LWW", "OR-Set") for `meta.type`. */
export const CRDT_SHORT: Record<CrdtName, string> = {
  'max-register': 'Max',
  'lww-register': 'LWW',
  'lww-map': 'LWW map',
  'mv-register': 'MV',
  'g-counter': 'G-Counter',
  'pn-counter': 'PN-Counter',
  'op-counter': 'Op-Counter',
  'g-set': 'G-Set',
  'two-phase-set': '2P-Set',
  'lww-element-set': 'LWW-Set',
  'or-set': 'OR-Set',
  rga: 'RGA',
  'lamport-clock': 'Lamport',
  'vector-clock': 'Vector',
  hlc: 'HLC',
}
