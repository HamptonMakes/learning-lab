/**
 * Vitest (jsdom) setup. Stubs the browser APIs the stage needs for measurement and motion, and
 * makes every Motion animation instant so tests assert on static DOM contracts.
 */
import '@testing-library/jest-dom/vitest'
import { MotionGlobalConfig } from 'motion/react'

MotionGlobalConfig.skipAnimations = true

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver
}

if (typeof window !== 'undefined' && typeof window.matchMedia !== 'function') {
  window.matchMedia = (query: string) =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }) as MediaQueryList
}

if (typeof window !== 'undefined' && !('scrollTo' in window && typeof window.scrollTo === 'function')) {
  window.scrollTo = () => {}
}
