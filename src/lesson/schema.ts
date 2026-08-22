/**
 * Zod mirrors of `src/lesson/types.ts` (docs/animation-dsl.md §13). Lesson data is validated with
 * `validateTopic` at test time; the reducer and stage then trust the types.
 *
 * Every object is strict (unknown keys rejected); every command `t` appears exactly once in
 * `CommandSchema` (`z.discriminatedUnion`). Localizable strings (§12) carry
 * `.meta({ localizable: true })` and are listed in `LOCALIZABLE_FIELDS`.
 */
import { z } from 'zod'
import { RESERVED_IDS, parsePath } from './path'
import {
  ACTOR_COLORS,
  ACTOR_ICONS,
  ACTOR_KINDS,
  ACTOR_STATUSES,
  COMPARE_RULES,
  CRDT_NAMES,
  HOLDS,
  LAYOUT_PRESETS,
  LIMITS,
  TONES,
  VERDICTS,
  type CommandT,
  type CrdtSchema,
  type Topic,
  type Value,
} from './types'

// ─── Helpers ──────────────────────────────────────────────────────────────────────────────────

/** Mark a string schema as a localizable field (§12); the i18n extractor reads this mark. */
function localizable<T extends z.ZodType>(schema: T): T {
  return schema.meta({ localizable: true }) as T
}

/** True when a schema (optionally wrapped in `.optional()`) carries the localizable mark. */
export function isLocalizable(schema: z.ZodType): boolean {
  let s: z.ZodType = schema
  while (s instanceof z.ZodOptional) s = s.unwrap() as z.ZodType
  return s.meta()?.localizable === true
}

type Issuer = {
  addIssue: (issue: { code: 'custom'; message: string; path?: PropertyKey[] }) => void
}

/** Add one issue per duplicated key among `items`. */
function unique<T>(
  ctx: Issuer,
  items: readonly T[],
  keyOf: (item: T) => string,
  what: string,
  path: PropertyKey[],
): void {
  const seen = new Set<string>()
  items.forEach((item, i) => {
    const key = keyOf(item)
    if (seen.has(key))
      ctx.addIssue({ code: 'custom', message: `duplicate ${what} "${key}"`, path: [...path, i] })
    seen.add(key)
  })
}

// ─── Narration (§13) ──────────────────────────────────────────────────────────────────────────

const CODE_SPAN = /`[^`]*`/g
const LINK = /\[([^\]]*)\]\([^)]*\)/g
const BOLD = /\*\*/g
/** id-, clock- and value-shaped tokens that must not split a sentence: `alice:1`, `10:00`, `0.5`, `e.g.`. */
const ID_TOKEN = /[A-Za-z0-9_-]+:\d+/g
const DECIMAL = /\d+\.\d+/g
const ABBREVIATION = /\b(?:e\.g\.|i\.e\.|vs\.)/gi
const SENTENCE_END = /[.!?]+["')\]]*(?=\s|$)/
const CURLY_QUOTES = /[‘’“”]/

/** Sentence and visible-character counts of a `say` string (markup and tokens handled per §13). */
export function sayStats(say: string): { sentences: number; chars: number } {
  const visible = say.replace(LINK, '$1').replace(BOLD, '').replace(/`/g, '')
  const tokenised = say
    .replace(CODE_SPAN, 'x')
    .replace(LINK, '$1')
    .replace(BOLD, '')
    .replace(ABBREVIATION, 'x')
    .replace(DECIMAL, 'x')
    .replace(ID_TOKEN, 'x')
  const sentences = tokenised.split(SENTENCE_END).filter((s) => s.trim().length > 0).length
  return { sentences, chars: visible.trim().length }
}

// ─── Primitives ───────────────────────────────────────────────────────────────────────────────

export const ScalarSchema = z.union([z.string(), z.number(), z.boolean(), z.null()])
export const ToneSchema = z.enum(TONES)
export const VerdictSchema = z.enum(VERDICTS)
export const CompareRuleSchema = z.enum(COMPARE_RULES)
export const LayoutPresetSchema = z.enum(LAYOUT_PRESETS)
export const ActorKindSchema = z.enum(ACTOR_KINDS)
export const ActorIconSchema = z.enum(ACTOR_ICONS)
export const ActorColorSchema = z.enum(ACTOR_COLORS)
export const ActorStatusSchema = z.enum(ACTOR_STATUSES)
export const CrdtNameSchema = z.enum(CRDT_NAMES)
export const HoldSchema = z.enum(HOLDS)

const DOT = /^[^\s:@[\]]+:\d+$/
const DOT_MESSAGE = 'expected a dot "node:seq" (e.g. "alice:3")'
/** `${node}:${seq}` — op ids, OR-Set tags, RGA element ids. */
export const DotSchema = z
  .templateLiteral([z.string(), ':', z.int().nonnegative()], DOT_MESSAGE)
  .refine((d) => DOT.test(d), DOT_MESSAGE)

/** A path string that parses under the §3 grammar (resolution is checked by the reducer dry-run). */
export const PathSchema = z.string().superRefine((p, ctx) => {
  try {
    parsePath(p)
  } catch (e) {
    ctx.addIssue({ code: 'custom', message: e instanceof Error ? e.message : String(e) })
  }
})

export const VectorClockSchema = z.record(z.string(), z.int().nonnegative())

/** An id that is declared (actor, board, item …): non-empty and never a reserved root. */
const DeclaredActorIdSchema = z
  .string()
  .min(1)
  .refine(
    (id) => !RESERVED_IDS.includes(id),
    '"board" and "msg" are reserved and cannot be actor ids',
  )
const IdSchema = z.string().min(1)
const LabelSchema = localizable(
  z.string().max(LIMITS.maxLabelChars, `a label is at most ${LIMITS.maxLabelChars} characters`),
)

// ─── Values ───────────────────────────────────────────────────────────────────────────────────

export const MetaSchema = z.strictObject({
  ts: z.number().optional(),
  node: z.string().optional(),
  hlc: z.strictObject({ wall: z.number(), counter: z.number() }).optional(),
  tag: DotSchema.optional(),
  tags: z.array(z.strictObject({ tag: DotSchema, alive: z.boolean() })).optional(),
  tombstone: z.boolean().optional(),
  addTs: z.number().optional(),
  removeTs: z.number().optional(),
  vc: VectorClockSchema.optional(),
  applied: z.array(DotSchema).optional(),
  stats: z
    .strictObject({ stored: z.int().nonnegative(), visible: z.int().nonnegative() })
    .optional(),
  type: CrdtNameSchema.optional(),
  note: localizable(z.string()).optional(),
})

export const AnnotationSchema = z
  .strictObject({
    id: z.string().optional(),
    from: z.int().nonnegative(),
    to: z.int().nonnegative(),
    unit: z.enum(['byte', 'bit']).optional(),
    label: localizable(z.string()).optional(),
    tone: ToneSchema.optional(),
  })
  .refine((a) => a.from < a.to, 'an annotation needs from < to (to is exclusive)')

export const PatternTokenSchema = z.strictObject({
  id: z.string().regex(/^p\d+$/, 'pattern token ids are "p0", "p1" … in source order'),
  src: z.string(),
  kind: z.enum(['literal', 'any', 'class', 'quant', 'group', 'anchor', 'alt']),
  label: z.string().optional(),
})

/** Recursive: a `Value` tree. Typed explicitly so the lazy reference compiles. */
export const ValueSchema: z.ZodType<Value> = z.lazy(() => ValueUnionSchema)

export const ItemSchema = z.strictObject({
  id: IdSchema.refine((id) => !id.includes(']'), 'an item id never contains "]"'),
  value: ValueSchema,
})
export const CounterRowSchema = z.strictObject({
  node: z.string().min(1),
  inc: z.number(),
  dec: z.number().optional(),
})
export const TableRowSchema = z.strictObject({
  id: IdSchema.refine((id) => !id.includes(']'), 'a row id never contains "]"'),
  cells: z.record(z.string(), ValueSchema),
})

const visibleItems = (items: readonly z.infer<typeof ItemSchema>[]) =>
  items.filter((it) => it.value.meta?.tombstone !== true).length
const ItemsSchema = z.array(ItemSchema)

const ScalarValueSchema = z.strictObject({
  kind: z.literal('scalar'),
  value: ScalarSchema,
  meta: MetaSchema.optional(),
})
const RecordValueSchema = z
  .strictObject({
    kind: z.literal('record'),
    fields: z
      .array(z.strictObject({ key: z.string().min(1), value: ValueSchema }))
      .max(LIMITS.maxRecordFields, `a record shows at most ${LIMITS.maxRecordFields} fields`),
    display: z.enum(['card', 'tree']).optional(),
    meta: MetaSchema.optional(),
  })
  .superRefine((v, ctx) => unique(ctx, v.fields, (f) => f.key, 'record field', ['fields']))
const ListValueSchema = z
  .strictObject({
    kind: z.literal('list'),
    items: ItemsSchema,
    display: z.enum(['row', 'column', 'text']).optional(),
    meta: MetaSchema.optional(),
  })
  .superRefine((v, ctx) => {
    unique(ctx, v.items, (it) => it.id, 'item id', ['items'])
    if (visibleItems(v.items) > LIMITS.maxVisibleItems) {
      ctx.addIssue({
        code: 'custom',
        path: ['items'],
        message: `a list shows at most ${LIMITS.maxVisibleItems} visible items`,
      })
    }
  })
const SetValueSchema = z
  .strictObject({ kind: z.literal('set'), items: ItemsSchema, meta: MetaSchema.optional() })
  .superRefine((v, ctx) => {
    unique(ctx, v.items, (it) => it.id, 'item id', ['items'])
    if (visibleItems(v.items) > LIMITS.maxVisibleItems) {
      ctx.addIssue({
        code: 'custom',
        path: ['items'],
        message: `a set shows at most ${LIMITS.maxVisibleItems} visible items`,
      })
    }
  })
const CounterValueSchema = z
  .strictObject({
    kind: z.literal('counter'),
    rows: z.array(CounterRowSchema),
    total: z.number(),
    meta: MetaSchema.optional(),
  })
  .superRefine((v, ctx) => unique(ctx, v.rows, (r) => r.node, 'counter row', ['rows']))
const ClockValueSchema = z.strictObject({
  kind: z.literal('clock'),
  entries: z.record(z.string(), z.number()),
  meta: MetaSchema.optional(),
})
const TableValueSchema = z
  .strictObject({
    kind: z.literal('table'),
    columns: z.array(z.strictObject({ key: z.string().min(1), label: localizable(z.string()) })),
    rows: z.array(TableRowSchema),
    meta: MetaSchema.optional(),
  })
  .superRefine((v, ctx) => {
    unique(ctx, v.columns, (c) => c.key, 'column', ['columns'])
    unique(ctx, v.rows, (r) => r.id, 'row id', ['rows'])
    const columns = new Set(v.columns.map((c) => c.key))
    v.rows.forEach((row, i) => {
      for (const key of Object.keys(row.cells)) {
        if (!columns.has(key)) {
          ctx.addIssue({
            code: 'custom',
            path: ['rows', i, 'cells', key],
            message: `cell "${key}" has no column`,
          })
        }
      }
    })
  })
const BytesValueSchema = z
  .strictObject({
    kind: z.literal('bytes'),
    bytes: z.array(z.int().min(0).max(255)),
    display: z.enum(['hex', 'bits', 'canonical', 'dec']),
    range: z.tuple([z.int().nonnegative(), z.int().nonnegative()]).optional(),
    annotations: z.array(AnnotationSchema),
    meta: MetaSchema.optional(),
  })
  .superRefine((v, ctx) => {
    if (v.range && (v.range[0] >= v.range[1] || v.range[1] > v.bytes.length)) {
      ctx.addIssue({
        code: 'custom',
        path: ['range'],
        message: `range [from, to) must satisfy from < to <= ${v.bytes.length}`,
      })
    }
  })
const TextValueSchema = z.strictObject({
  kind: z.literal('text'),
  text: z.string().max(LIMITS.maxTextChars, `text is at most ${LIMITS.maxTextChars} characters`),
  cursor: z.int().nonnegative().optional(),
  annotations: z.array(AnnotationSchema),
  meta: MetaSchema.optional(),
})
const PatternValueSchema = z
  .strictObject({
    kind: z.literal('pattern'),
    tokens: z.array(PatternTokenSchema),
    cursor: z.int().nonnegative().optional(),
    meta: MetaSchema.optional(),
  })
  .superRefine((v, ctx) => unique(ctx, v.tokens, (t) => t.id, 'token id', ['tokens']))
const MeterValueSchema = z.strictObject({
  kind: z.literal('meter'),
  value: z.number(),
  max: z.number().optional(),
  label: localizable(z.string()).optional(),
  tone: ToneSchema.optional(),
  meta: MetaSchema.optional(),
})

export const ValueUnionSchema = z.discriminatedUnion('kind', [
  ScalarValueSchema,
  RecordValueSchema,
  ListValueSchema,
  SetValueSchema,
  CounterValueSchema,
  ClockValueSchema,
  TableValueSchema,
  BytesValueSchema,
  TextValueSchema,
  PatternValueSchema,
  MeterValueSchema,
])

export const ValueOrScalarSchema = z.union([ValueSchema, ScalarSchema])

// ─── World ────────────────────────────────────────────────────────────────────────────────────

export const LayoutSchema = z.strictObject({
  preset: LayoutPresetSchema,
  hub: z.string().optional(),
})

const clockShape = {
  now: z.number(),
  show: z.boolean(),
  format: z.enum(['counter', 'ms', 'time']),
  start: z
    .string()
    .regex(/^\d{1,2}:\d{2}$/, 'clock.start is "hh:mm"')
    .optional(),
  autoTick: z.boolean().optional(),
}
const timeNeedsStart = (c: { format?: string; start?: string }, ctx: Issuer) => {
  if (c.format === 'time' && c.start === undefined) {
    ctx.addIssue({
      code: 'custom',
      path: ['start'],
      message: 'format "time" needs a start ("hh:mm")',
    })
  }
}
export const ClockSchema = z.strictObject(clockShape).superRefine(timeNeedsStart)
export const PartialClockSchema = z.strictObject(clockShape).partial().superRefine(timeNeedsStart)

export const OutboxChipSchema = z.strictObject({
  slot: z.string(),
  id: DotSchema,
  label: z.string(),
})

const actorShape = {
  id: DeclaredActorIdSchema,
  kind: ActorKindSchema,
  label: LabelSchema,
  subtitle: localizable(z.string()).optional(),
  icon: ActorIconSchema.optional(),
  owner: z.string().optional(),
  status: ActorStatusSchema.optional(),
  skew: z.number().optional(),
}
export const ActorSchema = z.strictObject({
  ...actorShape,
  color: ActorColorSchema,
  online: z.boolean(),
  holds: z.record(z.string(), ValueSchema),
  outbox: z.array(OutboxChipSchema),
})
/** Authoring shape for `spawn` and scene worlds; the reducer fills defaults. */
export const ActorSpecSchema = z.strictObject({
  ...actorShape,
  color: ActorColorSchema.optional(),
  online: z.boolean().optional(),
  holds: z.record(z.string(), ValueOrScalarSchema).optional(),
})

export const BoardSchema = z.strictObject({
  id: IdSchema,
  label: LabelSchema.optional(),
  value: ValueSchema,
  tone: ToneSchema.optional(),
})

// ─── CRDT replicas (§5.1) ─────────────────────────────────────────────────────────────────────

export const SeedOpSchema = z.strictObject({
  by: z.string().optional(),
  op: z.string().min(1),
  args: z.array(z.unknown()).optional(),
  path: z.string().optional(),
  ts: z.number().optional(),
})
export const CrdtArgsSchema = z.strictObject({
  seed: z.array(SeedOpSchema).optional(),
  bias: z.enum(['add', 'remove']).optional(),
  nodes: z.array(z.string()).optional(),
  clock: z.strictObject({ slot: z.string() }).optional(),
  stamp: z.enum(['lamport', 'clock']).optional(),
  display: z.enum(['row', 'column', 'text']).optional(),
  expose: z.array(z.enum(['vc', 'applied', 'stats'])).optional(),
  wire: z.enum(['state', 'ops']).optional(),
})
/** Recursive: a composed-document schema node. */
export const CrdtSchemaSchema: z.ZodType<CrdtSchema> = z.lazy(() =>
  z.union([
    CrdtNameSchema,
    z.strictObject({ type: CrdtNameSchema, args: CrdtArgsSchema.optional() }),
    z.strictObject({ const: ScalarSchema }),
    z.strictObject({ map: z.record(z.string(), CrdtSchemaSchema) }),
    z.strictObject({ list: CrdtSchemaSchema }),
    z.strictObject({ set: CrdtSchemaSchema }),
  ]),
)
export const OpRecordSchema = z.strictObject({
  id: DotSchema,
  op: z.unknown(),
  deps: VectorClockSchema,
  path: z.string().optional(),
  label: z.string(),
  ts: z.number(),
})
export const ReplicaSchema = z.strictObject({
  type: z.union([CrdtNameSchema, z.literal('doc')]),
  schema: CrdtSchemaSchema.optional(),
  args: CrdtArgsSchema,
  state: z.unknown(),
  seq: z.int().nonnegative(),
  version: VectorClockSchema,
  applied: z.array(DotSchema),
  log: z.array(OpRecordSchema),
  pending: z.array(DotSchema),
})
export const ViewCtxSchema = z.strictObject({
  actors: z.array(z.string()),
  replica: ReplicaSchema,
  expose: z.array(z.enum(['vc', 'applied', 'stats'])),
  display: z.enum(['row', 'column', 'text']).optional(),
})

// ─── Messages and marks ───────────────────────────────────────────────────────────────────────

export const MessageDataSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('state'),
    slot: z.string(),
    state: z.unknown(),
    version: VectorClockSchema,
  }),
  z.strictObject({ kind: z.literal('op'), slot: z.string(), op: OpRecordSchema }),
  z.strictObject({ kind: z.literal('stamp'), slot: z.string(), stamp: z.unknown() }),
])
export const MessageSchema = z.strictObject({
  id: IdSchema,
  from: z.string(),
  to: z.string(),
  payload: ValueSchema,
  label: LabelSchema.optional(),
  state: z.enum(['flying', 'parked']),
  into: PathSchema.optional(),
  size: z.int().nonnegative().optional(),
  data: MessageDataSchema.optional(),
})

export const MarkSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    id: IdSchema,
    kind: z.literal('highlight'),
    paths: z.array(PathSchema),
    tone: ToneSchema,
    sticky: z.boolean().optional(),
    auto: z.boolean().optional(),
  }),
  z.strictObject({
    id: IdSchema,
    kind: z.literal('callout'),
    at: PathSchema,
    text: localizable(z.string()),
    tone: ToneSchema,
    sticky: z.boolean().optional(),
  }),
  z.strictObject({
    id: IdSchema,
    kind: z.literal('conflict'),
    a: PathSchema,
    b: PathSchema,
    sticky: z.boolean().optional(),
  }),
  z.strictObject({
    id: IdSchema,
    kind: z.literal('compare'),
    paths: z.array(PathSchema),
    verdict: VerdictSchema,
    rule: CompareRuleSchema,
    sticky: z.boolean().optional(),
  }),
  z.strictObject({
    id: IdSchema,
    kind: z.literal(['check', 'cross']),
    path: PathSchema,
    sticky: z.boolean().optional(),
  }),
  z.strictObject({ id: IdSchema, kind: z.literal('unchanged'), path: PathSchema }),
  z.strictObject({
    id: IdSchema,
    kind: z.literal('flow'),
    from: PathSchema,
    to: PathSchema,
    both: z.boolean().optional(),
  }),
])

export const WorldSchema = z.strictObject({
  layout: LayoutSchema,
  clock: ClockSchema,
  actors: z.record(z.string(), ActorSchema),
  boards: z.record(z.string(), BoardSchema),
  messages: z.array(MessageSchema),
  marks: z.array(MarkSchema),
  replicas: z.record(z.string(), z.record(z.string(), ReplicaSchema)),
  engines: z.record(z.string(), z.unknown()),
  ids: z.int().nonnegative(),
})

// ─── Commands (§4–§5) ─────────────────────────────────────────────────────────────────────────

const ActorRef = z.string().min(1)
const ActorRefs = z.union([ActorRef, z.array(ActorRef).min(1)])
const quiet = z.boolean().optional()

export const SortKeySchema = z.union([
  z.literal(['value', 'id']),
  z.templateLiteral(['@', z.string()]).refine((s) => s.length > 1, '"@" needs a meta key'),
  z
    .templateLiteral(['.', z.string()])
    .refine((s) => s.length > 1, '"." needs a field / column key'),
])

export const PayloadSchema = z.union([
  z.strictObject({ ref: PathSchema }),
  ValueSchema,
  ScalarSchema,
])

/** Scalar `insert` items become ids via String(value), so the text may not contain "]" (§13). */
const InsertItemSchema = z.union([
  ItemSchema,
  TableRowSchema,
  ScalarSchema.refine(
    (s) => !String(s).includes(']'),
    'a scalar item becomes its own id and may not contain "]"',
  ),
])

// 4.1 Stage, actors, time (10)
const SpawnSchema = z.strictObject({ t: z.literal('spawn'), actor: ActorSpecSchema })
const RemoveSchema = z.strictObject({ t: z.literal('remove'), actor: ActorRef })
const RemoveBoardSchema = z.strictObject({ t: z.literal('removeBoard'), board: IdSchema })
const LayoutCommandSchema = z.strictObject({
  t: z.literal('layout'),
  preset: LayoutPresetSchema,
  hub: ActorRef.optional(),
})
const TickSchema = z.strictObject({ t: z.literal('tick'), by: z.number().optional() })
const SkewSchema = z.strictObject({ t: z.literal('skew'), actor: ActorRef, by: z.number() })
const OfflineSchema = z.strictObject({ t: z.literal('offline'), actor: ActorRef })
const OnlineSchema = z.strictObject({ t: z.literal('online'), actor: ActorRef })
const StatusSchema = z.strictObject({
  t: z.literal('status'),
  actor: ActorRef,
  status: ActorStatusSchema.nullable(),
})
const NoteSchema = z.strictObject({
  t: z.literal('note'),
  id: IdSchema,
  text: localizable(
    z.string().max(LIMITS.maxTextChars, `a note is at most ${LIMITS.maxTextChars} characters`),
  ),
  tone: ToneSchema.optional(),
  label: LabelSchema.optional(),
  textId: z.string().optional(),
})

// 4.2 Values (9)
const SetSchema = z.strictObject({
  t: z.literal('set'),
  path: PathSchema,
  value: ValueOrScalarSchema,
  quiet,
})
const PatchSchema = z.strictObject({
  t: z.literal('patch'),
  path: PathSchema,
  meta: MetaSchema.partial(),
  quiet,
})
const InsertSchema = z.strictObject({
  t: z.literal('insert'),
  path: PathSchema,
  item: InsertItemSchema,
  index: z.int().nonnegative().optional(),
  quiet,
})
const DeleteSchema = z.strictObject({
  t: z.literal('delete'),
  path: PathSchema,
  tombstone: z.boolean().optional(),
  quiet,
})
const MoveSchema = z.strictObject({
  t: z.literal('move'),
  path: PathSchema,
  to: z.int().nonnegative(),
  quiet,
})
const SortSchema = z.strictObject({
  t: z.literal('sort'),
  path: PathSchema,
  by: z.array(SortKeySchema).min(1),
})
const AnnotateSchema = z
  .strictObject({
    t: z.literal('annotate'),
    path: PathSchema,
    from: z.int().nonnegative(),
    to: z.int().nonnegative(),
    unit: z.enum(['byte', 'bit']).optional(),
    label: localizable(z.string()).optional(),
    tone: ToneSchema.optional(),
    id: z.string().optional(),
  })
  .refine((a) => a.from < a.to, 'annotate needs from < to (to is exclusive)')
const UnannotateSchema = z.strictObject({
  t: z.literal('unannotate'),
  path: PathSchema,
  id: z.string().optional(),
})
const ViewSchema = z
  .strictObject({
    t: z.literal('view'),
    path: PathSchema,
    display: z.enum(['hex', 'bits', 'canonical', 'dec']),
    range: z.tuple([z.int().nonnegative(), z.int().nonnegative()]).optional(),
  })
  .refine((v) => !v.range || v.range[0] < v.range[1], 'view.range is [from, to) with from < to')

// 4.3 Messages (5)
const SendSchema = z.strictObject({
  t: z.literal('send'),
  from: ActorRef,
  to: ActorRefs,
  payload: PayloadSchema,
  id: IdSchema.optional(),
  label: LabelSchema.optional(),
  into: PathSchema.optional(),
  stamp: z.string().optional(),
  textId: z.string().optional(),
})
const DeliverSchema = z.strictObject({
  t: z.literal('deliver'),
  message: IdSchema,
  into: PathSchema.optional(),
  park: z.boolean().optional(),
  recv: z.string().optional(),
})
const DropSchema = z.strictObject({ t: z.literal('drop'), message: IdSchema })
const DuplicateSchema = z.strictObject({
  t: z.literal('duplicate'),
  message: IdSchema,
  id: IdSchema,
})
const RelaySchema = z.strictObject({
  t: z.literal('relay'),
  message: IdSchema,
  to: ActorRefs,
  into: PathSchema.optional(),
})

// 4.4 Marks (8)
const markOpts = { sticky: z.boolean().optional(), id: IdSchema.optional() }
const HighlightSchema = z.strictObject({
  t: z.literal('highlight'),
  path: z.union([PathSchema, z.array(PathSchema).min(1)]),
  tone: ToneSchema.optional(),
  ...markOpts,
})
const CalloutSchema = z.strictObject({
  t: z.literal('callout'),
  at: PathSchema,
  text: localizable(z.string().min(1)),
  tone: ToneSchema.optional(),
  ...markOpts,
  textId: z.string().optional(),
})
const ConflictSchema = z.strictObject({
  t: z.literal('conflict'),
  a: PathSchema,
  b: PathSchema,
  ...markOpts,
})
const CompareSchema = z.strictObject({
  t: z.literal('compare'),
  paths: z.array(PathSchema).min(2, 'compare needs at least two paths'),
  expect: VerdictSchema.optional(),
  ...markOpts,
})
const CheckSchema = z.strictObject({ t: z.literal('check'), path: PathSchema, ...markOpts })
const CrossSchema = z.strictObject({ t: z.literal('cross'), path: PathSchema, ...markOpts })
const ClearMarksSchema = z.strictObject({ t: z.literal('clearMarks') })
const UnmarkSchema = z.strictObject({ t: z.literal('unmark'), id: IdSchema })

// 4.5 Assertions (1)
const ExpectSchema = z.strictObject({
  t: z.literal('expect'),
  path: PathSchema,
  equals: z.unknown(),
})

// 5.1 CRDT (8)
const CrdtInitSchema = z.strictObject({
  t: z.literal('crdt.init'),
  actors: z.array(ActorRef).min(1),
  slot: IdSchema,
  type: CrdtNameSchema,
  args: CrdtArgsSchema.optional(),
})
const CrdtDocSchema = z.strictObject({
  t: z.literal('crdt.doc'),
  actors: z.array(ActorRef).min(1),
  slot: IdSchema,
  fields: z.record(z.string(), CrdtSchemaSchema),
  args: CrdtArgsSchema.optional(),
})
const CrdtUpdateSchema = z.strictObject({
  t: z.literal('crdt.update'),
  actor: ActorRef,
  slot: IdSchema,
  path: z.string().optional(),
  op: z.string().min(1),
  args: z.array(z.unknown()).optional(),
  ts: z.number().optional(),
  quiet,
})
const CrdtSendSchema = z.strictObject({
  t: z.literal('crdt.send'),
  from: ActorRef,
  to: ActorRefs,
  slot: IdSchema,
  id: IdSchema.optional(),
  label: LabelSchema.optional(),
  mode: z.enum(['full', 'delta']).optional(),
  textId: z.string().optional(),
})
const CrdtBroadcastSchema = z.strictObject({
  t: z.literal('crdt.broadcast'),
  from: ActorRef,
  slot: IdSchema,
  to: z.array(ActorRef).min(1).optional(),
  id: IdSchema.optional(),
})
const CrdtMergeSchema = z.strictObject({
  t: z.literal('crdt.merge'),
  into: ActorRef,
  from: ActorRef,
  slot: IdSchema,
})
const CrdtSyncSchema = z.strictObject({
  t: z.literal('crdt.sync'),
  a: ActorRef,
  b: ActorRef,
  slot: IdSchema,
  mode: z.enum(['state', 'ops']).optional(),
})
const CrdtGcSchema = z.strictObject({
  t: z.literal('crdt.gc'),
  actor: ActorRef,
  slot: IdSchema,
  upTo: VectorClockSchema.optional(),
  unsafe: z.boolean().optional(),
})

// 5.3 Regex (2)
const RegexInitSchema = z.strictObject({
  t: z.literal('regex.init'),
  actor: ActorRef,
  pattern: z.string(),
  input: z.string(),
  flags: z.string().optional(),
})
const RegexAdvanceSchema = z.strictObject({
  t: z.literal('regex.advance'),
  actor: ActorRef,
  until: z.enum(['step', 'token', 'fail', 'attempt', 'backtrack', 'match', 'end']),
})

/** Every command, discriminated on `t` (43: 10 stage, 9 value, 5 message, 8 mark, 1 assert, 8 CRDT, 2 regex). */
export const CommandSchema = z.discriminatedUnion('t', [
  SpawnSchema,
  RemoveSchema,
  RemoveBoardSchema,
  LayoutCommandSchema,
  TickSchema,
  SkewSchema,
  OfflineSchema,
  OnlineSchema,
  StatusSchema,
  NoteSchema,
  SetSchema,
  PatchSchema,
  InsertSchema,
  DeleteSchema,
  MoveSchema,
  SortSchema,
  AnnotateSchema,
  UnannotateSchema,
  ViewSchema,
  SendSchema,
  DeliverSchema,
  DropSchema,
  DuplicateSchema,
  RelaySchema,
  HighlightSchema,
  CalloutSchema,
  ConflictSchema,
  CompareSchema,
  CheckSchema,
  CrossSchema,
  ClearMarksSchema,
  UnmarkSchema,
  ExpectSchema,
  CrdtInitSchema,
  CrdtDocSchema,
  CrdtUpdateSchema,
  CrdtSendSchema,
  CrdtBroadcastSchema,
  CrdtMergeSchema,
  CrdtSyncSchema,
  CrdtGcSchema,
  RegexInitSchema,
  RegexAdvanceSchema,
])

/** The `t` of every command, in §4–§5 order. */
export const COMMAND_TS: readonly CommandT[] = CommandSchema.options.map((o) => o.shape.t.value)

// ─── Steps, scenes, topics (§6, §8.1, §11) ────────────────────────────────────────────────────

export const StepIdSchema = z.string().regex(/^s\d{2}$/, 'step ids are "s01" … "s99" (zero-padded)')

export const SaySchema = localizable(
  z
    .string()
    .min(1)
    .superRefine((say, ctx) => {
      if (CURLY_QUOTES.test(say)) {
        ctx.addIssue({
          code: 'custom',
          message: 'use straight quotes only (\' and "), not curly quotes',
        })
      }
      const { sentences, chars } = sayStats(say)
      if (sentences > LIMITS.maxSaySentences) {
        ctx.addIssue({
          code: 'custom',
          message: `say has ${sentences} sentences; the limit is ${LIMITS.maxSaySentences} (split the step)`,
        })
      }
      if (chars > LIMITS.maxSayChars) {
        ctx.addIssue({
          code: 'custom',
          message: `say is ${chars} characters; the limit is ${LIMITS.maxSayChars}`,
        })
      }
    }),
)

export const StepSchema = z.strictObject({
  id: StepIdSchema,
  say: SaySchema,
  do: z.array(CommandSchema),
  hold: HoldSchema.optional(),
  autoHighlight: z.boolean().optional(),
})

export const TryItSchema = z.strictObject({
  slot: IdSchema,
  actors: z.array(ActorRef).optional(),
  ops: z.array(
    z.strictObject({
      op: z.string().min(1),
      label: localizable(z.string()).optional(),
      args: z.union([z.literal('prompt'), z.array(z.unknown())]).optional(),
    }),
  ),
  network: z.array(z.enum(['sync', 'send', 'offline', 'drop'])).optional(),
})

export const SceneWorldSchema = z
  .strictObject({
    layout: LayoutPresetSchema.optional(),
    hub: ActorRef.optional(),
    clock: PartialClockSchema.optional(),
    actors: z
      .array(ActorSpecSchema)
      .max(LIMITS.maxActors, `a world holds at most ${LIMITS.maxActors} actors`),
    boards: z.array(BoardSchema).optional(),
  })
  .superRefine((w, ctx) => {
    unique(ctx, w.actors, (a) => a.id, 'actor id', ['actors'])
    if (w.boards) unique(ctx, w.boards, (b) => b.id, 'board id', ['boards'])
    if (w.hub !== undefined && !w.actors.some((a) => a.id === w.hub)) {
      ctx.addIssue({
        code: 'custom',
        path: ['hub'],
        message: `hub "${w.hub}" is not an actor of this world`,
      })
    }
  })

export const SceneSchema = z
  .strictObject({
    id: IdSchema,
    title: z.string().optional(),
    inContext: z.boolean().optional(),
    world: SceneWorldSchema.optional(),
    startFrom: IdSchema.optional(),
    steps: z.array(StepSchema).min(1, 'a scene needs at least one step'),
    tryIt: TryItSchema.optional(),
  })
  .superRefine((s, ctx) => {
    if ((s.world === undefined) === (s.startFrom === undefined)) {
      ctx.addIssue({ code: 'custom', message: 'a scene declares exactly one of world / startFrom' })
    }
    unique(ctx, s.steps, (step) => step.id, 'step id', ['steps'])
  })

export const TopicSchema = z
  .strictObject({
    id: IdSchema,
    title: z.string().min(1),
    goal: z.string().min(1),
    whenToUse: z.array(z.string().min(1)),
    whenNotToUse: z.array(z.string().min(1)),
    realWorld: z.string().min(1),
    scenes: z.array(SceneSchema).min(1, 'a topic needs at least one scene'),
  })
  .superRefine((t, ctx) => {
    unique(ctx, t.scenes, (s) => s.id, 'scene id', ['scenes'])
    const seen = new Set<string>()
    t.scenes.forEach((s, i) => {
      if (s.startFrom !== undefined && !seen.has(s.startFrom)) {
        ctx.addIssue({
          code: 'custom',
          path: ['scenes', i, 'startFrom'],
          message: `startFrom "${s.startFrom}" must name an earlier scene of this topic`,
        })
      }
      seen.add(s.id)
    })
  })

// ─── Testing contract (§14) ───────────────────────────────────────────────────────────────────

export const ChangeSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('value'),
    path: PathSchema,
    op: z.enum(['added', 'changed', 'removed', 'meta']),
    via: IdSchema.optional(),
  }),
  z.strictObject({
    kind: z.literal('actor'),
    id: IdSchema,
    op: z.enum(['spawned', 'removed', 'online', 'offline', 'status', 'skew']),
  }),
  z.strictObject({
    kind: z.literal('board'),
    id: IdSchema,
    op: z.enum(['added', 'changed', 'removed']),
  }),
  z.strictObject({
    kind: z.literal('message'),
    op: z.enum(['sent', 'parked', 'delivered', 'dropped']),
    message: MessageSchema,
    transient: z.boolean().optional(),
  }),
  z.strictObject({
    kind: z.literal('sync'),
    slot: IdSchema,
    from: ActorRef,
    to: ActorRef,
    both: z.boolean(),
  }),
  z.strictObject({ kind: z.literal('mark'), id: IdSchema, op: z.enum(['added', 'removed']) }),
  z.strictObject({ kind: z.literal('layout'), from: LayoutSchema, to: LayoutSchema }),
  z.strictObject({ kind: z.literal('clock'), from: z.number(), to: z.number() }),
])
export const FrameSchema = z.strictObject({
  index: z.int().nonnegative(),
  sceneId: IdSchema,
  sceneIndex: z.int().nonnegative(),
  step: StepSchema,
  world: WorldSchema,
  prev: WorldSchema,
  changes: z.array(ChangeSchema),
})

// ─── i18n (§12) ───────────────────────────────────────────────────────────────────────────────

/** Where localizable text lives: by command `t` (field of the command) or by value/structure `kind`. */
export type LocalizableField =
  | { t: CommandT; field: string }
  | {
      kind: 'step' | 'actor' | 'board' | 'table' | 'annotation' | 'meta' | 'meter' | 'tryIt'
      field: string
    }

/** Every localizable field (§12). `[]` in a field name means "each element of that array". */
export const LOCALIZABLE_FIELDS = [
  { kind: 'step', field: 'say' },
  { t: 'callout', field: 'text' },
  { t: 'note', field: 'text' },
  { t: 'note', field: 'label' },
  { t: 'send', field: 'label' },
  { t: 'crdt.send', field: 'label' },
  { kind: 'actor', field: 'label' },
  { kind: 'actor', field: 'subtitle' },
  { kind: 'board', field: 'label' },
  { kind: 'table', field: 'columns[].label' },
  { kind: 'annotation', field: 'label' },
  { kind: 'meta', field: 'note' },
  { kind: 'meter', field: 'label' },
  { kind: 'tryIt', field: 'ops[].label' },
] as const satisfies readonly LocalizableField[]

// ─── validateTopic ────────────────────────────────────────────────────────────────────────────

export type ValidationResult = { ok: true; topic: Topic } | { ok: false; issues: string[] }

type IssueLike = {
  code?: string
  path: ReadonlyArray<PropertyKey>
  message: string
  errors?: ReadonlyArray<ReadonlyArray<IssueLike>>
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** `scenes[0:update-and-merge].steps[2:s03].do[1:crdt.update].path` — indexes annotated with ids / `t`. */
export function describeIssuePath(input: unknown, path: ReadonlyArray<PropertyKey>): string {
  let out = ''
  let node: unknown = input
  for (const key of path) {
    if (typeof key === 'number') {
      const el: unknown = Array.isArray(node) ? node[key] : undefined
      const tag =
        isRecord(el) && typeof el.id === 'string'
          ? el.id
          : isRecord(el) && typeof el.t === 'string'
            ? el.t
            : undefined
      out += tag === undefined ? `[${key}]` : `[${key}:${tag}]`
      node = el
    } else {
      const k = String(key)
      out += out.length === 0 ? k : `.${k}`
      node = isRecord(node) ? node[k] : undefined
    }
  }
  return out.length === 0 ? '(topic)' : out
}

const depthOf = (branch: ReadonlyArray<IssueLike>): number =>
  branch.reduce((d, i) => Math.max(d, i.path.length), 0)

/** Flatten Zod issues into one readable line each; union errors keep the branch that got deepest. */
export function formatIssues(
  issues: ReadonlyArray<IssueLike>,
  input: unknown,
  prefix: ReadonlyArray<PropertyKey> = [],
): string[] {
  const out: string[] = []
  for (const issue of issues) {
    const path = [...prefix, ...issue.path]
    if (issue.code === 'invalid_union' && issue.errors && issue.errors.length > 0) {
      const best = issue.errors.reduce((a, b) => (depthOf(b) > depthOf(a) ? b : a))
      if (depthOf(best) > 0) {
        out.push(...formatIssues(best, input, path))
        continue
      }
      const why = issue.errors.map((b) => b[0]?.message ?? 'invalid').join(' | ')
      out.push(`${describeIssuePath(input, path)}: ${issue.message} (${why})`)
      continue
    }
    out.push(`${describeIssuePath(input, path)}: ${issue.message}`)
  }
  return out
}

/** Validate lesson data against the schema; on failure, one readable line per issue. */
export function validateTopic(topic: unknown): ValidationResult {
  const result = TopicSchema.safeParse(topic)
  if (result.success) return { ok: true, topic: result.data }
  return { ok: false, issues: formatIssues(result.error.issues, topic) }
}
