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

/** The two ways the café serves an order. */
export const ORDER_TYPES = ['dine_in', 'takeaway'] as const

export type OrderType = (typeof ORDER_TYPES)[number]

export const ORDER_TYPE_LABELS: Record<OrderType, string> = {
  dine_in: 'Dine-in',
  takeaway: 'Takeaway',
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

export type TableNumberResult = { ok: true; tableNumber: string } | { ok: false; error: string }

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
    return { ok: false, error: 'Enter a table number for a dine-in order.' }
  }
  if (trimmed.length > TABLE_NUMBER_MAX) {
    return {
      ok: false,
      error: `Table numbers can be at most ${TABLE_NUMBER_MAX} characters.`,
    }
  }
  if (!TABLE_NUMBER_PATTERN.test(trimmed)) {
    return { ok: false, error: 'Use letters and numbers only, for example 5 or A3.' }
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
  | { ok: false; error: string }

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
}): string {
  if (order.orderType === null) return 'Not recorded'
  if (order.orderType === 'takeaway') return ORDER_TYPE_LABELS.takeaway
  return order.tableNumber === null
    ? ORDER_TYPE_LABELS.dine_in
    : `${ORDER_TYPE_LABELS.dine_in} · Table ${order.tableNumber}`
}
