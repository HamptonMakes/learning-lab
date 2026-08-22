/**
 * The step event log. Commands append the events a state diff cannot see (a message that was sent
 * and delivered inside one step, a sync between two slots, the message a value landed `via`).
 * `applyStep` reconciles this log with `diffWorld` into `Frame.changes` (DSL §6 step 5, §14).
 */
import type { Change, MessageId, Path } from '../types'

/** Events a command may push. `via` is folded into the matching `value` change at reconcile time. */
export type ReducerEvent =
  | Extract<Change, { kind: 'message' }>
  | Extract<Change, { kind: 'sync' }>
  | { kind: 'via'; path: Path; message: MessageId }

export interface EventLog {
  readonly events: ReducerEvent[]
  push(event: ReducerEvent): void
  /** Mark a message event recorded earlier in this step as transient (sent and consumed in one step). */
  markTransient(messageId: MessageId): void
}

export function createEventLog(): EventLog {
  const events: ReducerEvent[] = []
  return {
    events,
    push(e) {
      events.push(e)
    },
    markTransient(id) {
      for (const e of events) {
        if (e.kind === 'message' && e.message.id === id) e.transient = true
      }
    },
  }
}
