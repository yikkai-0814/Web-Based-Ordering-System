import type { OrderView } from '@/features/pos/orders-view'

/**
 * The day's resolved orders, handed from the page being left to the page being opened.
 *
 * **The problem.** The Orders list and the queue board read the same day through the same
 * workspace, but each mounts its own copy. A page that has just mounted has nothing: Firestore
 * already holds the data — the other page's listeners were open a moment ago — but the first
 * snapshot is always delivered asynchronously, and the sidecar listeners cannot open until the
 * orders have arrived. So every switch between the two drew the grey placeholder for two
 * asynchronous hops, even though the rows had been on screen an instant before. On a fast
 * laptop that was a frame or two; on a slower tablet it was long enough to see.
 *
 * **The handoff.** While any page shows a date, its last settled result is kept here. A page
 * opening that same date reads it during its first render — before the page it replaces has
 * been unmounted, because React renders the new tree before it commits and tears down the
 * old one — and starts from those rows instead of from nothing. Its own listeners replace
 * them the moment they answer.
 *
 * **Never stale.** An entry exists only while a page holding that date is mounted: the last
 * one to leave deletes it. Coming back to Orders after ten minutes on the New Order screen
 * therefore finds nothing here and loads as it always did — there is no "last known" board
 * that could be minutes out of date, and no timer deciding what counts as fresh.
 */

interface Entry {
  holders: number
  views: OrderView[] | null
}

const entries = new Map<string, Entry>()

/**
 * Marks a page as showing `businessDate`. Returns the release, for an effect's cleanup.
 */
export function holdWorkspace(businessDate: string): () => void {
  const entry = entries.get(businessDate) ?? { holders: 0, views: null }
  entry.holders += 1
  entries.set(businessDate, entry)
  return () => {
    const current = entries.get(businessDate)
    if (!current) return
    current.holders -= 1
    if (current.holders <= 0) entries.delete(businessDate)
  }
}

/** Records the latest complete result for a date some page is currently holding. */
export function rememberWorkspace(businessDate: string, views: OrderView[]): void {
  const entry = entries.get(businessDate)
  if (entry) entry.views = views
}

/** The result a page still on screen has for `businessDate`, if there is one. */
export function recallWorkspace(businessDate: string): OrderView[] | null {
  return entries.get(businessDate)?.views ?? null
}
