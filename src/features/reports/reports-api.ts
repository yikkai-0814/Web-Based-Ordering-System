import { Timestamp, collection, getDocs, orderBy, query, where } from 'firebase/firestore'

import { chunkOrderIds, type ChunkableOrder } from '@/features/pos/order-sidecars'
import { resolvePaymentState } from '@/features/pos/payments'
import { parseOrder, parseOrderPayment, parseOrderVoid, type Order } from '@/features/pos/types'
import { parseModifierOptionCost } from '@/features/menu/modifier-cost'
import {
  indexCostHistory,
  indexModifierCostHistory,
  type CostHistoryEntry,
  type CostHistoryIndex,
  type ModifierCostHistoryEntry,
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
 * **Every read is bounded by something that does not grow with trading history.**
 *
 *   * `orders` — the date range, served by the automatic single-field index on
 *     `businessDate`.
 *   * `orderPayments` and `orderVoids` — the ids of the orders just loaded (see below).
 *   * `menuItemCosts` and `menuItemCostHistory` — read whole, and legitimately so: both are
 *     bounded by the size of the menu and the number of times a price or a cost has been
 *     edited, neither of which grows with how much the café sells.
 *   * `modifierOptionCosts` and `modifierOptionCostHistory` — read whole for exactly the
 *     same reason, and bounded by the same thing: a café has tens of options, not one per
 *     sale. They are indexed once here into a map keyed by `groupId__optionId`, so costing
 *     a line's options is a lookup per option rather than a read — an order of a thousand
 *     lines still costs the four cost queries below and no more.
 *
 * **Why the sidecars are fetched by order id.** They were previously read whole, on the
 * reasoning that they are small. That is true of voids and false of payments: there is one
 * payment document per paid order, so `orderPayments` grows exactly as fast as `orders`, and
 * a report on a single day was reading every payment the café had ever taken. The cost only
 * ever increased.
 *
 * The fix is the one the orders workspace already uses, not a new idea:
 * `src/features/pos/order-sidecars.ts` explains at length why a payment carries no
 * `businessDate` of its own — the day it belongs to is already on the order it points at,
 * duplicating it would create a fact that can disagree with itself, and it could never be
 * backfilled onto records that are immutable by design. So the sidecars are fetched with
 * `where('orderId', 'in', [...])` over the ids already in hand, in chunks of 30, and
 * `chunkOrderIds` is reused rather than reimplemented. `in` on a single field is served by
 * the automatic index, so there is still no composite index to deploy.
 *
 * The cost is one extra round trip: the ids are not known until the orders come back, so
 * the sidecars can no longer be fetched in the same wave.
 *
 * All five collections are read with the caller's own permissions. The two cost collections
 * are admin-only at the rules layer, which is what actually keeps cost away from staff.
 */

export interface ReportData {
  orders: ReportOrder[]
  voids: Map<string, ReportVoidInfo>
  history: CostHistoryIndex
  currentCosts: Map<string, number>
  /** Modifier option costs, both keyed by `groupId__optionId`. */
  modifierHistory: CostHistoryIndex
  modifierCurrentCosts: Map<string, number>
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

/** The same validation, for an entry identified by its group and option rather than an item. */
function parseModifierCostHistoryEntry(
  data: Record<string, unknown>,
): ModifierCostHistoryEntry | null {
  const { groupId, optionId, cost, effectiveFrom } = data

  if (typeof groupId !== 'string' || groupId === '') return null
  if (typeof optionId !== 'string' || optionId === '') return null
  // A null cost is meaningful: it records the cost being cleared.
  if (cost !== null && (typeof cost !== 'number' || !Number.isInteger(cost) || cost < 0)) {
    return null
  }

  const when = toDate(effectiveFrom)
  if (!when) return null

  return { groupId, optionId, cost: cost as number | null, effectiveFrom: when }
}

/**
 * How many chunk queries may be in flight at once.
 *
 * A range is capped at 366 days, which at a busy 150 orders a day is some 1,800 chunks per
 * sidecar collection. Handing all of those to `Promise.all` would open thousands of
 * simultaneous requests and is a good way to be throttled; running them one at a time would
 * make a month's report crawl. A small window is the middle, and the total number of
 * documents read is the same either way.
 */
const MAX_CONCURRENT_CHUNK_QUERIES = 12

/**
 * Runs `task` over every item with at most `limit` outstanding at once, preserving nothing
 * about order — every caller here merges into a map, so order is irrelevant.
 *
 * A shared cursor consumed by `limit` workers, rather than fixed slices: chunk queries do
 * not all take the same time, and slicing would leave the slowest worker finishing alone.
 */
async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  task: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let cursor = 0

  async function worker(): Promise<void> {
    while (cursor < items.length) {
      const index = cursor++
      const item = items[index]
      // Only reachable if `items` were mutated mid-flight, which no caller does. Guarded
      // rather than asserted so the type stays honest under noUncheckedIndexedAccess.
      if (item === undefined) continue
      results[index] = await task(item)
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return results
}

/**
 * Every document of a sidecar collection belonging to the given orders, and nothing else.
 *
 * Returns an empty list for no orders rather than issuing a query — an `in` filter with no
 * values is an error, and "no orders" already has an answer.
 */
async function fetchSidecars(
  path: string,
  orders: readonly ChunkableOrder[],
): Promise<{ id: string; data: Record<string, unknown> }[]> {
  const chunks = chunkOrderIds(orders)
  if (chunks.length === 0) return []

  const snapshots = await mapWithConcurrency(chunks, MAX_CONCURRENT_CHUNK_QUERIES, (ids) =>
    getDocs(query(collection(db, path), where('orderId', 'in', ids))),
  )

  return snapshots.flatMap((snapshot) =>
    snapshot.docs.map((document) => ({ id: document.id, data: document.data() })),
  )
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

  // The cost collections do not depend on which orders come back, so they ride along in the
  // first wave rather than waiting for it.
  const [orderDocs, historyDocs, costDocs, optionHistoryDocs, optionCostDocs] = await Promise.all([
    getDocs(ordersQuery),
    getDocs(collection(db, 'menuItemCostHistory')),
    getDocs(collection(db, 'menuItemCosts')),
    getDocs(collection(db, 'modifierOptionCostHistory')),
    getDocs(collection(db, 'modifierOptionCosts')),
  ])

  // Parsed before the sidecars are fetched, because it is the parsed orders that say which
  // ids to ask for. Malformed documents are skipped rather than reported as zeroes — and
  // skipping them here also keeps them out of the sidecar queries, which is right: an order
  // that cannot be read cannot be reported on either way.
  const parsedOrders: Order[] = []
  for (const document of orderDocs.docs) {
    const parsed = parseOrder(document.id, document.data())
    if (parsed) parsedOrders.push(parsed)
  }

  const [paymentRows, voidRows] = await Promise.all([
    fetchSidecars('orderPayments', parsedOrders),
    fetchSidecars('orderVoids', parsedOrders),
  ])

  // Built before the orders loop so each order can be asked whether it was paid. The same
  // `resolvePaymentState` the till and the receipt use, so a report can never disagree with
  // what the counter sees — including on legacy orders that carry payment inline, which have
  // no payment document at all and so are simply absent from this map.
  const paymentsByOrderId = new Map<string, NonNullable<ReturnType<typeof parseOrderPayment>>>()
  for (const row of paymentRows) {
    const parsed = parseOrderPayment(row.id, row.data)
    if (parsed) paymentsByOrderId.set(parsed.orderId, parsed)
  }

  const orders: ReportOrder[] = parsedOrders.map((parsed) => {
    const state = resolvePaymentState(parsed, paymentsByOrderId.get(parsed.id) ?? null)
    return {
      id: parsed.id,
      number: parsed.number,
      businessDate: parsed.businessDate,
      createdAt: parsed.createdAt ? parsed.createdAt.toDate() : null,
      lines: parsed.lines,
      total: parsed.total,
      paid: state.status === 'paid',
      paymentMethod: state.status === 'paid' ? state.method : null,
    }
  })

  const voids = new Map<string, ReportVoidInfo>()
  for (const row of voidRows) {
    const parsed = parseOrderVoid(row.id, row.data)
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

  const modifierHistoryEntries: ModifierCostHistoryEntry[] = []
  for (const document of optionHistoryDocs.docs) {
    const parsed = parseModifierCostHistoryEntry(document.data())
    if (parsed) modifierHistoryEntries.push(parsed)
  }

  // Keyed by the document id, which IS `groupId__optionId` — the same key the history index
  // and `costOfLine` use. `parseModifierOptionCost` refuses a document whose fields
  // disagree with that id, so the two lookups can never resolve to different options.
  const modifierCurrentCosts = new Map<string, number>()
  for (const document of optionCostDocs.docs) {
    const parsed = parseModifierOptionCost(document.id, document.data())
    if (parsed) modifierCurrentCosts.set(document.id, parsed.cost)
  }

  return {
    orders,
    voids,
    history: indexCostHistory(historyEntries),
    currentCosts,
    modifierHistory: indexModifierCostHistory(modifierHistoryEntries),
    modifierCurrentCosts,
  }
}
