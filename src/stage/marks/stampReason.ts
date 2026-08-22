/**
 * The reason line on a `stamp`-rule verdict chip (DSL §10 rule 2): `ts 1 < 2` when the stamps
 * differ, `ts = → node` when equal stamps were broken by the node id. Read from the end-of-step
 * world, so the chip shows exactly what the reducer compared.
 */
import type { Path, Verdict, World } from '@/lesson/types'
import { getAt } from '@/lesson/path'

export function stampReason(world: World, paths: Path[], verdict: Verdict): string | undefined {
  const [pa, pb] = paths
  if (!pa || !pb) return undefined
  const a = getAt(world, pa)?.meta
  const b = getAt(world, pb)?.meta
  if (!a || !b || a.ts === undefined || b.ts === undefined) return undefined
  if (a.ts !== b.ts) return `ts ${a.ts} ${a.ts < b.ts ? '<' : '>'} ${b.ts}`
  return verdict === 'equal' ? 'ts =' : 'ts = → node'
}
