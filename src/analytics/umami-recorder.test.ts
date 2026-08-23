import { afterEach, describe, expect, it } from 'vitest'
import { createUmamiProvider } from './umami'

afterEach(() => {
  document.head.innerHTML = ''
})

describe('umami recorder', () => {
  it('injects the session-replay recorder next to the tracker when configured', () => {
    const p = createUmamiProvider({
      scriptUrl: 'https://a.example/script.js',
      websiteId: 'w1',
      recorderUrl: 'https://a.example/recorder.js',
    })
    p.init()
    p.init() // idempotent
    const scripts = Array.from(document.head.querySelectorAll('script'))
    expect(scripts.map((s) => s.src)).toEqual([
      'https://a.example/script.js',
      'https://a.example/recorder.js',
    ])
    const rec = scripts[1]
    expect(rec?.dataset.websiteId).toBe('w1')
    expect(rec?.dataset.sampleRate).toBe('0.15')
    expect(rec?.dataset.maskLevel).toBe('moderate')
    expect(rec?.defer).toBe(true)
  })
  it('injects only the tracker without a recorder url', () => {
    createUmamiProvider({ scriptUrl: 'https://a.example/script.js', websiteId: 'w1' }).init()
    expect(document.head.querySelectorAll('script')).toHaveLength(1)
  })
})
