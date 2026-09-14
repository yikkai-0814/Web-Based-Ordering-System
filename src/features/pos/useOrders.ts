import { message } from '@/features/i18n/messages'
import type { Message } from '@/features/i18n/messages'
import { useMemo } from 'react'
import { collection, query, where } from 'firebase/firestore'

import { byNumberDescending, parseOrder, type Order } from '@/features/pos/types'
import { useQueryDocs } from '@/features/pos/use-live-query'
import { db } from '@/lib/firebase'

/**
 * Live list of the orders filed under one business date, newest first.
 *
 * **Bounded by the date, not the whole collection.** Orders are the one collection here that
 * grows without limit, and the workspace only ever shows a single day, so the day is the
 * query rather than a filter applied after fetching everything ever sold.
 *
 * `businessDate` is `YYYY-MM-DD` and compared for equality, which the automatic single-field
 * index serves — `firestore.indexes.json` stays empty. Sorting is done in memory afterwards
 * rather than with `orderBy('number')`, because an equality filter plus a sort on a
 * different field is exactly what would require a composite index, and a day's orders are
 * few enough that sorting them costs nothing.
 */
export function useOrders(businessDate: string): {
  orders: Order[]
  loading: boolean
  error: Message | null
} {
  const ordersQuery = useMemo(
    () => query(collection(db, 'orders'), where('businessDate', '==', businessDate)),
    [businessDate],
  )

  const state = useQueryDocs<Order>(ordersQuery, parseOrder, message('load.orders'))

  const orders = useMemo(() => [...state.data].sort(byNumberDescending), [state.data])

  return { orders, loading: state.loading, error: state.error }
}
