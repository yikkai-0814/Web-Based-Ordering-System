import { useCallback, useEffect, useState } from 'react'

import { businessDateOf, msUntilNextBusinessDate } from '@/features/pos/types'

/**
 * A small cushion past midnight before re-reading the clock.
 *
 * Timers fire *approximately*, and a few milliseconds early would have this recompute the
 * date, get yesterday's answer back, and immediately schedule another wake-up microseconds
 * later. Waiting a moment past the boundary makes the first read the right one.
 */
const SETTLE_MS = 1_000

/** Never schedule tighter than this, so an early or mis-set clock cannot spin the timer. */
const MINIMUM_DELAY_MS = 250

/**
 * Today's business date, kept current while the page stays open.
 *
 * A till is not a page somebody visits; it is left running on a counter for days. Every
 * screen that shows "today" used to decide what today was once, at mount, and never
 * revisit it — so after midnight the kitchen board went on displaying yesterday while the
 * till, which stamps each sale with the date at the moment it writes, quietly filed new
 * orders under the new day. The sales were recorded correctly and became invisible to the
 * people who had to act on them.
 *
 * Two triggers, because one is not enough:
 *
 *   * **a timer armed for the next local midnight**, rearmed after each crossing. This is
 *     the case a machine that stays awake all night needs.
 *   * **`visibilitychange` and `focus`**, because a tablet asleep on a counter may not fire
 *     that timer at all — a suspended device can skip it entirely or deliver it late. Waking
 *     the screen has to be a trigger in its own right, not a nicety.
 *
 * Re-reading the clock costs nothing and setting the same string back is a no-op in React,
 * so the extra triggers cannot cause a re-render on a day that has not changed.
 */
export function useBusinessToday(): string {
  const [today, setToday] = useState(() => businessDateOf(new Date()))

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined

    function schedule() {
      const delay = Math.max(msUntilNextBusinessDate(new Date()) + SETTLE_MS, MINIMUM_DELAY_MS)
      timer = setTimeout(sync, delay)
    }

    function sync() {
      // Same value means React bails out, so a wake-up mid-afternoon changes nothing.
      setToday(businessDateOf(new Date()))
      schedule()
    }

    function revalidate() {
      if (timer !== undefined) clearTimeout(timer)
      sync()
    }

    schedule()
    document.addEventListener('visibilitychange', revalidate)
    window.addEventListener('focus', revalidate)

    return () => {
      if (timer !== undefined) clearTimeout(timer)
      document.removeEventListener('visibilitychange', revalidate)
      window.removeEventListener('focus', revalidate)
    }
  }, [])

  return today
}

export interface ShownBusinessDate {
  /** The day the screen is showing. */
  businessDate: string
  /** Show a different day. Choosing today resumes following it. */
  showDate: (next: string) => void
}

/**
 * Which day a dated workspace is showing — today, until somebody says otherwise.
 *
 * The distinction this draws is the whole reason it exists. A screen left alone should move
 * on at midnight, or the kitchen board spends the small hours displaying a day that has
 * ended. A screen somebody has deliberately navigated must NOT move: reading last Tuesday's
 * takings at 23:59 and being thrown to Wednesday at 00:01 would be its own kind of wrong.
 *
 * So "following" is a state of its own — `null` — rather than a date that happens to equal
 * today. Choosing today explicitly returns to following, which is what the Today button in
 * BusinessDateBar already does without needing to know any of this.
 *
 * Shared by the Orders list and the Queue, which had the same three lines each before.
 */
export function useShownBusinessDate(): ShownBusinessDate {
  const today = useBusinessToday()
  const [chosen, setChosen] = useState<string | null>(null)

  const showDate = useCallback(
    (next: string) => {
      setChosen(next === today ? null : next)
    },
    [today],
  )

  return { businessDate: chosen ?? today, showDate }
}
