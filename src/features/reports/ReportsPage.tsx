import { useMemo, useState } from 'react'
import { AlertCircle, Download, TriangleAlert } from 'lucide-react'

import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/data/EmptyState'
import { Panel } from '@/components/data/Panel'
import { MeterBar } from '@/components/data/MeterBar'
import { SectionHeader } from '@/components/data/SectionHeader'
import { StatCard } from '@/components/data/StatCard'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { PAYMENT_LABELS } from '@/features/pos/types'
import type { Report } from '@/features/reports/aggregate'
import { toCsv } from '@/features/reports/csv'
import { downloadCsv } from '@/features/reports/download'
import {
  MAX_RANGE_DAYS,
  RANGE_LABELS,
  RANGE_PRESETS,
  rangeFor,
  validateCustomRange,
  type DateRange,
  type RangePreset,
} from '@/features/reports/ranges'
import { useReport } from '@/features/reports/useReport'
import { formatMoney } from '@/lib/money'

const formatPercent = (value: number | null) => (value === null ? '—' : `${value.toFixed(1)}%`)

export function ReportsPage() {
  const [preset, setPreset] = useState<RangePreset>('today')
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')
  const [customError, setCustomError] = useState<string | null>(null)
  const [appliedRange, setAppliedRange] = useState<DateRange>(() => rangeFor('today', new Date()))

  const { report, loading, error } = useReport(appliedRange)

  function choosePreset(next: RangePreset) {
    setPreset(next)
    setCustomError(null)
    if (next !== 'custom') setAppliedRange(rangeFor(next, new Date()))
  }

  function applyCustom() {
    const result = validateCustomRange(customFrom, customTo)
    if (!result.ok) {
      setCustomError(result.error)
      return
    }
    setCustomError(null)
    setAppliedRange(result.range)
  }

  return (
    <div className="mx-auto w-full max-w-7xl space-y-6">
      <header className="space-y-1">
        <h1 className="font-heading text-2xl font-semibold tracking-tight sm:text-3xl">Reports</h1>
        <p className="text-sm text-muted-foreground">
          Sales for {appliedRange.from}
          {appliedRange.to !== appliedRange.from ? ` to ${appliedRange.to}` : ''}. Voided sales are
          excluded from every figure below. Revenue counts every order placed, paid or not; what has
          actually been received is shown as Collected.
        </p>
      </header>

      <div className="space-y-3 rounded-xl border bg-card p-4 shadow-xs">
        <div className="flex flex-wrap gap-2">
          {RANGE_PRESETS.map((candidate) => (
            <Button
              key={candidate}
              type="button"
              variant={preset === candidate ? 'default' : 'outline'}
              size="lg"
              aria-pressed={preset === candidate}
              className="h-touch grow text-base sm:grow-0"
              data-testid={`range-${candidate}`}
              onClick={() => choosePreset(candidate)}
            >
              {RANGE_LABELS[candidate]}
            </Button>
          ))}
        </div>

        {preset === 'custom' && (
          <div className="flex flex-wrap items-end gap-3">
            <div className="grid min-w-36 flex-1 gap-2 sm:flex-none">
              <Label htmlFor="from">From</Label>
              <Input
                id="from"
                type="date"
                className="h-touch text-base"
                value={customFrom}
                onChange={(event) => setCustomFrom(event.target.value)}
              />
            </div>
            <div className="grid min-w-36 flex-1 gap-2 sm:flex-none">
              <Label htmlFor="to">To</Label>
              <Input
                id="to"
                type="date"
                className="h-touch text-base"
                value={customTo}
                onChange={(event) => setCustomTo(event.target.value)}
              />
            </div>
            <Button
              type="button"
              size="lg"
              className="h-touch text-base"
              data-testid="apply-range"
              onClick={applyCustom}
            >
              Apply
            </Button>
            <p className="text-xs text-muted-foreground">At most {MAX_RANGE_DAYS} days.</p>
          </div>
        )}

        {customError && (
          <Alert variant="destructive">
            <AlertCircle aria-hidden="true" />
            <AlertDescription>{customError}</AlertDescription>
          </Alert>
        )}
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertCircle aria-hidden="true" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {loading && <Skeleton className="h-96 w-full" />}

      {!loading && report && <ReportBody report={report} range={appliedRange} />}
    </div>
  )
}

function ReportBody({ report, range }: { report: Report; range: DateRange }) {
  /**
   * An item was sold with no recorded cost.
   *
   * Every menu item is supposed to have one, so this is a data-integrity exception rather
   * than a figure to track: it is surfaced when it happens and invisible when it does not.
   * The arithmetic behind it is untouched — `buildReport` still resolves each line against
   * the cost history and still reports coverage; this page just no longer presents that
   * coverage as a business metric.
   */
  const missingCost = !report.coverage.complete

  const summaryCsv = useMemo(
    () =>
      toCsv([
        ['Metric', 'Value'],
        ['From', range.from],
        ['To', range.to],
        ['Revenue (sen)', report.revenue],
        ['Orders', report.orderCount],
        ['Paid orders', report.paidOrderCount],
        ['Unpaid orders', report.unpaidOrderCount],
        ['Collected (sen)', report.collectedRevenue],
        ['Outstanding (sen)', report.outstandingRevenue],
        ['Average order value (sen)', report.averageOrderValue],
        ['Estimated cost (sen)', report.estimatedCost],
        ['Estimated profit (sen)', report.estimatedProfit],
        ['Margin %', report.marginPercent === null ? '' : report.marginPercent.toFixed(1)],
        [
          'Cost coverage %',
          report.coverage.percent === null ? '' : report.coverage.percent.toFixed(1),
        ],
        ['Cost data complete', report.coverage.complete ? 'yes' : 'no'],
        ['Voided orders', report.voided.length],
        ['Voided value (sen)', report.voidedAmount],
      ]),
    [report, range],
  )

  const itemsCsv = useMemo(
    () =>
      toCsv([
        [
          'Item',
          'Quantity',
          'Revenue (sen)',
          'Estimated cost (sen)',
          'Estimated profit (sen)',
          'Margin %',
          'Cost coverage %',
        ],
        ...report.items.map((row) => [
          row.name,
          row.quantity,
          row.revenue,
          row.estimatedCost,
          row.estimatedProfit,
          row.marginPercent === null ? '' : row.marginPercent.toFixed(1),
          row.coverage.percent === null ? '' : row.coverage.percent.toFixed(1),
        ]),
      ]),
    [report],
  )

  return (
    <div className="space-y-6">
      <Panel
        tone="plain"
        title="Trading"
        description="Revenue counts every order placed; Collected is what has actually been received."
        aria-label="Trading"
      >
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-5">
          <StatCard
            label="Revenue"
            value={formatMoney(report.revenue)}
            testId="tile-revenue"
            tone="money"
            variant="hero"
            className="col-span-2 lg:col-span-1"
          />
          <StatCard
            label="Orders"
            value={String(report.orderCount)}
            testId="tile-orders"
            variant="quiet"
          />
          <StatCard
            label="Average order"
            value={formatMoney(report.averageOrderValue)}
            testId="tile-average"
            variant="quiet"
            tone="money"
          />
          <StatCard
            label="Collected"
            value={formatMoney(report.collectedRevenue)}
            testId="tile-collected"
            variant="quiet"
            tone="money"
            hint={`${report.paidOrderCount} of ${report.orderCount} orders paid`}
          />
          <StatCard
            label="Outstanding"
            value={formatMoney(report.outstandingRevenue)}
            testId="tile-outstanding"
            variant="quiet"
            tone={report.outstandingRevenue > 0 ? 'warning' : 'money'}
            hint={
              report.unpaidOrderCount === 0
                ? 'Everything has been paid'
                : `${report.unpaidOrderCount} order${report.unpaidOrderCount === 1 ? '' : 's'} not yet paid`
            }
          />
        </div>
      </Panel>

      {/* The strongest surface on the page, because profitability is the reason an admin
          opens Reports rather than the Orders list. */}
      <Panel
        tone="accent"
        title="Cost and profitability"
        description="Cost comes from the cost recorded against each item at the time of each sale, so a price change today does not rewrite what an older order cost."
        aria-label="Cost and profitability"
      >
        {/* An exception, not a metric: shown only when an item was sold with no recorded
            cost, and phrased as something to go and fix. */}
        {missingCost && (
          <Alert data-testid="missing-cost-warning">
            <TriangleAlert aria-hidden="true" />
            <AlertDescription>
              Some items sold in this range have no recorded cost, so the cost below is lower — and
              the profit higher — than the real figures. The item table marks which ones; record
              their cost on the Menu page.
            </AlertDescription>
          </Alert>
        )}

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            label="Profit"
            value={formatMoney(report.estimatedProfit)}
            testId="tile-profit"
            tone="money"
            variant="hero"
            className="sm:col-span-2"
            hint="Revenue less recorded cost"
          />
          <StatCard
            label="Recorded cost"
            value={formatMoney(report.estimatedCost)}
            testId="tile-cost"
            tone="money"
            variant="hero"
            hint="What the items sold cost to make"
          />
          <StatCard
            label="Margin"
            value={formatPercent(report.marginPercent)}
            testId="tile-margin"
            hint="Profit as a share of revenue"
          />
        </div>
      </Panel>

      <div className="flex flex-wrap gap-3">
        <Button
          variant="outline"
          size="lg"
          className="h-touch text-base"
          data-testid="export-summary"
          onClick={() => downloadCsv(`summary-${range.from}-to-${range.to}.csv`, summaryCsv)}
        >
          <Download aria-hidden="true" />
          Export summary (CSV)
        </Button>
        <Button
          variant="outline"
          size="lg"
          className="h-touch text-base"
          data-testid="export-items"
          onClick={() => downloadCsv(`items-${range.from}-to-${range.to}.csv`, itemsCsv)}
        >
          <Download aria-hidden="true" />
          Export items (CSV)
        </Button>
      </div>

      <section className="space-y-3" aria-label="Payment methods">
        <SectionHeader
          title="Payment methods"
          description="Paid orders only — an unpaid order has no method to attribute."
        />
        {report.payments.length === 0 ? (
          <EmptyState
            title={
              report.orderCount === 0
                ? 'No sales in this range'
                : 'No payments recorded in this range'
            }
            description="Methods appear here as orders are settled."
          />
        ) : (
          <div className="space-y-4 rounded-xl border bg-card p-4 shadow-xs">
            {report.payments.map((row, index) => (
              <div key={row.method} data-testid="payment-row" data-method={row.method}>
                <MeterBar
                  label={`${PAYMENT_LABELS[row.method]} · ${row.count} ${row.count === 1 ? 'order' : 'orders'}`}
                  value={formatMoney(row.amount)}
                  // Share of what was collected, which is exactly what these rows sum to.
                  percent={
                    report.collectedRevenue === 0
                      ? null
                      : (row.amount / report.collectedRevenue) * 100
                  }
                  tone={index === 0 ? 'primary' : 'secondary'}
                />
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="space-y-3" aria-label="Item performance">
        <SectionHeader
          title="Item performance"
          description="Every item sold in this period with its quantity sold, ordered by revenue. Scrolls sideways on a narrow screen rather than shrinking the figures."
        />
        {report.items.length === 0 ? (
          <EmptyState
            title="No items sold in this range"
            description="Try a wider date range, or check that sales were rung up on these days."
          />
        ) : (
          <div className="rounded-xl border bg-card shadow-xs">
            <Table className="min-w-2xl">
              <TableHeader className="bg-muted/50">
                <TableRow className="hover:bg-transparent">
                  <TableHead>Item</TableHead>
                  <TableHead className="w-24 text-right">Qty sold</TableHead>
                  <TableHead className="w-32 text-right">Revenue</TableHead>
                  <TableHead className="w-32 text-right">Est. cost</TableHead>
                  <TableHead className="w-32 text-right">Est. profit</TableHead>
                  <TableHead className="w-24 text-right">Margin</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {report.items.map((row) => (
                  <TableRow
                    key={row.menuItemId}
                    data-testid="item-row"
                    data-item-name={row.name}
                    data-item-id={row.menuItemId}
                  >
                    <TableCell className="font-medium">
                      <span className="flex flex-wrap items-center gap-2">
                        {row.name}
                        {/* The exception, on the row that has it — so an admin can see what to
                            go and fix instead of reading a percentage. Words, not a colour. */}
                        {!row.coverage.complete && (
                          <span
                            className="inline-flex items-center rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary"
                            data-testid="item-missing-cost"
                          >
                            No cost recorded
                          </span>
                        )}
                      </span>
                    </TableCell>
                    <TableCell className="text-right font-medium tabular-nums">
                      {row.quantity}
                    </TableCell>
                    <TableCell
                      className="text-right font-semibold tabular-nums"
                      data-testid="item-revenue"
                    >
                      {formatMoney(row.revenue)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      {formatMoney(row.estimatedCost)}
                    </TableCell>
                    <TableCell className="text-right font-medium tabular-nums">
                      {formatMoney(row.estimatedProfit)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatPercent(row.marginPercent)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>

      <section className="space-y-3" aria-label="Voided sales">
        <SectionHeader
          title="Voided sales"
          description={`${report.voided.length} ${report.voided.length === 1 ? 'sale' : 'sales'} worth ${formatMoney(report.voidedAmount)}, excluded from every figure above. A void is a counter-entry, never an edit.`}
        />
        {report.voided.length === 0 ? (
          <EmptyState title="No sales were voided in this range" />
        ) : (
          <div className="rounded-xl border bg-card shadow-xs">
            <Table className="min-w-2xl">
              <TableHeader className="bg-muted/50">
                <TableRow className="hover:bg-transparent">
                  <TableHead className="w-24">Order</TableHead>
                  <TableHead className="w-32">Date</TableHead>
                  <TableHead>Reason</TableHead>
                  <TableHead>Voided by</TableHead>
                  <TableHead className="w-32 text-right">Value</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {report.voided.map((row) => (
                  <TableRow key={row.orderId} data-testid="void-row">
                    <TableCell className="tabular-nums">#{row.number}</TableCell>
                    <TableCell className="tabular-nums text-muted-foreground">
                      {row.businessDate}
                    </TableCell>
                    <TableCell>{row.reason}</TableCell>
                    <TableCell>{row.voidedByName}</TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground line-through">
                      {formatMoney(row.amount)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>
    </div>
  )
}
