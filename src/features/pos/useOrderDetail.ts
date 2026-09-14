import { message } from '@/features/i18n/messages'
import type { Message } from '@/features/i18n/messages'
import { useMemo } from 'react'
import { doc } from 'firebase/firestore'

import { buildOrderView, type OrderView } from '@/features/pos/orders-view'
import {
  parseOrder,
  parseOrderFulfillment,
  parseOrderPayment,
  parseOrderVoid,
} from '@/features/pos/types'
import { useLiveDoc } from '@/features/pos/use-live-query'
import { db } from '@/lib/firebase'

/**
 * One order and its three sidecars, by id.
 *
 * Four single-document listeners rather than a slice of four collections: a receipt is about
 * exactly one sale, and the previous implementation found it by loading every order ever
 * written and searching the array — which read the whole history to show one docket, and got
 * slower with every sale the café made.
 *
 * A missing sidecar is not an error. No void means the sale stands, no payment means it is
 * unpaid, no fulfilment record means it is still pending — see `useLiveDoc`.
 */
export interface OrderDetail {
  /** Null when no order has that id, which the page renders as "not found". */
  view: OrderView | null
  loading: boolean
  error: Message | null
}

const ORDER_ERROR = message('load.order')

export function useOrderDetail(orderId: string | undefined): OrderDetail {
  const orderRef = useMemo(() => (orderId ? doc(db, 'orders', orderId) : null), [orderId])
  const paymentRef = useMemo(() => (orderId ? doc(db, 'orderPayments', orderId) : null), [orderId])
  const voidRef = useMemo(() => (orderId ? doc(db, 'orderVoids', orderId) : null), [orderId])
  const fulfillmentRef = useMemo(
    () => (orderId ? doc(db, 'orderFulfillment', orderId) : null),
    [orderId],
  )

  const order = useLiveDoc(orderRef, parseOrder, ORDER_ERROR)
  const payment = useLiveDoc(paymentRef, parseOrderPayment, message('load.payment'))
  const voided = useLiveDoc(voidRef, parseOrderVoid, message('load.void'))
  const fulfillment = useLiveDoc(fulfillmentRef, parseOrderFulfillment, message('load.fulfilment'))

  const loading = order.loading || payment.loading || voided.loading || fulfillment.loading

  const view = useMemo(() => {
    if (!order.data) return null
    // buildOrderView takes maps because the list builds many rows at once; one entry each is
    // the same call with a smaller map, which keeps a receipt and a list row resolved by
    // exactly the same code.
    return buildOrderView(order.data, {
      payments: payment.data ? new Map([[order.data.id, payment.data]]) : new Map(),
      fulfillments: fulfillment.data ? new Map([[order.data.id, fulfillment.data]]) : new Map(),
      voids: voided.data ? new Map([[order.data.id, voided.data]]) : new Map(),
    })
  }, [order.data, payment.data, fulfillment.data, voided.data])

  return {
    view,
    loading,
    error: order.error ?? payment.error ?? voided.error ?? fulfillment.error,
  }
}
