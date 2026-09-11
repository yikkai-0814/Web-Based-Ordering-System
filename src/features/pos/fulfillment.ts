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
