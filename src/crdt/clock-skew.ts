/**
 * Clock skew helpers for the "wall clocks lie" lesson. No machine's clock is exactly right: each
 * one runs a little fast or slow (its skew). A last-writer-wins register trusts the timestamp on
 * each write, so a node whose clock is behind can lose a write that really happened later. This
 * file has no clock logic of its own — it only stages that pitfall with the real `compareStamp`
 * rule so tests and docs can point at concrete numbers.
 *
 * Metadata ("sidecar") the demo carries, per write: who wrote, what, the true time, that node's
 * skew, and the time the node actually stamped (`trueTime + skewMs`). `winner` is whichever stamp
 * `compareStamp` ranks higher — exactly what an LWW register would keep.
 */
import { compareStamp, type NodeId } from './types'

/** The time a node with `skewMs` of drift reads when the true time is `trueNow`. */
export function skewedNow(trueNow: number, skewMs: number): number {
  return trueNow + skewMs
}

export interface SkewedWrite {
  node: NodeId
  value: string
  /** When the write really happened (ms). */
  trueTime: number
  /** How far this node's clock is off: negative = behind, positive = ahead. */
  skewMs: number
  /** The timestamp the node put on the write: `trueTime + skewMs`. */
  stampedTime: number
}

export interface LwwSkewDemo {
  /** In true-time order: `first` really happened before `second`. */
  first: SkewedWrite
  second: SkewedWrite
  /** The write an LWW register keeps (highest stamp, ties by node id). */
  winner: SkewedWrite
  loser: SkewedWrite
  /** The lesson's "whoops": the write that really happened last is the one that lost. */
  laterWriteLost: boolean
}

/**
 * Two writes to one LWW register. Bob's clock is right; Alice's is off by `aliceSkewMs`
 * (default: 5 seconds behind). Bob writes first; Alice writes two seconds later in real time.
 * With the default skew, Alice's stamp is older than Bob's, so Bob's write wins — the later
 * write is lost.
 */
export function demonstrateLwwSkew(aliceSkewMs = -5_000): LwwSkewDemo {
  const first: SkewedWrite = {
    node: 'bob',
    value: 'draft',
    trueTime: 10_000,
    skewMs: 0,
    stampedTime: skewedNow(10_000, 0),
  }
  const second: SkewedWrite = {
    node: 'alice',
    value: 'final',
    trueTime: 12_000,
    skewMs: aliceSkewMs,
    stampedTime: skewedNow(12_000, aliceSkewMs),
  }
  const cmp = compareStamp(
    { ts: first.stampedTime, node: first.node },
    { ts: second.stampedTime, node: second.node },
  )
  const winner = cmp > 0 ? first : second
  const loser = winner === first ? second : first
  return { first, second, winner, loser, laterWriteLost: loser === second }
}
