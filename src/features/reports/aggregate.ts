import type { PaymentMethod } from '@/features/pos/types'

/**
 * All reporting arithmetic, as pure functions.
 *
 * No React, no Firestore, no clock — the caller passes the data and "now". That is what
 * makes the awkward cases (a cost cleared mid-month, a sale before any cost was recorded,
 * a renamed item) testable exhaustively rather than by inspection, and it follows the same
 * split as cart.ts and money.ts.
 *
 * Amounts are whole sen throughout. Percentages are the only floats here, and they are
 * derived for display, never fed back into money.
 */

/** The minimum an order needs to expose for reporting. Timestamps arrive as plain Dates. */
export interface ReportOrderLine {
  menuItemId: string
  name: string
  unitPrice: number
  quantity: number
}

export interface ReportOrder {
  id: string
  number: number
  businessDate: string
  /** Null when the document is malformed; such an order cannot have its cost resolved. */
  createdAt: Date | null
  lines: ReportOrderLine[]
  total: number
  /**
   * Whether the money has actually been received, resolved by `resolvePaymentState` before
   * it reaches here. An order exists from the moment it is rung up; being paid is a later,
   * separate event, so this is never inferred from the order's existence.
   */
  paid: boolean
  /** The method money was received by. Null while an order is still unpaid. */
  paymentMethod: PaymentMethod | null
}

export interface ReportVoidInfo {
  amount: number
  reason: string
  voidedByName: string
}

export interface CostHistoryEntry {
  itemId: string
  /** Null records the cost being cleared — deliberately different from "never recorded". */
  cost: number | null
  effectiveFrom: Date
}

/** Entries per item, newest first. Built by indexCostHistory. */
export type CostHistoryIndex = ReadonlyMap<string, readonly CostHistoryEntry[]>

export function indexCostHistory(entries: readonly CostHistoryEntry[]): CostHistoryIndex {
  const index = new Map<string, CostHistoryEntry[]>()
  for (const entry of entries) {
    const bucket = index.get(entry.itemId)
    if (bucket) bucket.push(entry)
    else index.set(entry.itemId, [entry])
  }
  for (const bucket of index.values()) {
    bucket.sort((a, b) => b.effectiveFrom.getTime() - a.effectiveFrom.getTime())
  }
  return index
}

/**
 * The unit cost in force for an item at a given moment, or null when it is genuinely not
 * knowable. Null is a real answer here, not a failure — see the table below.
 *
 * | Situation                                  | Result                                   |
 * | ------------------------------------------ | ---------------------------------------- |
 * | Entries exist at or before `when`           | the newest such entry's cost             |
 * | ...and that newest entry cleared the cost   | **null** — a clearing is a real event,   |
 * |                                             | so we must NOT fall back to the current  |
 * |                                             | cost and resurrect a removed figure      |
 * | No history at all for the item               | the current cost, which has applied for  |
 * |                                             | all time (this is why Phase 3 needed no  |
 * |                                             | backfill)                                |
 * | History exists but every entry is later      | **null** — the cost was not recorded     |
 * |                                             | then, and a later figure would be a      |
 * |                                             | guess presented as fact                  |
 * | `when` is null (malformed order)             | **null**                                 |
 *
 * Resolution keys on `menuItemId`, so renaming or repricing an item afterwards changes
 * nothing.
 */
export function resolveCostAtTime(
  itemId: string,
  when: Date | null,
  history: CostHistoryIndex,
  currentCosts: ReadonlyMap<string, number>,
): number | null {
  const entries = history.get(itemId)

  if (!entries || entries.length === 0) {
    return currentCosts.get(itemId) ?? null
  }

  if (when === null) return null

  // Entries are newest-first, so the first one at or before `when` is the one in force.
  // The comparison is inclusive: a sale at the exact instant of a change uses the new cost.
  for (const entry of entries) {
    if (entry.effectiveFrom.getTime() <= when.getTime()) return entry.cost
  }

  return null
}

export interface CostCoverage {
  /** Revenue from lines whose cost is known, in sen. */
  knownRevenue: number
  totalRevenue: number
  /** 0–100, or null when there is no revenue to cover. */
  percent: number | null
  complete: boolean
}

export interface PaymentBreakdownRow {
  method: PaymentMethod
  count: number
  amount: number
}

export interface ItemPerformanceRow {
  menuItemId: string
  /** The most recent snapshotted name in range, so a renamed item stays one row. */
  name: string
  quantity: number
  revenue: number
  estimatedCost: number
  /** revenue − estimatedCost; incomplete when coverage is below 100%. */
  estimatedProfit: number
  marginPercent: number | null
  coverage: CostCoverage
}

export interface VoidedOrderRow {
  orderId: string
  number: number
  businessDate: string
  amount: number
  reason: string
  voidedByName: string
}

export interface Report {
  /**
   * Every non-voided order in range, paid or not.
   *
   * A sale is counted when it is rung up, not when it is settled — so revenue, cost, profit
   * and margin all mean the same thing they meant before payment became a separate step,
   * and an unpaid order does not quietly vanish from the day's trading figures. What has
   * actually been *collected* is reported separately below; the two are different questions
   * and conflating them is how a report ends up unable to answer either.
   */
  revenue: number
  orderCount: number
  /** Of `orderCount`, how many have had payment recorded. */
  paidOrderCount: number
  unpaidOrderCount: number
  /** Revenue from orders that have been paid — money in the drawer. */
  collectedRevenue: number
  /** Revenue from orders not yet paid — money still owed. Sums with collected to revenue. */
  outstandingRevenue: number
  /** Rounded to the nearest sen; a display figure, never re-used in arithmetic. */
  averageOrderValue: number
  estimatedCost: number
  estimatedProfit: number
  /** 0–100; null when revenue is zero or no cost at all is known — never NaN. */
  marginPercent: number | null
  coverage: CostCoverage
  payments: PaymentBreakdownRow[]
  items: ItemPerformanceRow[]
  voided: VoidedOrderRow[]
  voidedAmount: number
}

export interface BuildReportInput {
  orders: readonly ReportOrder[]
  /** Keyed by order id. Only orders present here are treated as voided. */
  voids: ReadonlyMap<string, ReportVoidInfo>
  history: CostHistoryIndex
  currentCosts: ReadonlyMap<string, number>
}

function percentOf(part: number, whole: number): number | null {
  if (whole === 0) return null
  return (part / whole) * 100
}

/**
 * Margin, suppressed when **no** cost at all is known for the scope.
 *
 * With zero known cost, `revenue - 0` makes the margin exactly 100% every time — a number
 * that looks like a performance figure but carries no information, and the most flattering
 * one possible. Partial coverage still returns a value, because that is a genuine upper
 * bound the warning already explains; total absence of cost data returns null so the UI
 * shows an em dash instead.
 */
function marginOf(profit: number, revenue: number, knownRevenue: number): number | null {
  if (knownRevenue === 0) return null
  return percentOf(profit, revenue)
}

function coverageOf(knownRevenue: number, totalRevenue: number): CostCoverage {
  return {
    knownRevenue,
    totalRevenue,
    percent: percentOf(knownRevenue, totalRevenue),
    // Zero revenue is trivially "complete" — there is nothing left uncovered.
    complete: knownRevenue === totalRevenue,
  }
}

/**
 * Builds the whole report in one pass.
 *
 * **Voided orders are removed once, here, before anything is counted.** Every metric below
 * therefore excludes them by construction rather than by each aggregation remembering to
 * filter — which is how a cancelled sale leaks into a total somebody forgot about.
 */
export function buildReport({ orders, voids, history, currentCosts }: BuildReportInput): Report {
  const live: ReportOrder[] = []
  const voided: VoidedOrderRow[] = []
  let voidedAmount = 0

  for (const order of orders) {
    const voidInfo = voids.get(order.id)
    if (voidInfo) {
      voided.push({
        orderId: order.id,
        number: order.number,
        businessDate: order.businessDate,
        amount: voidInfo.amount,
        reason: voidInfo.reason,
        voidedByName: voidInfo.voidedByName,
      })
      voidedAmount += voidInfo.amount
    } else {
      live.push(order)
    }
  }

  let revenue = 0
  let estimatedCost = 0
  let knownRevenue = 0
  let paidOrderCount = 0
  let collectedRevenue = 0

  const paymentTotals = new Map<PaymentMethod, PaymentBreakdownRow>()
  const itemTotals = new Map<
    string,
    {
      name: string
      /** Used to keep the most recent name when an item was renamed mid-range. */
      nameAt: number
      quantity: number
      revenue: number
      estimatedCost: number
      knownRevenue: number
    }
  >()

  for (const order of live) {
    revenue += order.total

    if (order.paid) {
      paidOrderCount += 1
      collectedRevenue += order.total
    }

    // The breakdown answers "how was money taken", so only orders where money was actually
    // taken belong in it. An unpaid order has no method to attribute, and inventing a
    // bucket for it would put money that has not arrived alongside money that has.
    if (order.paid && order.paymentMethod !== null) {
      const method = order.paymentMethod
      const payment = paymentTotals.get(method)
      if (payment) {
        payment.count += 1
        payment.amount += order.total
      } else {
        paymentTotals.set(method, { method, count: 1, amount: order.total })
      }
    }

    const orderTime = order.createdAt ? order.createdAt.getTime() : 0

    for (const line of order.lines) {
      const lineRevenue = line.unitPrice * line.quantity
      const unitCost = resolveCostAtTime(line.menuItemId, order.createdAt, history, currentCosts)
      const lineCost = unitCost === null ? 0 : unitCost * line.quantity
      const lineKnownRevenue = unitCost === null ? 0 : lineRevenue

      estimatedCost += lineCost
      knownRevenue += lineKnownRevenue

      const existing = itemTotals.get(line.menuItemId)
      if (existing) {
        existing.quantity += line.quantity
        existing.revenue += lineRevenue
        existing.estimatedCost += lineCost
        existing.knownRevenue += lineKnownRevenue
        if (orderTime >= existing.nameAt) {
          existing.name = line.name
          existing.nameAt = orderTime
        }
      } else {
        itemTotals.set(line.menuItemId, {
          name: line.name,
          nameAt: orderTime,
          quantity: line.quantity,
          revenue: lineRevenue,
          estimatedCost: lineCost,
          knownRevenue: lineKnownRevenue,
        })
      }
    }
  }

  const items: ItemPerformanceRow[] = [...itemTotals.entries()]
    .map(([menuItemId, totals]) => {
      const profit = totals.revenue - totals.estimatedCost
      return {
        menuItemId,
        name: totals.name,
        quantity: totals.quantity,
        revenue: totals.revenue,
        estimatedCost: totals.estimatedCost,
        estimatedProfit: profit,
        marginPercent: marginOf(profit, totals.revenue, totals.knownRevenue),
        coverage: coverageOf(totals.knownRevenue, totals.revenue),
      }
    })
    .sort((a, b) => b.revenue - a.revenue || a.name.localeCompare(b.name))

  const estimatedProfit = revenue - estimatedCost

  return {
    revenue,
    orderCount: live.length,
    paidOrderCount,
    unpaidOrderCount: live.length - paidOrderCount,
    collectedRevenue,
    outstandingRevenue: revenue - collectedRevenue,
    averageOrderValue: live.length === 0 ? 0 : Math.round(revenue / live.length),
    estimatedCost,
    estimatedProfit,
    marginPercent: marginOf(estimatedProfit, revenue, knownRevenue),
    coverage: coverageOf(knownRevenue, revenue),
    payments: [...paymentTotals.values()].sort((a, b) => b.amount - a.amount),
    items,
    voided: voided.sort((a, b) => b.number - a.number),
    voidedAmount,
  }
}
