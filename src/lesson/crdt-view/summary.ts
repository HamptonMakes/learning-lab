/**
 * `summarizeState(type, state, args?)`: the compact text of a state token (DSL §5.1 `crdt.send`:
 * "type chip + a ≤ 24-character value summary (+n) + stamp/size badges; the full payload sits in
 * title / data-value"). Returns the ≤ 24-character summary and the envelope `Meta` (`type` for the
 * chip; `ts`/`node`/`hlc` for an LWW register; `vc` for an MV-Register).
 */
import type { DocPart, DocState } from '../../crdt/doc'
import { gCounterEntries, gCounter, type GCounterState } from '../../crdt/g-counter'
import { gSet, type GSetState } from '../../crdt/g-set'
import type { Hlc } from '../../crdt/hlc'
import { lwwElementSet, type LwwElementSetState } from '../../crdt/lww-element-set'
import { lwwMapFields, type LwwMapState } from '../../crdt/lww-map'
import { lwwIsWritten, type LwwRegisterState } from '../../crdt/lww-register'
import type { MaxRegisterState } from '../../crdt/max-register'
import { mvRegisterClock, type MvRegisterState } from '../../crdt/mv-register'
import type { OpCounterState } from '../../crdt/op-counter'
import { orSet, orSetRows, type OrSetState } from '../../crdt/or-set'
import { pnCounterEntries, pnCounter, type PNCounterState } from '../../crdt/pn-counter'
import { rga, rgaRows, type RgaState } from '../../crdt/rga'
import { twoPhaseSet, type TwoPhaseSetState } from '../../crdt/two-phase-set'
import type { CrdtArgs, CrdtName, Meta, VectorClock } from '../types'
import { fmtValue, joinFit, truncate } from './format'
import { decodeHlcStamp } from './hlc-stamp'

export type StateSummary = { value: string; meta: Meta }

/** What an empty register / set / clock reads as on a token. */
export const EMPTY_SUMMARY = '∅'

function elements(values: readonly unknown[]): string {
  return values.length === 0 ? EMPTY_SUMMARY : joinFit(values.map(fmtValue))
}

function sequence(values: readonly unknown[]): string {
  if (values.length === 0) return EMPTY_SUMMARY
  const text = values.every((v) => typeof v === 'string' && v.length === 1)
  return text ? truncate(values.join('')) : joinFit(values.map(fmtValue))
}

function clockEntries(vc: VectorClock): string {
  const parts = Object.keys(vc).map((node) => `${node} ${vc[node] ?? 0}`)
  return parts.length === 0 ? EMPTY_SUMMARY : joinFit(parts, ' · ')
}

function docPartSummary(part: DocPart): string {
  switch (part.kind) {
    case 'leaf':
      return summarizeState(part.type, part.state).value
    case 'const':
      return fmtValue(part.value)
    case 'map':
      return `{${joinFit(
        Object.keys(part.fields).map((k) => {
          const p = part.fields[k]
          return p ? `${k}: ${docPartSummary(p)}` : k
        }),
      )}}`
    case 'set':
      return `${orSetRows(part.membership).filter((r) => r.present).length} items`
    case 'list':
      return `${rgaRows(part.seq).filter((r) => !r.tombstone).length} items`
  }
}

export function summarizeState(
  type: CrdtName | 'doc',
  state: unknown,
  args: CrdtArgs = {},
): StateSummary {
  const meta: Meta = type === 'doc' ? {} : { type }
  switch (type) {
    case 'max-register': {
      const s = state as MaxRegisterState
      return { value: s.value === null ? EMPTY_SUMMARY : String(s.value), meta }
    }
    case 'lww-register': {
      const s = state as LwwRegisterState<unknown>
      if (!lwwIsWritten(s)) return { value: EMPTY_SUMMARY, meta }
      meta.ts = s.ts
      meta.node = s.node
      if (args.clock) meta.hlc = decodeHlcStamp(s.ts)
      return { value: truncate(fmtValue(s.value)), meta }
    }
    case 'lww-map': {
      const live = lwwMapFields(state as LwwMapState<unknown>).filter((f) => !f.tombstone)
      return {
        value:
          live.length === 0
            ? EMPTY_SUMMARY
            : joinFit(live.map((f) => `${f.key}=${fmtValue(f.value)}`)),
        meta,
      }
    }
    case 'mv-register': {
      const s = state as MvRegisterState<unknown>
      if (s.versions.length === 0) return { value: EMPTY_SUMMARY, meta }
      meta.vc = mvRegisterClock(s)
      return {
        value: joinFit(
          s.versions.map((v) => fmtValue(v.value)),
          ' | ',
        ),
        meta,
      }
    }
    case 'g-counter': {
      const s = state as GCounterState
      const rows = gCounterEntries(s).map((e) => `${e.node} ${e.count}`)
      return { value: joinFit([String(gCounter.value(s)), ...rows], ' · '), meta }
    }
    case 'pn-counter': {
      const s = state as PNCounterState
      const rows = pnCounterEntries(s).map((e) =>
        e.dec > 0 ? `${e.node} +${e.inc} −${e.dec}` : `${e.node} +${e.inc}`,
      )
      return { value: joinFit([String(pnCounter.value(s)), ...rows], ' · '), meta }
    }
    case 'op-counter':
      return { value: String((state as OpCounterState).total), meta }
    case 'g-set':
      return { value: elements(gSet.value(state as GSetState<string>)), meta }
    case 'two-phase-set':
      return { value: elements(twoPhaseSet.value(state as TwoPhaseSetState<string>)), meta }
    case 'lww-element-set':
      return { value: elements(lwwElementSet.value(state as LwwElementSetState<string>)), meta }
    case 'or-set':
      return { value: elements(orSet.value(state as OrSetState<unknown>)), meta }
    case 'rga':
      return { value: sequence(rga.value(state as RgaState<unknown>)), meta }
    case 'lamport-clock':
      return { value: String(state as number), meta }
    case 'vector-clock':
      return { value: clockEntries(state as VectorClock), meta }
    case 'hlc': {
      const s = state as Hlc
      return { value: `${s.wall}.${s.counter}`, meta }
    }
    case 'doc': {
      const s = state as DocState
      const root = s.root
      if (root.kind === 'map') {
        const parts = Object.keys(root.fields).map((k) => {
          const p = root.fields[k]
          return p ? `${k}: ${docPartSummary(p)}` : k
        })
        return { value: parts.length === 0 ? EMPTY_SUMMARY : joinFit(parts), meta }
      }
      return { value: truncate(docPartSummary(root)), meta }
    }
  }
}
