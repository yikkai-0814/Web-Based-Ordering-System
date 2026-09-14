import { message } from '@/features/i18n/messages'
import type { Message } from '@/features/i18n/messages'
import { useSidecarDocs } from '@/features/pos/useOrderSidecars'
import { parseOrderVoid, type OrderVoid } from '@/features/pos/types'

/**
 * Live map of order id -> void, for every signed-in active user.
 *
 * Staff subscribe too, unlike the admin-only cost collections: a till operator must be able
 * to see that a sale was cancelled, or the orders list would misrepresent the day's takings
 * to the person working it.
 *
 * Scoped to the orders the workspace has loaded — see `chunkOrderIds`.
 */
export function useOrderVoids(chunks: readonly (readonly string[])[]): {
  voids: Map<string, OrderVoid>
  loading: boolean
  error: Message | null
} {
  const state = useSidecarDocs<OrderVoid>(
    'orderVoids',
    parseOrderVoid,
    chunks,
    message('load.voidsDate'),
  )

  return { voids: state.records, loading: state.loading, error: state.error }
}
