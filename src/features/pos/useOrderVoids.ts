import { useMemo } from 'react'

import { useCollectionDocs } from '@/features/menu/use-collection'
import { parseOrderVoid, type OrderVoid } from '@/features/pos/types'
import { indexVoidsByOrderId } from '@/features/pos/voids'

/**
 * Live map of order id -> void, for every signed-in active user.
 *
 * Staff subscribe too, unlike the admin-only cost collections: a till operator must be able
 * to see that a sale was cancelled, or the orders list would misrepresent the day's takings
 * to the person working it.
 */
export function useOrderVoids(): {
  voids: Map<string, OrderVoid>
  loading: boolean
  error: string | null
} {
  const state = useCollectionDocs<OrderVoid>('orderVoids', parseOrderVoid)

  const voids = useMemo(() => indexVoidsByOrderId(state.data), [state.data])

  return { voids, loading: state.loading, error: state.error }
}
