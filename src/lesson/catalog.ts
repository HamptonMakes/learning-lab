/**
 * Catalog types: the navigable tree (Module › Unit › Topic) without lesson bodies.
 * Topic bodies (scenes/steps) are loaded lazily per topic via src/content/registry.ts.
 */
export type ModuleStatus = 'live' | 'prototype' | 'coming-soon'

export interface TopicMeta {
  /** URL segment, stable forever (translations + progress key on it). */
  id: string
  title: string
  /** One short sentence shown in nav tooltips and topic headers. */
  summary: string
  /** Rough reading time in minutes. */
  minutes?: number
}

export interface UnitMeta {
  id: string
  /** e.g. "I", "II" — shown as a small numeral in nav. */
  numeral: string
  title: string
  summary?: string
  topics: TopicMeta[]
}

export interface ModuleMeta {
  id: string
  title: string
  /** Short label for compact nav. */
  short: string
  summary: string
  status: ModuleStatus
  units: UnitMeta[]
}

export interface TopicRef {
  module: ModuleMeta
  unit: UnitMeta
  topic: TopicMeta
  /** Zero-based position across the whole module (for prev/next). */
  index: number
}

/** Flatten a module's topics in reading order. */
export function flattenTopics(module: ModuleMeta): TopicRef[] {
  const out: TopicRef[] = []
  for (const unit of module.units) {
    for (const topic of unit.topics) {
      out.push({ module, unit, topic, index: out.length })
    }
  }
  return out
}

export function findTopic(module: ModuleMeta, unitId: string, topicId: string): TopicRef | undefined {
  return flattenTopics(module).find((r) => r.unit.id === unitId && r.topic.id === topicId)
}

export function neighbors(module: ModuleMeta, ref: TopicRef): { prev?: TopicRef; next?: TopicRef } {
  const all = flattenTopics(module)
  return { prev: all[ref.index - 1], next: all[ref.index + 1] }
}
