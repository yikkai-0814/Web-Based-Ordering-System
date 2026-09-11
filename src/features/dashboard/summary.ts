/**
 * What the dashboard says about today, as one pure function.
 *
 * No React, no Firestore, no clock — the same split as cart.ts, queue.ts and orders-view.ts.
 * The caller passes the day's already-resolved rows and the role of whoever is looking.
 *
 * **Nothing new is stored, and nothing is re-derived.** Every figure below is read off
 * fields that `buildOrderViews` has already resolved — `voided`, `payment.status`,
 * `fulfillment`, `order.total` — and the queue depths go through the very same `isQueued`
 * and `QUEUE_COLUMNS` the kitchen board uses. That is what makes it impossible for the
 * dashboard to disagree with the Orders list or the Queue about the same day. There is
 * deliberately no persisted aggregate and no stored dashboard status; a third copy of a fact
 * is a third thing that can fall out of step with the two it came from.
 *
 * **A voided sale is cancelled, and counts as nothing else.** It is not an order taken, not
 * revenue, not money owed, and not work for the kitchen. That is the same rule `matchesFilter`
 * applies in orders-view.ts, restated here rather than quietly re-invented: listing a voided
 * sale under "unpaid" would send somebody chasing money for a sale that no longer exists.
 */

import type { Role } from '@/features/auth/types'
import type { OrderView } from '@/features/pos/orders-view'
import { isQueued, QUEUE_COLUMNS, type QueueColumn } from '@/features/pos/queue'

/**
 * The money side of the day. Amounts are whole sen, like everywhere else.
 *
 * `collected` and `outstanding` always sum to `revenue`: an order is either settled or it is
 * not, and revenue counts every order placed rather than only the ones paid for. That is the
 * same definition the Reports page uses, so the two screens answer the same question the
 * same way.
 */
export interface FinanceSummary {
  /** Every non-voided order of the day, paid or not. */
  revenue: number
  /** Revenue from orders with payment recorded — money in the drawer. */
  collected: number
  /** Revenue from orders not yet paid — money still owed. */
  outstanding: number
}

export interface DashboardSummary {
  /** Orders taken today. Voided sales are excluded — a cancelled sale was not a sale. */
  orderCount: number
  voidedCount: number
  /** Of `orderCount`, how many still have money outstanding. */
  unpaidCount: number
  /** How many orders sit in each column of the kitchen board, right now. */
  queue: Record<QueueColumn, number>
  /**
   * The money tiles, or **null** for a staff member.
   *
   * Null rather than an object with the figures blanked out, on purpose. The financial
   * section is then absent from the data itself, so no component can render it by accident
   * and a test can assert its absence directly rather than inspecting markup.
   *
   * Note honestly what this is and is not. Orders carry `total` and staff can read them —
   * the till shows totals all day — so this is a presentation decision matching Reports
   * being admin-only, not a security boundary. The real boundary is cost, which lives in
   * admin-only collections and is never fetched in a staff session.
   */
  finance: FinanceSummary | null
}

function emptyQueue(): Record<QueueColumn, number> {
  const counts = {} as Record<QueueColumn, number>
  for (const column of QUEUE_COLUMNS) counts[column] = 0
  return counts
}

export function buildDashboard(views: readonly OrderView[], role: Role): DashboardSummary {
  const queue = emptyQueue()
  let orderCount = 0
  let voidedCount = 0
  let unpaidCount = 0
  let revenue = 0
  let collected = 0

  for (const view of views) {
    if (view.voided) {
      voidedCount += 1
      continue
    }

    orderCount += 1
    revenue += view.order.total

    if (view.payment.status === 'paid') collected += view.order.total
    else unpaidCount += 1

    // `isQueued` decides membership, and it also rules out the delivered and voided rows —
    // so a column can never be given a row the board itself would not show.
    if (isQueued(view) && view.fulfillment in queue) {
      queue[view.fulfillment as QueueColumn] += 1
    }
  }

  return {
    orderCount,
    voidedCount,
    unpaidCount,
    queue,
    finance: role === 'admin' ? { revenue, collected, outstanding: revenue - collected } : null,
  }
}
