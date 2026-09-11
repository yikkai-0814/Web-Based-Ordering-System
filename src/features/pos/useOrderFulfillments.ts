import { useMemo } from 'react'

import { useCollectionDocs } from '@/features/menu/use-collection'
import { indexFulfillmentsByOrderId } from '@/features/pos/fulfillment'
import { parseOrderFulfillment, type OrderFulfillment } from '@/features/pos/types'

/**
 * Live map of order id -> fulfilment, for every signed-in active user.
 *
 * Live rather than one-shot matters more here than anywhere else in the app: the counter and
 * the kitchen are looking at the same orders on different devices, and a board that only
 * refreshed on navigation would have somebody making a drink that was handed over two
 * minutes ago.
 *
 * Orders with no record are simply absent from this map, which is exactly how `pending` is
 * represented — see `resolveFulfillmentState`.
 */
export function useOrderFulfillments(): {
  fulfillments: Map<string, OrderFulfillment>
  loading: boolean
  error: string | null
} {
  const state = useCollectionDocs<OrderFulfillment>('orderFulfillment', parseOrderFulfillment)

  const fulfillments = useMemo(() => indexFulfillmentsByOrderId(state.data), [state.data])

  return { fulfillments, loading: state.loading, error: state.error }
}
