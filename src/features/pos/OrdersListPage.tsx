import { useMemo, useState } from 'react'
import { Link } from 'react-router'
import { AlertCircle, Search } from 'lucide-react'

import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { BusinessDateBar } from '@/features/pos/BusinessDateBar'
import { orderTypeSummaryOf } from '@/features/pos/order-type'
import {
  filterOrders,
  ORDER_FILTER_LABELS,
  ORDER_FILTERS,
  type OrderFilter,
} from '@/features/pos/orders-view'
import {
  FulfillmentStatusBadge,
  OverallStatusBadge,
  PaymentStatusBadge,
} from '@/features/pos/PaymentStatusBadge'
import { businessDateOf, operatorNameOf, PAYMENT_LABELS } from '@/features/pos/types'
import { useOrdersWorkspace } from '@/features/pos/useOrdersWorkspace'
import { formatMoney } from '@/lib/money'
import { cn } from '@/lib/utils'

/**
 * The day's sales record.
 *
 * **One business date at a time.** The date is the query, not a filter applied over
 * everything ever sold — see `useOrders`. Filters and search then narrow what is already
 * loaded, in memory, which is also why search is honest about being local to the selected
 * day rather than pretending to reach the whole history.
 */
export function OrdersListPage() {
  const [businessDate, setBusinessDate] = useState(() => businessDateOf(new Date()))
  const [filter, setFilter] = useState<OrderFilter>('all')
  const [search, setSearch] = useState('')

  const { views, loading, error } = useOrdersWorkspace(businessDate)

  const rows = useMemo(() => filterOrders(views, filter, search), [views, filter, search])

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Orders</h1>
        <p className="text-muted-foreground">
          One business date at a time, newest first. Dine-in orders carry the table they belong to.
          Fulfilment and payment advance independently — an order is complete only once it has been
          delivered <em>and</em> paid for. Orders cannot be edited or deleted; a mistake is
          corrected by voiding, which leaves the original record intact.
        </p>
      </div>

      <BusinessDateBar businessDate={businessDate} onChange={setBusinessDate}>
        <div className="grid gap-1.5">
          <Label htmlFor="order-search">Search this date</Label>
          <div className="relative">
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              id="order-search"
              type="search"
              className="h-9 w-64 pl-8"
              data-testid="order-search"
              placeholder="Order number, table, or item"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
        </div>
      </BusinessDateBar>

      {/* Buttons rather than a select: the state of the day should be readable without
          opening anything, and a counter taps rather than clicks. */}
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter orders">
        {ORDER_FILTERS.map((candidate) => (
          <Button
            key={candidate}
            size="sm"
            variant={candidate === filter ? 'secondary' : 'outline'}
            aria-pressed={candidate === filter}
            data-testid="order-filter"
            data-filter={candidate}
            data-active={candidate === filter}
            onClick={() => setFilter(candidate)}
          >
            {ORDER_FILTER_LABELS[candidate]}
          </Button>
        ))}
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertCircle aria-hidden="true" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {loading ? (
        <Skeleton className="h-96 w-full max-w-4xl" />
      ) : rows.length === 0 ? (
        <p className="text-muted-foreground" data-testid="orders-empty">
          {views.length === 0
            ? 'No sales recorded on this date.'
            : 'No orders on this date match that filter or search.'}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-24">Order</TableHead>
                <TableHead className="w-36">Type</TableHead>
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
              {rows.map(({ order, fulfillment, payment, voided, overall }) => (
                <TableRow
                  key={order.id}
                  data-testid="order-row"
                  data-order-number={order.number}
                  data-voided={voided !== null}
                >
                  <TableCell className="font-medium tabular-nums">#{order.number}</TableCell>
                  {/* "Dine-in · Table 5", "Takeaway", or "Not recorded" for an order placed
                      before order types existed. Never a table for a takeaway. */}
                  <TableCell data-testid="order-service">{orderTypeSummaryOf(order)}</TableCell>
                  <TableCell className="tabular-nums">
                    {order.lines.reduce((count, line) => count + line.quantity, 0)}
                  </TableCell>
                  <TableCell>
                    <FulfillmentStatusBadge status={fulfillment} />
                  </TableCell>
                  <TableCell>
                    <span className="flex flex-wrap items-center gap-1.5">
                      <PaymentStatusBadge state={payment} />
                      {payment.status === 'paid' && (
                        <span className="text-xs text-muted-foreground">
                          {PAYMENT_LABELS[payment.method]}
                        </span>
                      )}
                    </span>
                  </TableCell>
                  <TableCell className="truncate" data-testid="order-operator">
                    {operatorNameOf(order)}
                  </TableCell>
                  {/* Derived from both axes — never a stored field. */}
                  <TableCell>
                    <OverallStatusBadge status={overall} />
                  </TableCell>
                  {/* A voided total is struck through so it cannot be read as revenue. */}
                  <TableCell
                    className={cn(
                      'text-right tabular-nums',
                      voided !== null && 'text-muted-foreground line-through',
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
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {!loading && views.length > 0 && (
        <p className="text-sm text-muted-foreground" data-testid="orders-count">
          Showing {rows.length} of {views.length} {views.length === 1 ? 'order' : 'orders'} on{' '}
          {businessDate}.
        </p>
      )}
    </div>
  )
}
