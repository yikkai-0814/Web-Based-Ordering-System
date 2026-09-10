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
import { businessDateOf, PAYMENT_LABELS } from '@/features/pos/types'
import { useOrders } from '@/features/pos/useOrders'
import { formatMoney } from '@/lib/money'

export function OrdersListPage() {
  const { orders, loading, error } = useOrders()
  const today = businessDateOf(new Date())

  if (loading) {
    return <Skeleton className="h-96 w-full max-w-4xl" />
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Orders</h1>
        <p className="text-muted-foreground">
          Completed sales, newest first. Orders cannot be edited or deleted.
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
                <TableHead className="w-24">Items</TableHead>
                <TableHead className="w-28">Payment</TableHead>
                <TableHead>Served by</TableHead>
                <TableHead className="w-32 text-right">Total</TableHead>
                <TableHead className="w-28 text-right">Receipt</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {orders.map((order) => (
                <TableRow key={order.id} data-testid="order-row" data-order-number={order.number}>
                  <TableCell className="font-medium tabular-nums">#{order.number}</TableCell>
                  <TableCell className="tabular-nums text-muted-foreground">
                    {order.businessDate === today ? 'Today' : order.businessDate}
                  </TableCell>
                  <TableCell className="tabular-nums">
                    {order.lines.reduce((count, line) => count + line.quantity, 0)}
                  </TableCell>
                  <TableCell>{PAYMENT_LABELS[order.paymentMethod]}</TableCell>
                  <TableCell className="truncate">{order.createdByName}</TableCell>
                  <TableCell className="text-right tabular-nums" data-testid="order-total">
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
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}
