/**
 * Topic registry: discovers every lesson module under src/content/<module>/<unit>/<topic>.ts and
 * loads it lazily (one chunk per topic). A topic file exports its Topic as `default`.
 * Keys are `${module}/${unit}/${topic}` — the same ids as the catalog and the URL.
 */
import type { Topic } from '@/lesson/types'

type Loader = () => Promise<{ default: Topic }>

const modules = import.meta.glob<{ default: Topic }>('./*/*/*.ts')

const KEY_RE = /^\.\/([^/]+)\/([^/]+)\/([^/]+)\.ts$/

export const topicLoaders: Record<string, Loader> = Object.fromEntries(
  Object.entries(modules).flatMap(([file, loader]) => {
    const m = KEY_RE.exec(file)
    if (!m) return []
    const [, mod, unit, topic] = m
    if (!mod || !unit || !topic || topic.endsWith('.test') || topic.startsWith('_')) return []
    return [[`${mod}/${unit}/${topic}`, loader as Loader]]
  }),
)

export function topicKeyOf(module: string, unit: string, topic: string): string {
  return `${module}/${unit}/${topic}`
}

export function hasTopic(module: string, unit: string, topic: string): boolean {
  return topicKeyOf(module, unit, topic) in topicLoaders
}

export async function loadTopic(
  module: string,
  unit: string,
  topic: string,
): Promise<Topic | null> {
  const loader = topicLoaders[topicKeyOf(module, unit, topic)]
  if (!loader) return null
  const mod = await loader()
  return mod.default
}

/** All registered keys (for tests that walk every topic). */
export function registeredTopicKeys(): string[] {
  return Object.keys(topicLoaders).sort()
}
