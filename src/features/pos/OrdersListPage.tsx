import { Link } from 'react-router'
import { AlertCircle } from 'lucide-react'

import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { overallStatusOf, resolveFulfillmentState } from '@/features/pos/fulfillment'
import { resolvePaymentState } from '@/features/pos/payments'
import {
  FulfillmentStatusBadge,
  OverallStatusBadge,
  PaymentStatusBadge,
} from '@/features/pos/PaymentStatusBadge'
import { businessDateOf, operatorNameOf, PAYMENT_LABELS } from '@/features/pos/types'
import { useOrders } from '@/features/pos/useOrders'
import { useOrderFulfillments } from '@/features/pos/useOrderFulfillments'
import { useOrderPayments } from '@/features/pos/useOrderPayments'
import { useOrderVoids } from '@/features/pos/useOrderVoids'
import { formatMoney } from '@/lib/money'
import { cn } from '@/lib/utils'

export function OrdersListPage() {
  const { orders, loading, error } = useOrders()
  const { voids, loading: voidsLoading } = useOrderVoids()
  const { payments, loading: paymentsLoading } = useOrderPayments()
  const { fulfillments, loading: fulfillmentsLoading } = useOrderFulfillments()
  const today = businessDateOf(new Date())

  if (loading || voidsLoading || paymentsLoading || fulfillmentsLoading) {
    return <Skeleton className="h-96 w-full max-w-4xl" />
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Orders</h1>
        <p className="text-muted-foreground">
          Orders, newest first. Fulfilment and payment advance independently — an order is complete
          only once it has been delivered <em>and</em> paid for. Orders cannot be edited or deleted;
          a mistake is corrected by voiding, which leaves the original record intact.
        </p>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertCircle aria-hidden="true" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {orders.length === 0 ? (
        <p className="text-muted-foreground">No sales recorded yet.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-24">Order</TableHead>
                <TableHead className="w-32">Date</TableHead>
                <TableHead className="w-20">Items</TableHead>
                <TableHead className="w-28">Fulfilment</TableHead>
                <TableHead className="w-32">Payment</TableHead>
                <TableHead>Served by</TableHead>
                <TableHead className="w-40">Overall</TableHead>
                <TableHead className="w-32 text-right">Total</TableHead>
                <TableHead className="w-28 text-right">Receipt</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {orders.map((order) => {
                const voided = voids.has(order.id)
                const paymentState = resolvePaymentState(order, payments.get(order.id) ?? null)
                const fulfillment = resolveFulfillmentState(
                  order,
                  fulfillments.get(order.id) ?? null,
                )
                const overall = overallStatusOf({
                  fulfillment,
                  payment: paymentState,
                  voided,
                })
                return (
                  <TableRow
                    key={order.id}
                    data-testid="order-row"
                    data-order-number={order.number}
                    data-voided={voided}
                  >
                    <TableCell className="font-medium tabular-nums">#{order.number}</TableCell>
                    <TableCell className="tabular-nums text-muted-foreground">
                      {order.businessDate === today ? 'Today' : order.businessDate}
                    </TableCell>
                    <TableCell className="tabular-nums">
                      {order.lines.reduce((count, line) => count + line.quantity, 0)}
                    </TableCell>
                    <TableCell>
                      <FulfillmentStatusBadge status={fulfillment} />
                    </TableCell>
                    <TableCell>
                      <span className="flex flex-wrap items-center gap-1.5">
                        <PaymentStatusBadge state={paymentState} />
                        {paymentState.status === 'paid' && (
                          <span className="text-xs text-muted-foreground">
                            {PAYMENT_LABELS[paymentState.method]}
                          </span>
                        )}
                      </span>
                    </TableCell>
                    <TableCell className="truncate" data-testid="order-operator">
                      {operatorNameOf(order)}
                    </TableCell>
                    {/* Derived from both axes — never a stored field, and never the blanket
                        "Completed" this column used to show for every order. */}
                    <TableCell>
                      <OverallStatusBadge status={overall} />
                    </TableCell>
                    {/* A voided total is struck through so it cannot be read as revenue. */}
                    <TableCell
                      className={cn(
                        'text-right tabular-nums',
                        voided && 'text-muted-foreground line-through',
                      )}
                      data-testid="order-total"
                    >
                      {formatMoney(order.total)}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button asChild variant="ghost" size="sm">
                        <Link
                          to={`/orders/${order.id}`}
                          aria-label={`Receipt for order ${order.number}`}
                        >
                          View
                        </Link>
                      </Button>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}
