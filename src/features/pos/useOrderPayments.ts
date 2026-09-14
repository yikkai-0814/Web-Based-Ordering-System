import { message } from '@/features/i18n/messages'
import type { Message } from '@/features/i18n/messages'
import { useSidecarDocs } from '@/features/pos/useOrderSidecars'
import { parseOrderPayment, type OrderPayment } from '@/features/pos/types'

/**
 * Live map of order id -> payment, for every signed-in active user.
 *
 * Staff subscribe, exactly as they do to voids: the person working the till is the one who
 * needs to know which orders are still owed for, so this cannot be admin-only.
 *
 * Scoped to the orders the workspace has loaded rather than the whole collection — the
 * chunks come from `chunkOrderIds`, so exactly one business date's payments are read.
 */
const PAYMENTS_ERROR = message('load.paymentsDate')

export function useOrderPayments(chunks: readonly (readonly string[])[]): {
  payments: Map<string, OrderPayment>
  loading: boolean
  error: Message | null
} {
  const state = useSidecarDocs<OrderPayment>(
    'orderPayments',
    parseOrderPayment,
    chunks,
    PAYMENTS_ERROR,
  )

  return { payments: state.records, loading: state.loading, error: state.error }
}
