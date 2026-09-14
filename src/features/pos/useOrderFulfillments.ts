import { message } from '@/features/i18n/messages'
import type { Message } from '@/features/i18n/messages'
import { useSidecarDocs } from '@/features/pos/useOrderSidecars'
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
 *
 * Scoped to the orders the workspace has loaded — see `chunkOrderIds`.
 */
const FULFILMENTS_ERROR = message('load.fulfilmentDate')

export function useOrderFulfillments(chunks: readonly (readonly string[])[]): {
  fulfillments: Map<string, OrderFulfillment>
  loading: boolean
  error: Message | null
} {
  const state = useSidecarDocs<OrderFulfillment>(
    'orderFulfillment',
    parseOrderFulfillment,
    chunks,
    FULFILMENTS_ERROR,
  )

  return { fulfillments: state.records, loading: state.loading, error: state.error }
}
