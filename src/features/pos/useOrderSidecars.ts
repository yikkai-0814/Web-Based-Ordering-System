import { useEffect, useMemo, useRef, useState } from 'react'
import { collection, onSnapshot, query, where, type Unsubscribe } from 'firebase/firestore'

import type { ParseDoc } from '@/features/pos/use-live-query'
import { db } from '@/lib/firebase'

/**
 * Live sidecar records for the orders currently on screen, and only those.
 *
 * One listener per chunk of order ids (see order-sidecars.ts for why the chunks are cut the
 * way they are). A variable number of subscriptions cannot be expressed as a hook each, so
 * they are reconciled by hand against the chunk list: open a listener for a chunk that has
 * appeared, close one whose chunk has gone, and leave the rest alone. That last part is the
 * point — a chunk that has not changed keeps its listener across a sale being rung up,
 * across a filter being switched, and across every re-render.
 *
 * Each chunk's rows are held separately and merged on read, so one chunk's snapshot cannot
 * clobber another's.
 */
export interface SidecarState<T> {
  records: Map<string, T>
  loading: boolean
  error: string | null
}

const EMPTY_RECORDS = new Map<string, never>()

/**
 * The chunk list as one string, and back again.
 *
 * Chunk arrays are rebuilt on every snapshot of the orders query, so their identity churns
 * constantly while their CONTENT usually does not. Collapsing them to a string is what lets
 * the effect depend on what the chunks say rather than on which arrays they happen to be,
 * and it is safe because Firestore document ids contain neither separator.
 */
const CHUNK_SEPARATOR = '|'
const ID_SEPARATOR = ','

function keysOf(signature: string): string[] {
  return signature === '' ? [] : signature.split(CHUNK_SEPARATOR)
}

export function useSidecarDocs<T extends { orderId: string }>(
  path: string,
  parse: ParseDoc<T>,
  chunks: readonly (readonly string[])[],
  errorMessage: string,
): SidecarState<T> {
  const signature = useMemo(
    () =>
      chunks
        .filter((chunk) => chunk.length > 0)
        .map((chunk) => chunk.join(ID_SEPARATOR))
        .join(CHUNK_SEPARATOR),
    [chunks],
  )

  const [pages, setPages] = useState<Map<string, T[]>>(() => new Map())
  const [error, setError] = useState<string | null>(null)
  const subscriptions = useRef(new Map<string, Unsubscribe>())
  /**
   * The chunks currently wanted, read by every snapshot callback.
   *
   * A ref rather than the effect's own local set: a listener opened while one chunk list was
   * current keeps firing after a longer list replaces it, and pruning against the set it
   * closed over would throw away the rows of a chunk that had since been added.
   */
  const wanted = useRef<Set<string>>(new Set())

  useEffect(() => {
    const keys = keysOf(signature)
    wanted.current = new Set(keys)

    for (const [key, unsubscribe] of subscriptions.current) {
      if (wanted.current.has(key)) continue
      unsubscribe()
      subscriptions.current.delete(key)
      // Its rows are deliberately not deleted here — that would be a synchronous state
      // update in an effect, for no benefit: the merge below reads only the wanted keys, and
      // the next snapshot prunes whatever is left over.
    }

    for (const key of keys) {
      if (subscriptions.current.has(key)) continue
      const ids = key.split(ID_SEPARATOR)
      subscriptions.current.set(
        key,
        onSnapshot(
          // `in` on a single field is served by the automatic index — no composite index to
          // deploy, and no read of any document outside the selected day.
          query(collection(db, path), where('orderId', 'in', ids)),
          (snapshot) => {
            const rows: T[] = []
            for (const document of snapshot.docs) {
              const parsed = parse(document.id, document.data())
              if (parsed !== null) rows.push(parsed)
            }
            setPages((previous) => {
              // Rebuilt from the chunks that are wanted right now, so pages belonging to a
              // business date that has been navigated away from do not accumulate.
              const next = new Map<string, T[]>()
              for (const live of wanted.current) {
                const existing = previous.get(live)
                if (existing) next.set(live, existing)
              }
              next.set(key, rows)
              return next
            })
            setError(null)
          },
          () => setError(errorMessage),
        ),
      )
    }
  }, [signature, path, parse, errorMessage])

  // Torn down separately from the reconciliation above, which must NOT close listeners it is
  // about to keep. Clearing the map matters as much as unsubscribing: React's development
  // strict mode mounts twice, and a map still holding dead entries would make the second
  // mount think it was already subscribed.
  useEffect(() => {
    const open = subscriptions.current
    return () => {
      for (const unsubscribe of open.values()) unsubscribe()
      open.clear()
    }
  }, [])

  const keys = useMemo(() => keysOf(signature), [signature])

  const records = useMemo(() => {
    if (keys.length === 0) return EMPTY_RECORDS as Map<string, T>
    const index = new Map<string, T>()
    for (const key of keys) {
      for (const row of pages.get(key) ?? []) index.set(row.orderId, row)
    }
    return index
  }, [pages, keys])

  // Loading until every chunk has reported once. No chunks means no orders to describe,
  // which is settled rather than pending.
  const loading = keys.some((key) => !pages.has(key))

  return { records, loading, error }
}
