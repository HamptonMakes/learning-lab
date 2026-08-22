/**
 * Lesson text overlays. Lessons are authored in English inline; other languages supply a flat
 * overlay { "<id chain>.<field>": "translated text" } keyed by stable ids. applyOverlay() returns a
 * translated deep copy; collectStrings() lists every localizable string (to build overlay files).
 */

export const DEFAULT_LOCALIZABLE_FIELDS: readonly string[] = [
  'say',
  'title',
  'summary',
  'label',
  'text',
  'note',
]

export type Overlay = Readonly<Record<string, string>>

export interface LocalizableString {
  /** Dot-joined chain of ids from the root to the owning object, e.g. "lww.scene-1.step-3". */
  path: string
  field: string
  value: string
}

/** The overlay key for a field on the object at `path`. */
export function overlayKey(path: string, field: string): string {
  return `${path}.${field}`
}

type Visit = (path: string, field: string, value: string) => string

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const proto: unknown = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}

/** Deep-copy `node`, calling `visit` for each localizable field on id-bearing objects. */
function walk(node: unknown, path: string, fields: readonly string[], visit: Visit): unknown {
  if (Array.isArray(node)) return node.map((item: unknown) => walk(item, path, fields, visit))
  if (!isPlainObject(node)) return node

  const id = node['id']
  const hasId = typeof id === 'string' && id.length > 0
  const here = hasId ? (path ? `${path}.${id}` : id) : path

  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(node)) {
    const localizable = hasId && key !== 'id' && typeof value === 'string' && fields.includes(key)
    out[key] = localizable ? visit(here, key, value) : walk(value, here, fields, visit)
  }
  return out
}

/**
 * Return a deep copy of `data` where, for every object with a string `id`, each field in `fields`
 * is replaced by overlay["<id chain>.<field>"] when present. Never mutates `data`.
 */
export function applyOverlay<T>(
  data: T,
  overlay: Overlay,
  fields: readonly string[] = DEFAULT_LOCALIZABLE_FIELDS,
): T {
  // walk() preserves shape (same keys, arrays stay arrays), only string values change.
  return walk(
    data,
    '',
    fields,
    (path, field, value) => overlay[overlayKey(path, field)] ?? value,
  ) as T
}

/** List every localizable string in `data`, in document order, with its overlay path. */
export function collectStrings(
  data: unknown,
  fields: readonly string[] = DEFAULT_LOCALIZABLE_FIELDS,
): LocalizableString[] {
  const found: LocalizableString[] = []
  walk(data, '', fields, (path, field, value) => {
    found.push({ path, field, value })
    return value
  })
  return found
}
