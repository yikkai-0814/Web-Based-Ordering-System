import { useTranslation } from '@/features/i18n/useTranslation'
import { memo, useDeferredValue, useMemo, useState } from 'react'
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
import type { OrderView } from '@/features/pos/orders-view'
import { useOrdersWorkspace } from '@/features/pos/useOrdersWorkspace'
import { MD_BREAKPOINT, useMediaQuery } from '@/lib/useMediaQuery'
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
/** Stable identity for "nothing has ever arrived", so the memo below is not defeated. */
const NO_VIEWS: OrderView[] = []

/**
 * The last workspace result that actually arrived.
 *
 * **Why the page needs this.** The business date IS the query, so choosing another day builds
 * a new Firestore query, and `useQueryDocs` reports "loading" with no rows from the very
 * render that changes it — deliberately, because returning the old rows as though they were
 * the new day's would put yesterday's sales under today's heading. Correct, but it meant the
 * whole list was replaced by a grey skeleton for as long as the switch took. Measured against
 * the emulator, a day that had been viewed before comes back from Firestore's local cache in
 * 27-48 ms: the skeleton was a flicker that communicated nothing.
 *
 * Holding the last arrived result lets the page keep showing it — dimmed, marked `aria-busy`,
 * and under a note naming the day being loaded — instead of blanking. The rows on screen are
 * always one day's, never a mixture: this returns whichever single result last arrived, and
 * the page stops trusting it for anything it would assert about the selected date.
 *
 * Set during render rather than in an effect, which is React's own pattern for deriving state
 * from changed input: the guard makes it idempotent, and it commits nothing to the DOM in
 * between.
 */
function useLastArrivedViews(views: OrderView[], loading: boolean): OrderView[] | null {
  const [arrived, setArrived] = useState<OrderView[] | null>(loading ? null : views)
  if (!loading && arrived !== views) setArrived(views)
  return arrived
}

export function OrdersListPage() {
  const { t } = useTranslation()
  // Follows today on its own, unless somebody has navigated to another day — see the hook.
  const { businessDate, showDate } = useShownBusinessDate()
  const [filter, setFilter] = useState<OrderFilter>('all')
  const [search, setSearch] = useState('')

  const { views, loading, error } = useOrdersWorkspace(businessDate)
  // Which of the two layouts to MOUNT. See the note above the card list.
  const wide = useMediaQuery(MD_BREAKPOINT)

  /**
   * The list re-filters as somebody types, and on a busy day that means unmounting a couple
   * of hundred rows per keystroke — measured at ~400ms each, which is long enough that the
   * characters themselves appeared late. Deferring the value keeps the input painting at
   * once and lets React render the narrowed list at a lower priority, so typing stays
   * responsive and the rows catch up a frame later. The filter itself is unchanged.
   */
  const deferredSearch = useDeferredValue(search)

  /**
   * What is on screen, and how much of it to believe.
   *
   * `firstLoad` is the only state that earns a skeleton — there is genuinely nothing to show.
   * `refreshing` is a date change over rows that are already up: those rows stay, visibly
   * de-emphasised, and every claim the page makes ABOUT the selected date is withheld until
   * the new rows arrive. That is what keeps "do not mix two dates" true while still not
   * blanking the page.
   */
  const arrived = useLastArrivedViews(views, loading)
  const showing = arrived ?? NO_VIEWS
  const firstLoad = loading && arrived === null
  const refreshing = loading && arrived !== null

  const rows = useMemo(
    () => filterOrders(showing, filter, deferredSearch),
    [showing, filter, deferredSearch],
  )

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

      {/* Says which day is being fetched, so the rows below — which are still the previous
          day's — cannot be mistaken for it. This replaces the count line while it shows. */}
      {refreshing && (
        <p className="text-sm text-muted-foreground" data-testid="orders-refreshing">
          {t('orders.loadingDate', { date: businessDate })}
        </p>
      )}

      <div
        aria-busy={refreshing}
        className={cn('space-y-6 transition-opacity', refreshing && 'opacity-60')}
      >
        {firstLoad ? (
          <Skeleton className="h-96 w-full max-w-4xl" />
        ) : rows.length === 0 ? (
          <div data-testid="orders-empty">
            <EmptyState
              title={t(showing.length === 0 ? 'orders.emptyDate' : 'orders.emptyFilter')}
              description={t(
                showing.length === 0 ? 'orders.emptyDateBlurb' : 'orders.emptyFilterBlurb',
              )}
              icon={<ReceiptText className="size-6" aria-hidden="true" />}
            />
          </div>
        ) : wide ? (
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
                {rows.map((view) => (
                  <OrderRow key={view.order.id} view={view} />
                ))}
              </TableBody>
            </Table>
          </div>
        ) : null}

        {/* Below md the nine-column table would scroll sideways for every glance, so the same
          rows are stated as cards. Same data, same order, same test ids — one layout per
          width rather than one layout squeezed.

          Only one of the two is MOUNTED, not merely shown: rendering both and hiding one
          with `md:` built 500 row subtrees for a 250-order day and paid for every one of
          them. The classes stay as a second line of defence — see useMediaQuery. */}
        {!wide && !firstLoad && rows.length > 0 && (
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

        {/* Withheld while refreshing: it names the selected date, and the rows above are
            not yet that date's. */}
        {!firstLoad && !refreshing && showing.length > 0 && (
          <p className="text-sm text-muted-foreground" data-testid="orders-count">
            {t(showing.length === 1 ? 'orders.countOne' : 'orders.countOther', {
              shown: rows.length,
              total: showing.length,
              date: businessDate,
            })}
          </p>
        )}
      </div>
    </div>
  )
}

/**
 * One row of the table, memoised on the identity of its `view`.
 *
 * **Where that memo pays off: filtering and typing.** The list re-renders on every keystroke
 * in the search box, because `filterOrders` returns a new array each time — but it re-slices
 * the SAME OrderView objects rather than building new ones, so every row that was already on
 * screen is handed an identical reference and skips. Typing therefore costs the rows that
 * appeared or disappeared, not all two hundred and fifty of them.
 *
 * **Where it does not: Firestore snapshots.** `buildOrderViews` is an unconditional
 * `orders.map(...)`, so any snapshot on `orders`, `orderPayments`, `orderVoids` or
 * `orderFulfillment` produces a fresh OrderView for EVERY order, not only the one that
 * changed. Do not read this memo as making a live update cheap: one order being paid for
 * re-renders the whole list. Measured on a 90-order day, one payment recreated all 90 views
 * and re-rendered all 90 rows.
 *
 * That was left as it is deliberately. The wasted work is real but small — about 5.7 ms per
 * update for 90 rows on the production React build, comfortably inside one frame, and a
 * burst of updates never blocked longer than 15.3 ms. It becomes worth revisiting nearer
 * 300+ rows on screen, where the same update approaches 20 ms; the fix would be to reuse the
 * previous view when the order and its three sidecar records are all reference-identical.
 */
const OrderRow = memo(function OrderRow({ view }: { view: OrderView }) {
  const { t } = useTranslation()
  const { order, fulfillment, payment, voided, overall } = view

  return (
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
      <TableCell className="text-base font-semibold tabular-nums">#{order.number}</TableCell>
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
  )
})
