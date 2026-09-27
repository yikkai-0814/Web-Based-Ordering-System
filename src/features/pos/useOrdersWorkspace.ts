import type { Message } from '@/features/i18n/messages'
import { useEffect, useMemo } from 'react'

import { chunkOrderIds } from '@/features/pos/order-sidecars'
import { buildOrderViews, type OrderView } from '@/features/pos/orders-view'
import { useOrderFulfillments } from '@/features/pos/useOrderFulfillments'
import { useOrderPayments } from '@/features/pos/useOrderPayments'
import { useOrders } from '@/features/pos/useOrders'
import { useOrderVoids } from '@/features/pos/useOrderVoids'
import { holdWorkspace, rememberWorkspace } from '@/features/pos/workspace-handoff'

/**
 * Everything the Orders list and the fulfilment queue need for one business date, resolved
 * into rows.
 *
 * Both screens read the same day through the same subscriptions, so the board and the list
 * cannot show different answers for the same order — and the sidecars are fetched by the ids
 * of the orders actually loaded, which is what keeps the day's reads bounded by the day.
 *
 * Loading is true until all four are in. The four resolve at different moments, and showing
 * rows before the sidecars land would flash every order as unpaid and pending for a frame.
 */
export interface OrdersWorkspace {
  /** Newest first, every order of the selected date, with both axes resolved. */
  views: OrderView[]
  loading: boolean
  error: Message | null
}

export function useOrdersWorkspace(businessDate: string): OrdersWorkspace {
  const { orders, loading: ordersLoading, error: ordersError } = useOrders(businessDate)

  const chunks = useMemo(() => chunkOrderIds(orders), [orders])

  const { payments, loading: paymentsLoading, error: paymentsError } = useOrderPayments(chunks)
  const { voids, loading: voidsLoading, error: voidsError } = useOrderVoids(chunks)
  const {
    fulfillments,
    loading: fulfillmentsLoading,
    error: fulfillmentsError,
  } = useOrderFulfillments(chunks)

  const views = useMemo(
    () => buildOrderViews(orders, { payments, fulfillments, voids }),
    [orders, payments, fulfillments, voids],
  )

  const loading = ordersLoading || paymentsLoading || voidsLoading || fulfillmentsLoading

  // While this page shows the date, its latest complete result is what a page opened in its
  // place starts from — see workspace-handoff.ts. Only complete results are handed over, so a
  // page never inherits the half-loaded moment this one happened to be in.
  useEffect(() => holdWorkspace(businessDate), [businessDate])
  useEffect(() => {
    if (!loading) rememberWorkspace(businessDate, views)
  }, [businessDate, views, loading])

  return {
    views,
    loading,
    // The first failure wins. Orders come first because without them the rest is moot.
    error: ordersError ?? paymentsError ?? voidsError ?? fulfillmentsError,
  }
}
