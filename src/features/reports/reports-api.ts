import { Timestamp, collection, getDocs, orderBy, query, where } from 'firebase/firestore'

import { parseOrder, parseOrderVoid } from '@/features/pos/types'
import {
  indexCostHistory,
  type CostHistoryEntry,
  type CostHistoryIndex,
  type ReportOrder,
  type ReportVoidInfo,
} from '@/features/reports/aggregate'
import type { DateRange } from '@/features/reports/ranges'
import { db } from '@/lib/firebase'

/**
 * Reading data for a report.
 *
 * **One-shot `getDocs`, not `onSnapshot`** — a deliberate departure from the live
 * subscriptions every other feature uses. A report is a point-in-time answer; holding a
 * listener open across thousands of order documents costs memory and reads for no benefit,
 * and refetching when the filter changes is the natural model.
 *
 * Reads are bounded by the date range for orders, which is the collection that grows
 * without limit. The other three are small by nature:
 *   * `orderVoids`  — a handful per hundred sales
 *   * `menuItemCosts` — one document per menu item
 *   * `menuItemCostHistory` — one entry per cost change
 *
 * Voids are fetched whole rather than filtered by date because the void record carries no
 * `businessDate`, and adding one would mean changing the void model.
 *
 * All four collections are read with the caller's own permissions. The two cost
 * collections are admin-only at the rules layer, which is what actually keeps cost away
 * from staff — this module simply never runs for them, because /reports is admin-only.
 */

export interface ReportData {
  orders: ReportOrder[]
  voids: Map<string, ReportVoidInfo>
  history: CostHistoryIndex
  currentCosts: Map<string, number>
}

function toDate(value: unknown): Date | null {
  return value instanceof Timestamp ? value.toDate() : null
}

function parseCostHistoryEntry(data: Record<string, unknown>): CostHistoryEntry | null {
  const { itemId, cost, effectiveFrom } = data

  if (typeof itemId !== 'string' || itemId === '') return null
  // A null cost is meaningful: it records the cost being cleared.
  if (cost !== null && (typeof cost !== 'number' || !Number.isInteger(cost) || cost < 0)) {
    return null
  }

  const when = toDate(effectiveFrom)
  // Without a timestamp the entry cannot be placed in time, so it cannot be used.
  if (!when) return null

  return { itemId, cost: cost as number | null, effectiveFrom: when }
}

export async function fetchReportData(range: DateRange): Promise<ReportData> {
  // `businessDate` is YYYY-MM-DD, so lexicographic order is chronological order and this
  // range needs only the automatic single-field index — no composite index to deploy.
  const ordersQuery = query(
    collection(db, 'orders'),
    where('businessDate', '>=', range.from),
    where('businessDate', '<=', range.to),
    orderBy('businessDate'),
  )

  const [orderDocs, voidDocs, historyDocs, costDocs] = await Promise.all([
    getDocs(ordersQuery),
    getDocs(collection(db, 'orderVoids')),
    getDocs(collection(db, 'menuItemCostHistory')),
    getDocs(collection(db, 'menuItemCosts')),
  ])

  const orders: ReportOrder[] = []
  for (const document of orderDocs.docs) {
    const parsed = parseOrder(document.id, document.data())
    // Malformed documents are skipped rather than reported as zeroes.
    if (!parsed) continue
    orders.push({
      id: parsed.id,
      number: parsed.number,
      businessDate: parsed.businessDate,
      createdAt: parsed.createdAt ? parsed.createdAt.toDate() : null,
      lines: parsed.lines,
      total: parsed.total,
      paymentMethod: parsed.paymentMethod,
    })
  }

  const voids = new Map<string, ReportVoidInfo>()
  for (const document of voidDocs.docs) {
    const parsed = parseOrderVoid(document.id, document.data())
    if (!parsed) continue
    voids.set(parsed.orderId, {
      amount: parsed.amount,
      reason: parsed.reason,
      voidedByName: parsed.voidedByName,
    })
  }

  const historyEntries: CostHistoryEntry[] = []
  for (const document of historyDocs.docs) {
    const parsed = parseCostHistoryEntry(document.data())
    if (parsed) historyEntries.push(parsed)
  }

  const currentCosts = new Map<string, number>()
  for (const document of costDocs.docs) {
    const cost = document.data().cost
    if (typeof cost === 'number' && Number.isInteger(cost) && cost >= 0) {
      currentCosts.set(document.id, cost)
    }
  }

  return { orders, voids, history: indexCostHistory(historyEntries), currentCosts }
}
