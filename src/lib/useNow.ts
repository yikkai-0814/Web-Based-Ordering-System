import { useEffect, useState } from 'react'

/**
 * A clock that ticks, for UI that has to keep counting while nothing else changes.
 *
 * The elapsed times on the queue board are derived from two stored timestamps and this
 * value — so a running timer costs exactly nothing in Firestore. Writing the elapsed time
 * every second would be a write per order per second across every open till, to store a
 * number that can be subtracted for free at render time.
 *
 * Only components that actually display a live timer should call this: it re-renders them
 * once a second by design, and a component that merely shows a finished duration has
 * nothing to re-render for.
 *
 * The interval is cleared on unmount, and restarted if the period changes.
 */
export function useNow(periodMs = 1000): number {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    // The initial value is seeded by useState above; this only keeps it moving. Setting
    // state here as well would start a second render for a value that is already correct.
    const id = setInterval(() => setNow(Date.now()), periodMs)
    return () => clearInterval(id)
  }, [periodMs])

  return now
}
