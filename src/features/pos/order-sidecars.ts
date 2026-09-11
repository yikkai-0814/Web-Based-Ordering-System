/**
 * How the order sidecars are fetched for a day's worth of orders.
 *
 * Pure — no React, no Firestore — the same split as cart.ts, payments.ts, fulfillment.ts and
 * order-type.ts.
 *
 * **The problem this solves.** An order is filed under a `businessDate`, so a day's orders
 * are one indexed query. Its sidecars — `orderPayments`, `orderFulfillment`, `orderVoids` —
 * are keyed by the order id and carry no business date of their own, which is deliberate:
 * a payment answers "was this order settled", not "which day's takings does it belong to",
 * and the day it belongs to is already on the order it points at. Adding a date to them
 * would duplicate a fact that can disagree with itself, and could not be applied to the
 * existing records anyway — payments and voids are immutable, so nothing already written
 * could ever be backfilled.
 *
 * So the sidecars are fetched **by the ids of the orders already loaded**, with
 * `where('orderId', 'in', [...])`. That is exact: every sidecar belonging to the selected
 * day, and nothing else. Firestore caps a disjunction at 30 values, so the ids are split
 * into chunks and one listener is opened per chunk.
 *
 * **Why the chunks are cut by order number.** The obvious split — sort the ids and slice —
 * would reshuffle every chunk each time a sale is rung up, tearing down and rebuilding every
 * listener on the busiest screen in the café. Order numbers are assigned 1, 2, 3… within a
 * business date and never change, so cutting on them freezes each chunk the moment it fills:
 * a new order only ever joins the last one, and every earlier listener survives untouched.
 */

/** Firestore's ceiling on the number of values in an `in` filter. */
export const SIDECAR_QUERY_LIMIT = 30

/** The minimum an order must expose to be placed in a chunk. */
export interface ChunkableOrder {
  id: string
  number: number
}

/**
 * Splits a day's order ids into query-sized chunks, stable as the day goes on.
 *
 * Orders are bucketed by `number` — 1..30, 31..60, and so on — then each bucket is emitted
 * in ascending number order. Buckets that would exceed the limit anyway (which needs
 * duplicate numbers, something the counter transaction is meant to prevent) are sliced
 * further, so the returned chunks are never too large for a query whatever the data says.
 *
 * Returns `[]` for no orders, which callers treat as "open no listeners at all" rather than
 * as a query that matches everything.
 */
export function chunkOrderIds(
  orders: readonly ChunkableOrder[],
  size: number = SIDECAR_QUERY_LIMIT,
): string[][] {
  if (size < 1) throw new Error('Chunk size must be at least 1.')

  const buckets = new Map<number, ChunkableOrder[]>()
  for (const order of orders) {
    // Numbers start at 1, so subtract one before dividing; anything below that is clamped
    // into the first bucket rather than producing a negative index.
    const index = order.number >= 1 ? Math.floor((order.number - 1) / size) : 0
    const bucket = buckets.get(index)
    if (bucket) bucket.push(order)
    else buckets.set(index, [order])
  }

  const chunks: string[][] = []
  for (const index of [...buckets.keys()].sort((a, b) => a - b)) {
    const bucket = (buckets.get(index) ?? []).sort((a, b) => a.number - b.number)
    for (let start = 0; start < bucket.length; start += size) {
      chunks.push(bucket.slice(start, start + size).map((order) => order.id))
    }
  }

  return chunks
}
