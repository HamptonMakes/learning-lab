import { z } from 'zod'
import { createLocalStore } from './store'

/** Topic key = `${module}/${unit}/${topic}` */
export type TopicKey = string

const TopicProgressSchema = z.object({
  lastStep: z.number().int().nonnegative().default(0),
  totalSteps: z.number().int().nonnegative().default(0),
  completed: z.boolean().default(false),
  completedAt: z.string().optional(),
  lastVisitedAt: z.string().optional(),
})
export type TopicProgress = z.infer<typeof TopicProgressSchema>

export const ProgressSchema = z.object({
  topics: z.record(z.string(), TopicProgressSchema).default({}),
})
export type Progress = z.infer<typeof ProgressSchema>

export const PROGRESS_KEY = 'cs-lab:progress'
export const progressStore = createLocalStore<Progress>(PROGRESS_KEY, ProgressSchema, {
  topics: {},
})

export function topicKey(module: string, unit: string, topic: string): TopicKey {
  return `${module}/${unit}/${topic}`
}

export function recordStep(
  key: TopicKey,
  step: number,
  totalSteps: number,
  now = new Date(),
): void {
  const { topics } = progressStore.get()
  const prev = topics[key] ?? { lastStep: 0, totalSteps, completed: false }
  const completed = prev.completed || (totalSteps > 0 && step >= totalSteps - 1)
  progressStore.set({
    topics: {
      ...topics,
      [key]: {
        ...prev,
        lastStep: Math.max(prev.lastStep, step),
        totalSteps,
        completed,
        completedAt: completed ? (prev.completedAt ?? now.toISOString()) : prev.completedAt,
        lastVisitedAt: now.toISOString(),
      },
    },
  })
}

export function resetProgress(): void {
  progressStore.reset()
}
