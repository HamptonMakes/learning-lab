/**
 * Keyboard transport for the topic page (stage-architecture §8, DSL §7):
 *   ArrowRight / ArrowLeft  next / prev (swapped in RTL, like the mirrored transport buttons)
 *   Space                   play / pause (default prevented so the page does not scroll)
 *   Home / End              first / last frame
 *   . / ,                   speed up / down through SPEEDS
 *   Escape                  pause
 * Ignored while typing (input / textarea / select / contenteditable), while a Radix dialog or
 * menu is open, and when a modifier (meta / ctrl / alt) is held. Space is also left alone when a
 * button or link has focus: its native activation already does the right thing (and would
 * otherwise double up with ours).
 */
import { useEffect } from 'react'
import { SPEEDS, type Speed } from '@/settings'
import type { PlayerApi } from './usePlayer'

export type KeyboardTransportApi = Pick<
  PlayerApi,
  'state' | 'next' | 'prev' | 'toggle' | 'pause' | 'seek' | 'setSpeed'
>

export interface KeyboardTransportOptions {
  enabled?: boolean
  dir?: 'ltr' | 'rtl'
}

const EDITABLE = 'input, textarea, select, [contenteditable]:not([contenteditable="false"])'
const ACTIVATABLE = 'button, a[href], [role="button"], summary'
const OVERLAY_OPEN = '[role="dialog"][data-state="open"], [data-radix-popper-content-wrapper]'

/** Next / previous speed in SPEEDS; clamped at both ends. */
export function stepSpeed(speed: Speed, delta: 1 | -1): Speed {
  const i = SPEEDS.indexOf(speed)
  const at = i === -1 ? SPEEDS.indexOf(1) : i
  return SPEEDS[Math.min(SPEEDS.length - 1, Math.max(0, at + delta))] ?? speed
}

/** Exported for tests: decide and perform the action for one keydown. Returns true if handled. */
export function handleTransportKey(
  e: KeyboardEvent,
  api: KeyboardTransportApi,
  dir: 'ltr' | 'rtl',
  doc: Document = document,
): boolean {
  if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return false
  const target = e.target instanceof Element ? e.target : null
  if (target?.closest(EDITABLE)) return false
  if (doc.querySelector(OVERLAY_OPEN)) return false

  const forward = dir === 'rtl' ? 'ArrowLeft' : 'ArrowRight'
  const backward = dir === 'rtl' ? 'ArrowRight' : 'ArrowLeft'
  const { total, speed } = api.state

  switch (e.key) {
    case forward:
      api.next()
      break
    case backward:
      api.prev()
      break
    case ' ':
    case 'Spacebar':
      if (target?.closest(ACTIVATABLE)) return false
      api.toggle()
      break
    case 'Home':
      api.seek(0)
      break
    case 'End':
      api.seek(Math.max(0, total - 1))
      break
    case '.':
      api.setSpeed(stepSpeed(speed, 1))
      break
    case ',':
      api.setSpeed(stepSpeed(speed, -1))
      break
    case 'Escape':
      api.pause()
      break
    default:
      return false
  }
  e.preventDefault()
  return true
}

export function useKeyboardTransport(
  api: KeyboardTransportApi,
  { enabled = true, dir = 'ltr' }: KeyboardTransportOptions = {},
): void {
  useEffect(() => {
    if (!enabled) return
    const onKeyDown = (e: KeyboardEvent) => {
      handleTransportKey(e, api, dir)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [api, enabled, dir])
}
