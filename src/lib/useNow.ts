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
 * nothing to re-render for. See `OrderElapsedTime`, which splits into two components so the
 * delivered form never subscribes at all.
 *
 * **One interval per period, shared by every subscriber.** A busy lunch leaves 70-odd cards
 * on the queue board, all of them waiting and all of them ticking. A `setInterval` each
 * meant 70 timers firing at 70 slightly different moments, each waking React for a single
 * component — 70 renders a second, spread out so none of them could be batched. Sharing the
 * timer means one wake-up, one timestamp, and one batched render for the whole board.
 *
 * Subscribers all receive the same `Date.now()` for a given tick, which is also more correct
 * than each reading its own: two cards on the same screen can no longer disagree about what
 * time it is.
 */

interface Clock {
  id: ReturnType<typeof setInterval>
  now: number
  subscribers: Set<(now: number) => void>
}

/** Keyed by period, so a 1s and a 5s caller do not share a timer. */
const clocks = new Map<number, Clock>()

function subscribe(periodMs: number, listener: (now: number) => void): () => void {
  let clock = clocks.get(periodMs)
  if (!clock) {
    const created: Clock = {
      now: Date.now(),
      subscribers: new Set(),
      id: setInterval(() => {
        const current = clocks.get(periodMs)
        if (!current) return
        current.now = Date.now()
        for (const notify of current.subscribers) notify(current.now)
      }, periodMs),
    }
    clocks.set(periodMs, created)
    clock = created
  }

  clock.subscribers.add(listener)

  return () => {
    const current = clocks.get(periodMs)
    if (!current) return
    current.subscribers.delete(listener)
    // The last subscriber leaving stops the timer, so an idle screen holds no interval at
    // all — the same guarantee the per-component version gave on unmount.
    if (current.subscribers.size === 0) {
      clearInterval(current.id)
      clocks.delete(periodMs)
    }
  }
}

export function useNow(periodMs = 1000): number {
  const [now, setNow] = useState(() => clocks.get(periodMs)?.now ?? Date.now())

  useEffect(() => {
    // Seeded by useState above; a subscriber joining an already-running clock adopts its
    // current tick so every card on the board shows the same second.
    return subscribe(periodMs, setNow)
  }, [periodMs])

  return now
}
