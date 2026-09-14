/**
 * Pure rules for whether an order has been paid, and whether it may be.
 *
 * No React, no Firestore, no clock — the same split as cart.ts and voids.ts. The awkward
 * cases live here (an order written before pay-later existed, a voided order, a second
 * attempt to pay), so they can be tested exhaustively without an emulator.
 *
 * **Payment is not a field on the order.** It is its own document, `orderPayments/{orderId}`,
 * exactly as a void is. Orders are immutable at the database, and marking one paid would
 * mean granting update permission, which would reopen every field on every sale to whoever
 * can take money. Keying by the order id also makes paying twice impossible: the second
 * write is an update, and updates are denied. See firestore.rules.
 */

import type { TranslationKey } from '@/features/i18n/translations/en'
import { message, type Message } from '@/features/i18n/messages'
import type { PaymentMethod } from '@/features/pos/types'

/**
 * What the payment rules need from an order.
 *
 * `paymentMethod` here is the **legacy inline field**. Sales rung up before pay-later
 * existed captured payment at the moment of creation and carry it on the order document
 * itself; orders written since carry nothing, and their payment lives in its own document.
 * Structural rather than the full `Order` so this file stays testable with object literals.
 */
export interface PayableOrder {
  paymentMethod: PaymentMethod | null
  cashTendered: number | null
  changeGiven: number | null
}

/** The parts of a recorded payment that decide how an order is displayed. */
export interface RecordedPayment {
  method: PaymentMethod
  cashTendered: number | null
  changeGiven: number | null
}

export type PaymentStatus = 'paid' | 'unpaid'

export type PaymentState =
  | { status: 'unpaid' }
  | {
      status: 'paid'
      method: PaymentMethod
      cashTendered: number | null
      changeGiven: number | null
      /**
       * Where the answer came from, because it decides which timestamp is the moment of
       * payment.
       *
       * `recorded` — paid through the pay-later flow, so `orderPayments/{orderId}` holds
       * the detail, `paidAt` included. `legacy` — payment was captured at creation on the
       * order itself, so the order's own `createdAt` *is* when it was paid; there is no
       * separate `paidAt` and inventing one would be a fabrication.
       */
      source: 'recorded' | 'legacy'
    }

/**
 * Whether an order has been paid, and how.
 *
 * Three cases, in priority order:
 *
 * | Situation                                   | Result                                  |
 * | ------------------------------------------- | --------------------------------------- |
 * | A payment document exists                    | paid, `source: 'recorded'`              |
 * | No payment document, but inline method       | paid, `source: 'legacy'` — see below    |
 * | Neither                                      | unpaid                                  |
 *
 * The middle row is the whole migration story. Every order written before this change has
 * `paymentMethod` on it and always meant "paid"; treating that as paid is what keeps those
 * receipts reading correctly with no data migration and no backfill of immutable documents.
 * New orders are forbidden by the rules from carrying those fields at all, so the legacy
 * branch cannot be used to self-declare a new order paid.
 */
export function resolvePaymentState(
  order: PayableOrder,
  payment: RecordedPayment | null,
): PaymentState {
  if (payment) {
    return {
      status: 'paid',
      method: payment.method,
      cashTendered: payment.cashTendered,
      changeGiven: payment.changeGiven,
      source: 'recorded',
    }
  }

  if (order.paymentMethod !== null) {
    return {
      status: 'paid',
      method: order.paymentMethod,
      cashTendered: order.cashTendered,
      changeGiven: order.changeGiven,
      source: 'legacy',
    }
  }

  return { status: 'unpaid' }
}

export function isPaid(state: PaymentState): boolean {
  return state.status === 'paid'
}

export type PaymentEligibility = { ok: true } | { ok: false; reason: Message }

/**
 * Whether payment may be recorded against this order.
 *
 * Mirrors the two conditions firestore.rules enforces, so the button can be hidden and a
 * reason shown rather than letting the counter discover the refusal from a failed write.
 * This is user experience; the rules are the enforcement, and they are checked independently
 * of anything decided here.
 */
export function canRecordPayment({
  state,
  voided,
}: {
  state: PaymentState
  voided: boolean
}): PaymentEligibility {
  if (voided) {
    return { ok: false, reason: message('validation.voidedNoPayment') }
  }
  if (state.status === 'paid') {
    return { ok: false, reason: message('validation.alreadyPaid') }
  }
  return { ok: true }
}

/**
 * Deliberately shouty, and deliberately not sentence case: an unpaid order is money not yet
 * in the drawer, and the person at the counter has to see it at a glance across a busy till.
 */
export const PAYMENT_STATUS_LABEL_KEYS: Record<PaymentStatus, TranslationKey> = {
  paid: 'status.paidUpper',
  unpaid: 'status.unpaidUpper',
}

/**
 * Keys payments by the order they settle, so a list of orders renders without a lookup per
 * row. The twin of `indexVoidsByOrderId`; kept separate rather than shared behind one
 * generic name because a call site reading `indexPaymentsByOrderId` says what it holds.
 */
export function indexPaymentsByOrderId<T extends { orderId: string }>(
  payments: readonly T[],
): Map<string, T> {
  const index = new Map<string, T>()
  for (const entry of payments) index.set(entry.orderId, entry)
  return index
}
