/**
 * The fulfilment queue: the day's orders that still have work left in them, arranged by how
 * far along they are.
 *
 * Pure — no React, no Firestore — so the grouping and the action offered on each card can be
 * tested exhaustively without a browser.
 *
 * **No new state, and no second copy of the transition logic.** A card's column is its
 * resolved fulfilment status, and the button on it comes from `canAdvanceFulfillment` and
 * `FULFILLMENT_ACTIONS` — the same two helpers the receipt uses, which in turn mirror what
 * firestore.rules enforces. The queue is a different arrangement of facts that already
 * exist, not a workflow of its own.
 */

import type { TranslationKey } from '@/features/i18n/translations/en'
import {
  canAdvanceFulfillment,
  canReverseFulfillment,
  FULFILLMENT_ACTION_KEYS,
  FULFILLMENT_BACK_ACTION_KEYS,
  FULFILLMENT_LABEL_KEYS,
  type FulfillmentStatus,
} from '@/features/pos/fulfillment'
import type { OrderView } from '@/features/pos/orders-view'

/**
 * The three columns, in the order the work flows.
 *
 * `delivered` is deliberately absent: the queue is what still needs doing, and a board that
 * accumulated every handed-over order all day would bury the three that do not. Delivered
 * orders remain in the Orders workspace, under `all`, `delivered` and `completed`.
 */
export const QUEUE_COLUMNS = [
  'pending',
  'preparing',
  'ready',
] as const satisfies readonly FulfillmentStatus[]

export type QueueColumn = (typeof QUEUE_COLUMNS)[number]

export const QUEUE_COLUMN_LABEL_KEYS: Record<QueueColumn, TranslationKey> = {
  pending: FULFILLMENT_LABEL_KEYS.pending,
  preparing: FULFILLMENT_LABEL_KEYS.preparing,
  ready: FULFILLMENT_LABEL_KEYS.ready,
}

export function isQueueColumn(value: unknown): value is QueueColumn {
  return typeof value === 'string' && (QUEUE_COLUMNS as readonly string[]).includes(value)
}

/**
 * Whether an order still belongs on the board.
 *
 * A voided sale is cancelled, so there is nothing to make; a delivered one is with the
 * customer. Both drop off, which is the same pair of conditions `canAdvanceFulfillment`
 * refuses to offer a next step for — stated here as membership rather than re-derived, so a
 * card can never appear with no action on it.
 */
export function isQueued(view: OrderView): boolean {
  return view.voided === null && isQueueColumn(view.fulfillment)
}

export interface QueueGroup {
  status: QueueColumn
  views: OrderView[]
}

/**
 * Splits the day into the three columns, **oldest first within each**.
 *
 * The opposite of the Orders list, which is newest first: that list is a record and is read
 * from the top, whereas a kitchen works the queue in the order the orders arrived. Order
 * numbers ascend through the day, so the number is the arrival order.
 *
 * Every column is returned even when empty, so the board keeps its shape instead of
 * reflowing as orders move across it.
 */
export function groupQueue(views: readonly OrderView[]): QueueGroup[] {
  const queued = views.filter(isQueued).sort((a, b) => a.order.number - b.order.number)

  return QUEUE_COLUMNS.map((status) => ({
    status,
    views: queued.filter((view) => view.fulfillment === status),
  }))
}

export interface QueueAction {
  /** Where the card moves to. Always exactly one step forward. */
  next: FulfillmentStatus
  /** What the person is about to do. A key, so the button follows the chosen language. */
  labelKey: TranslationKey
}

/**
 * The single move offered on a card, or null when there is none.
 *
 * Pending → Preparing → Ready → Delivered, one step at a time, and never for a voided or
 * already-delivered order. Nothing here decides that: `canAdvanceFulfillment` does, and the
 * security rules decide it again independently at write time. This is what the button says,
 * not what is permitted.
 */
/** The step back a card offers, when the counter owns one. */
export interface QueueReversal {
  /** Where the card moves back to. Always exactly one step. */
  previous: FulfillmentStatus
  labelKey: TranslationKey
}

/**
 * The backward action on a card, or null when there is none for staff to take.
 *
 * Null at `pending`, which has nothing behind it, and null at `delivered`, which is an
 * admin's correction rather than a step in the kitchen's workflow — see
 * `isStaffReversibleStep`. The board is staff-only, so this asks as a staff account.
 */
export function queueReverseFor(view: OrderView): QueueReversal | null {
  const reverse = canReverseFulfillment({
    current: view.fulfillment,
    voided: view.voided !== null,
    isAdmin: false,
  })
  if (!reverse.ok) return null

  const labelKey = FULFILLMENT_BACK_ACTION_KEYS[view.fulfillment]
  return labelKey === null ? null : { previous: reverse.previous, labelKey }
}

export function queueActionFor(view: OrderView): QueueAction | null {
  const advance = canAdvanceFulfillment({
    current: view.fulfillment,
    voided: view.voided !== null,
  })
  if (!advance.ok) return null

  const labelKey = FULFILLMENT_ACTION_KEYS[view.fulfillment]
  return labelKey === null ? null : { next: advance.next, labelKey }
}

/** Total items on a card — what the kitchen counts, not what the till charged. */
export function itemCountOf(view: OrderView): number {
  return view.order.lines.reduce((count, line) => count + line.quantity, 0)
}
