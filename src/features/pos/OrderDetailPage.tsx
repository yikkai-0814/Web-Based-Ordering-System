import { Link, useParams } from 'react-router'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { lineTotal } from '@/features/pos/cart'
import { PAYMENT_LABELS } from '@/features/pos/types'
import { useOrders } from '@/features/pos/useOrders'
import { formatMoney } from '@/lib/money'

/**
 * On-screen receipt.
 *
 * Every figure shown comes from the order document itself, never from the current menu —
 * that is the whole point of snapshotting the line items. Repricing or deleting an item
 * afterwards leaves this receipt exactly as it was at the time of sale.
 */
export function OrderDetailPage() {
  const { orderId } = useParams<{ orderId: string }>()
  const { orders, loading } = useOrders()

  if (loading) {
    return <Skeleton className="h-96 w-full max-w-lg" />
  }

  const order = orders.find((candidate) => candidate.id === orderId)

  if (!order) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold tracking-tight">Order not found</h1>
        <p className="text-muted-foreground">No sale matches that address.</p>
        <Button asChild size="lg" className="h-touch text-base">
          <Link to="/orders">Back to orders</Link>
        </Button>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <Card className="w-full max-w-lg">
        <CardHeader>
          <CardTitle className="text-xl" data-testid="receipt-number">
            Order #{order.number}
          </CardTitle>
          <CardDescription>
            {order.businessDate} · served by {order.createdByName}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <ul className="divide-y">
            {order.lines.map((line) => (
              <li
                key={line.menuItemId}
                className="flex items-baseline gap-3 py-2"
                data-testid="receipt-line"
                data-item-name={line.name}
              >
                <span className="w-8 tabular-nums text-muted-foreground">{line.quantity}×</span>
                <span className="min-w-0 flex-1 truncate">{line.name}</span>
                <span className="tabular-nums text-muted-foreground">
                  {formatMoney(line.unitPrice)}
                </span>
                <span className="w-24 text-right tabular-nums">{formatMoney(lineTotal(line))}</span>
              </li>
            ))}
          </ul>

          <div className="flex items-baseline gap-3 border-t pt-3">
            <span className="text-base font-medium">Total</span>
            <span
              className="ml-auto text-2xl font-semibold tabular-nums"
              data-testid="receipt-total"
            >
              {formatMoney(order.total)}
            </span>
          </div>

          <dl className="grid gap-1 text-sm">
            <div className="flex gap-3">
              <dt className="text-muted-foreground">Payment</dt>
              <dd className="ml-auto" data-testid="receipt-method">
                {PAYMENT_LABELS[order.paymentMethod]}
              </dd>
            </div>
            {order.paymentMethod === 'cash' && order.cashTendered !== null && (
              <>
                <div className="flex gap-3">
                  <dt className="text-muted-foreground">Tendered</dt>
                  <dd className="ml-auto tabular-nums">{formatMoney(order.cashTendered)}</dd>
                </div>
                <div className="flex gap-3">
                  <dt className="text-muted-foreground">Change</dt>
                  <dd className="ml-auto tabular-nums" data-testid="receipt-change">
                    {formatMoney(order.changeGiven ?? 0)}
                  </dd>
                </div>
              </>
            )}
          </dl>
        </CardContent>
      </Card>

      <Button asChild variant="outline" size="lg" className="h-touch text-base">
        <Link to="/orders">Back to orders</Link>
      </Button>
    </div>
  )
}
