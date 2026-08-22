/**
 * Pure helpers behind the message layer: which arc a message travels, how tokens stack on one arc,
 * tray slots for parked tokens, and what this frame's change log says about token exits.
 * Kept free of React so the rules are unit-testable (DSL §4.3, stage-architecture §4–§5.2).
 */
import type { ActorId, Change, Message, MessageId, Path } from '@/lesson/types'
import type { Point, Rect } from '../geometry'

/** Travel duration in ms — the base of `tr('travel')` (transitions.ts); timers use `ms(TRAVEL_MS)`. */
export const TRAVEL_MS = 600

/** From this many tokens on one arc they collapse into a deck token. */
export const DECK_THRESHOLD = 4

/**
 * Arc bulge. `arcBetween` bends a positive bulge to the right of the travel direction, so one sign
 * already puts the two directions of a pair on opposite sides of the chord (two lanes, never
 * overlapping). Kept in one place so the policy is easy to change.
 */
export const ARC_BULGE = 0.18

export function bulgeFor(_message: Message): number {
  return ARC_BULGE
}

/** The arc endpoint path: `message.into` (a value node) when given, else the recipient card. */
export function arcEndpoint(message: Message): Path {
  return message.into ?? message.to
}

/** Tokens with the same key share one arc and stack on it. */
export function arcKey(message: Message): string {
  return `${message.from}→${arcEndpoint(message)}`
}

export interface ArcGroup {
  key: string
  from: ActorId
  to: ActorId
  endpoint: Path
  /** Flying messages on this arc in creation order (stack index = position). */
  messages: Message[]
}

/** Flying messages grouped by arc, groups and members in creation order. */
export function groupFlying(messages: readonly Message[]): ArcGroup[] {
  const groups = new Map<string, ArcGroup>()
  for (const m of messages) {
    if (m.state !== 'flying') continue
    const key = arcKey(m)
    const g = groups.get(key)
    if (g) g.messages.push(m)
    else groups.set(key, { key, from: m.from, to: m.to, endpoint: arcEndpoint(m), messages: [m] })
  }
  return [...groups.values()]
}

/** Parked messages → slot index in the recipient's inbox tray (creation order per recipient). */
export function traySlots(messages: readonly Message[]): ReadonlyMap<MessageId, number> {
  const next = new Map<ActorId, number>()
  const slots = new Map<MessageId, number>()
  for (const m of messages) {
    if (m.state !== 'parked') continue
    const i = next.get(m.to) ?? 0
    slots.set(m.id, i)
    next.set(m.to, i + 1)
  }
  return slots
}

/** Tray layout: tokens sit in one row from the tray's start edge; beyond 3 they stack under the third. */
export const TRAY_SLOT_W = 60
export const TRAY_GAP = 6
export const TRAY_VISIBLE = 3

/** Centre of the i-th tray slot (stage coordinates). Slots ≥ 3 stack under the third with a small drift. */
export function traySlotCenter(tray: Rect, slot: number, dir: 'ltr' | 'rtl' = 'ltr'): Point {
  const visible = Math.min(slot, TRAY_VISIBLE - 1)
  const drift = Math.max(0, slot - (TRAY_VISIBLE - 1)) * 4
  const along = TRAY_GAP + visible * (TRAY_SLOT_W + TRAY_GAP) + TRAY_SLOT_W / 2 + drift
  const x = dir === 'rtl' ? tray.x + tray.w - along : tray.x + along
  return { x, y: tray.y + tray.h / 2 + drift }
}

/** Translate from the arc end (where a parking token lands) to its tray slot. */
export function parkedDelta(
  arcEnd: Point,
  tray: Rect,
  slot: number,
  dir: 'ltr' | 'rtl' = 'ltr',
): Point {
  const c = traySlotCenter(tray, slot, dir)
  return { x: c.x - arcEnd.x, y: c.y - arcEnd.y }
}

export type ExitOutcome = 'delivered' | 'dropped'
/** Outcome per message that left the world this frame (consumed by exiting tokens via AnimatePresence `custom`). */
export type ExitInfo = Readonly<Record<MessageId, ExitOutcome>>

export function exitOutcomes(changes: readonly Change[]): ExitInfo {
  const out: Record<MessageId, ExitOutcome> = {}
  for (const c of changes) {
    if (c.kind !== 'message' || c.transient) continue
    if (c.op === 'delivered' || c.op === 'dropped') out[c.message.id] = c.op
  }
  return out
}

/** Ids with a given message event this frame (`sent` → enters from the arc start; `parked` → slides into the tray). */
export function messageIds(
  changes: readonly Change[],
  op: 'sent' | 'parked',
): ReadonlySet<MessageId> {
  const ids = new Set<MessageId>()
  for (const c of changes)
    if (c.kind === 'message' && c.op === op && !c.transient) ids.add(c.message.id)
  return ids
}

export interface TransientFlightSpec {
  message: Message
  outcome: ExitOutcome
}

/** Same-step send + deliver/drop (§4.3): one flight per message that lived and died inside this step. */
export function transientFlights(changes: readonly Change[]): TransientFlightSpec[] {
  const sent = new Map<MessageId, Message>()
  const out: TransientFlightSpec[] = []
  for (const c of changes) {
    if (c.kind !== 'message' || !c.transient) continue
    if (c.op === 'sent') sent.set(c.message.id, c.message)
    else if ((c.op === 'delivered' || c.op === 'dropped') && sent.has(c.message.id)) {
      out.push({ message: c.message, outcome: c.op })
      sent.delete(c.message.id)
    }
  }
  return out
}
