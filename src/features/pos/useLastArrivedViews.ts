import { useState } from 'react'

import type { OrderView } from '@/features/pos/orders-view'

/**
 * The last workspace result that actually arrived.
 *
 * **Why a page needs this.** `useOrdersWorkspace` reports "loading" with no rows whenever any
 * of its listeners has not answered yet — deliberately, because returning old rows as though
 * they were current would, on a date change, put yesterday's sales under today's heading. But
 * a page that renders its skeleton straight from that flag replaces everything on screen with
 * a grey block for as long as the wait lasts. Holding the last arrived result lets it keep
 * showing that instead of blanking.
 *
 * Set during render rather than in an effect, which is React's own pattern for deriving state
 * from changed input: the guard makes it idempotent, and it commits nothing to the DOM in
 * between. It relies on `views` keeping its identity while it is unchanged, which the
 * workspace guarantees by memoising it.
 *
 * **`scope`** is for a page that must never show one scope's rows under another — the queue
 * board, which has no way to mark a whole board as "not this day yet". Pass the business date
 * and a result is only ever returned for the date it arrived under: a new date starts from
 * nothing, while the SAME date keeps its board across a refresh (a sale rung up at another
 * till, a reconnect). Left out, the result is held across every change, which is what the
 * Orders list wants — it withholds its date-specific claims itself while it refreshes.
 */
export function useLastArrivedViews(
  views: OrderView[],
  loading: boolean,
  scope?: string,
): OrderView[] | null {
  const [arrived, setArrived] = useState<{ views: OrderView[]; scope?: string } | null>(
    loading ? null : { views, scope },
  )
  if (!loading && (arrived?.views !== views || arrived.scope !== scope)) {
    setArrived({ views, scope })
  }
  if (!arrived) return null
  if (scope !== undefined && arrived.scope !== scope) return null
  return arrived.views
}
