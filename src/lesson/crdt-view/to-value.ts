/**
 * `toValue(state, ctx)` per CRDT type and for the composed document (DSL §5.1 table, §5.2
 * ordering rules): real `src/crdt` state → the `Value` tree the stage draws, sidecar → `Meta`.
 *
 * Ordering is part of the contract (Motion never reshuffles rows on a merge): counter rows and
 * clock entries in world `actors` order, then unknown nodes (incl. the pseudo-node `seed`) by id;
 * set items by canonical key; list items in sequence order; map fields by key; MV-Register
 * siblings `s1…` in canonical order. `tombstone` appears only when true. The pseudo-node `seed`
 * stays `seed` (the renderer labels it "init"). `expose` publishes `vc` / `applied` / `stats` on
 * the slot's root meta (an MV-Register root `vc` is always the join of its siblings).
 */
import type { DocPart, DocState } from '../../crdt/doc'
import { gCounter, type GCounterState } from '../../crdt/g-counter'
import { sortedEntries, type GSetState } from '../../crdt/g-set'
import type { Hlc } from '../../crdt/hlc'
import { lwwElementSetRows, type LwwElementSetState } from '../../crdt/lww-element-set'
import { lwwMapFields, type LwwMapState } from '../../crdt/lww-map'
import { lwwIsWritten, type LwwRegisterState } from '../../crdt/lww-register'
import type { MaxRegisterState } from '../../crdt/max-register'
import { mvRegisterClock, type MvRegisterState } from '../../crdt/mv-register'
import type { OpCounterState } from '../../crdt/op-counter'
import { orSetRows, type OrSetState } from '../../crdt/or-set'
import { pnCounterEntries, pnCounter, type PNCounterState } from '../../crdt/pn-counter'
import { rgaRows, type RgaState } from '../../crdt/rga'
import { parseDot } from '../../crdt/types'
import type {
  CrdtArgs,
  CrdtName,
  CrdtSchema,
  CrdtView,
  Item,
  Meta,
  NodeId,
  Value,
  VectorClock,
  ViewCtx,
} from '../types'
import { orderNodes } from './format'
import { fromJson } from './from-json'
import { decodeHlcStamp } from './hlc-stamp'
import { opLabel, opLabelParts, type OpLabelParts } from './op-label'

/** The lesson-side view: the DSL `CrdtView` plus the `before`-aware label functions (§5.2). */
export interface LessonCrdtView extends CrdtView<unknown, unknown> {
  toValue(state: unknown, ctx: ViewCtx): Value
  /** `before` = the state the op was prepared against (counters need it for the delta, docs for the leaf type). */
  opLabel(op: unknown, before?: unknown): string
  opLabelParts(op: unknown, before?: unknown): OpLabelParts
}

// ─── Meta helpers ─────────────────────────────────────────────────────────────────────────────

/** Merge `extra` into `v.meta`, dropping undefined keys; returns `v` itself when nothing is added. */
function withMeta(v: Value, extra: Meta | undefined): Value {
  if (!extra) return v
  const merged: Record<string, unknown> = { ...v.meta }
  let any = false
  for (const [k, val] of Object.entries(extra)) {
    if (val !== undefined) {
      merged[k] = val
      any = true
    }
  }
  return any ? { ...v, meta: merged as Meta } : v
}

/** A version vector with its entries in world order (actors first, then unknown nodes by id). */
export function orderedVc(vc: VectorClock, actors: readonly string[]): VectorClock {
  const out: VectorClock = {}
  for (const node of orderNodes(Object.keys(vc), actors)) out[node] = vc[node] ?? 0
  return out
}

/** The exposed delivery-layer sidecar for the slot's root meta (`expose` in CrdtArgs). */
function exposed(ctx: ViewCtx, stats?: { stored: number; visible: number }): Meta | undefined {
  const meta: Meta = {}
  let any = false
  if (ctx.expose.includes('vc')) {
    meta.vc = orderedVc(ctx.replica.version, ctx.actors)
    any = true
  }
  if (ctx.expose.includes('applied')) {
    meta.applied = [...ctx.replica.applied]
    any = true
  }
  if (ctx.expose.includes('stats') && stats) {
    meta.stats = stats
    any = true
  }
  return any ? meta : undefined
}

/** `Meta.hlc` when the slot's stamps come from an HLC (`args.clock`), decoded from the LWW stamp. */
function hlcMeta(ctx: ViewCtx, ts: number): Meta | undefined {
  return ctx.replica.args.clock && ts >= 0 ? { hlc: decodeHlcStamp(ts) } : undefined
}

function tomb(dead: boolean): Meta | undefined {
  return dead ? { tombstone: true } : undefined
}

function view<S>(type: CrdtName, project: (s: S, ctx: ViewCtx) => Value): LessonCrdtView {
  return {
    toValue: (s, ctx) => project(s as S, ctx),
    opLabel: (op, before) => opLabel(type, op, before),
    opLabelParts: (op, before) => opLabelParts(type, op, before),
  }
}

// ─── Registers ────────────────────────────────────────────────────────────────────────────────

const maxRegisterView = view<MaxRegisterState>('max-register', (s, ctx) =>
  withMeta({ kind: 'scalar', value: s.value }, exposed(ctx)),
)

const lwwRegisterView = view<LwwRegisterState<unknown>>('lww-register', (s, ctx) => {
  const stamp: Meta | undefined = lwwIsWritten(s)
    ? { ts: s.ts, node: s.node, ...hlcMeta(ctx, s.ts) }
    : undefined
  return withMeta(withMeta(fromJson(s.value), stamp), exposed(ctx))
})

const lwwMapView = view<LwwMapState<unknown>>('lww-map', (s, ctx) => {
  const fields = lwwMapFields(s).map((f) => ({
    key: f.key,
    value: withMeta(fromJson(f.value), {
      ts: f.ts,
      node: f.node,
      ...tomb(f.tombstone),
      ...hlcMeta(ctx, f.ts),
    }),
  }))
  return withMeta({ kind: 'record', fields }, exposed(ctx))
})

const mvRegisterView = view<MvRegisterState<unknown>>('mv-register', (s, ctx) => {
  // The root `vc` of an MV-Register is always the join of its siblings (the Dynamo context).
  const ex: Meta = { ...exposed(ctx) }
  delete ex.vc
  if (s.versions.length === 0) return withMeta({ kind: 'scalar', value: null }, ex)
  const only = s.versions[0]
  if (s.versions.length === 1 && only) {
    return withMeta(fromJson(only.value), { vc: orderedVc(only.clock, ctx.actors), ...ex })
  }
  const items: Item[] = s.versions.map((v, i) => ({
    id: `s${i + 1}`,
    value: withMeta(fromJson(v.value), { vc: orderedVc(v.clock, ctx.actors) }),
  }))
  return { kind: 'set', items, meta: { vc: orderedVc(mvRegisterClock(s), ctx.actors), ...ex } }
})

// ─── Counters ─────────────────────────────────────────────────────────────────────────────────

const gCounterView = view<GCounterState>('g-counter', (s, ctx) => {
  const rows = orderNodes(Object.keys(s.counts), ctx.actors).map((node) => ({
    node,
    inc: s.counts[node] ?? 0,
  }))
  return withMeta({ kind: 'counter', rows, total: gCounter.value(s) }, exposed(ctx))
})

const pnCounterView = view<PNCounterState>('pn-counter', (s, ctx) => {
  const entries = pnCounterEntries(s)
  const byNode = new Map(entries.map((e) => [e.node, e] as const))
  const rows = orderNodes(
    entries.map((e) => e.node),
    ctx.actors,
  ).map((node) => {
    const e = byNode.get(node)
    return { node, inc: e?.inc ?? 0, dec: e?.dec ?? 0 }
  })
  return withMeta({ kind: 'counter', rows, total: pnCounter.value(s) }, exposed(ctx))
})

const opCounterView = view<OpCounterState>('op-counter', (s, ctx) =>
  withMeta({ kind: 'scalar', value: s.total }, exposed(ctx)),
)

// ─── Sets ─────────────────────────────────────────────────────────────────────────────────────

const gSetView = view<GSetState<unknown>>('g-set', (s, ctx) =>
  withMeta(
    {
      kind: 'set',
      items: sortedEntries(s.items).map(([id, e]) => ({ id, value: fromJson(e) })),
    },
    exposed(ctx),
  ),
)

const twoPhaseSetView = view<import('../../crdt/two-phase-set').TwoPhaseSetState<unknown>>(
  'two-phase-set',
  (s, ctx) =>
    withMeta(
      {
        kind: 'set',
        items: sortedEntries(s.added).map(([id, e]) => ({
          id,
          value: withMeta(fromJson(e), tomb(Object.hasOwn(s.removed, id))),
        })),
      },
      exposed(ctx),
    ),
)

const lwwElementSetView = view<LwwElementSetState<unknown>>('lww-element-set', (s, ctx) =>
  withMeta(
    {
      kind: 'set',
      items: lwwElementSetRows(s).map((r) => ({
        id: r.key,
        value: withMeta(fromJson(r.e), {
          addTs: r.addTs,
          removeTs: r.removeTs,
          ...tomb(!r.present),
        }),
      })),
    },
    exposed(ctx),
  ),
)

const orSetView = view<OrSetState<unknown>>('or-set', (s, ctx) =>
  withMeta(
    {
      kind: 'set',
      items: orSetRows(s).map((r) => ({
        id: r.key,
        value: withMeta(fromJson(r.e), { tags: r.tags, ...tomb(!r.present) }),
      })),
    },
    exposed(ctx),
  ),
)

// ─── Sequences ────────────────────────────────────────────────────────────────────────────────

function nodeOf(id: string): NodeId {
  return parseDot(id as `${string}:${number}`).node
}

const rgaView = view<RgaState<unknown>>('rga', (s, ctx) => {
  const rows = rgaRows(s)
  let visible = 0
  const items: Item[] = rows.map((r) => {
    if (!r.tombstone) visible += 1
    return {
      id: r.id,
      value: withMeta(fromJson(r.value), { ts: r.ts, node: nodeOf(r.id), ...tomb(r.tombstone) }),
    }
  })
  return withMeta(
    { kind: 'list', items, display: ctx.display ?? 'row' },
    exposed(ctx, { stored: rows.length, visible }),
  )
})

// ─── Clocks ───────────────────────────────────────────────────────────────────────────────────

const lamportView = view<number>('lamport-clock', (s, ctx) =>
  withMeta({ kind: 'scalar', value: s }, exposed(ctx)),
)

const vectorClockView = view<VectorClock>('vector-clock', (s, ctx) =>
  withMeta({ kind: 'clock', entries: orderedVc(s, ctx.actors) }, exposed(ctx)),
)

const hlcView = view<Hlc>('hlc', (s, ctx) =>
  withMeta(
    {
      kind: 'record',
      fields: [
        { key: 'wall', value: { kind: 'scalar', value: s.wall } },
        { key: 'counter', value: { kind: 'scalar', value: s.counter } },
      ],
    },
    exposed(ctx),
  ),
)

// ─── Composed document ────────────────────────────────────────────────────────────────────────

/** Leaf args of a schema node (`'rga'` → `{}`, `{ type, args }` → args). */
function argsOf(schema: CrdtSchema | undefined): CrdtArgs {
  if (schema === undefined || typeof schema === 'string') return {}
  return 'type' in schema ? (schema.args ?? {}) : {}
}

function fieldSchema(schema: CrdtSchema | undefined, key: string): CrdtSchema | undefined {
  return schema !== undefined && typeof schema !== 'string' && 'map' in schema
    ? schema.map[key]
    : undefined
}

function itemSchema(schema: CrdtSchema | undefined): CrdtSchema | undefined {
  if (schema === undefined || typeof schema === 'string') return undefined
  if ('set' in schema) return schema.set
  if ('list' in schema) return schema.list
  return undefined
}

function partValue(part: DocPart, schema: CrdtSchema | undefined, ctx: ViewCtx): Value {
  switch (part.kind) {
    case 'const':
      return { kind: 'scalar', value: part.value }
    case 'leaf': {
      const args = argsOf(schema)
      const sub: ViewCtx = {
        actors: ctx.actors,
        replica: { ...ctx.replica, type: part.type, args },
        expose: [],
      }
      if (args.display !== undefined) sub.display = args.display
      return withMeta(leafViews[part.type].toValue(part.state, sub), { type: part.type })
    }
    case 'map':
      return {
        kind: 'record',
        fields: sortedEntries(part.fields).map(([key, p]) => ({
          key,
          value: partValue(p, fieldSchema(schema, key), ctx),
        })),
      }
    case 'set': {
      const of = itemSchema(schema)
      const items: Item[] = []
      for (const row of orSetRows(part.membership)) {
        const sub = part.subs[row.e]
        if (!sub) continue
        items.push({
          id: row.e,
          value: withMeta(partValue(sub, of, ctx), { tags: row.tags, ...tomb(!row.present) }),
        })
      }
      return { kind: 'set', items, meta: { type: 'or-set' } }
    }
    case 'list': {
      const of = itemSchema(schema)
      const items: Item[] = []
      for (const row of rgaRows(part.seq)) {
        const sub = part.subs[row.id]
        if (!sub) continue
        items.push({
          id: row.id,
          value: withMeta(partValue(sub, of, ctx), {
            ts: row.ts,
            node: nodeOf(row.id),
            ...tomb(row.tombstone),
          }),
        })
      }
      return { kind: 'list', items, meta: { type: 'rga' } }
    }
  }
}

const docView: LessonCrdtView = {
  toValue: (state, ctx) => {
    const s = state as DocState
    const schema = (ctx.replica.schema ?? s.schema) as CrdtSchema
    return withMeta(partValue(s.root, schema, ctx), exposed(ctx))
  },
  opLabel: (op, before) => opLabel('doc', op, before),
  opLabelParts: (op, before) => opLabelParts('doc', op, before),
}

// ─── Registry ─────────────────────────────────────────────────────────────────────────────────

const leafViews: Record<CrdtName, LessonCrdtView> = {
  'max-register': maxRegisterView,
  'lww-register': lwwRegisterView,
  'lww-map': lwwMapView,
  'mv-register': mvRegisterView,
  'g-counter': gCounterView,
  'pn-counter': pnCounterView,
  'op-counter': opCounterView,
  'g-set': gSetView,
  'two-phase-set': twoPhaseSetView,
  'lww-element-set': lwwElementSetView,
  'or-set': orSetView,
  rga: rgaView,
  'lamport-clock': lamportView,
  'vector-clock': vectorClockView,
  hlc: hlcView,
}

/** One view per `CrdtName`, plus the composed document. */
export const views: Record<CrdtName | 'doc', LessonCrdtView> = { ...leafViews, doc: docView }

export function viewFor(type: CrdtName | 'doc'): LessonCrdtView {
  const v = views[type]
  if (!v) throw new Error(`no CRDT view for type "${String(type)}"`)
  return v
}

/** `views[type].toValue(state, ctx)`. */
export function toValue(type: CrdtName | 'doc', state: unknown, ctx: ViewCtx): Value {
  return viewFor(type).toValue(state, ctx)
}
