import { useState } from 'react'

import type { OrderView } from '@/features/pos/orders-view'
import { recallWorkspace } from '@/features/pos/workspace-handoff'

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
 * **It starts from the page it replaced.** A page that has just been opened has no result of
 * its own yet, so it begins from the one the Orders list or the queue board had for the same
 * date a moment ago — see workspace-handoff.ts. Switching between the two therefore shows the
 * day's rows at once instead of the placeholder. Arriving from anywhere else there is nothing
 * to begin from, and a first load still shows the placeholder, which is then the truth.
 *
 * Set during render rather than in an effect, which is React's own pattern for deriving state
 * from changed input: the guard makes it idempotent, and it commits nothing to the DOM in
 * between. It relies on `views` keeping its identity while it is unchanged, which the
 * workspace guarantees by memoising it.
 *
 * **Across dates.** By default a result is only returned for the date it arrived under: a new
 * date starts from nothing (or from a page handing that date over), while the SAME date keeps
 * its rows across a refresh — a sale rung up at another till, a reconnect. The queue board
 * needs exactly that, having no way to mark a whole board as "not this day yet".
 * `acrossDates` holds the result through a date change instead, which is what the Orders list
 * wants: it withholds its date-specific claims itself while it refreshes.
 */
export function useLastArrivedViews(
  views: OrderView[],
  loading: boolean,
  businessDate: string,
  { acrossDates = false }: { acrossDates?: boolean } = {},
): OrderView[] | null {
  const [arrived, setArrived] = useState<{ views: OrderView[]; date: string } | null>(() => {
    if (!loading) return { views, date: businessDate }
    const handedOver = recallWorkspace(businessDate)
    return handedOver ? { views: handedOver, date: businessDate } : null
  })
  if (!loading && (arrived?.views !== views || arrived.date !== businessDate)) {
    setArrived({ views, date: businessDate })
  }
  if (!arrived) return null
  if (!acrossDates && arrived.date !== businessDate) return null
  return arrived.views
}
