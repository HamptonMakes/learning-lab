/**
 * Property-based law checks shared by every CRDT test. Pure helpers (no vitest import) — call
 * them inside `it(...)` blocks; they throw on the first counterexample via fast-check.
 *
 *   assertMergeLaws(cfg)      merge is commutative, associative, idempotent
 *   assertConvergence(cfg)    replicas that gossip states in a random order end with equal values
 *   assertOpConvergence(cfg)  ops delivered in any causal order produce equal values (op-based)
 */
import fc from 'fast-check'
import { makeCtx, type CrdtType, type Ctx, type NodeId } from './types'

export interface LawsConfig<S, U, O, V, A> {
  type: CrdtType<S, U, O, V, A>
  args: A
  /** Arbitrary producing a random update for the given node. */
  updateArb: (node: NodeId) => fc.Arbitrary<U>
  nodes?: NodeId[]
  equals?: (a: S, b: S) => boolean
  valueEquals?: (a: V, b: V) => boolean
  numRuns?: number
  /** Max updates per replica when generating states. */
  maxUpdates?: number
}

/** Canonical JSON: object keys sorted recursively, so structurally-equal states compare equal. */
export function canon(x: unknown): string {
  return JSON.stringify(sortKeys(x))
}
function sortKeys(x: unknown): unknown {
  if (Array.isArray(x)) return x.map(sortKeys)
  if (x && typeof x === 'object') {
    return Object.fromEntries(
      Object.keys(x as Record<string, unknown>)
        .sort()
        .map((k) => [k, sortKeys((x as Record<string, unknown>)[k])]),
    )
  }
  return x
}

const DEFAULT_NODES = ['a', 'b', 'c']

function eqFor<S, U, O, V, A>(cfg: LawsConfig<S, U, O, V, A>) {
  return cfg.equals ?? cfg.type.equals ?? ((a: S, b: S) => canon(a) === canon(b))
}
function veqFor<S, U, O, V, A>(cfg: LawsConfig<S, U, O, V, A>) {
  return cfg.valueEquals ?? ((a: V, b: V) => canon(a) === canon(b))
}

/** Arbitrary: a replica state for `node` after 0..maxUpdates random local updates with rising ts. */
export function stateArb<S, U, O, V, A>(cfg: LawsConfig<S, U, O, V, A>, node: NodeId, tsBase = 0): fc.Arbitrary<S> {
  const max = cfg.maxUpdates ?? 6
  return fc.array(cfg.updateArb(node), { maxLength: max }).map((updates) => {
    const ctx = makeCtx(node, tsBase)
    let s = cfg.type.init(node, cfg.args)
    updates.forEach((u, i) => {
      ctx.ts = tsBase + i + 1
      s = cfg.type.update(s, u, ctx)
    })
    return s
  })
}

export function assertMergeLaws<S, U, O, V, A>(cfg: LawsConfig<S, U, O, V, A>): void {
  const { type } = cfg
  const eq = eqFor(cfg)
  const nodes = cfg.nodes ?? DEFAULT_NODES
  const [na = 'a', nb = 'b', nc = 'c'] = nodes
  const triple = fc.tuple(stateArb(cfg, na, 0), stateArb(cfg, nb, 100), stateArb(cfg, nc, 200))
  const opts = { numRuns: cfg.numRuns ?? 200 }
  fc.assert(
    fc.property(triple, ([a, b]) => eq(type.merge(a, b), type.merge(b, a))),
    { ...opts, verbose: true },
  )
  fc.assert(
    fc.property(triple, ([a, b, c]) => eq(type.merge(type.merge(a, b), c), type.merge(a, type.merge(b, c)))),
    { ...opts, verbose: true },
  )
  fc.assert(
    fc.property(triple, ([a]) => eq(type.merge(a, a), a)),
    { ...opts, verbose: true },
  )
  // merge(a, b) then merging a again changes nothing (inflation / a ≤ merge(a,b))
  fc.assert(
    fc.property(triple, ([a, b]) => {
      const m = type.merge(a, b)
      return eq(type.merge(m, a), m) && eq(type.merge(m, b), m)
    }),
    { ...opts, verbose: true },
  )
}

/** Replicas do random local updates interleaved with random pairwise state exchanges; then a full
 *  all-pairs sync. All values must be equal at the end. */
export function assertConvergence<S, U, O, V, A>(cfg: LawsConfig<S, U, O, V, A>): void {
  const { type } = cfg
  const veq = veqFor(cfg)
  const nodes = cfg.nodes ?? DEFAULT_NODES
  const n = nodes.length
  type Event = { kind: 'update'; node: number; u: U } | { kind: 'sync'; from: number; to: number }
  const eventArb: fc.Arbitrary<Event> = fc.oneof(
    fc.integer({ min: 0, max: n - 1 }).chain((node) =>
      cfg.updateArb(nodes[node] ?? 'a').map((u) => ({ kind: 'update', node, u }) as Event),
    ),
    fc
      .tuple(fc.integer({ min: 0, max: n - 1 }), fc.integer({ min: 0, max: n - 1 }))
      .map(([from, to]) => ({ kind: 'sync', from, to }) as Event),
  )
  fc.assert(
    fc.property(fc.array(eventArb, { maxLength: 40 }), (events) => {
      const states: S[] = nodes.map((id) => type.init(id, cfg.args))
      const ctxs: Ctx[] = nodes.map((id) => makeCtx(id, 0))
      let clock = 0
      for (const e of events) {
        clock += 1
        if (e.kind === 'update') {
          const ctx = ctxs[e.node] as Ctx
          ctx.ts = clock
          states[e.node] = type.update(states[e.node] as S, e.u, ctx)
        } else {
          states[e.to] = type.merge(states[e.to] as S, states[e.from] as S)
        }
      }
      // full sync, both directions, twice
      for (let round = 0; round < 2; round++) {
        for (let i = 0; i < n; i++) {
          for (let j = 0; j < n; j++) {
            if (i !== j) states[j] = type.merge(states[j] as S, states[i] as S)
          }
        }
      }
      const values = states.map((s) => type.value(s))
      return values.every((v) => veq(v, values[0] as V))
    }),
    { numRuns: cfg.numRuns ?? 150, verbose: true },
  )
}

/**
 * Op-based convergence. Builds a causal history: at each step a node either prepares a new op
 * (applying it locally) or receives all not-yet-seen ops from another node (in that node's order,
 * which respects causality because each node only emits ops after applying what it has seen).
 * Then every replica receives every op it has not seen, in a random causal order. Values must agree.
 */
export function assertOpConvergence<S, U, O, V, A>(cfg: LawsConfig<S, U, O, V, A>): void {
  const { type } = cfg
  const veq = veqFor(cfg)
  const nodes = cfg.nodes ?? DEFAULT_NODES
  const n = nodes.length
  type Event = { kind: 'op'; node: number; u: U } | { kind: 'recv'; node: number; from: number }
  const eventArb: fc.Arbitrary<Event> = fc.oneof(
    { weight: 3, arbitrary: fc.integer({ min: 0, max: n - 1 }).chain((node) => cfg.updateArb(nodes[node] ?? 'a').map((u) => ({ kind: 'op', node, u }) as Event)) },
    { weight: 2, arbitrary: fc.tuple(fc.integer({ min: 0, max: n - 1 }), fc.integer({ min: 0, max: n - 1 })).map(([node, from]) => ({ kind: 'recv', node, from }) as Event) },
  )
  fc.assert(
    fc.property(fc.array(eventArb, { maxLength: 40 }), fc.integer({ min: 0, max: 1 << 20 }), (events, seed) => {
      const states: S[] = nodes.map((id) => type.init(id, cfg.args))
      const ctxs = nodes.map((id) => makeCtx(id, 0))
      // log[i] = ops node i has applied, in application order (its causal past)
      const log: { id: number; op: O }[][] = nodes.map(() => [])
      let opId = 0
      let clock = 0
      for (const e of events) {
        clock += 1
        if (e.kind === 'op') {
          const ctx = ctxs[e.node] as Ctx
          ctx.ts = clock
          const op = type.prepare(states[e.node] as S, e.u, ctx)
          states[e.node] = type.effect(states[e.node] as S, op)
          ;(log[e.node] as { id: number; op: O }[]).push({ id: opId++, op })
        } else if (e.node !== e.from) {
          const seen = new Set((log[e.node] as { id: number }[]).map((x) => x.id))
          for (const entry of log[e.from] as { id: number; op: O }[]) {
            if (!seen.has(entry.id)) {
              states[e.node] = type.effect(states[e.node] as S, entry.op)
              ;(log[e.node] as { id: number; op: O }[]).push(entry)
              seen.add(entry.id)
            }
          }
        }
      }
      // final delivery: everyone receives everything, pulling from peers in a seeded random order
      let rnd = seed
      const next = () => ((rnd = (rnd * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff)
      for (let round = 0; round < 3; round++) {
        const order = nodes.map((_, i) => i).sort(() => next() - 0.5)
        for (const i of order) {
          const peers = nodes.map((_, j) => j).filter((j) => j !== i).sort(() => next() - 0.5)
          for (const j of peers) {
            const seen = new Set((log[i] as { id: number }[]).map((x) => x.id))
            for (const entry of log[j] as { id: number; op: O }[]) {
              if (!seen.has(entry.id)) {
                states[i] = type.effect(states[i] as S, entry.op)
                ;(log[i] as { id: number; op: O }[]).push(entry)
                seen.add(entry.id)
              }
            }
          }
        }
      }
      const values = states.map((s) => type.value(s))
      return values.every((v) => veq(v, values[0] as V))
    }),
    { numRuns: cfg.numRuns ?? 150, verbose: true },
  )
}
