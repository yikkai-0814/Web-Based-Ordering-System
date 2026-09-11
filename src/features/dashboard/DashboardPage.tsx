import { useMemo, useState } from 'react'
import { Link } from 'react-router'
import { AlertCircle, TriangleAlert } from 'lucide-react'

import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { ROLE_LABELS } from '@/features/auth/types'
import { useAuth } from '@/features/auth/useAuth'
import { buildDashboard } from '@/features/dashboard/summary'
import { QUEUE_COLUMN_LABELS, QUEUE_COLUMNS } from '@/features/pos/queue'
import { businessDateOf } from '@/features/pos/types'
import { useOrdersWorkspace } from '@/features/pos/useOrdersWorkspace'
import { rangeFor } from '@/features/reports/ranges'
import { useReport } from '@/features/reports/useReport'
import { formatMoney } from '@/lib/money'
import { cn } from '@/lib/utils'

/**
 * Today at a glance, and the way in to the three screens somebody works from.
 *
 * **Today only, and derived from data that is already on screen elsewhere.** The date is
 * `businessDateOf(new Date())` — the same helper the till files orders under — and the rows
 * come from `useOrdersWorkspace`, the single live subscription set the Orders list and the
 * Queue board already share. So the counts move as sales are rung up and cards are advanced,
 * without a reload and without a second source of truth. Picking a different date is what
 * those two screens are for; this one is about now.
 *
 * **Role-aware in what it fetches, not merely in what it shows.** The money tiles come from
 * `buildDashboard`, which returns no financial section at all for a staff member. The
 * estimated cost and profit card is a separate component mounted only for an admin, so a
 * staff session never issues a read against the admin-only cost collections — which would
 * otherwise fail at the rules layer and put a permission error on the landing page.
 */
export function DashboardPage() {
  const { profile } = useAuth()
  const [businessDate] = useState(() => businessDateOf(new Date()))
  const { views, loading, error } = useOrdersWorkspace(businessDate)

  const role = profile?.role ?? 'staff'
  const summary = useMemo(() => buildDashboard(views, role), [views, role])

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          Welcome{profile ? `, ${profile.displayName}` : ''}
        </h1>
        <p className="text-muted-foreground">
          {businessDate} · signed in as {profile ? ROLE_LABELS[profile.role] : 'a user'}. Everything
          below is today only, and updates as orders are rung up and moved along. Voided sales are
          excluded from every figure.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button asChild size="lg" className="h-touch text-base">
          <Link to="/pos">Open the till</Link>
        </Button>
        <Button asChild size="lg" variant="outline" className="h-touch text-base">
          <Link to="/queue">Go to the queue</Link>
        </Button>
        <Button asChild size="lg" variant="outline" className="h-touch text-base">
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
          <section className="space-y-3" aria-label="Today">
            <h2 className="text-sm font-semibold tracking-wide uppercase">Today</h2>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <Tile
                label="Orders"
                value={String(summary.orderCount)}
                testId="tile-orders"
                hint={
                  summary.voidedCount > 0
                    ? `${summary.voidedCount} voided, not counted`
                    : 'Voided sales excluded'
                }
              />
              <Tile
                label="Unpaid"
                value={String(summary.unpaidCount)}
                testId="tile-unpaid"
                hint="Money still to collect"
                warn={summary.unpaidCount > 0}
                to="/orders"
              />
              {summary.finance && (
                <>
                  <Tile
                    label="Revenue"
                    value={formatMoney(summary.finance.revenue)}
                    testId="tile-revenue"
                    hint="Every order placed, paid or not"
                  />
                  <Tile
                    label="Collected"
                    value={formatMoney(summary.finance.collected)}
                    testId="tile-collected"
                    hint={`${formatMoney(summary.finance.outstanding)} outstanding`}
                  />
                </>
              )}
            </div>
          </section>

          <section className="space-y-3" aria-label="Kitchen queue">
            <h2 className="text-sm font-semibold tracking-wide uppercase">Queue</h2>
            <div className="grid gap-3 sm:grid-cols-3">
              {QUEUE_COLUMNS.map((column) => (
                <Tile
                  key={column}
                  label={QUEUE_COLUMN_LABELS[column]}
                  value={String(summary.queue[column])}
                  testId="tile-queue"
                  dataStatus={column}
                  to="/queue"
                />
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              Delivered orders leave the board. They are still on the Orders page.
            </p>
          </section>
        </>
      )}

      {/* Mounted only for an admin, so the admin-only cost read is never issued by a staff
          session. The guard is the mount, not a hidden element. */}
      {profile?.role === 'admin' && <TodayCostCard />}
    </div>
  )
}

/**
 * Estimated cost and profit for today, admin only.
 *
 * **Reused from the reports feature, never recomputed.** `useReport` runs the same
 * `fetchReportData` and `buildReport` the Reports page runs, for the `today` preset. There is
 * one implementation of that arithmetic and this is not a second one.
 *
 * It is deliberately its own card, apart from the live tiles above, because it is a different
 * kind of answer: a one-shot snapshot taken when the page loaded, against tiles that update
 * continuously. Blending the two would produce a screen where revenue and profit silently
 * disagree by whatever was rung up in between. The Refresh button is how it is brought back
 * into line.
 */
function TodayCostCard() {
  const range = useMemo(() => rangeFor('today', new Date()), [])
  const { report, loading, error, refresh } = useReport(range)

  const incomplete = report !== null && !report.coverage.complete

  return (
    <section className="space-y-3 rounded-lg border p-4" aria-label="Estimated cost and profit">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold tracking-wide uppercase">Estimated cost and profit</h2>
        <Button type="button" size="sm" variant="outline" onClick={refresh} disabled={loading}>
          Refresh
        </Button>
      </div>

      <p className="text-xs text-muted-foreground">
        A snapshot taken when this page loaded, not a live figure. Cost is resolved from the
        cost-history journal at the time of each sale, exactly as on the Reports page.
      </p>

      {error && (
        <Alert variant="destructive">
          <AlertCircle aria-hidden="true" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {loading && <Skeleton className="h-24 w-full" />}

      {!loading && report && (
        <>
          {/* The same guard the Reports page carries: never let an estimate read as fact. */}
          {incomplete && (
            <Alert variant="destructive" data-testid="dashboard-coverage-warning">
              <TriangleAlert aria-hidden="true" />
              <AlertDescription>
                Cost data is incomplete — a recorded cost was found for{' '}
                {report.coverage.percent === null ? '—' : `${report.coverage.percent.toFixed(1)}%`}{' '}
                of revenue, so the figures below are an <strong>upper bound</strong>, not what was
                actually earned.
              </AlertDescription>
            </Alert>
          )}

          <div className="grid gap-3 sm:grid-cols-3">
            <Tile
              label={incomplete ? 'Estimated cost (incomplete)' : 'Estimated cost'}
              value={formatMoney(report.estimatedCost)}
              testId="tile-estimated-cost"
              warn={incomplete}
            />
            <Tile
              label={incomplete ? 'Estimated profit (incomplete)' : 'Estimated profit'}
              value={formatMoney(report.estimatedProfit)}
              testId="tile-estimated-profit"
              warn={incomplete}
            />
            <Tile
              label="Margin"
              value={report.marginPercent === null ? '—' : `${report.marginPercent.toFixed(1)}%`}
              testId="tile-margin"
              warn={incomplete}
            />
          </div>
        </>
      )}
    </section>
  )
}

/**
 * One figure. Becomes a link when `to` is given, so a tile that raises a question leads to
 * the screen that answers it.
 */
function Tile({
  label,
  value,
  testId,
  hint,
  warn = false,
  to,
  dataStatus,
}: {
  label: string
  value: string
  testId: string
  hint?: string
  warn?: boolean
  to?: string
  dataStatus?: string
}) {
  const className = cn(
    'block rounded-lg border p-4',
    warn && 'border-destructive/40',
    to && 'transition-colors hover:bg-muted/50',
  )

  const body = (
    <>
      <span className="block text-sm text-muted-foreground">{label}</span>
      <span className="block text-2xl font-semibold tabular-nums" data-testid={testId}>
        {value}
      </span>
      {hint && <span className="mt-1 block text-xs text-muted-foreground">{hint}</span>}
    </>
  )

  if (to) {
    return (
      <Link to={to} className={className} data-status={dataStatus}>
        {body}
      </Link>
    )
  }

  return (
    <div className={className} data-status={dataStatus}>
      {body}
    </div>
  )
}
