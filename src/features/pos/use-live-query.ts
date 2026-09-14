import type { Message } from '@/features/i18n/messages'
import { useEffect, useState } from 'react'
import { onSnapshot, type DocumentReference, type Query } from 'firebase/firestore'

/**
 * Live subscriptions to a **bounded** slice of Firestore.
 *
 * The menu's `useCollectionDocs` subscribes to a whole collection, which is right for a
 * catalog of tens of items and wrong for orders, which grow without limit. Everything here
 * takes a query or a single document reference that the caller has already narrowed — by
 * business date, by a set of order ids, or by one id — so no screen ever opens a listener
 * over the entire sales history.
 *
 * Callers must pass a **memoised** query or reference. Firestore builds a new object on
 * every `query()` call, so an inline one would tear the subscription down and rebuild it on
 * every render.
 *
 * Each hook remembers which query its snapshot came from and only returns it while that
 * query is still the one being asked. Switching the business date therefore reads as
 * "loading" during the render that switches it, rather than showing yesterday's rows under
 * today's heading until the first snapshot lands — and it does so without an effect that
 * resets state, which would mean an extra render every time.
 */

export interface LiveQueryState<T> {
  data: T[]
  loading: boolean
  error: Message | null
}

export type ParseDoc<T> = (id: string, data: Record<string, unknown>) => T | null

const LOADING: LiveQueryState<never> = Object.freeze({
  data: Object.freeze([]) as never[],
  loading: true,
  error: null,
})

const IDLE: LiveQueryState<never> = Object.freeze({
  data: Object.freeze([]) as never[],
  loading: false,
  error: null,
})

/**
 * Subscribes to a query and parses each document, skipping malformed ones rather than
 * rendering nonsense — the same contract as `useCollectionDocs`.
 *
 * A null query means "nothing to ask for yet" and settles immediately as empty and not
 * loading, so a caller with no id to look up need not skip the hook and break the rules of
 * hooks.
 */
export function useQueryDocs<T>(
  liveQuery: Query | null,
  parse: ParseDoc<T>,
  errorMessage: Message,
): LiveQueryState<T> {
  const [received, setReceived] = useState<{
    source: Query
    state: LiveQueryState<T>
  } | null>(null)

  useEffect(() => {
    if (!liveQuery) return

    return onSnapshot(
      liveQuery,
      (snapshot) => {
        const rows: T[] = []
        for (const document of snapshot.docs) {
          const parsed = parse(document.id, document.data())
          if (parsed !== null) rows.push(parsed)
        }
        setReceived({ source: liveQuery, state: { data: rows, loading: false, error: null } })
      },
      () => {
        setReceived({
          source: liveQuery,
          state: { data: [], loading: false, error: errorMessage },
        })
      },
    )
  }, [liveQuery, parse, errorMessage])

  if (!liveQuery) return IDLE as LiveQueryState<T>
  return received?.source === liveQuery ? received.state : (LOADING as LiveQueryState<T>)
}

export interface LiveDocState<T> {
  data: T | null
  loading: boolean
  error: Message | null
}

const DOC_LOADING: LiveDocState<never> = Object.freeze({
  data: null,
  loading: true,
  error: null,
})

const DOC_IDLE: LiveDocState<never> = Object.freeze({
  data: null,
  loading: false,
  error: null,
})

/**
 * Subscribes to one document.
 *
 * A missing document is `null` with no error — which is exactly how this system represents
 * several real states: no `orderVoids/{id}` means the sale stands, no `orderPayments/{id}`
 * means it is unpaid, and no `orderFulfillment/{id}` means it is still pending. The absence
 * IS the information, so it must not be reported as a failure.
 */
export function useLiveDoc<T>(
  reference: DocumentReference | null,
  parse: ParseDoc<T>,
  errorMessage: Message,
): LiveDocState<T> {
  const [received, setReceived] = useState<{
    source: DocumentReference
    state: LiveDocState<T>
  } | null>(null)

  useEffect(() => {
    if (!reference) return

    return onSnapshot(
      reference,
      (snapshot) => {
        const parsed = snapshot.exists() ? parse(snapshot.id, snapshot.data()) : null
        setReceived({ source: reference, state: { data: parsed, loading: false, error: null } })
      },
      () => {
        setReceived({
          source: reference,
          state: { data: null, loading: false, error: errorMessage },
        })
      },
    )
  }, [reference, parse, errorMessage])

  if (!reference) return DOC_IDLE as LiveDocState<T>
  return received?.source === reference ? received.state : (DOC_LOADING as LiveDocState<T>)
}
