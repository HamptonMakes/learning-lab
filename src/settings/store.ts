/**
 * Tiny typed localStorage store with Zod validation and cross-tab sync.
 * All persisted user state goes through createLocalStore — never touch localStorage directly elsewhere.
 */
import type { z } from 'zod'

export type Listener = () => void

export interface LocalStore<T> {
  readonly key: string
  get(): T
  set(next: T): void
  patch(partial: Partial<T>): void
  reset(): void
  subscribe(listener: Listener): () => void
}

function safeStorage(): Storage | null {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return null
    return window.localStorage
  } catch {
    return null
  }
}

export function createLocalStore<T extends object>(
  key: string,
  schema: z.ZodType<T>,
  defaults: T,
): LocalStore<T> {
  const storage = safeStorage()
  const listeners = new Set<Listener>()
  let cache: T | null = null

  const read = (): T => {
    if (!storage) return defaults
    const raw = storage.getItem(key)
    if (raw == null) return defaults
    try {
      const parsed = schema.safeParse({ ...defaults, ...(JSON.parse(raw) as object) })
      return parsed.success ? parsed.data : defaults
    } catch {
      return defaults
    }
  }

  const emit = () => listeners.forEach((l) => l())

  const write = (next: T) => {
    cache = next
    try {
      storage?.setItem(key, JSON.stringify(next))
    } catch {
      /* quota or privacy mode: keep in-memory value */
    }
    emit()
  }

  if (storage && typeof window !== 'undefined') {
    window.addEventListener('storage', (e) => {
      if (e.key === key) {
        cache = null
        emit()
      }
    })
  }

  return {
    key,
    get: () => (cache ??= read()),
    set: write,
    patch: (partial) => write({ ...(cache ??= read()), ...partial }),
    reset: () => write(defaults),
    subscribe: (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
  }
}
