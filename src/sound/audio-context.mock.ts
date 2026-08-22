/**
 * Test-only stand-in for AudioContext. Records every node it creates so tests can assert on what
 * a recipe scheduled (types, start/stop times) without a real audio engine.
 */
import { vi, type Mock } from 'vitest'

export interface MockParam {
  value: number
  setValueAtTime: Mock
  linearRampToValueAtTime: Mock
  exponentialRampToValueAtTime: Mock
}

function param(value = 0): MockParam {
  return {
    value,
    setValueAtTime: vi.fn(),
    linearRampToValueAtTime: vi.fn(),
    exponentialRampToValueAtTime: vi.fn(),
  }
}

export interface MockNode {
  kind: 'oscillator' | 'buffersource' | 'gain' | 'biquad'
  connect: Mock
  disconnect: Mock
  /** Present on oscillators and buffer sources. */
  start?: Mock
  stop?: Mock
  type?: string
  frequency?: MockParam
  gain?: MockParam
  Q?: MockParam
  buffer?: unknown
}

export class MockAudioContext {
  static instances: MockAudioContext[] = []

  state: AudioContextState = 'running'
  currentTime = 0
  sampleRate = 48_000
  destination = { kind: 'destination' }
  nodes: MockNode[] = []
  resume: Mock<() => Promise<void>> = vi.fn(() => {
    this.state = 'running'
    return Promise.resolve()
  })

  constructor() {
    MockAudioContext.instances.push(this)
  }

  private add(node: MockNode): MockNode {
    this.nodes.push(node)
    return node
  }

  createOscillator(): MockNode {
    return this.add({
      kind: 'oscillator',
      connect: vi.fn(),
      disconnect: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
      type: 'sine',
      frequency: param(440),
    })
  }

  createBufferSource(): MockNode {
    return this.add({
      kind: 'buffersource',
      connect: vi.fn(),
      disconnect: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
      buffer: null,
    })
  }

  createGain(): MockNode {
    return this.add({ kind: 'gain', connect: vi.fn(), disconnect: vi.fn(), gain: param(1) })
  }

  createBiquadFilter(): MockNode {
    return this.add({
      kind: 'biquad',
      connect: vi.fn(),
      disconnect: vi.fn(),
      type: 'lowpass',
      frequency: param(350),
      Q: param(1),
    })
  }

  createBuffer(_channels: number, length: number): { getChannelData: () => Float32Array } {
    const data = new Float32Array(length)
    return { getChannelData: () => data }
  }

  nodesOf(kind: MockNode['kind']): MockNode[] {
    return this.nodes.filter((n) => n.kind === kind)
  }

  /** Every scheduled source stop time, in seconds. */
  stopTimes(): number[] {
    return this.nodes.flatMap((n) => n.stop?.mock.calls ?? []).map((call) => call[0] as number)
  }
}

/** Replace the global AudioContext with the mock for the current test. Pair with vi.unstubAllGlobals(). */
export function installMockAudioContext(): typeof MockAudioContext {
  MockAudioContext.instances = []
  vi.stubGlobal('AudioContext', MockAudioContext)
  return MockAudioContext
}
