/**
 * Fulfilment — how far an order has got through being made and handed over.
 *
 * Pure: no React, no Firestore, no clock, the same split as cart.ts, voids.ts and
 * payments.ts. The transition rules live here so they can be tested exhaustively, and the
 * security rules mirror them; neither is the other's enforcement.
 *
 * **Fulfilment and payment are two independent axes.** An order can be delivered and unpaid,
 * or paid and still being made — a stall takes money whenever the customer offers it, which
 * is not necessarily when the food is ready. Collapsing the two into one `status` field
 * would make half the real states unrepresentable, so there is deliberately no such field
 * anywhere in this system. "Completed" is not stored at all: it is derived, below, from both
 * axes at read time.
 *
 * **Fulfilment is not on the order document.** Orders are immutable, so it lives in its own
 * document, `orderFulfillment/{orderId}` — the same mechanism as a void and a payment. See
 * firestore.rules.
 */

import type { PaymentState } from '@/features/pos/payments'
import type { PaymentMethod } from '@/features/pos/types'

/** In order. The array order IS the progression, and `nextFulfillment` relies on it. */
export const FULFILLMENT_STATUSES = ['pending', 'preparing', 'ready', 'delivered'] as const

export type FulfillmentStatus = (typeof FULFILLMENT_STATUSES)[number]

export const FULFILLMENT_LABELS: Record<FulfillmentStatus, string> = {
  pending: 'Pending',
  preparing: 'Preparing',
  ready: 'Ready',
  delivered: 'Delivered',
}

/**
 * The wording on the button that advances each step — what the person is about to do, not
 * the state they are leaving.
 */
export const FULFILLMENT_ACTIONS: Record<FulfillmentStatus, string | null> = {
  pending: 'Start preparing',
  preparing: 'Mark ready',
  ready: 'Mark delivered',
  delivered: null,
}

export function isFulfillmentStatus(value: unknown): value is FulfillmentStatus {
  return typeof value === 'string' && (FULFILLMENT_STATUSES as readonly string[]).includes(value)
}

/**
 * `delivered` is the final state for every order.
 *
 * There is deliberately no separate `collected` for takeaway: the system does not record how
 * an order is served, so a second terminal state would be a distinction nothing could
 * actually set. One final state, meaning "the customer has it".
 */
export const FINAL_FULFILLMENT = 'delivered' as const satisfies FulfillmentStatus

/** Where an order starts. Represented by the ABSENCE of a fulfilment document. */
export const INITIAL_FULFILLMENT = 'pending' as const satisfies FulfillmentStatus

/** The next status along, or null at the end. */
export function nextFulfillment(current: FulfillmentStatus): FulfillmentStatus | null {
  const index = FULFILLMENT_STATUSES.indexOf(current)
  return FULFILLMENT_STATUSES[index + 1] ?? null
}

/** The one before, or null at the start. Used only for an admin correcting a mis-tap. */
export function previousFulfillment(current: FulfillmentStatus): FulfillmentStatus | null {
  const index = FULFILLMENT_STATUSES.indexOf(current)
  return index <= 0 ? null : (FULFILLMENT_STATUSES[index - 1] ?? null)
}

/**
 * Whether a status change is a legal single step forward.
 *
 * Exactly one place, never backward, never skipping. Skipping is refused rather than
 * tolerated because a client that can jump straight to `delivered` can also jump an order
 * it should not have touched, and a kitchen that genuinely never prepares anything is a
 * workflow question, not a permission one.
 */
export function isForwardStep(from: FulfillmentStatus, to: FulfillmentStatus): boolean {
  return nextFulfillment(from) === to
}

/** Whether a change is a legal single step backward — an admin-only correction. */
export function isBackwardStep(from: FulfillmentStatus, to: FulfillmentStatus): boolean {
  return previousFulfillment(from) === to
}

/**
 * The minimum an order needs to expose for fulfilment to be resolved.
 *
 * `paymentMethod` is the LEGACY inline field — see `PayableOrder` in payments.ts. Its
 * presence is what identifies a sale rung up before either of these workflows existed.
 */
export interface FulfillableOrder {
  paymentMethod: PaymentMethod | null
}

/** The parts of a fulfilment document that decide how an order is displayed. */
export interface RecordedFulfillment {
  status: FulfillmentStatus
}

/**
 * How far along an order is.
 *
 * | Situation                                    | Result                                   |
 * | -------------------------------------------- | ---------------------------------------- |
 * | A fulfilment document exists                  | its status                               |
 * | None, but the order carries inline payment    | **delivered** — see below                |
 * | None                                          | pending                                  |
 *
 * The middle row is the legacy story. Orders written before payment and fulfilment were
 * separate steps were rung up and handed over across the counter in one motion, so they were
 * delivered; reading them as `pending` would be false, and would leave every historical sale
 * sitting forever in a queue of work nobody is going to do. Orders placed under the current
 * flow have no inline payment, so they correctly start at `pending`.
 */
export function resolveFulfillmentState(
  order: FulfillableOrder,
  fulfillment: RecordedFulfillment | null,
): FulfillmentStatus {
  if (fulfillment) return fulfillment.status
  if (order.paymentMethod !== null) return FINAL_FULFILLMENT
  return INITIAL_FULFILLMENT
}

/**
 * The single line a person reads to know where an order stands.
 *
 * `completed` requires BOTH axes to be finished. `payment-outstanding` is the state this
 * whole feature exists for: the food is with the customer and the money is not in the till
 * — a fact that must be impossible to mistake for "done", because it is the one state that
 * needs somebody to go and do something about it.
 */
export type OverallStatus =
  'voided' | 'completed' | 'payment-outstanding' | 'pending' | 'preparing' | 'ready'

export const OVERALL_LABELS: Record<OverallStatus, string> = {
  voided: 'Voided',
  completed: 'Completed',
  'payment-outstanding': 'Payment outstanding',
  pending: 'Pending',
  preparing: 'Preparing',
  ready: 'Ready',
}

/**
 * Derives the overall state. Never stored — storing it would be a third piece of state that
 * could contradict the two it is derived from.
 *
 * Voided comes first: a cancelled sale is neither in progress nor completed, whatever the
 * other two axes say. Otherwise fulfilment leads until it is finished, because a paid order
 * that is still being made is, to everyone involved, still being made.
 */
export function overallStatusOf({
  fulfillment,
  payment,
  voided,
}: {
  fulfillment: FulfillmentStatus
  payment: PaymentState
  voided: boolean
}): OverallStatus {
  if (voided) return 'voided'
  if (fulfillment !== FINAL_FULFILLMENT) return fulfillment
  return payment.status === 'paid' ? 'completed' : 'payment-outstanding'
}

/** True only when both axes are finished. The definition of done, in one place. */
export function isCompleted(overall: OverallStatus): boolean {
  return overall === 'completed'
}

export type FulfillmentEligibility =
  { ok: true; next: FulfillmentStatus } | { ok: false; reason: string }

/**
 * Whether fulfilment may be advanced, and to what.
 *
 * Mirrors what firestore.rules enforces, so the button can be hidden with a reason rather
 * than letting the counter discover the refusal from a failed write. A voided order stops
 * here: it is cancelled, and pushing it further through the kitchen would be work on a sale
 * that no longer exists.
 */
export function canAdvanceFulfillment({
  current,
  voided,
}: {
  current: FulfillmentStatus
  voided: boolean
}): FulfillmentEligibility {
  if (voided) {
    return { ok: false, reason: 'This sale was voided, so it cannot be worked on further.' }
  }
  const next = nextFulfillment(current)
  if (!next) return { ok: false, reason: 'This order has already been delivered.' }
  return { ok: true, next }
}

/**
 * Keys fulfilment records by the order they belong to, so a list renders without a lookup
 * per row. The triplet of `indexVoidsByOrderId` and `indexPaymentsByOrderId`.
 */
export function indexFulfillmentsByOrderId<T extends { orderId: string }>(
  records: readonly T[],
): Map<string, T> {
  const index = new Map<string, T>()
  for (const entry of records) index.set(entry.orderId, entry)
  return index
}

/* ---------------------------------------------------------------------------
 * Order elapsed time
 *
 * How long the customer has been waiting: `order.createdAt` until the order is handed over.
 * It starts the instant the sale is rung up and stops at exactly one moment — delivery.
 *
 * Nothing else stops it, pauses it or resets it. Not payment, which lives in a different
 * document this never reads. Not the kitchen picking the ticket up, and not the kitchen
 * finishing it: an order that has been sitting on the pass for six minutes is still an order
 * the customer has not been given, and a clock that stopped at `ready` would hide precisely
 * the wait worth seeing.
 *
 * `readyAt` is still recorded — it answers "when did this become ready?" — but it has no say
 * in this number.
 *
 * There is no separate START timestamp. `order.createdAt` already records when the clock
 * began, on a document that is immutable, so storing a second one would be a fact that could
 * disagree with itself. Only the END is recorded, on the fulfilment sidecar, because nothing
 * else knows when the order was handed over.
 *
 * Nothing here reads a clock. The elapsed value is derived at render time from the stored
 * timestamps and a `now` the caller supplies, so a running timer costs no writes — see
 * `useNow`.
 * ------------------------------------------------------------------------- */

/**
 * What a transition should do to a recorded timestamp.
 *
 * `'now'` is the server's own time for this write, `'keep'` leaves the stored value alone,
 * and `null` clears it. Deliberately a description rather than a value: the API turns it
 * into `serverTimestamp()` (or into not writing the field at all) and firestore.rules checks
 * the same tables against `request.time`, so the two agree without either trusting the other.
 */
export type TimestampInstruction = 'now' | 'keep' | null

/**
 * When the order was handed over — the one thing that stops the clock.
 *
 * | Step                | deliveredAt | Why                                             |
 * | ------------------- | ----------- | ----------------------------------------------- |
 * | ready → delivered   | now         | the customer has it; the wait is over           |
 * | delivered → ready   | null        | it was not handed over after all; clock resumes |
 * | every other step    | null        | the order is not delivered, so it cannot claim  |
 *
 * There is no `keep`, and that is what makes the rule total: an order is delivered or it is
 * not, `delivered` is reachable only from `ready`, and the only way out of it clears the
 * stamp. A re-delivery after an admin correction records the second handover, which is the
 * one that actually happened.
 */
export function nextDeliveredAt(
  _from: FulfillmentStatus,
  to: FulfillmentStatus,
): TimestampInstruction {
  return to === FINAL_FULFILLMENT ? 'now' : null
}

/**
 * When the order became ready. Kept for the question it answers; it does NOT stop the timer.
 *
 * | Step                   | readyAt | Why                                              |
 * | ---------------------- | ------- | ------------------------------------------------ |
 * | pending → preparing    | null    | not finished                                     |
 * | preparing → ready      | now     | the kitchen finished it                          |
 * | ready → delivered      | keep    | handing over does not un-finish it               |
 * | delivered → ready      | keep    | a fulfilment correction, not a remake            |
 * | ready → preparing      | null    | it is being worked on again                      |
 * | preparing → pending    | null    | already null; stated so the table is total       |
 */
export function nextReadyAt(from: FulfillmentStatus, to: FulfillmentStatus): TimestampInstruction {
  if (to === 'ready') {
    // Arriving from `preparing` is the kitchen finishing. Arriving from `delivered` is an
    // admin undoing a mis-tap, which must not overwrite the time it was really finished.
    return from === 'preparing' ? 'now' : 'keep'
  }
  if (to === FINAL_FULFILLMENT) return 'keep'
  return null
}

/**
 * Anything that converts to a Date — a Firestore `Timestamp`, or a stand-in in a test.
 *
 * Structural on purpose: this module stays free of Firestore imports, exactly as cart.ts,
 * payments.ts and voids.ts do.
 */
export interface DateLike {
  toDate(): Date
}

/** The order half of the window: when the clock started. */
export interface TimeableOrder {
  createdAt: DateLike | null
}

/** The fulfilment half: when it was handed over, if it has been. */
export interface DeliverableFulfillment {
  deliveredAt: DateLike | null
}

/** When the clock started and, if it has stopped, when it stopped. */
export interface ElapsedWindow {
  startedAt: Date | null
  finishedAt: Date | null
}

/**
 * The window for one order: creation to delivery.
 *
 * `startedAt` is null only while a just-placed order's `createdAt` is still an unresolved
 * server timestamp in the local cache — a frame or two, after which it fills in.
 */
export function elapsedWindowOf(
  order: TimeableOrder | null,
  fulfillment: DeliverableFulfillment | null,
): ElapsedWindow {
  return {
    startedAt: order?.createdAt?.toDate() ?? null,
    finishedAt: fulfillment?.deliveredAt?.toDate() ?? null,
  }
}

/**
 * How long the order has taken, in milliseconds, or null when the start is not known yet.
 *
 * Still running: measured against the `now` the caller passes. Delivered: frozen at
 * `finishedAt`, so the number stops the instant the customer is handed the order and stays
 * available for the rest of its life.
 *
 * Clamped at zero. A finish before the start should be impossible — one comes from the
 * order's own creation and the other from the server's clock — but a negative duration on a
 * kitchen display would be a worse answer than nothing.
 */
export function elapsedMsOf(window: ElapsedWindow, now: number): number | null {
  if (!window.startedAt) return null
  const end = window.finishedAt ? window.finishedAt.getTime() : now
  return Math.max(0, end - window.startedAt.getTime())
}

/** True once the order has been handed over — the duration shown is final, not ticking. */
export function isElapsedFinished(window: ElapsedWindow): boolean {
  return window.startedAt !== null && window.finishedAt !== null
}

/**
 * A duration as a counter reads it: `4:12`, or `1:03:47` once it runs past an hour.
 *
 * Seconds are floored rather than rounded so a timer never shows a second that has not
 * elapsed yet, and minutes and seconds are always two digits past their first unit so the
 * text does not change width while it ticks.
 */
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const seconds = total % 60
  const minutes = Math.floor(total / 60) % 60
  const hours = Math.floor(total / 3600)

  const pad = (value: number) => value.toString().padStart(2, '0')
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${minutes}:${pad(seconds)}`
}

/**
 * What the number means, for anything that cannot see the clock icon beside it.
 *
 * A duration on an order card is ambiguous on its own — it could as easily be a countdown or
 * a preparation time — so this is the readout's accessible name rather than a decoration.
 */
export const ELAPSED_LABEL = 'Time since ordered'

/** The same, once it has stopped. */
export const ELAPSED_FINAL_LABEL = 'Total time to delivery'
