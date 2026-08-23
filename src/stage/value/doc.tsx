/**
 * Composed documents (DSL §5.1 `crdt.doc`, src/crdt/doc.ts) on the stage. The renderer never
 * reads `replicas`, so a doc is recognised from its value alone: `toValue` stamps every CRDT part
 * with `meta.type`, so a slot whose *nested* nodes carry a type is a document (an atomic slot's
 * root may carry a type chip; its children never do). Inside a doc the sidecar is gated — the
 * document is the hero, metadata shows only where the step points (see MetaBadges) — and the slot
 * caption names the doc once ("card · doc"). `DocContext` carries the doc root path to every node
 * under it.
 */
import { createContext, useContext } from 'react'
import type { CrdtName, Path, Value } from '@/lesson/types'

/** The root path of the enclosing composed document, or null outside one. */
export const DocContext = createContext<Path | null>(null)

export function useDocRoot(): Path | null {
  return useContext(DocContext)
}

function childValues(v: Value): Value[] {
  switch (v.kind) {
    case 'record':
      return v.fields.map((f) => f.value)
    case 'list':
    case 'set':
      return v.items.map((it) => it.value)
    case 'table':
      return v.rows.flatMap((r) => Object.values(r.cells))
    default:
      return []
  }
}

function hasTypedNode(v: Value): boolean {
  if (v.meta?.type !== undefined) return true
  return childValues(v).some(hasTypedNode)
}

/** True when `v` is a composed document: some nested part carries `meta.type`. */
export function isDocValue(v: Value): boolean {
  return childValues(v).some(hasTypedNode)
}

/** The type of a doc's root part when it has one (a set- or list-rooted doc); else undefined. */
export function docRootType(v: Value): CrdtName | undefined {
  return v.meta?.type
}
