/**
 * How an order is served: eaten in, or taken away.
 *
 * Pure — no React, no Firestore, no clock — the same split as cart.ts, voids.ts,
 * payments.ts and fulfillment.ts. The rules a table number must satisfy live here so they can
 * be tested exhaustively, and firestore.rules mirrors them; neither is the other's
 * enforcement.
 *
 * **A table number is only an identifier stamped on an order.** It is not a tab, a seat
 * reservation, or a claim on anything: several orders may carry the same one, and nothing in
 * this system tracks which tables are occupied or free. That is deliberate — a café writes
 * "5" on a docket so the food reaches the right table, and that is the whole of it.
 *
 * Both this and the table number are written once, with the order, and never change. Orders
 * are immutable, so a mistyped table number is corrected the way any other mistake on a sale
 * is: void it and ring it again.
 */

import type { TranslationKey } from '@/features/i18n/translations/en'
import { message, type Message } from '@/features/i18n/messages'

/** The two ways the café serves an order. */
export const ORDER_TYPES = ['dine_in', 'takeaway'] as const

export type OrderType = (typeof ORDER_TYPES)[number]

export const ORDER_TYPE_LABEL_KEYS: Record<OrderType, TranslationKey> = {
  dine_in: 'orderType.dineIn',
  takeaway: 'orderType.takeaway',
}

export function isOrderType(value: unknown): value is OrderType {
  return typeof value === 'string' && (ORDER_TYPES as readonly string[]).includes(value)
}

/** Mirrored in firestore.rules; keep the two in step. */
export const TABLE_NUMBER_MAX = 8

/**
 * What a table number may look like: letters and digits only, 1 to `TABLE_NUMBER_MAX` of
 * them. Accepts `5`, `12`, `A3`, `T12`, `12B` — a café labels tables however it likes, so
 * this is not restricted to numbers despite the name.
 *
 * Deliberately excludes spaces and punctuation rather than merely trimming, because the same
 * expression is mirrored in firestore.rules, where there is no `trim()`. A rule that only
 * checked length would accept `"   "` from a client that skipped this form.
 */
export const TABLE_NUMBER_PATTERN = /^[A-Za-z0-9]{1,8}$/

export type TableNumberResult = { ok: true; tableNumber: string } | { ok: false; error: Message }

/**
 * Validates what somebody typed into the table field.
 *
 * Returns a discriminated result rather than throwing, so the till can show a specific
 * message — the same shape as `validateVoidReason` and `parsePriceInput`. The trimmed value
 * is returned so callers store what was validated rather than the raw input.
 */
export function validateTableNumber(input: string): TableNumberResult {
  const trimmed = input.trim()

  if (trimmed === '') {
    return { ok: false, error: message('validation.tableRequired') }
  }
  if (trimmed.length > TABLE_NUMBER_MAX) {
    return {
      ok: false,
      error: message('validation.tableTooLong', { max: TABLE_NUMBER_MAX }),
    }
  }
  if (!TABLE_NUMBER_PATTERN.test(trimmed)) {
    return { ok: false, error: message('validation.tableCharacters') }
  }

  return { ok: true, tableNumber: trimmed }
}

/**
 * Everything about service that the till must settle before an order may be written.
 *
 * The success arms are split by order type on purpose: the type system then guarantees that
 * a takeaway carries `null` and a dine-in carries a string, so a caller cannot write the one
 * combination the security rules refuse.
 */
export type PlacementResult =
  | { ok: true; orderType: 'dine_in'; tableNumber: string }
  | { ok: true; orderType: 'takeaway'; tableNumber: null }
  | { ok: false; error: Message }

/**
 * Guards the place-order button.
 *
 * A takeaway ignores the table field entirely rather than refusing a value left in it — the
 * field is hidden for takeaway, and a stale entry from a mis-tap is simply not written.
 */
export function validatePlacement(orderType: OrderType, tableInput: string): PlacementResult {
  if (orderType === 'takeaway') {
    return { ok: true, orderType: 'takeaway', tableNumber: null }
  }

  const table = validateTableNumber(tableInput)
  if (!table.ok) return { ok: false, error: table.error }

  return { ok: true, orderType: 'dine_in', tableNumber: table.tableNumber }
}

/**
 * How an order is served, in one line: `Dine-in · Table 5`, `Takeaway`, or `Not recorded`.
 *
 * **Never shows a table number for a takeaway**, even if one somehow reached the document —
 * the label would be meaningless, and the rules refuse that combination on new orders anyway.
 *
 * `Not recorded` is the honest answer for an order placed before order types existed. Those
 * orders genuinely did not capture this, orders are immutable so they cannot be backfilled,
 * and guessing a type would invent history that never happened.
 */
export function orderTypeSummaryOf(order: {
  orderType: OrderType | null
  tableNumber: string | null
}): Message {
  if (order.orderType === null) return message('common.notRecorded')
  if (order.orderType === 'takeaway') return message(ORDER_TYPE_LABEL_KEYS.takeaway)
  if (order.tableNumber === null) return message(ORDER_TYPE_LABEL_KEYS.dine_in)
  // The table is the vendor's own identifier — "5", "A3", "Bar 2" — so it is a parameter
  // spliced in as typed, never something looked up.
  return message('orderType.dineInWithTable', { table: order.tableNumber })
}
