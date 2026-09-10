import { useCallback, useEffect, useState } from 'react'

import { buildReport, type Report } from '@/features/reports/aggregate'
import { fetchReportData } from '@/features/reports/reports-api'
import type { DateRange } from '@/features/reports/ranges'

interface Loaded {
  /** Identifies which request produced this result. */
  key: string
  report: Report | null
  error: string | null
}

const NOTHING_LOADED: Loaded = { key: '', report: null, error: null }

/**
 * Fetches and aggregates a report for a date range.
 *
 * Refetches only when the range changes — the result is held in state, so re-rendering the
 * page (sorting a table, opening a menu) costs no Firestore reads.
 *
 * `loading` is **derived** by comparing the key of the last completed request with the one
 * currently wanted, rather than being flipped by the effect. That keeps the effect free of
 * synchronous state writes, and it makes a stale response harmless: a result carrying an
 * old key simply never matches, so it cannot be painted over a newer range.
 */
export function useReport(range: DateRange): {
  report: Report | null
  loading: boolean
  error: string | null
  refresh: () => void
} {
  const [nonce, setNonce] = useState(0)
  const [loaded, setLoaded] = useState<Loaded>(NOTHING_LOADED)

  const refresh = useCallback(() => setNonce((value) => value + 1), [])

  const { from, to } = range
  const key = `${from}|${to}|${nonce}`

  useEffect(() => {
    let cancelled = false

    fetchReportData({ from, to })
      .then((data) => {
        if (!cancelled) setLoaded({ key, report: buildReport(data), error: null })
      })
      .catch(() => {
        if (!cancelled) {
          setLoaded({
            key,
            report: null,
            error: 'Could not load the report. You may not have permission, or you may be offline.',
          })
        }
      })

    return () => {
      cancelled = true
    }
  }, [key, from, to])

  const settled = loaded.key === key

  return {
    report: settled ? loaded.report : null,
    loading: !settled,
    error: settled ? loaded.error : null,
    refresh,
  }
}
