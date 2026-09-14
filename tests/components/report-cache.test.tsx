// @vitest-environment jsdom
/**
 * The report a visit inherits, and the one it must not.
 *
 * The admin bands on the Dashboard are the one part of that page not served by a listener:
 * `fetchReportData` is a one-shot read in two sequential waves, because the sidecar queries
 * cannot be issued until the orders come back and say which ids to ask for. Held only in
 * component state, that cost was paid again on every visit — navigating away unmounted the
 * bands and coming back re-ran both waves while the rest of the page was already on screen.
 * Measured against the emulator on a 120-order day, the bands landed 151-213 ms after the
 * live tiles, every time.
 *
 * What these tests pin down is the part that is easy to get wrong: remembering a result must
 * not turn into showing the wrong one. A remembered report is shown only for the range it was
 * fetched for, it is always revalidated rather than trusted, and a failure is never
 * remembered at all.
 */
import { renderHook, waitFor, act } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const fetchReportData = vi.fn()

vi.mock('@/features/reports/reports-api', () => ({
  fetchReportData: (range: unknown) => fetchReportData(range),
}))

vi.mock('@/features/reports/aggregate', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/reports/aggregate')>()
  return { ...actual, buildReport: (data: unknown) => data }
})

import { clearReportCache, useReport } from '@/features/reports/useReport'

const TODAY = { from: '2026-09-14', to: '2026-09-14' }
const YESTERDAY = { from: '2026-09-13', to: '2026-09-13' }

beforeEach(() => {
  clearReportCache()
  fetchReportData.mockReset()
  fetchReportData.mockImplementation((range: { from: string }) =>
    Promise.resolve({ marker: range.from }),
  )
})

afterEach(() => {
  clearReportCache()
})

describe('a report is remembered between visits', () => {
  it('waits on the first visit to a range', async () => {
    const first = renderHook(() => useReport(TODAY))

    expect(first.result.current.loading).toBe(true)
    expect(first.result.current.report).toBeNull()

    await waitFor(() => expect(first.result.current.loading).toBe(false))
    expect(first.result.current.report).toEqual({ marker: '2026-09-14' })
    first.unmount()
  })

  it('shows the previous result immediately on the next visit, and still revalidates', async () => {
    const first = renderHook(() => useReport(TODAY))
    await waitFor(() => expect(first.result.current.loading).toBe(false))
    first.unmount()

    expect(fetchReportData).toHaveBeenCalledTimes(1)

    // Navigating back: the bands must paint at once rather than showing a skeleton.
    const second = renderHook(() => useReport(TODAY))
    expect(second.result.current.loading).toBe(false)
    expect(second.result.current.report).toEqual({ marker: '2026-09-14' })
    // Shown, but explicitly not treated as final — the Refresh button stays disabled.
    expect(second.result.current.refreshing).toBe(true)

    // The read is NOT skipped. The figures are no staler than they were before this change.
    await waitFor(() => expect(second.result.current.refreshing).toBe(false))
    expect(fetchReportData).toHaveBeenCalledTimes(2)
    second.unmount()
  })

  it('never shows one range’s result under another range', async () => {
    const first = renderHook(() => useReport(TODAY))
    await waitFor(() => expect(first.result.current.loading).toBe(false))
    first.unmount()

    const other = renderHook(() => useReport(YESTERDAY))
    // Nothing remembered for this day, so it waits rather than borrowing today's figures.
    expect(other.result.current.loading).toBe(true)
    expect(other.result.current.report).toBeNull()

    await waitFor(() => expect(other.result.current.loading).toBe(false))
    expect(other.result.current.report).toEqual({ marker: '2026-09-13' })
    other.unmount()
  })

  it('does not remember a failure, so a later visit retries cleanly', async () => {
    fetchReportData.mockRejectedValueOnce(new Error('network'))

    const failed = renderHook(() => useReport(TODAY))
    await waitFor(() => expect(failed.result.current.error).not.toBeNull())
    expect(failed.result.current.report).toBeNull()
    failed.unmount()

    const retried = renderHook(() => useReport(TODAY))
    expect(retried.result.current.loading).toBe(true)
    expect(retried.result.current.error).toBeNull()

    await waitFor(() => expect(retried.result.current.loading).toBe(false))
    expect(retried.result.current.report).toEqual({ marker: '2026-09-14' })
    retried.unmount()
  })

  it('refetches when Refresh is pressed, keeping the current figures on screen', async () => {
    const view = renderHook(() => useReport(TODAY))
    await waitFor(() => expect(view.result.current.loading).toBe(false))
    expect(fetchReportData).toHaveBeenCalledTimes(1)

    act(() => {
      view.result.current.refresh()
    })

    // The panel is never blanked: the figures stay up while the newer ones are fetched.
    expect(view.result.current.loading).toBe(false)
    expect(view.result.current.report).toEqual({ marker: '2026-09-14' })
    expect(view.result.current.refreshing).toBe(true)

    await waitFor(() => expect(view.result.current.refreshing).toBe(false))
    expect(fetchReportData).toHaveBeenCalledTimes(2)
    view.unmount()
  })
})
