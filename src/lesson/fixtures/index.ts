/**
 * Lesson fixtures: the docs/animation-dsl.md §15 worked examples and a kitchen-sink topic that
 * uses every command once. Shared by the reducer, stage, lint and builder tests.
 */
export { lwwRegisterTopic } from './lww-register'
export { orSetTagsTopic } from './or-set-tags'
export { uuidV7Topic } from './uuid-v7'
export { kitchenSinkTopic } from './kitchen-sink'

import type { Topic } from '../types'
import { kitchenSinkTopic } from './kitchen-sink'
import { lwwRegisterTopic } from './lww-register'
import { orSetTagsTopic } from './or-set-tags'
import { uuidV7Topic } from './uuid-v7'

/** Every fixture topic, in spec order. */
export const fixtureTopics: readonly Topic[] = [
  lwwRegisterTopic,
  orSetTagsTopic,
  uuidV7Topic,
  kitchenSinkTopic,
]
