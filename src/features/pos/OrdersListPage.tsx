import { useTranslation } from '@/features/i18n/useTranslation'
import { useMemo, useState } from 'react'
import { Link } from 'react-router'
import { AlertCircle, ReceiptText, Search } from 'lucide-react'

import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/data/EmptyState'
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
  ORDER_FILTER_LABEL_KEYS,
  ORDER_FILTERS,
  type OrderFilter,
} from '@/features/pos/orders-view'
import {
  FulfillmentStatusBadge,
  OverallStatusBadge,
  PaymentStatusBadge,
} from '@/features/pos/PaymentStatusBadge'
import { operatorNameOf, PAYMENT_LABEL_KEYS } from '@/features/pos/types'
import { useShownBusinessDate } from '@/features/pos/useBusinessToday'
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
  const { t } = useTranslation()
  // Follows today on its own, unless somebody has navigated to another day — see the hook.
  const { businessDate, showDate } = useShownBusinessDate()
  const [filter, setFilter] = useState<OrderFilter>('all')
  const [search, setSearch] = useState('')

  const { views, loading, error } = useOrdersWorkspace(businessDate)

  const rows = useMemo(() => filterOrders(views, filter, search), [views, filter, search])

  return (
    <div className="mx-auto w-full max-w-7xl space-y-6">
      <div className="space-y-1">
        <h1 className="font-heading text-2xl font-semibold tracking-tight sm:text-3xl">
          {t('nav.orders')}
        </h1>
        <p className="max-w-3xl text-sm text-muted-foreground">{t('orders.blurb')}</p>
      </div>

      {/* The controls are one panel, not three rows of loose widgets: choosing a day,
          searching within it and narrowing it are the same task, and grouping them stops the
          page reading as a pile of unrelated toolbars on a laptop screen. */}
      <div className="space-y-4 rounded-xl border bg-card p-4 shadow-xs">
        <BusinessDateBar businessDate={businessDate} onChange={showDate}>
          <div className="grid min-w-0 flex-1 gap-1.5 sm:max-w-xs">
            <Label htmlFor="order-search">{t('orders.search')}</Label>
            <div className="relative">
              <Search
                aria-hidden="true"
                className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
              />
              <Input
                id="order-search"
                type="search"
                className="h-touch w-full pl-8 sm:h-10"
                data-testid="order-search"
                placeholder={t('orders.searchPlaceholder')}
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </div>
          </div>
        </BusinessDateBar>

        {/* Buttons rather than a select: the state of the day should be readable without
            opening anything, and a counter taps rather than clicks. They scroll rather than
            wrap on a phone, so the row stays one line and the panel keeps its shape. */}
        <div
          className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-0.5"
          role="group"
          aria-label={t('orders.filter')}
        >
          {ORDER_FILTERS.map((candidate) => (
            <Button
              key={candidate}
              size="sm"
              variant={candidate === filter ? 'default' : 'outline'}
              aria-pressed={candidate === filter}
              data-testid="order-filter"
              data-filter={candidate}
              data-active={candidate === filter}
              className="shrink-0"
              onClick={() => setFilter(candidate)}
            >
              {t(ORDER_FILTER_LABEL_KEYS[candidate])}
            </Button>
          ))}
        </div>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertCircle aria-hidden="true" />
          <AlertDescription>{t(error)}</AlertDescription>
        </Alert>
      )}

      {loading ? (
        <Skeleton className="h-96 w-full max-w-4xl" />
      ) : rows.length === 0 ? (
        <div data-testid="orders-empty">
          <EmptyState
            title={t(views.length === 0 ? 'orders.emptyDate' : 'orders.emptyFilter')}
            description={t(
              views.length === 0 ? 'orders.emptyDateBlurb' : 'orders.emptyFilterBlurb',
            )}
            icon={<ReceiptText className="size-6" aria-hidden="true" />}
          />
        </div>
      ) : (
        <div className="hidden rounded-xl border bg-card shadow-xs md:block">
          <Table className="min-w-3xl">
            <TableHeader className="bg-muted/50">
              <TableRow className="hover:bg-transparent">
                <TableHead className="w-24">{t('orders.column.order')}</TableHead>
                <TableHead className="w-36">{t('orders.column.type')}</TableHead>
                <TableHead className="w-20">{t('orders.column.items')}</TableHead>
                <TableHead className="w-28">{t('orders.column.fulfilment')}</TableHead>
                <TableHead className="w-32">{t('orders.column.payment')}</TableHead>
                <TableHead>{t('orders.column.servedBy')}</TableHead>
                <TableHead className="w-40">{t('orders.column.overall')}</TableHead>
                <TableHead className="w-32 text-right">{t('orders.column.total')}</TableHead>
                <TableHead className="w-28 text-right">{t('orders.column.receipt')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map(({ order, fulfillment, payment, voided, overall }) => (
                <TableRow
                  key={order.id}
                  className={cn(
                    'transition-colors hover:bg-muted/50',
                    // A voided sale is still a record, but it is not part of the day's
                    // trading, so it recedes rather than competing with the rows that are.
                    voided !== null && 'opacity-70',
                  )}
                  data-testid="order-row"
                  data-order-number={order.number}
                  data-voided={voided !== null}
                >
                  <TableCell className="text-base font-semibold tabular-nums">
                    #{order.number}
                  </TableCell>
                  {/* "Dine-in · Table 5", "Takeaway", or "Not recorded" for an order placed
                      before order types existed. Never a table for a takeaway. */}
                  <TableCell data-testid="order-service">{t(orderTypeSummaryOf(order))}</TableCell>
                  <TableCell className="tabular-nums text-muted-foreground">
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
                          {t(PAYMENT_LABEL_KEYS[payment.method])}
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
                      'text-right font-semibold tabular-nums',
                      voided !== null && 'font-normal text-muted-foreground line-through',
                    )}
                    data-testid="order-total"
                  >
                    {formatMoney(order.total)}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button asChild variant="ghost" size="sm">
                      <Link
                        to={`/orders/${order.id}`}
                        aria-label={t('orders.receiptFor', { number: order.number })}
                      >
                        {t('common.view')}
                      </Link>
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Below md the nine-column table would scroll sideways for every glance, so the same
          rows are stated as cards. Same data, same order, same test ids — one layout per
          width rather than one layout squeezed. */}
      {!loading && rows.length > 0 && (
        <ul className="space-y-3 md:hidden">
          {rows.map(({ order, fulfillment, payment, voided, overall }) => (
            <li key={order.id}>
              <Link
                to={`/orders/${order.id}`}
                aria-label={t('orders.receiptFor', { number: order.number })}
                className={cn(
                  'block rounded-xl border bg-card p-3 shadow-xs transition-colors',
                  'hover:border-primary/30 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none',
                  voided !== null && 'opacity-70',
                )}
                data-testid="order-card"
                data-order-number={order.number}
              >
                <div className="flex items-baseline gap-2">
                  <span className="text-base font-semibold tabular-nums">#{order.number}</span>
                  <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">
                    {t(orderTypeSummaryOf(order))}
                  </span>
                  <span
                    className={cn(
                      'font-semibold tabular-nums',
                      voided !== null && 'font-normal text-muted-foreground line-through',
                    )}
                  >
                    {formatMoney(order.total)}
                  </span>
                </div>

                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  <OverallStatusBadge status={overall} />
                  <FulfillmentStatusBadge status={fulfillment} />
                  <PaymentStatusBadge state={payment} />
                </div>

                <p className="mt-2 text-xs text-muted-foreground">
                  {/* The operator is the vendor's own name, spliced in unaltered. */}
                  {t('orders.servedByLine', {
                    count: order.lines.reduce((count, line) => count + line.quantity, 0),
                    name: operatorNameOf(order),
                  })}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {!loading && views.length > 0 && (
        <p className="text-sm text-muted-foreground" data-testid="orders-count">
          {t(views.length === 1 ? 'orders.countOne' : 'orders.countOther', {
            shown: rows.length,
            total: views.length,
            date: businessDate,
          })}
        </p>
      )}
    </div>
  )
}
