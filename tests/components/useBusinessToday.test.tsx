// @vitest-environment jsdom
/**
 * Whether the till notices midnight.
 *
 * The arithmetic is proven in tests/unit (`msUntilNextBusinessDate`); what is proven here is
 * that something actually acts on it. Before Phase 14 every "today" screen decided what
 * today was at mount and never revisited it, so a counter left running overnight showed
 * yesterday's kitchen board while the till filed new sales under the new day — recorded
 * correctly, invisible to the people who had to cook them.
 *
 * Fake timers throughout, with the system clock moved explicitly. Nothing here waits.
 *
 * This file renders with Testing Library directly rather than through `./render`, and so
 * registers its own cleanup: that helper builds a `userEvent` session, and user-event's
 * internal delays deadlock against a fake clock unless it is handed one. Nothing here needs
 * it — the interactions are plain clicks — so the simpler tool is the safer one.
 */
import { useEffect } from 'react'

import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { businessDateOf } from '@/features/pos/types'
import { useBusinessToday, useShownBusinessDate } from '@/features/pos/useBusinessToday'

/** 12 September 2026, a minute before closing time in local time. */
const LATE_EVENING = new Date(2026, 8, 12, 23, 59, 0, 0)

function Today() {
  const today = useBusinessToday()
  return <span data-testid="today">{today}</span>
}

function Workspace() {
  const { businessDate, showDate } = useShownBusinessDate()
  return (
    <div>
      <span data-testid="shown">{businessDate}</span>
      <button type="button" onClick={() => showDate('2026-09-08')}>
        Last Tuesday
      </button>
      {/* Local date, never toISOString — that reads as UTC and would pick the wrong day for
          anyone west of Greenwich, which is precisely the trap businessDateOf exists to
          avoid. Using it here keeps this test true in any timezone. */}
      <button type="button" onClick={() => showDate(businessDateOf(new Date()))}>
        Today
      </button>
    </div>
  )
}

/** Moves the clock and lets the timers that were due in that span run. */
async function passTime(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
}

/** Moves the clock WITHOUT running timers — a tablet asleep on the counter. */
async function sleepThrough(ms: number) {
  vi.setSystemTime(new Date(Date.now() + ms))
  await Promise.resolve()
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(LATE_EVENING)
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('useBusinessToday', () => {
  it('starts on the current business date', () => {
    render(<Today />)
    expect(screen.getByTestId('today').textContent).toBe('2026-09-12')
  })

  it('moves to the new day at midnight, with nobody touching anything', async () => {
    render(<Today />)
    await passTime(2 * 60 * 1000)
    expect(screen.getByTestId('today').textContent).toBe('2026-09-13')
  })

  it('does not move early — 23:59:59.999 is still the same day', async () => {
    render(<Today />)
    await passTime(59 * 1000 + 999)
    expect(screen.getByTestId('today').textContent).toBe('2026-09-12')
  })

  it('rearms, so a second night rolls over too', async () => {
    render(<Today />)
    await passTime(2 * 60 * 1000)
    expect(screen.getByTestId('today').textContent).toBe('2026-09-13')

    // Through the whole of the 13th and into the 14th.
    await passTime(24 * 60 * 60 * 1000)
    expect(screen.getByTestId('today').textContent).toBe('2026-09-14')
  })

  it('catches up when a sleeping device is woken, without waiting for the timer', async () => {
    render(<Today />)

    // Suspended across midnight: the clock moved, the timer never fired.
    await sleepThrough(9 * 60 * 60 * 1000)
    expect(screen.getByTestId('today').textContent).toBe('2026-09-12')

    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'))
    })
    expect(screen.getByTestId('today').textContent).toBe('2026-09-13')
  })

  it('catches up on window focus as well', async () => {
    render(<Today />)
    await sleepThrough(9 * 60 * 60 * 1000)

    await act(async () => {
      window.dispatchEvent(new Event('focus'))
    })
    expect(screen.getByTestId('today').textContent).toBe('2026-09-13')
  })

  it('changes nothing when the day has not changed', async () => {
    // Counted in an effect rather than during render: commits are what actually cost
    // anything, and reassigning during render is a side effect in its own right.
    let commits = 0
    function Counting() {
      useEffect(() => {
        commits += 1
      })
      return <Today />
    }
    render(<Counting />)
    const before = commits

    await passTime(30 * 1000)
    await act(async () => {
      window.dispatchEvent(new Event('focus'))
      document.dispatchEvent(new Event('visibilitychange'))
    })

    // Same string back is a no-op in React, so a mid-shift wake-up costs no render.
    expect(screen.getByTestId('today').textContent).toBe('2026-09-12')
    expect(commits).toBe(before)
  })

  it('stops its timer when unmounted', async () => {
    const { unmount } = render(<Today />)
    unmount()
    // Nothing left armed: advancing past midnight must not try to set state on a gone tree.
    await passTime(2 * 60 * 1000)
    expect(vi.getTimerCount()).toBe(0)
  })
})

describe('useShownBusinessDate: following versus chosen', () => {
  it('follows today over a rollover while nobody has navigated', async () => {
    render(<Workspace />)
    expect(screen.getByTestId('shown').textContent).toBe('2026-09-12')

    await passTime(2 * 60 * 1000)
    expect(screen.getByTestId('shown').textContent).toBe('2026-09-13')
  })

  it('leaves a deliberately chosen day exactly where it is', async () => {
    render(<Workspace />)
    await act(async () => {
      screen.getByText('Last Tuesday').click()
    })
    expect(screen.getByTestId('shown').textContent).toBe('2026-09-08')

    // The reason this matters: somebody reading last Tuesday's takings at 23:59 must still
    // be reading last Tuesday at 00:01, not be thrown forward two days.
    await passTime(2 * 60 * 1000)
    expect(screen.getByTestId('shown').textContent).toBe('2026-09-08')
  })

  it('resumes following once today is chosen again', async () => {
    render(<Workspace />)
    await act(async () => {
      screen.getByText('Last Tuesday').click()
    })
    await act(async () => {
      screen.getByText('Today').click()
    })
    expect(screen.getByTestId('shown').textContent).toBe('2026-09-12')

    // Following again, so the next midnight moves it on.
    await passTime(2 * 60 * 1000)
    expect(screen.getByTestId('shown').textContent).toBe('2026-09-13')
  })
})
