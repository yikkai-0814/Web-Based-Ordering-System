import { message, type Message } from '@/features/i18n/messages'
import { useEffect, useMemo, useState } from 'react'
import { collection, onSnapshot } from 'firebase/firestore'

import { db } from '@/lib/firebase'

export interface CollectionState<T> {
  data: T[]
  loading: boolean
  error: Message | null
}

/**
 * Subscribes to a whole collection and parses each document.
 *
 * A live `onSnapshot` rather than a one-off read, matching the pattern already used for
 * the user profile in src/features/auth/AuthProvider.tsx: an admin editing a price on one
 * device sees it change on the till immediately, with no refresh.
 *
 * The catalog is deliberately fetched whole and filtered in memory. A café menu is tens of
 * items, so this avoids composite indexes entirely; if it ever grows past that, this is
 * the single place to add a query.
 *
 * `parse` must be a stable module-level function, not an inline closure, or the
 * subscription will tear down and rebuild on every render.
 *
 * **The last rows a collection reported survive unmounting.** Navigating away from Menu or
 * Staff tears the listener down, so coming back was a fresh mount that began with
 * `loading: true` and an empty list — a grey skeleton, for as long as it took Firestore to
 * answer. Measured against the emulator, that answer comes back from the local cache in
 * 10-25 ms: long enough to see a flash, far too short for it to mean anything.
 *
 * Seeding from what the collection last said turns that into a stable transition. The page
 * shows the catalogue or the roster it had, and the listener corrects it a frame or two later
 * — which is the same information, because the listener's own first callback is served from
 * the same local cache. A collection nobody has opened yet has nothing remembered, so a
 * genuine first load still gets its skeleton.
 *
 * This changes nothing about the subscription: the listener is created, torn down and
 * recreated exactly as before, and its snapshot is always what ends up on screen.
 */

/**
 * Keyed by collection path. Bounded by the five collections this hook serves, so it needs no
 * eviction; each holds one day-independent list whose size is the menu or the roster.
 */
const lastKnown = new Map<string, readonly unknown[]>()

/** Exported for tests: state that outlives a mount would otherwise leak between them. */
export function clearCollectionCache(): void {
  lastKnown.clear()
}
export function useCollectionDocs<T>(
  path: string,
  parse: (id: string, data: Record<string, unknown>) => T | null,
  /**
   * Set false to skip the subscription entirely. Used for admin-only collections: a staff
   * session must not even attempt the read, or the rules would (correctly) refuse it and
   * the page would show a permission error for something staff are not meant to see.
   */
  enabled = true,
): CollectionState<T> {
  const [state, setState] = useState<CollectionState<T>>(() => {
    const remembered = enabled ? lastKnown.get(path) : undefined
    return remembered
      ? { data: remembered as T[], loading: false, error: null }
      : { data: [], loading: true, error: null }
  })

  useEffect(() => {
    if (!enabled) return

    // No `setState({ loading: true })` here: the initial state already says loading, and
    // `path` is a constant per call site, so re-flagging it would only cause an extra
    // render. The first snapshot clears it.
    const unsubscribe = onSnapshot(
      collection(db, path),
      (snapshot) => {
        const rows: T[] = []
        for (const document of snapshot.docs) {
          const parsed = parse(document.id, document.data())
          // Skip malformed documents rather than rendering nonsense.
          if (parsed !== null) rows.push(parsed)
        }
        // Remembered before the render, so the next mount of this collection starts from what
        // it last actually said rather than from nothing.
        lastKnown.set(path, rows)
        setState({ data: rows, loading: false, error: null })
      },
      () => {
        // A refused or failed read is NOT remembered: the error is shown with no rows, exactly
        // as before, and a later mount retries from scratch rather than inheriting anything.
        setState({
          data: [],
          loading: false,
          error: message('validation.menuLoadError'),
        })
      },
    )

    return unsubscribe
  }, [path, parse, enabled])

  // Derived during render rather than written into state by the effect. A shared frozen
  // constant keeps the identity stable so downstream useMemo calls do not re-run.
  return enabled ? state : (DISABLED as CollectionState<T>)
}

const DISABLED: CollectionState<never> = Object.freeze({
  data: Object.freeze([]) as never[],
  loading: false,
  error: null,
})

/** Applies a comparator to a collection result without re-sorting on every render. */
export function useSorted<T>(state: CollectionState<T>, compare: (a: T, b: T) => number) {
  const data = useMemo(() => [...state.data].sort(compare), [state.data, compare])
  return { ...state, data }
}
