/**
 * What the orders workspace shows: one resolved row per order, and the filters and search
 * that narrow the day down to the orders somebody is actually looking for.
 *
 * Pure — no React, no Firestore, no clock — the same split as cart.ts, payments.ts,
 * fulfillment.ts and order-type.ts.
 *
 * **Nothing new is stored.** A row's fulfilment, payment and overall state are resolved here
 * from the order and its sidecars by the very same helpers the receipt uses
 * (`resolveFulfillmentState`, `resolvePaymentState`, `overallStatusOf`), so a filter can
 * never disagree with the badge on the row it selected. There is deliberately no stored
 * overall status to filter on, and adding one would be a third piece of state that could
 * contradict the two it is derived from.
 */

import type { TranslationKey } from '@/features/i18n/translations/en'
import {
  isCompleted,
  overallStatusOf,
  resolveFulfillmentState,
  type FulfillmentStatus,
  type OverallStatus,
} from '@/features/pos/fulfillment'
import { resolvePaymentState, type PaymentState } from '@/features/pos/payments'
import type { Order, OrderFulfillment, OrderPayment, OrderVoid } from '@/features/pos/types'

/** An order with both its axes resolved, and the one line derived from them. */
export interface OrderView {
  order: Order
  fulfillment: FulfillmentStatus
  payment: PaymentState
  /** The void record itself, not a flag — the list shows the reversed amount and reason. */
  voided: OrderVoid | null
  overall: OverallStatus
  /** The fulfilment record, for the operator who made the most recent move. */
  fulfillmentRecord: OrderFulfillment | null
  /** The payment record, for the operator who took the money. */
  paymentRecord: OrderPayment | null
}

export interface OrderSidecars {
  payments: Map<string, OrderPayment>
  fulfillments: Map<string, OrderFulfillment>
  voids: Map<string, OrderVoid>
}

export function buildOrderView(order: Order, sidecars: OrderSidecars): OrderView {
  const voided = sidecars.voids.get(order.id) ?? null
  const paymentRecord = sidecars.payments.get(order.id) ?? null
  const fulfillmentRecord = sidecars.fulfillments.get(order.id) ?? null

  const payment = resolvePaymentState(order, paymentRecord)
  const fulfillment = resolveFulfillmentState(order, fulfillmentRecord)

  return {
    order,
    fulfillment,
    payment,
    voided,
    overall: overallStatusOf({ fulfillment, payment, voided: voided !== null }),
    fulfillmentRecord,
    paymentRecord,
  }
}

export function buildOrderViews(orders: readonly Order[], sidecars: OrderSidecars): OrderView[] {
  return orders.map((order) => buildOrderView(order, sidecars))
}

/**
 * The operational questions somebody asks of a day's orders.
 *
 * Grouped by what they answer: everything, the money axis, the kitchen axis, both axes
 * finished, and how the order is served. `all` is first because it is the default and the
 * only one that hides nothing.
 */
export const ORDER_FILTERS = [
  'all',
  'unpaid',
  'paid',
  'pending',
  'preparing',
  'ready',
  'delivered',
  'completed',
  'dine_in',
  'takeaway',
] as const

export type OrderFilter = (typeof ORDER_FILTERS)[number]

export const ORDER_FILTER_LABEL_KEYS: Record<OrderFilter, TranslationKey> = {
  all: 'orders.filter.all',
  unpaid: 'orders.filter.unpaid',
  paid: 'orders.filter.paid',
  pending: 'orders.filter.pending',
  preparing: 'orders.filter.preparing',
  ready: 'orders.filter.ready',
  delivered: 'orders.filter.delivered',
  completed: 'orders.filter.completed',
  dine_in: 'orders.filter.dineIn',
  takeaway: 'orders.filter.takeaway',
}

export function isOrderFilter(value: unknown): value is OrderFilter {
  return typeof value === 'string' && (ORDER_FILTERS as readonly string[]).includes(value)
}

/**
 * Whether a row belongs under a filter.
 *
 * **A voided sale appears under `all` and nowhere else.** It is cancelled: it is not waiting
 * to be paid, not queued in the kitchen, and not completed. `overallStatusOf` already says
 * so by returning `voided` rather than a workflow state, so listing one under "Unpaid" would
 * contradict the badge on its own row and send somebody chasing money for a sale that no
 * longer exists.
 *
 * An order placed before order types existed has no type and so matches neither `dine_in`
 * nor `takeaway`. That is the honest answer — guessing one would invent history — and `all`
 * still shows it.
 */
export function matchesFilter(view: OrderView, filter: OrderFilter): boolean {
  if (filter === 'all') return true
  if (view.voided) return false

  switch (filter) {
    case 'unpaid':
      return view.payment.status === 'unpaid'
    case 'paid':
      return view.payment.status === 'paid'
    case 'completed':
      return isCompleted(view.overall)
    case 'dine_in':
    case 'takeaway':
      return view.order.orderType === filter
    default:
      // The four fulfilment statuses, compared against the resolved axis rather than the
      // presence of a record — which is what keeps a legacy order reading as delivered.
      return view.fulfillment === filter
  }
}

/**
 * Free-text search **within the loaded business date**, matched against the three things
 * somebody at a counter has to hand: the number on the docket, the table it went to, and
 * what was ordered.
 *
 * Deliberately client-side and deliberately local to the day. Firestore cannot search
 * substrings, and a global search would mean either loading every order ever sold or
 * bolting on a search service — neither of which a café's "which one was the flat white for
 * table 5" needs.
 *
 * A leading `#` is stripped so typing a docket number exactly as it is written still finds
 * it. Number matching is a substring so a partial number narrows as it is typed.
 */
export function matchesSearch(order: Order, term: string): boolean {
  const needle = term.trim().toLowerCase()
  if (needle === '') return true

  const number = needle.startsWith('#') ? needle.slice(1) : needle
  if (number !== '' && String(order.number).includes(number)) return true

  // Only a dine-in order has a table, so this quietly does nothing for a takeaway.
  if (order.tableNumber !== null && order.tableNumber.toLowerCase().includes(needle)) return true

  return order.lines.some((line) => line.name.toLowerCase().includes(needle))
}

/** Both narrowings, in the order a person thinks about them: the view, then the words. */
export function filterOrders(
  views: readonly OrderView[],
  filter: OrderFilter,
  search: string,
): OrderView[] {
  return views.filter((view) => matchesFilter(view, filter) && matchesSearch(view.order, search))
}
