import { useMemo } from 'react'
import { Link } from 'react-router'
import {
  AlertCircle,
  ChefHat,
  Coins,
  Receipt,
  TrendingUp,
  TriangleAlert,
  Wallet,
} from 'lucide-react'

import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/data/EmptyState'
import { MeterBar } from '@/components/data/MeterBar'
import { Panel } from '@/components/data/Panel'
import { StatCard } from '@/components/data/StatCard'
import { ROLE_LABELS } from '@/features/auth/types'
import { useAuth } from '@/features/auth/useAuth'
import { buildDashboard } from '@/features/dashboard/summary'
import { QUEUE_COLUMN_LABELS, QUEUE_COLUMNS } from '@/features/pos/queue'
import { useBusinessToday } from '@/features/pos/useBusinessToday'
import { useOrdersWorkspace } from '@/features/pos/useOrdersWorkspace'
import { PAYMENT_LABELS } from '@/features/pos/types'
import type { Report } from '@/features/reports/aggregate'
import type { DateRange } from '@/features/reports/ranges'
import { useReport } from '@/features/reports/useReport'
import { formatMoney } from '@/lib/money'

/** How many revenue-leading items the highlights band shows before it stops being a glance. */
const TOP_ITEM_COUNT = 5

/**
 * Today at a glance.
 *
 * Everything here is derived, never stored: the live tiles come from `buildDashboard` over
 * the same rows the Orders list and the Queue board already subscribe to, and the admin
 * bands come from one `useReport` for today — the same `fetchReportData` and `buildReport`
 * the Reports page runs. Nothing on this screen computes a figure of its own.
 *
 * **Role awareness is in what it fetches, not only in what it shows.** `buildDashboard`
 * returns no financial section at all for a staff member, and the admin bands are separate
 * components mounted only for an admin, so a staff session never issues a read against the
 * admin-only cost collections — which would otherwise fail at the rules layer and put a
 * permission error on the landing page.
 */
export function DashboardPage() {
  const { profile } = useAuth()
  // Follows the clock rather than freezing at mount. This page has no date bar by design —
  // it answers for "today" and nothing else — so if today moved on without it, a till left
  // running overnight would show yesterday with no way to correct it short of a reload.
  const businessDate = useBusinessToday()
  const { views, loading, error } = useOrdersWorkspace(businessDate)

  const role = profile?.role ?? 'staff'
  const summary = useMemo(() => buildDashboard(views, role), [views, role])

  return (
    <div className="mx-auto w-full max-w-7xl space-y-6">
      <header className="space-y-1">
        <h1 className="font-heading text-2xl font-semibold tracking-tight sm:text-3xl">
          Welcome{profile ? `, ${profile.displayName}` : ''}
        </h1>
        <p className="text-sm text-muted-foreground">
          {businessDate} · signed in as {profile ? ROLE_LABELS[profile.role] : 'a user'}. Everything
          below is today only, and updates as orders are rung up and moved along. Voided sales are
          excluded from every figure.
        </p>
      </header>

      {/* Only the sales record. This page is the admin's, and an admin works neither the
          till nor the kitchen board — offering either would be a link to a 403. */}
      <div className="flex flex-wrap gap-2">
        <Button asChild size="lg" className="h-touch text-base">
          <Link to="/orders">See all orders</Link>
        </Button>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertCircle aria-hidden="true" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {loading ? (
        <Skeleton className="h-64 w-full" />
      ) : (
        <>
          {summary.finance && (
            <Panel tone="accent" aria-label="Money taken today">
              {/* The hero and its two supporting figures share one surface, so they read as
                  one answer — what today is worth — rather than as three separate cards. */}
              <div className="grid gap-3 sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)]">
                <StatCard
                  label="Revenue today"
                  value={formatMoney(summary.finance.revenue)}
                  testId="tile-revenue"
                  tone="money"
                  variant="hero"
                  icon={<Coins className="size-3.5" aria-hidden="true" />}
                  hint="Every order placed, paid or not"
                />
                <StatCard
                  label="Collected"
                  value={formatMoney(summary.finance.collected)}
                  testId="tile-collected"
                  tone="money"
                  icon={<Wallet className="size-3.5" aria-hidden="true" />}
                  hint="Money in the drawer"
                />
                <StatCard
                  label="Outstanding"
                  value={formatMoney(summary.finance.outstanding)}
                  testId="tile-outstanding"
                  tone={summary.finance.outstanding > 0 ? 'warning' : 'money'}
                  icon={<Receipt className="size-3.5" aria-hidden="true" />}
                  hint={summary.finance.outstanding > 0 ? 'Still to collect' : 'Nothing owed'}
                  to="/orders"
                />
              </div>
            </Panel>
          )}

          <Panel
            tone="plain"
            title="Service"
            description="How today is running. Delivered orders leave the board; they stay on the Orders page."
            aria-label="Service"
          >
            {/* Quiet tiles sitting on the page itself: counts that give the money above its
                context, not figures anybody opens a dashboard to read. */}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
              <StatCard
                label="Orders"
                value={String(summary.orderCount)}
                testId="tile-orders"
                variant="quiet"
                hint="Voided excluded"
                to="/orders"
              />
              <StatCard
                label="Unpaid"
                value={String(summary.unpaidCount)}
                testId="tile-unpaid"
                variant="quiet"
                tone={summary.unpaidCount > 0 ? 'warning' : 'count'}
                hint="Awaiting payment"
                to="/orders"
              />
              <StatCard
                label="Voided"
                value={String(summary.voidedCount)}
                testId="tile-voided"
                variant="quiet"
                hint="Not counted"
              />
              {QUEUE_COLUMNS.map((column) => (
                <StatCard
                  key={column}
                  label={QUEUE_COLUMN_LABELS[column]}
                  value={String(summary.queue[column])}
                  testId="tile-queue"
                  dataStatus={column}
                  variant="quiet"
                  icon={<ChefHat className="size-3.5" aria-hidden="true" />}
                />
              ))}
            </div>
          </Panel>
        </>
      )}

      {/* Mounted only for an admin, so the admin-only cost read is never issued by a staff
          session. The guard is the mount, not a hidden element. */}
      {profile?.role === 'admin' && <TodayBusinessBands businessDate={businessDate} />}
    </div>
  )
}

/**
 * The admin bands: cost and profit, then what today was made of.
 *
 * **Reused from the reports feature, never recomputed.** `useReport` runs the same
 * `fetchReportData` and `buildReport` the Reports page runs, for this one day. There is one
 * implementation of that arithmetic and this is not a second one.
 *
 * It is deliberately a snapshot taken when the page loaded, against tiles above that update
 * continuously. Blending the two would produce a screen where revenue and profit silently
 * disagree by whatever was rung up in between. The Refresh button is how it is brought back
 * into line, and the note says so rather than leaving it to be discovered.
 */
function TodayBusinessBands({ businessDate }: { businessDate: string }) {
  // Built from the day the page is showing rather than from the clock, which is what makes
  // the snapshot follow a rollover: `rangeFor('today', …)` would answer for whenever it
  // happened to be called, and the card would keep reporting yesterday's profit under
  // today's heading. One day, so both ends are that day — the same shape rangeFor returns
  // for its own `today` preset.
  const range = useMemo<DateRange>(() => ({ from: businessDate, to: businessDate }), [businessDate])
  const { report, loading, error, refresh } = useReport(range)

  /**
   * An item sold without a recorded cost.
   *
   * Every menu item is supposed to have one, so this is a **data-integrity exception**, not a
   * metric: it is not reported when everything is in order, and when it is not, it says what
   * to go and fix rather than offering a percentage to watch. The underlying figures are
   * unchanged — `buildReport` still resolves each line's cost from the history journal, and
   * still reports coverage — this screen simply no longer treats that coverage as news.
   */
  const missingCost = report !== null && !report.coverage.complete

  return (
    <div className="space-y-6">
      <Panel
        tone="accent"
        title="Cost and profit"
        description="A snapshot taken when this page loaded, not a live figure. Cost comes from the cost recorded against each item at the time of the sale."
        action={
          <Button type="button" size="sm" variant="outline" onClick={refresh} disabled={loading}>
            Refresh
          </Button>
        }
        aria-label="Cost and profit"
      >
        {error && (
          <Alert variant="destructive">
            <AlertCircle aria-hidden="true" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {loading && <Skeleton className="h-24 w-full" />}

        {!loading && report && (
          <>
            {/* Only when something is actually wrong, and phrased as a job to do rather than
                as a figure to track. */}
            {missingCost && (
              <Alert data-testid="missing-cost-warning">
                <TriangleAlert aria-hidden="true" />
                <AlertDescription>
                  Some items sold today have no recorded cost, so profit is higher than the real
                  figure. Record their cost on the <Link to="/menu">Menu</Link> page — every item is
                  meant to have one.
                </AlertDescription>
              </Alert>
            )}

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <StatCard
                label="Profit"
                value={formatMoney(report.estimatedProfit)}
                testId="tile-estimated-profit"
                tone="money"
                variant="hero"
                icon={<TrendingUp className="size-3.5" aria-hidden="true" />}
                hint="Revenue less cost"
                className="sm:col-span-2"
              />
              <StatCard
                label="Cost"
                value={formatMoney(report.estimatedCost)}
                testId="tile-estimated-cost"
                tone="money"
                variant="hero"
                icon={<Coins className="size-3.5" aria-hidden="true" />}
                hint="Recorded cost of what sold"
              />
              <StatCard
                label="Margin"
                value={report.marginPercent === null ? '—' : `${report.marginPercent.toFixed(1)}%`}
                testId="tile-margin"
                hint={`${report.voided.length} voided · ${formatMoney(report.voidedAmount)} reversed`}
              />
            </div>
          </>
        )}
      </Panel>

      {!loading && report && (
        <Panel tone="plain" title="What today was made of" aria-label="What today was made of">
          {/* Side by side once there is room; stacked before that, because two half-width
              bar lists on a phone would leave no room for the labels. */}
          <div className="grid gap-4 lg:grid-cols-2">
            <PaymentMixCard report={report} />
            <TopItemsCard report={report} />
          </div>
        </Panel>
      )}
    </div>
  )
}

function PaymentMixCard({ report }: { report: Report }) {
  // The denominator is the rows' own total, so the bars always sum to the whole they are
  // drawn from. A share for a bar's width — not a figure anybody reads as a result.
  const total = report.payments.reduce((sum, row) => sum + row.amount, 0)

  return (
    <Panel tone="raised" as="h3" title="How today was paid">
      {report.payments.length === 0 ? (
        <EmptyState
          title="No payments recorded yet"
          description="Payments appear here as orders are settled."
        />
      ) : (
        <div className="space-y-3">
          {report.payments.map((row, index) => (
            <MeterBar
              key={row.method}
              label={`${PAYMENT_LABELS[row.method]} · ${row.count} ${row.count === 1 ? 'order' : 'orders'}`}
              value={formatMoney(row.amount)}
              percent={total === 0 ? null : (row.amount / total) * 100}
              tone={index === 0 ? 'primary' : 'secondary'}
            />
          ))}
        </div>
      )}
    </Panel>
  )
}

function TopItemsCard({ report }: { report: Report }) {
  // `report.items` arrives sorted by revenue, so this is a slice rather than a sort — the
  // ordering is the report's, not this component's.
  const top = report.items.slice(0, TOP_ITEM_COUNT)
  const leader = top[0]?.revenue ?? 0

  return (
    <Panel tone="raised" as="h3" title="Revenue-leading items">
      {top.length === 0 ? (
        <EmptyState
          title="Nothing sold yet today"
          description="Items appear here once the first order is rung up."
        />
      ) : (
        <div className="space-y-3">
          {top.map((row, index) => (
            <MeterBar
              key={row.menuItemId}
              rank={index + 1}
              leading={index === 0}
              label={`${row.name} · ${row.quantity} sold`}
              value={formatMoney(row.revenue)}
              // Relative to the leader rather than to total revenue: this band answers
              // "what is selling", and a bar against the day's whole total would be a
              // sliver for every row in a café with a wide menu.
              percent={leader === 0 ? null : (row.revenue / leader) * 100}
              tone="primary"
            />
          ))}
        </div>
      )}
    </Panel>
  )
}
