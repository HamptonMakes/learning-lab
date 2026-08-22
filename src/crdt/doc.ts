/**
 * Composed documents — CRDT parts nested in maps, lists and sets, merged part by part.
 *
 * Plain words: a real document is rarely one register. A shopping list is a title (an LWW
 * register) plus a set of items, and each item is a name (register) plus a quantity (counter). A
 * composed document is exactly that: a *schema* says what lives where, and every part is one of the
 * registered leaf types, or a fixed label, or a container of parts:
 *
 *   - `{ map: { field: Schema } }`   fixed fields, each its own part; merged field by field.
 *   - `{ set: Schema }`              an OR-Set of sub-documents. `add(init?)` creates a sub-document
 *                                    whose id is the Dot of the add (so the id doubles as the op id);
 *                                    `remove(id)` tombstones its tag. Add-wins, like the OR-Set.
 *   - `{ list: Schema }`             an RGA of sub-documents, in sequence order. `insertAfter`,
 *                                    `insertAt`, `delete` (and `deleteAt`) — ids are Dots too.
 *   - `{ const: scalar }`            an immutable label (a poll question). Never updated.
 *   - `'lww-register'` / `{ type, args? }`  a leaf: the real CRDT from the registry.
 *
 * The state is a tree that mirrors the schema. Container parts are backed by the real OR-Set
 * (`membership`, element = the sub-document id) and the real RGA (`seq`, element = the id), plus a
 * `subs` table id → sub-document. Tombstoned members keep their sub-document (a concurrent edit to a
 * removed item still has somewhere to land, and the stage can show it dimmed). Merge is a join of
 * joins: leaves merge with their own `merge`, membership with the OR-Set's, order with the RGA's,
 * and `subs` key-wise (a sub-document only one side knows is copied) — so every law a leaf obeys,
 * the document obeys.
 *
 * Updates are routed by a path (`'title'`, `'items[alice:1].qty'`; `''` = root): `.key` steps into
 * a map field, `[id]` into a sub-document. The op is a string from the per-type vocabulary
 * (`set`, `inc`, `add`, `insertAt`, … see `leafUpdateFor`) plus positional args, i.e. exactly what
 * a `crdt.update` command carries. For a set/list `add`/`insert`, `init` (`Record<field, Scalar>`,
 * dotted keys allowed) writes the named *register* leaves of the new sub-document with the adder's
 * stamp; counters start at 0, nested sets/lists empty. The doc op carries the membership op and
 * the real leaf ops of that init, so `effect` at any replica recreates the sub-document exactly.
 *
 * One `ctx.nextSeq()` call per add/insert mints the sub-document id; the membership op (OR-Set tag
 * / RGA element id) reuses the same number, so the reducer's op id and the sub-document id coincide.
 *
 * Sidecar for the stage: `docParts(state)` walks the tree in canonical order (map fields by key,
 * set members by id, list elements in sequence order) with each part's path, kind, backing type
 * and real state, and an `alive` flag for parts inside removed members; `docPartAt(state, path)`
 * picks one. Values: map → object, leaf → its value, const → the scalar, set/list → arrays of
 * `{ id, ...fields }` (or `{ id, value }` for non-map items), visible members only.
 */
import { canonicalJson, sortRecord, sortedEntries } from './g-set'
import { orSet, orSetRows, type OrSetOp, type OrSetState } from './or-set'
import { rga, rgaRows, rgaVisibleIds, type RgaAnchor, type RgaOp, type RgaState } from './rga'
import { crdtRegistry, isCrdtName, type AnyCrdtType, type CrdtName } from './registry'
import { dot, parseDot, type CrdtType, type Ctx, type Dot, type NodeId } from './types'

// ---------------------------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------------------------

export type Scalar = string | number | boolean | null

/** Every registered leaf type — anything in the registry; the document itself is not a leaf. */
export type CrdtLeafName = CrdtName

/** What lives where. Mirrors `CrdtSchema` in docs/animation-dsl.md §5.1 (defined here to keep
 *  `src/crdt` free of lesson imports). */
export type DocSchema =
  | CrdtLeafName
  | { type: CrdtLeafName; args?: Record<string, unknown> }
  | { const: Scalar }
  | { map: Record<string, DocSchema> }
  | { list: DocSchema }
  | { set: DocSchema }

export interface DocArgs {
  schema: DocSchema
}

// ---------------------------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------------------------

export type DocPart =
  /** A registered CRDT; `state` is that type's real state. */
  | { kind: 'leaf'; type: CrdtLeafName; state: unknown }
  | { kind: 'const'; value: Scalar }
  /** Fixed fields, keys sorted. */
  | { kind: 'map'; fields: Record<string, DocPart> }
  /** Membership is a real OR-Set of ids; `subs` holds every sub-document ever created (sorted). */
  | { kind: 'set'; membership: OrSetState<Dot>; subs: Record<Dot, DocPart> }
  /** Order is a real RGA of ids; tombstoned elements keep their sub-document. */
  | { kind: 'list'; seq: RgaState<Dot>; subs: Record<Dot, DocPart> }

export type DocPartKind = DocPart['kind']

export interface DocState {
  /** The (normalized) schema this document was built from; replicas must agree on it. */
  schema: DocSchema
  root: DocPart
}

// ---------------------------------------------------------------------------------------------
// Updates and ops
// ---------------------------------------------------------------------------------------------

/** What a `crdt.update` command carries: a path to the part, an op name and positional args. */
export interface DocUpdate {
  /** `''` or omitted = the root. Segments: `.key` (map field), `[id]` (sub-document). */
  path?: string
  op: string
  args?: readonly unknown[]
}

/** A new sub-document as carried inside an add/insert op, so every replica recreates it alike. */
export interface DocSubOp {
  id: Dot
  /** The adder's `init` argument (what the op label shows). */
  init: Record<string, Scalar>
  /** The real leaf ops that `init` produced, with paths relative to the sub-document root. */
  ops: Array<{ path: string; op: unknown }>
}

export type DocOp =
  /** An op of the leaf at `path`, produced by that leaf type's `prepare`. */
  | { kind: 'leaf'; path: string; op: unknown }
  /** A membership op of the set at `path`; `sub` is present for adds. */
  | { kind: 'set'; path: string; op: OrSetOp<Dot>; sub?: DocSubOp }
  /** A sequence op of the list at `path`; `sub` is present for inserts. */
  | { kind: 'list'; path: string; op: RgaOp<Dot>; sub?: DocSubOp }

/** JSON composed from the parts' values (see the header). */
export type DocValue = unknown

export type DocCrdt = CrdtType<DocState, DocUpdate, DocOp, DocValue, DocArgs>

// ---------------------------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------------------------

export type DocPathSegment = { key: string } | { id: Dot }

/** `'items[alice:1].qty'` → `[{ key: 'items' }, { id: 'alice:1' }, { key: 'qty' }]`; `''` → `[]`. */
export function parseDocPath(path: string): DocPathSegment[] {
  const segs: DocPathSegment[] = []
  let i = 0
  while (i < path.length) {
    const c = path[i]
    if (c === '[') {
      const end = path.indexOf(']', i)
      if (end < 0) throw new Error(`doc: bad path "${path}" — "[" without "]"`)
      const id = path.slice(i + 1, end)
      if (!id.includes(':')) throw new Error(`doc: bad path "${path}" — "[${id}]" is not an id`)
      segs.push({ id: id as Dot })
      i = end + 1
      continue
    }
    if (c === '.') {
      if (i === 0) throw new Error(`doc: bad path "${path}" — cannot start with "."`)
      i += 1
    } else if (segs.length > 0) {
      throw new Error(`doc: bad path "${path}" — expected "." or "[" at ${i}`)
    }
    let j = i
    while (j < path.length && path[j] !== '.' && path[j] !== '[') j += 1
    if (j === i) throw new Error(`doc: bad path "${path}" — empty field name at ${i}`)
    segs.push({ key: path.slice(i, j) })
    i = j
  }
  return segs
}

/** The inverse of `parseDocPath`. */
export function formatDocPath(segs: readonly DocPathSegment[]): string {
  let out = ''
  for (const seg of segs) {
    if ('id' in seg) out += `[${seg.id}]`
    else out += out === '' ? seg.key : `.${seg.key}`
  }
  return out
}

function joinPath(path: string, seg: DocPathSegment): string {
  return formatDocPath([...parseDocPath(path), seg])
}

// ---------------------------------------------------------------------------------------------
// Schema helpers
// ---------------------------------------------------------------------------------------------

function leafTypeOf(name: CrdtLeafName): AnyCrdtType {
  const type = crdtRegistry[name]
  if (!type) throw new Error(`doc: unknown leaf type "${String(name)}"`)
  return type
}

function isScalar(v: unknown): v is Scalar {
  return v === null || typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean'
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** Validate a schema and return it in canonical form (map keys sorted). Throws on bad shapes. */
export function normalizeDocSchema(schema: DocSchema, at = ''): DocSchema {
  const where = at === '' ? 'root' : `"${at}"`
  if (typeof schema === 'string') {
    if (!isCrdtName(schema)) throw new Error(`doc schema at ${where}: unknown type "${schema}"`)
    return schema
  }
  if (!isRecord(schema)) throw new Error(`doc schema at ${where}: not a schema`)
  if ('type' in schema) {
    if (!isCrdtName(schema.type)) {
      throw new Error(`doc schema at ${where}: unknown type "${String(schema.type)}"`)
    }
    return schema.args === undefined
      ? { type: schema.type }
      : { type: schema.type, args: schema.args }
  }
  if ('const' in schema) {
    if (!isScalar(schema.const)) throw new Error(`doc schema at ${where}: const must be a scalar`)
    return { const: schema.const }
  }
  if ('map' in schema) {
    if (!isRecord(schema.map)) throw new Error(`doc schema at ${where}: map must be an object`)
    const fields: Record<string, DocSchema> = {}
    for (const [key, sub] of sortedEntries(schema.map)) {
      if (key === '' || /[.[\]]/.test(key)) {
        throw new Error(`doc schema at ${where}: bad field name "${key}" (no ".", "[" or "]")`)
      }
      fields[key] = normalizeDocSchema(sub, at === '' ? key : `${at}.${key}`)
    }
    return { map: fields }
  }
  if ('list' in schema) return { list: normalizeDocSchema(schema.list, `${at}[…]`) }
  if ('set' in schema) return { set: normalizeDocSchema(schema.set, `${at}[…]`) }
  throw new Error(
    `doc schema at ${where}: expected a type name, { type }, { const }, { map }, { list } or { set }`,
  )
}

/** The schema of the part at `path` (throws when the path does not fit the schema). */
export function docSchemaAt(schema: DocSchema, path: string): DocSchema {
  let s = schema
  for (const seg of parseDocPath(path)) {
    if ('key' in seg) {
      const next = typeof s !== 'string' && 'map' in s ? s.map[seg.key] : undefined
      if (!next) throw new Error(`doc: path "${path}" does not fit the schema at "${seg.key}"`)
      s = next
    } else {
      if (typeof s === 'string' || !('set' in s || 'list' in s)) {
        throw new Error(`doc: path "${path}" does not fit the schema at "[${seg.id}]"`)
      }
      s = 'set' in s ? s.set : s.list
    }
  }
  return s
}

/** The item schema of a set/list schema. */
function itemSchemaOf(schema: DocSchema, path: string): DocSchema {
  if (typeof schema !== 'string') {
    if ('set' in schema) return schema.set
    if ('list' in schema) return schema.list
  }
  throw new Error(`doc: the schema at "${path}" is not a set or list`)
}

/** An empty part for `schema`, for replica `node`. */
function initPart(schema: DocSchema, node: NodeId): DocPart {
  if (typeof schema === 'string') {
    return { kind: 'leaf', type: schema, state: leafTypeOf(schema).init(node, undefined) }
  }
  if ('type' in schema) {
    return {
      kind: 'leaf',
      type: schema.type,
      state: leafTypeOf(schema.type).init(node, schema.args),
    }
  }
  if ('const' in schema) return { kind: 'const', value: schema.const }
  if ('map' in schema) {
    const fields: Record<string, DocPart> = {}
    for (const [key, sub] of sortedEntries(schema.map)) fields[key] = initPart(sub, node)
    return { kind: 'map', fields }
  }
  if ('list' in schema) return { kind: 'list', seq: rga.init<Dot>(node), subs: {} }
  return { kind: 'set', membership: orSet.init<Dot>(node), subs: {} }
}

// ---------------------------------------------------------------------------------------------
// Tree helpers
// ---------------------------------------------------------------------------------------------

function partAt(part: DocPart, segs: readonly DocPathSegment[]): DocPart | undefined {
  let p: DocPart | undefined = part
  for (const seg of segs) {
    if (!p) return undefined
    if ('key' in seg) p = p.kind === 'map' ? p.fields[seg.key] : undefined
    else p = p.kind === 'set' || p.kind === 'list' ? p.subs[seg.id] : undefined
  }
  return p
}

/** Rebuild the spine from the root to `segs`, replacing the part there by `fn(part)`. Returns the
 *  same root when `fn` returns the same part. Throws when the path does not resolve. */
function replaceAt(
  part: DocPart,
  segs: readonly DocPathSegment[],
  i: number,
  path: string,
  fn: (p: DocPart) => DocPart,
): DocPart {
  const seg = segs[i]
  if (seg === undefined) return fn(part)
  if ('key' in seg) {
    if (part.kind !== 'map') {
      throw new Error(
        `doc: path "${path}" — "${seg.key}" is a field but the part is a ${part.kind}`,
      )
    }
    const child = part.fields[seg.key]
    if (!child) throw new Error(`doc: path "${path}" — no field "${seg.key}"`)
    const next = replaceAt(child, segs, i + 1, path, fn)
    return next === child ? part : { kind: 'map', fields: { ...part.fields, [seg.key]: next } }
  }
  if (part.kind !== 'set' && part.kind !== 'list') {
    throw new Error(`doc: path "${path}" — "[${seg.id}]" is an id but the part is a ${part.kind}`)
  }
  const child = part.subs[seg.id]
  if (!child) {
    throw new Error(
      `doc: path "${path}" — no sub-document ${seg.id} here (not created yet; ops must be delivered causally)`,
    )
  }
  const next = replaceAt(child, segs, i + 1, path, fn)
  return next === child ? part : { ...part, subs: { ...part.subs, [seg.id]: next } }
}

// ---------------------------------------------------------------------------------------------
// Op vocabulary (what `crdt.update.op` + `args` mean for each leaf type)
// ---------------------------------------------------------------------------------------------

/** Leaf types whose `set(v)` an add/insert `init` may write. */
export const REGISTER_LEAF_TYPES: ReadonlySet<CrdtLeafName> = new Set<CrdtLeafName>([
  'max-register',
  'lww-register',
  'mv-register',
])

/**
 * Translate a named op with positional args into the leaf type's own Update object, following the
 * per-type vocabulary of docs/animation-dsl.md §5.1:
 *
 *   max-register / lww-register / mv-register   set(v)
 *   lww-map                                     set(key, v) · remove(key)
 *   g-counter                                   inc(n = 1)
 *   pn-counter                                  inc(n = 1) · dec(n = 1)
 *   op-counter                                  inc(n = 1) · dec(n = 1)
 *   g-set                                       add(e)
 *   two-phase-set / lww-element-set / or-set    add(e) · remove(e)
 *   rga                                         insertAfter(anchor, v) · insertAt(i, v) · delete(id) · deleteAt(i)
 *   lamport-clock / vector-clock                tick() · receive(remote)
 *   hlc                                         tick()
 *
 * Throws on an unknown op or a wrong number of args; value checks are left to the leaf (it throws
 * its own RangeError for e.g. a non-integer increment). The reducer uses this for plain slots too.
 */
export function leafUpdateFor(type: CrdtLeafName, op: string, args: readonly unknown[]): unknown {
  /** Check the arg count, then build the leaf update. */
  const take = (min: number, max: number, build: () => unknown): unknown => {
    if (args.length < min || args.length > max) {
      const n = min === max ? `${min}` : `${min}–${max}`
      throw new Error(`doc: ${type}.${op} takes ${n} argument(s), got ${args.length}`)
    }
    return build()
  }
  const delta = (v: unknown): number => (typeof v === 'number' ? v : Number.NaN)
  switch (type) {
    case 'max-register':
    case 'lww-register':
    case 'mv-register':
      if (op === 'set') return take(1, 1, () => ({ set: args[0] }))
      break
    case 'lww-map':
      if (op === 'set') return take(2, 2, () => ({ key: String(args[0]), set: args[1] }))
      if (op === 'remove') return take(1, 1, () => ({ key: String(args[0]), remove: true }))
      break
    case 'g-counter':
      if (op === 'inc') return take(0, 1, () => ({ inc: args[0] ?? 1 }))
      break
    case 'pn-counter':
      if (op === 'inc') return take(0, 1, () => ({ inc: args[0] ?? 1 }))
      if (op === 'dec') return take(0, 1, () => ({ dec: args[0] ?? 1 }))
      break
    case 'op-counter':
      if (op === 'inc') return take(0, 1, () => ({ add: delta(args[0] ?? 1) }))
      if (op === 'dec') return take(0, 1, () => ({ add: -delta(args[0] ?? 1) }))
      break
    case 'g-set':
      if (op === 'add') return take(1, 1, () => ({ add: args[0] }))
      break
    case 'two-phase-set':
    case 'lww-element-set':
    case 'or-set':
      if (op === 'add') return take(1, 1, () => ({ add: args[0] }))
      if (op === 'remove') return take(1, 1, () => ({ remove: args[0] }))
      break
    case 'rga':
      if (op === 'insertAfter') return take(2, 2, () => ({ insertAfter: args[0], value: args[1] }))
      if (op === 'insertAt') return take(2, 2, () => ({ insertAt: args[0], value: args[1] }))
      if (op === 'delete') return take(1, 1, () => ({ delete: args[0] }))
      if (op === 'deleteAt') return take(1, 1, () => ({ deleteAt: args[0] }))
      break
    case 'lamport-clock':
    case 'vector-clock':
      if (op === 'tick') return take(0, 0, () => ({ tick: true }))
      if (op === 'receive') return take(1, 1, () => ({ receive: args[0] }))
      break
    case 'hlc':
      if (op === 'tick') return take(0, 0, () => ({ tick: true }))
      break
  }
  throw new Error(`doc: unknown op "${op}" for ${type}`)
}

// ---------------------------------------------------------------------------------------------
// Sub-documents
// ---------------------------------------------------------------------------------------------

/** A ctx whose `nextSeq()` always returns the number already minted for this update. */
function fixedSeq(ctx: Ctx, seq: number): Ctx {
  return { node: ctx.node, ts: ctx.ts, nextSeq: () => seq }
}

function parseInit(arg: unknown, what: string): Record<string, Scalar> {
  if (arg === undefined) return {}
  if (!isRecord(arg)) throw new Error(`doc: ${what} init must be an object of scalars`)
  const init: Record<string, Scalar> = {}
  for (const [key, v] of sortedEntries(arg)) {
    if (!isScalar(v)) {
      throw new Error(
        `doc: ${what} init.${key} must be a scalar (use a dotted key like "a.b" for nested fields)`,
      )
    }
    init[key] = v
  }
  return init
}

/** The leaf type name of a schema node, or undefined for const/map/set/list. */
function leafNameOf(schema: DocSchema): CrdtLeafName | undefined {
  if (typeof schema === 'string') return schema
  return 'type' in schema ? schema.type : undefined
}

/** Every `init` key must name a register leaf of the item schema (checked before a seq is minted). */
function checkInitTargets(itemSchema: DocSchema, init: Record<string, Scalar>, what: string): void {
  for (const key of Object.keys(init)) {
    let target: DocSchema
    try {
      target = docSchemaAt(itemSchema, key)
    } catch {
      throw new Error(`doc: ${what} init.${key} names no part of the item schema`)
    }
    const name = leafNameOf(target)
    if (!name || !REGISTER_LEAF_TYPES.has(name)) {
      throw new Error(
        `doc: ${what} init.${key} is not a register (${name ?? Object.keys(target)[0]}); init sets registers only`,
      )
    }
  }
}

function parseId(arg: unknown, what: string): Dot {
  if (typeof arg !== 'string' || !arg.includes(':')) {
    throw new Error(`doc: ${what} needs a sub-document id like "alice:1", got ${String(arg)}`)
  }
  return arg as Dot
}

function parseAnchor(arg: unknown): RgaAnchor {
  return arg === 'HEAD' ? 'HEAD' : parseId(arg, 'insertAfter')
}

/** Build the sub-document op for a new member: the real leaf ops that `init` produces. */
function prepareSub(
  itemSchema: DocSchema,
  id: Dot,
  init: Record<string, Scalar>,
  ctx: Ctx,
): DocSubOp {
  let part = initPart(itemSchema, parseDot(id).node)
  const ops: DocSubOp['ops'] = []
  for (const [key, v] of sortedEntries(init)) {
    const segs = parseDocPath(key)
    part = replaceAt(part, segs, 0, key, (leaf) => {
      if (leaf.kind !== 'leaf') throw new Error(`doc: init.${key} is not a leaf`) // checked upstream
      const type = leafTypeOf(leaf.type)
      const op = type.prepare(leaf.state, { set: v }, ctx)
      ops.push({ path: key, op })
      return { ...leaf, state: type.effect(leaf.state, op) }
    })
  }
  return { id, init, ops }
}

/** Recreate a sub-document from its op: fresh parts for the creator, then the carried leaf ops. */
function recreateSub(itemSchema: DocSchema, sub: DocSubOp): DocPart {
  let part = initPart(itemSchema, parseDot(sub.id).node)
  for (const { path, op } of sub.ops) {
    part = replaceAt(part, parseDocPath(path), 0, path, (leaf) => {
      if (leaf.kind !== 'leaf') throw new Error(`doc: sub-document op at "${path}" is not a leaf`)
      return { ...leaf, state: leafTypeOf(leaf.type).effect(leaf.state, op) }
    })
  }
  return part
}

function withSub(subs: Record<Dot, DocPart>, sub: DocSubOp | undefined, itemSchema: DocSchema) {
  if (!sub || subs[sub.id]) return subs // already created here: keep it (it may have newer edits)
  return sortRecord({ ...subs, [sub.id]: recreateSub(itemSchema, sub) }) as Record<Dot, DocPart>
}

// ---------------------------------------------------------------------------------------------
// prepare / effect
// ---------------------------------------------------------------------------------------------

function prepareAt(state: DocState, u: DocUpdate, ctx: Ctx): DocOp {
  const path = u.path ?? ''
  const args = u.args ?? []
  const segs = parseDocPath(path)
  const part = partAt(state.root, segs)
  if (!part) throw new Error(`doc: path "${path}" does not resolve`)
  const arity = (min: number, max = min) => {
    if (args.length < min || args.length > max) {
      throw new Error(
        `doc: ${u.op} at "${path}" takes ${min === max ? min : `${min}–${max}`} argument(s), got ${args.length}`,
      )
    }
  }
  switch (part.kind) {
    case 'leaf': {
      const type = leafTypeOf(part.type)
      return {
        kind: 'leaf',
        path,
        op: type.prepare(part.state, leafUpdateFor(part.type, u.op, args), ctx),
      }
    }
    case 'const':
      throw new Error(`doc: "${path}" is a const; it cannot be updated`)
    case 'map':
      throw new Error(`doc: "${path}" is a map; address one of its fields`)
    case 'set': {
      const itemSchema = itemSchemaOf(docSchemaAt(state.schema, path), path)
      if (u.op === 'add') {
        arity(0, 1)
        const init = parseInit(args[0], 'add')
        checkInitTargets(itemSchema, init, 'add')
        const seq = ctx.nextSeq()
        const id = dot(ctx.node, seq)
        const once = fixedSeq(ctx, seq)
        const op = orSet.prepare(part.membership, { add: id }, once) // tag === id
        return { kind: 'set', path, op, sub: prepareSub(itemSchema, id, init, once) }
      }
      if (u.op === 'remove') {
        arity(1)
        const id = parseId(args[0], 'remove')
        return { kind: 'set', path, op: orSet.prepare(part.membership, { remove: id }, ctx) }
      }
      throw new Error(`doc: unknown op "${u.op}" for a set (use add(init?) or remove(id))`)
    }
    case 'list': {
      const itemSchema = itemSchemaOf(docSchemaAt(state.schema, path), path)
      if (u.op === 'insertAfter' || u.op === 'insertAt') {
        arity(1, 2)
        const init = parseInit(args[1], u.op)
        checkInitTargets(itemSchema, init, u.op)
        const where =
          u.op === 'insertAfter'
            ? { insertAfter: parseAnchor(args[0]) }
            : { insertAt: num(args[0], `${u.op} index`) }
        const seq = ctx.nextSeq()
        const id = dot(ctx.node, seq)
        const once = fixedSeq(ctx, seq)
        const op = rga.prepare<Dot>(part.seq, { ...where, value: id }, once) // element id === id
        return { kind: 'list', path, op, sub: prepareSub(itemSchema, id, init, once) }
      }
      if (u.op === 'delete') {
        arity(1)
        return {
          kind: 'list',
          path,
          op: rga.prepare<Dot>(part.seq, { delete: parseId(args[0], 'delete') }, ctx),
        }
      }
      if (u.op === 'deleteAt') {
        arity(1)
        return {
          kind: 'list',
          path,
          op: rga.prepare<Dot>(part.seq, { deleteAt: num(args[0], 'deleteAt index') }, ctx),
        }
      }
      throw new Error(
        `doc: unknown op "${u.op}" for a list (use insertAfter(anchor, init?), insertAt(i, init?), delete(id) or deleteAt(i))`,
      )
    }
  }
}

function num(v: unknown, what: string): number {
  if (typeof v !== 'number' || !Number.isInteger(v)) {
    throw new Error(`doc: ${what} must be an integer, got ${String(v)}`)
  }
  return v
}

function effectAt(state: DocState, op: DocOp): DocState {
  const segs = parseDocPath(op.path)
  const root = replaceAt(state.root, segs, 0, op.path, (part) => {
    switch (op.kind) {
      case 'leaf': {
        if (part.kind !== 'leaf')
          throw new Error(`doc: leaf op at "${op.path}" but the part is a ${part.kind}`)
        const next = leafTypeOf(part.type).effect(part.state, op.op)
        return next === part.state ? part : { ...part, state: next }
      }
      case 'set': {
        if (part.kind !== 'set')
          throw new Error(`doc: set op at "${op.path}" but the part is a ${part.kind}`)
        const membership = orSet.effect(part.membership, op.op)
        const subs = withSub(
          part.subs,
          op.sub,
          itemSchemaOf(docSchemaAt(state.schema, op.path), op.path),
        )
        if (membership === part.membership && subs === part.subs) return part
        return { kind: 'set', membership, subs }
      }
      case 'list': {
        if (part.kind !== 'list')
          throw new Error(`doc: list op at "${op.path}" but the part is a ${part.kind}`)
        const seq = rga.effect(part.seq, op.op)
        const subs = withSub(
          part.subs,
          op.sub,
          itemSchemaOf(docSchemaAt(state.schema, op.path), op.path),
        )
        if (seq === part.seq && subs === part.subs) return part
        return { kind: 'list', seq, subs }
      }
    }
  })
  return root === state.root ? state : { schema: state.schema, root }
}

// ---------------------------------------------------------------------------------------------
// merge / value / equals
// ---------------------------------------------------------------------------------------------

function mergeSubs(a: Record<Dot, DocPart>, b: Record<Dot, DocPart>): Record<Dot, DocPart> {
  const out: Record<string, DocPart> = {}
  for (const id of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const x = a[id as Dot]
    const y = b[id as Dot]
    out[id] = x && y ? mergePart(x, y) : ((x ?? y) as DocPart)
  }
  return sortRecord(out) as Record<Dot, DocPart>
}

function mismatch(a: DocPart, b: DocPart): Error {
  return new Error(`doc: cannot merge a ${a.kind} part with a ${b.kind} part (different schemas?)`)
}

function mergePart(a: DocPart, b: DocPart): DocPart {
  if (a === b) return a
  switch (a.kind) {
    case 'const':
      if (b.kind !== 'const') throw mismatch(a, b)
      return a
    case 'leaf': {
      if (b.kind !== 'leaf' || b.type !== a.type) throw mismatch(a, b)
      const state = leafTypeOf(a.type).merge(a.state, b.state)
      return state === a.state ? a : { ...a, state }
    }
    case 'map': {
      if (b.kind !== 'map') throw mismatch(a, b)
      const fields: Record<string, DocPart> = {}
      let changed = false
      for (const [key, x] of sortedEntries(a.fields)) {
        const y = b.fields[key]
        if (!y) throw new Error(`doc: cannot merge — the other side has no field "${key}"`)
        const m = mergePart(x, y)
        if (m !== x) changed = true
        fields[key] = m
      }
      return changed ? { kind: 'map', fields } : a
    }
    case 'set':
      if (b.kind !== 'set') throw mismatch(a, b)
      return {
        kind: 'set',
        membership: orSet.merge(a.membership, b.membership),
        subs: mergeSubs(a.subs, b.subs),
      }
    case 'list':
      if (b.kind !== 'list') throw mismatch(a, b)
      return { kind: 'list', seq: rga.merge(a.seq, b.seq), subs: mergeSubs(a.subs, b.subs) }
  }
}

function memberValue(id: Dot, subs: Record<Dot, DocPart>): unknown {
  const sub = subs[id]
  if (!sub) throw new Error(`doc: state is inconsistent — member ${id} has no sub-document`)
  const v = partValue(sub)
  return sub.kind === 'map' ? { id, ...(v as Record<string, unknown>) } : { id, value: v }
}

function partValue(part: DocPart): unknown {
  switch (part.kind) {
    case 'leaf':
      return leafTypeOf(part.type).value(part.state)
    case 'const':
      return part.value
    case 'map': {
      const out: Record<string, unknown> = {}
      for (const [key, p] of sortedEntries(part.fields)) out[key] = partValue(p)
      return out
    }
    case 'set':
      return orSet.value(part.membership).map((id) => memberValue(id, part.subs))
    case 'list':
      return rgaVisibleIds(part.seq).map((id) => memberValue(id, part.subs))
  }
}

function sameSubs(a: Record<Dot, DocPart>, b: Record<Dot, DocPart>): boolean {
  const ka = Object.keys(a)
  const kb = Object.keys(b)
  if (ka.length !== kb.length) return false
  return ka.every((id) => {
    const y = b[id as Dot]
    return y !== undefined && partEquals(a[id as Dot] as DocPart, y)
  })
}

/** Part equality: leaves by their own `equals` when they define one, else canonical JSON. */
function partEquals(a: DocPart, b: DocPart): boolean {
  if (a === b) return true
  if (a.kind !== b.kind) return false
  switch (a.kind) {
    case 'const':
      return b.kind === 'const' && a.value === b.value
    case 'leaf': {
      if (b.kind !== 'leaf' || b.type !== a.type) return false
      const eq = leafTypeOf(a.type).equals
      return eq ? eq(a.state, b.state) : canonicalJson(a.state) === canonicalJson(b.state)
    }
    case 'map': {
      if (b.kind !== 'map') return false
      const ka = Object.keys(a.fields)
      if (ka.length !== Object.keys(b.fields).length) return false
      return ka.every((k) => {
        const y = b.fields[k]
        return y !== undefined && partEquals(a.fields[k] as DocPart, y)
      })
    }
    case 'set':
      return (
        b.kind === 'set' &&
        canonicalJson(a.membership) === canonicalJson(b.membership) &&
        sameSubs(a.subs, b.subs)
      )
    case 'list':
      return (
        b.kind === 'list' &&
        canonicalJson(a.seq) === canonicalJson(b.seq) &&
        sameSubs(a.subs, b.subs)
      )
  }
}

// ---------------------------------------------------------------------------------------------
// The CRDT
// ---------------------------------------------------------------------------------------------

export const docCrdt: DocCrdt = {
  name: 'doc',

  init(node: NodeId, args: DocArgs): DocState {
    const schema = normalizeDocSchema(args.schema)
    return { schema, root: initPart(schema, node) }
  },

  update(state: DocState, u: DocUpdate, ctx: Ctx): DocState {
    return effectAt(state, prepareAt(state, u, ctx))
  },

  prepare: prepareAt,

  effect: effectAt,

  /** Part-by-part join. Throws if the two documents were built from different schemas. */
  merge(a: DocState, b: DocState): DocState {
    if (canonicalJson(a.schema) !== canonicalJson(b.schema)) {
      throw new Error('doc: cannot merge documents with different schemas')
    }
    const root = mergePart(a.root, b.root)
    return root === a.root ? a : { schema: a.schema, root }
  },

  value(state: DocState): DocValue {
    return partValue(state.root)
  },

  equals: docEquals,
}

/** Same schema and equal parts — leaves by their own `equals` when they define one (clocks), else
 *  canonical JSON. This is what the law tests compare. */
export function docEquals(a: DocState, b: DocState): boolean {
  return canonicalJson(a.schema) === canonicalJson(b.schema) && partEquals(a.root, b.root)
}

// ---------------------------------------------------------------------------------------------
// Helpers for the lesson view layer
// ---------------------------------------------------------------------------------------------

export interface DocPartEntry {
  /** `''` for the root; `'items[alice:1].qty'` for nested parts. */
  path: string
  kind: DocPartKind
  /** The CRDT backing this part: the leaf's type, `'or-set'` for a set, `'rga'` for a list. */
  type?: CrdtLeafName
  /** The real state behind `type`: the leaf state, the set's membership, the list's sequence;
   *  the scalar for a const; undefined for a map. */
  state: unknown
  part: DocPart
  /** False inside a removed set member or a deleted list element (the stage may dim those). */
  alive: boolean
}

/** Every part of the document, depth-first in canonical order (map fields by key, set members by
 *  id, list elements in sequence order — tombstoned members included, flagged `alive: false`). */
export function docParts(state: DocState): DocPartEntry[] {
  const out: DocPartEntry[] = []
  const walk = (part: DocPart, path: string, alive: boolean) => {
    switch (part.kind) {
      case 'leaf':
        out.push({ path, kind: 'leaf', type: part.type, state: part.state, part, alive })
        return
      case 'const':
        out.push({ path, kind: 'const', state: part.value, part, alive })
        return
      case 'map':
        out.push({ path, kind: 'map', state: undefined, part, alive })
        for (const [key, p] of sortedEntries(part.fields)) walk(p, joinPath(path, { key }), alive)
        return
      case 'set':
        out.push({ path, kind: 'set', type: 'or-set', state: part.membership, part, alive })
        for (const row of orSetRows(part.membership)) {
          const sub = part.subs[row.e]
          if (sub) walk(sub, joinPath(path, { id: row.e }), alive && row.present)
        }
        return
      case 'list':
        out.push({ path, kind: 'list', type: 'rga', state: part.seq, part, alive })
        for (const row of rgaRows(part.seq)) {
          const sub = part.subs[row.id]
          if (sub) walk(sub, joinPath(path, { id: row.id }), alive && !row.tombstone)
        }
        return
    }
  }
  walk(state.root, '', true)
  return out
}

/** The part at `path`, or undefined when the path does not resolve. */
export function docPartAt(state: DocState, path: string): DocPart | undefined {
  return partAt(state.root, parseDocPath(path))
}
