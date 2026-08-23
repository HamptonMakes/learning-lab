/**
 * Umami provider. Injects the tracker script once with auto-track off (we send page views
 * ourselves so SPA navigations count exactly once) and forwards typed events to
 * `window.umami.track`. Calls made before the script is ready are queued and flushed when it
 * loads (script `load` event, with a bounded poll as fallback). Nothing here may throw —
 * analytics must never break the app.
 */
import type { AnalyticsProvider } from './provider'

export interface UmamiOptions {
  /** e.g. https://cloud.umami.is/script.js */
  scriptUrl: string
  websiteId: string
  /** Where events are posted (`data-host-url`). Defaults to the script's origin. */
  hostUrl?: string
  /** Optional Umami session-replay recorder (recorder.js), injected next to the tracker. */
  recorderUrl?: string
}

type UmamiPayload = Record<string, unknown>

/**
 * The slice of Umami's tracker API we rely on. The callback form merges our fields into
 * Umami's base payload (website, hostname, screen, language, referrer, …); a payload with
 * `name`/`data` is an event, without them it is a page view.
 */
export interface UmamiTracker {
  track(build: (base: UmamiPayload) => UmamiPayload): unknown
}

declare global {
  interface Window {
    /** Set by the Umami tracker script once it has loaded. */
    umami?: UmamiTracker
  }
}

type Send = (umami: UmamiTracker) => unknown

const QUEUE_LIMIT = 200
const POLL_MS = 250
const POLL_MAX = 40 // 40 × 250ms = 10s

function findTracker(): UmamiTracker | undefined {
  return typeof window === 'undefined' ? undefined : window.umami
}

function hasScript(websiteId: string): boolean {
  return Array.from(document.querySelectorAll<HTMLScriptElement>('script[data-website-id]')).some(
    (script) => script.dataset.websiteId === websiteId,
  )
}

export function createUmamiProvider(options: UmamiOptions): AnalyticsProvider {
  const { scriptUrl, websiteId, hostUrl, recorderUrl } = options
  const queue: Send[] = []
  let injected = false
  let scriptFailed = false
  let lastPath: string | undefined
  let timer: ReturnType<typeof setInterval> | undefined
  let polls = 0

  const deliver = (umami: UmamiTracker, send: Send): void => {
    try {
      void Promise.resolve(send(umami)).catch(() => undefined)
    } catch {
      /* analytics must never throw */
    }
  }

  const stopPolling = (): void => {
    if (timer === undefined) return
    clearInterval(timer)
    timer = undefined
  }

  /** Drains the queue when the tracker is available. Returns true once it is. */
  const flush = (): boolean => {
    const umami = findTracker()
    if (!umami) return false
    stopPolling()
    for (let next = queue.shift(); next; next = queue.shift()) deliver(umami, next)
    return true
  }

  const startPolling = (): void => {
    if (timer !== undefined || typeof window === 'undefined') return
    polls = 0
    timer = setInterval(() => {
      polls += 1
      if (flush() || polls >= POLL_MAX) stopPolling()
    }, POLL_MS)
  }

  const enqueue = (send: Send): void => {
    const umami = findTracker()
    if (umami) {
      flush() // keep ordering if queued calls have not been flushed yet
      deliver(umami, send)
      return
    }
    if (scriptFailed) return
    if (queue.length >= QUEUE_LIMIT) queue.shift()
    queue.push(send)
    startPolling()
  }

  const buildScript = (): HTMLScriptElement => {
    const script = document.createElement('script')
    script.defer = true
    script.src = scriptUrl
    script.dataset.websiteId = websiteId
    script.dataset.autoTrack = 'false'
    if (hostUrl) script.dataset.hostUrl = hostUrl
    script.addEventListener('load', () => {
      flush()
    })
    script.addEventListener('error', () => {
      scriptFailed = true
      queue.length = 0
      stopPolling()
    })
    return script
  }

  const buildRecorder = (url: string): HTMLScriptElement => {
    const rec = document.createElement('script')
    rec.defer = true
    rec.src = url
    rec.dataset.websiteId = websiteId
    rec.dataset.sampleRate = '0.15'
    rec.dataset.maskLevel = 'moderate'
    rec.dataset.maxDuration = '300000'
    return rec
  }

  const init = (): void => {
    if (injected || typeof document === 'undefined') return
    injected = true
    try {
      if (!hasScript(websiteId)) document.head.appendChild(buildScript())
      if (recorderUrl && !document.querySelector(`script[src="${recorderUrl}"]`)) {
        document.head.appendChild(buildRecorder(recorderUrl))
      }
      startPolling()
    } catch {
      /* analytics must never throw */
    }
  }

  const pageview = (path: string): void => {
    try {
      lastPath = path
      const title = document.title
      enqueue((umami) => umami.track((base) => ({ ...base, url: path, title })))
    } catch {
      /* analytics must never throw */
    }
  }

  const track: AnalyticsProvider['track'] = (name, props) => {
    try {
      // With auto-track off, Umami's own notion of the URL is stale; attach the one we know.
      const url = lastPath ?? window.location.pathname
      enqueue((umami) => umami.track((base) => ({ ...base, url, name, data: props })))
    } catch {
      /* analytics must never throw */
    }
  }

  return { name: 'umami', init, track, pageview }
}
