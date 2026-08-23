import { describe, expect, it } from 'vitest'
import { lwwRegisterTopic } from '../fixtures/lww-register'
import { applyStep } from '../reducer'
import { buildTimeline } from '../reducer/timeline'
import { buildPresentation, FLOW_SCENE } from '../presentation'
import { deriveControls } from '../sandbox'
import type { Frame, Step, World } from '../types'
import { beatFor, inputFor, mulberry32, planFlowStep, seedOf } from './autopilot'
import { registeredTopicKeys, topicLoaders } from '@/content/registry'

/** Runs `steps` beats of the autopilot from `world`, through the real reducer; throws on a ReducerError. */
function drive(world: World, seed: number, steps: number, sceneId = 'flow') {
  const rng = mulberry32(seed)
  const beats: string[] = []
  let w = world
  for (let n = 0; n < steps; n += 1) {
    const plan = planFlowStep(w, rng, n)
    if (!plan) break
    beats.push(plan.beat)
    const step: Step = { id: `x${n + 1}`, say: 'flow', do: plan.commands }
    w = applyStep(w, step, { sceneId, stepId: step.id, assertMode: 'warn' }).world
  }
  return { world: w, beats }
}

describe('mulberry32 / seedOf', () => {
  it('is deterministic and stays in [0, 1)', () => {
    const a = mulberry32(42)
    const b = mulberry32(42)
    const xs = Array.from({ length: 50 }, () => a())
    const ys = Array.from({ length: 50 }, () => b())
    expect(xs).toEqual(ys)
    for (const x of xs) expect(x >= 0 && x < 1).toBe(true)
    expect(seedOf('crdts/g-counter')).toBe(seedOf('crdts/g-counter'))
    expect(seedOf('a')).not.toBe(seedOf('b'))
  })
})

describe('planFlowStep on the LWW register lesson', () => {
  const lesson = buildTimeline(lwwRegisterTopic)
  const last = lesson[lesson.length - 1] as Frame
  it('keeps the rhythm: updates, syncs on the sync beats, and never asks the real code for something it refuses', () => {
    const { beats } = drive(last.world, 7, 40)
    expect(beats.length).toBe(40)
    expect(beats.filter((b) => b === 'update').length).toBeGreaterThan(10)
    expect(beats.filter((b) => b === 'sync').length).toBeGreaterThan(5)
    expect(new Set(beats)).not.toContain('offline') // only two actors: nobody goes offline
  })
  it('plans only enabled controls with valid inputs', () => {
    const rng = mulberry32(3)
    for (let n = 0; n < 30; n += 1) {
      const plan = planFlowStep(last.world, rng, n)
      expect(plan).toBeDefined()
      expect(plan?.control.disabled).toBeUndefined()
      expect(plan?.commands.length).toBeGreaterThan(0)
      if (plan?.control.prompt?.kind === 'number') expect(Number(plan.input?.value)).not.toBeNaN()
      if (plan?.control.prompt?.kind === 'text') expect(plan.input?.value).toBeTruthy()
    }
  })
  it('converges once everything is delivered and synced', () => {
    const { world } = drive(last.world, 11, 37)
    // settle: deliver whatever is in flight, then sync every pair, a few times
    let w = world
    for (let round = 0; round < 4; round += 1) {
      const controls = deriveControls(w)
      const ids = controls.network.filter((c) => c.disabled === undefined)
      for (const c of ids) {
        if (c.action !== 'deliverAll' && c.action !== 'sync') continue
        const step: Step = { id: `settle-${round}-${c.id}`, say: 'settle', do: c.commands() }
        w = applyStep(w, step, { sceneId: 'flow', stepId: step.id, assertMode: 'warn' }).world
      }
    }
    const slots = new Set(Object.values(w.replicas).flatMap((s) => Object.keys(s)))
    expect(slots.size).toBeGreaterThan(0)
    for (const slot of slots) {
      const holders = Object.values(w.actors).filter((a) => a.holds[slot] !== undefined)
      const values = holders.map((a) => JSON.stringify(a.holds[slot]))
      expect(holders.length, slot).toBeGreaterThan(1)
      expect(new Set(values).size, slot).toBe(1)
    }
  })
  it('fills prompts sensibly', () => {
    const controls = deriveControls(last.world)
    const actor = controls.actors[0]
    const op = actor?.slots[0]?.ops.find((o) => o.prompt?.kind === 'text')
    if (actor && op) {
      const input = inputFor(
        op,
        last.world,
        actor.actor.id,
        actor.slots[0]?.slot ?? '',
        mulberry32(1),
      )
      expect(typeof input?.value).toBe('string')
    }
    expect(beatFor(last.world, mulberry32(1), 2)).toBe('sync')
    expect(beatFor(last.world, mulberry32(1), 0)).toBe('update')
  })
})

describe('planFlowStep across every lesson with replicas', () => {
  it('runs 30 beats on each without a ReducerError', async () => {
    const keys = registeredTopicKeys()
    let flows = 0
    for (const key of keys) {
      const loader = topicLoaders[key]
      if (!loader) continue
      const topic = (await loader()).default
      const frames = buildPresentation(topic, {
        title: 't',
        subtitle: 's',
        labels: { use: 'u', avoid: 'a', world: 'w' },
        assertMode: 'warn',
      })
      const flow = frames.find((f) => f.sceneId === FLOW_SCENE)
      if (!flow) continue
      flows += 1
      const { beats } = drive(flow.world, seedOf(key), 30, 'flow')
      expect(beats.length, key).toBe(30)
    }
    expect(flows).toBeGreaterThan(20)
  }, 60_000)
})
