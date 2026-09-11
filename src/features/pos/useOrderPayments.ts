import { useMemo } from 'react'

import { useCollectionDocs } from '@/features/menu/use-collection'
import { indexPaymentsByOrderId } from '@/features/pos/payments'
import { parseOrderPayment, type OrderPayment } from '@/features/pos/types'

/**
 * Live map of order id -> payment, for every signed-in active user.
 *
 * Staff subscribe, exactly as they do to voids: the person working the till is the one who
 * needs to know which orders are still owed for, so this cannot be admin-only.
 */
export function useOrderPayments(): {
  payments: Map<string, OrderPayment>
  loading: boolean
  error: string | null
} {
  const state = useCollectionDocs<OrderPayment>('orderPayments', parseOrderPayment)

  const payments = useMemo(() => indexPaymentsByOrderId(state.data), [state.data])

  return { payments, loading: state.loading, error: state.error }
}
