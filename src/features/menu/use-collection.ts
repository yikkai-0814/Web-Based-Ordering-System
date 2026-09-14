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
 */
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
  const [state, setState] = useState<CollectionState<T>>({
    data: [],
    loading: true,
    error: null,
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
        setState({ data: rows, loading: false, error: null })
      },
      () => {
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
