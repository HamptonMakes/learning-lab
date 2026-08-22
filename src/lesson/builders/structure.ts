/**
 * Structure builders (docs/animation-dsl.md §8.1): `topic`, `scene`, `step`. `step()` flattens
 * nested arrays so macros and aliases that return command lists drop in anywhere a command goes.
 */
import type { Command, Scene, SceneId, SceneWorld, Step, StepId, Topic, TryIt } from '../types'
import { compact } from './internal'

/** A command, or an arbitrarily nested list of commands (macros expand to lists). */
export type CommandInput = Command | ReadonlyArray<CommandInput>

/** Flatten nested command lists into one ordered list (what `step()` stores in `do`). */
export function flattenCommands(cmds: ReadonlyArray<CommandInput>): Command[] {
  const out: Command[] = []
  const visit = (c: CommandInput): void => {
    if (Array.isArray(c)) for (const inner of c as ReadonlyArray<CommandInput>) visit(inner)
    else out.push(c as Command)
  }
  for (const c of cmds) visit(c)
  return out
}

function makeStep(hold: Step['hold'] | undefined) {
  return (id: StepId, say: string, ...cmds: CommandInput[]): Step =>
    compact({ id, say, do: flattenCommands(cmds), hold })
}

/**
 * `step('s01', 'One or two sentences.', ...cmds)` — hold `normal`; `step.long(...)` /
 * `step.short(...)` set `hold`. Ids are explicit strings (`s01`), never generated.
 */
export const step = Object.assign(makeStep(undefined), {
  long: makeStep('long'),
  short: makeStep('short'),
})

export type SceneOpts = {
  title?: string
  inContext?: boolean
  startFrom?: SceneId
  tryIt?: TryIt
}

/**
 * `scene(id, world | null, steps, opts?)`. Pass `null` for the world together with
 * `opts.startFrom` to inherit an earlier scene's final world.
 */
export function scene(
  id: SceneId,
  world: SceneWorld | null,
  steps: ReadonlyArray<Step>,
  opts?: SceneOpts,
): Scene {
  return compact({
    id,
    title: opts?.title,
    inContext: opts?.inContext,
    world: world === null ? undefined : world,
    startFrom: opts?.startFrom,
    steps: [...steps],
    tryIt: opts?.tryIt,
  })
}

/** `topic({ id, title, goal, whenToUse, whenNotToUse, realWorld, scenes })` — typed identity. */
export function topic(t: Topic): Topic {
  return { ...t }
}
