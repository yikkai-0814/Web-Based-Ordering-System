import { message, type Message } from '@/features/i18n/messages'
import { useCallback, useEffect, useState } from 'react'

import { buildReport, type Report } from '@/features/reports/aggregate'
import { fetchReportData } from '@/features/reports/reports-api'
import type { DateRange } from '@/features/reports/ranges'

/** A result held in component state: which request produced it, and for which range. */
interface Loaded {
  /** Identifies the exact request — range plus refresh count — that produced this result. */
  key: string
  /** The range alone, so a result stays showable while a newer request for it is in flight. */
  range: string
  report: Report | null
  error: Message | null
}

/** What survives between mounts. No request key: a revalidation is always in flight after one. */
type Remembered = Omit<Loaded, 'key'>

/**
 * The last successful result for each range, kept across mounts.
 *
 * **Why this exists.** Unlike everything else on the Dashboard, a report is fetched with
 * one-shot `getDocs` rather than a listener, and it is fetched in two waves: the sidecar
 * queries cannot even be issued until the orders come back and say which ids to ask for. So
 * the admin bands cost two sequential server round trips, where the live tiles above them are
 * served from Firestore's own local cache in single-digit milliseconds.
 *
 * Held only in component state, that cost was paid again on every visit: navigating away
 * unmounts the bands, the state dies, and coming back re-ran both waves from scratch while
 * the rest of the page was already on screen. Measured against the emulator on a 120-order
 * day — with no network latency at all — the bands landed 151-213 ms after the rest of the
 * page, every single time.
 *
 * Remembering the last result per range means a return visit paints the previous answer at
 * once and corrects it when the revalidation lands, instead of showing a skeleton while the
 * same two round trips happen again.
 *
 * **This does not make the report staler.** It is refetched on every mount exactly as before;
 * the cache only decides what is on screen while that happens. A failure is deliberately not
 * remembered, so a later visit retries cleanly rather than inheriting an error.
 */
const CACHE_LIMIT = 4
const cache = new Map<string, Remembered>()

function remember(entry: Remembered): void {
  // Re-inserted so the map's insertion order is least-recently-used first.
  cache.delete(entry.range)
  cache.set(entry.range, entry)
  for (const oldest of cache.keys()) {
    if (cache.size <= CACHE_LIMIT) break
    cache.delete(oldest)
  }
}

/** Exported for tests: a cache that outlives mounts would otherwise leak between them. */
export function clearReportCache(): void {
  cache.clear()
}

export interface ReportState {
  report: Report | null
  /** Nothing to show yet. The first visit to a range, or a range whose fetch failed. */
  loading: boolean
  /** A result is on screen and a newer one is on its way. */
  refreshing: boolean
  error: Message | null
  refresh: () => void
}

/**
 * Fetches and aggregates a report for a date range.
 *
 * Refetches only when the range changes or `refresh` is called — the result is held in state,
 * so re-rendering the page (sorting a table, opening a menu) costs no Firestore reads.
 *
 * `loading` is **derived** by comparing the request that produced the result on screen with
 * the one currently wanted, rather than being flipped by the effect. That keeps the effect
 * free of synchronous state writes, and it makes a stale response harmless: a result carrying
 * an old key simply never matches, so it cannot be painted over a newer range.
 */
export function useReport(range: DateRange): ReportState {
  const [nonce, setNonce] = useState(0)
  const { from, to } = range
  const rangeKey = `${from}|${to}`
  const key = `${rangeKey}|${nonce}`

  // Seeded from the cache with no request key, which no live request can match — so a
  // remount shows the remembered result AND counts as refreshing until its own fetch lands.
  const [loaded, setLoaded] = useState<Loaded | null>(() => {
    const remembered = cache.get(rangeKey)
    return remembered ? { ...remembered, key: '' } : null
  })

  const refresh = useCallback(() => setNonce((value) => value + 1), [])

  useEffect(() => {
    let cancelled = false

    fetchReportData({ from, to })
      .then((data) => {
        const entry: Loaded = { key, range: rangeKey, report: buildReport(data), error: null }
        remember({ range: entry.range, report: entry.report, error: entry.error })
        if (!cancelled) setLoaded(entry)
      })
      .catch(() => {
        if (!cancelled) {
          setLoaded({ key, range: rangeKey, report: null, error: message('reports.loadError') })
        }
      })

    return () => {
      cancelled = true
    }
  }, [key, rangeKey, from, to])

  const settled = loaded !== null && loaded.key === key
  // A result for this range — from this request or from an earlier visit — may be shown.
  // One for a different range may not, or switching range would paint the old day's figures
  // under the new day's heading.
  const showing = loaded !== null && loaded.range === rangeKey ? loaded : null

  return {
    report: showing?.report ?? null,
    error: showing?.error ?? null,
    loading: !settled && showing === null,
    refreshing: !settled && showing !== null,
    refresh,
  }
}
