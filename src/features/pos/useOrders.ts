import { useMemo } from 'react'

import { useCollectionDocs } from '@/features/menu/use-collection'
import { byNumberDescending, parseOrder, type Order } from '@/features/pos/types'

/**
 * Live list of orders, newest first.
 *
 * Reuses the subscription helper written for the menu rather than a second implementation.
 * The whole collection is fetched, as with the catalog — acceptable while a café's order
 * history is small, and the single place to add a date-bounded query when it is not.
 */
export function useOrders(): { orders: Order[]; loading: boolean; error: string | null } {
  const state = useCollectionDocs<Order>('orders', parseOrder)

  const orders = useMemo(() => [...state.data].sort(byNumberDescending), [state.data])

  return { orders, loading: state.loading, error: state.error }
}
