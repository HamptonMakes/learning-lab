/**
 * The real CRDT sources, as text, for the sandbox's "Code" panel. Vite's `?raw` import gives us
 * the exact file that runs (`src/crdt/*.ts`); `codeFor(type, fn)` extracts one function out of it
 * with `extractFunction` (memoized) and falls back to the whole file when the name is not found.
 */
/* oxlint-disable import/default -- `?raw` imports are Vite text modules; the import plugin cannot see their default export */
import docSrc from '@/crdt/doc.ts?raw'
import gCounterSrc from '@/crdt/g-counter.ts?raw'
import gSetSrc from '@/crdt/g-set.ts?raw'
import hlcSrc from '@/crdt/hlc.ts?raw'
import lamportSrc from '@/crdt/lamport-clock.ts?raw'
import lwwElementSetSrc from '@/crdt/lww-element-set.ts?raw'
import lwwMapSrc from '@/crdt/lww-map.ts?raw'
import lwwRegisterSrc from '@/crdt/lww-register.ts?raw'
import maxRegisterSrc from '@/crdt/max-register.ts?raw'
import mvRegisterSrc from '@/crdt/mv-register.ts?raw'
import opCounterSrc from '@/crdt/op-counter.ts?raw'
import orSetSrc from '@/crdt/or-set.ts?raw'
import pnCounterSrc from '@/crdt/pn-counter.ts?raw'
import rgaSrc from '@/crdt/rga.ts?raw'
import twoPhaseSetSrc from '@/crdt/two-phase-set.ts?raw'
import vectorClockSrc from '@/crdt/vector-clock.ts?raw'
import { extractFunction, type CrdtFn, type ExtractedFn, type ReplicaType } from '@/lesson/sandbox'

export type CrdtSource = {
  /** Repo path, e.g. `src/crdt/or-set.ts`. */
  file: string
  /** The exported object the reducer calls, e.g. `orSet` → shown as `orSet.effect`. */
  object: string
  source: string
}

export const CRDT_SOURCES: Readonly<Record<ReplicaType, CrdtSource>> = {
  'max-register': {
    file: 'src/crdt/max-register.ts',
    object: 'maxRegister',
    source: maxRegisterSrc,
  },
  'lww-register': {
    file: 'src/crdt/lww-register.ts',
    object: 'lwwRegister',
    source: lwwRegisterSrc,
  },
  'lww-map': { file: 'src/crdt/lww-map.ts', object: 'lwwMap', source: lwwMapSrc },
  'mv-register': { file: 'src/crdt/mv-register.ts', object: 'mvRegister', source: mvRegisterSrc },
  'g-counter': { file: 'src/crdt/g-counter.ts', object: 'gCounter', source: gCounterSrc },
  'pn-counter': { file: 'src/crdt/pn-counter.ts', object: 'pnCounter', source: pnCounterSrc },
  'op-counter': { file: 'src/crdt/op-counter.ts', object: 'opCounter', source: opCounterSrc },
  'g-set': { file: 'src/crdt/g-set.ts', object: 'gSet', source: gSetSrc },
  'two-phase-set': {
    file: 'src/crdt/two-phase-set.ts',
    object: 'twoPhaseSet',
    source: twoPhaseSetSrc,
  },
  'lww-element-set': {
    file: 'src/crdt/lww-element-set.ts',
    object: 'lwwElementSet',
    source: lwwElementSetSrc,
  },
  'or-set': { file: 'src/crdt/or-set.ts', object: 'orSet', source: orSetSrc },
  rga: { file: 'src/crdt/rga.ts', object: 'rga', source: rgaSrc },
  'lamport-clock': {
    file: 'src/crdt/lamport-clock.ts',
    object: 'lamportClock',
    source: lamportSrc,
  },
  'vector-clock': {
    file: 'src/crdt/vector-clock.ts',
    object: 'vectorClock',
    source: vectorClockSrc,
  },
  hlc: { file: 'src/crdt/hlc.ts', object: 'hlcClock', source: hlcSrc },
  doc: { file: 'src/crdt/doc.ts', object: 'docCrdt', source: docSrc },
}

export type CodeBlock = {
  type: ReplicaType
  fn: CrdtFn
  /** `orSet.effect` */
  label: string
  file: string
  /** The extracted function, or `undefined` when the panel shows the whole file instead. */
  extracted: ExtractedFn | undefined
  /** What to print: the function text, or the whole file as the fallback. */
  text: string
}

const cache = new Map<string, CodeBlock>()

/** The code to show for one CRDT function of one type (memoized per type + fn). */
export function codeFor(type: ReplicaType, fn: CrdtFn): CodeBlock {
  const key = `${type}.${fn}`
  const hit = cache.get(key)
  if (hit) return hit
  const src = CRDT_SOURCES[type]
  const extracted = extractFunction(src.source, fn)
  const block: CodeBlock = {
    type,
    fn,
    label: `${src.object}.${fn}`,
    file: src.file,
    extracted,
    text: extracted ? extracted.text : src.source,
  }
  cache.set(key, block)
  return block
}
