import type { Message } from '@/features/i18n/messages'
import { useTranslation } from '@/features/i18n/useTranslation'
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
import { PAYMENT_LABEL_KEYS } from '@/features/pos/types'
import type { Report } from '@/features/reports/aggregate'
import { toCsv } from '@/features/reports/csv'
import { downloadCsv } from '@/features/reports/download'
import {
  MAX_RANGE_DAYS,
  RANGE_LABEL_KEYS,
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
  const { t } = useTranslation()
  const [preset, setPreset] = useState<RangePreset>('today')
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')
  const [customError, setCustomError] = useState<Message | null>(null)
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
        <h1 className="font-heading text-2xl font-semibold tracking-tight sm:text-3xl">
          {t('nav.reports')}
        </h1>
        <p className="text-sm text-muted-foreground">
          {appliedRange.to === appliedRange.from
            ? t('reports.blurbDay', { from: appliedRange.from })
            : t('reports.blurbRange', { from: appliedRange.from, to: appliedRange.to })}
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
              {t(RANGE_LABEL_KEYS[candidate])}
            </Button>
          ))}
        </div>

        {preset === 'custom' && (
          <div className="flex flex-wrap items-end gap-3">
            <div className="grid min-w-36 flex-1 gap-2 sm:flex-none">
              <Label htmlFor="from">{t('reports.from')}</Label>
              <Input
                id="from"
                type="date"
                className="h-touch text-base"
                value={customFrom}
                onChange={(event) => setCustomFrom(event.target.value)}
              />
            </div>
            <div className="grid min-w-36 flex-1 gap-2 sm:flex-none">
              <Label htmlFor="to">{t('reports.to')}</Label>
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
              {t('reports.apply')}
            </Button>
            <p className="text-xs text-muted-foreground">
              {t('reports.maxDays', { max: MAX_RANGE_DAYS })}
            </p>
          </div>
        )}

        {customError && (
          <Alert variant="destructive">
            <AlertCircle aria-hidden="true" />
            <AlertDescription>{t(customError)}</AlertDescription>
          </Alert>
        )}
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertCircle aria-hidden="true" />
          <AlertDescription>{t(error)}</AlertDescription>
        </Alert>
      )}

      {loading && <Skeleton className="h-96 w-full" />}

      {!loading && report && <ReportBody report={report} range={appliedRange} />}
    </div>
  )
}

function ReportBody({ report, range }: { report: Report; range: DateRange }) {
  const { t } = useTranslation()
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
        title={t('reports.trading')}
        description={t('reports.tradingBlurb')}
        aria-label={t('reports.trading')}
      >
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-5">
          <StatCard
            label={t('reports.revenue')}
            value={formatMoney(report.revenue)}
            testId="tile-revenue"
            tone="money"
            variant="hero"
            className="col-span-2 lg:col-span-1"
          />
          <StatCard
            label={t('reports.orders')}
            value={String(report.orderCount)}
            testId="tile-orders"
            variant="quiet"
          />
          <StatCard
            label={t('reports.averageOrder')}
            value={formatMoney(report.averageOrderValue)}
            testId="tile-average"
            variant="quiet"
            tone="money"
          />
          <StatCard
            label={t('reports.collected')}
            value={formatMoney(report.collectedRevenue)}
            testId="tile-collected"
            variant="quiet"
            tone="money"
            hint={t('reports.collectedHint', {
              paid: report.paidOrderCount,
              total: report.orderCount,
            })}
          />
          <StatCard
            label={t('reports.outstanding')}
            value={formatMoney(report.outstandingRevenue)}
            testId="tile-outstanding"
            variant="quiet"
            tone={report.outstandingRevenue > 0 ? 'warning' : 'money'}
            hint={
              report.unpaidOrderCount === 0
                ? t('reports.outstandingHintClear')
                : t(
                    report.unpaidOrderCount === 1
                      ? 'reports.outstandingHintOne'
                      : 'reports.outstandingHintOther',
                    { count: report.unpaidOrderCount },
                  )
            }
          />
        </div>
      </Panel>

      {/* The strongest surface on the page, because profitability is the reason an admin
          opens Reports rather than the Orders list. */}
      <Panel
        tone="accent"
        title={t('reports.costAndProfitability')}
        description={t('reports.costBlurb')}
        aria-label={t('reports.costAndProfitability')}
      >
        {/* An exception, not a metric: shown only when an item was sold with no recorded
            cost, and phrased as something to go and fix. */}
        {missingCost && (
          <Alert data-testid="missing-cost-warning">
            <TriangleAlert aria-hidden="true" />
            <AlertDescription>{t('reports.missingCostRange')}</AlertDescription>
          </Alert>
        )}

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            label={t('reports.profit')}
            value={formatMoney(report.estimatedProfit)}
            testId="tile-profit"
            tone="money"
            variant="hero"
            className="sm:col-span-2"
            hint={t('reports.profitHint')}
          />
          <StatCard
            label={t('reports.recordedCost')}
            value={formatMoney(report.estimatedCost)}
            testId="tile-cost"
            tone="money"
            variant="hero"
            hint={t('reports.recordedCostHint')}
          />
          <StatCard
            label={t('reports.margin')}
            value={formatPercent(report.marginPercent)}
            testId="tile-margin"
            hint={t('reports.marginHint')}
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
          {t('reports.exportSummary')}
        </Button>
        <Button
          variant="outline"
          size="lg"
          className="h-touch text-base"
          data-testid="export-items"
          onClick={() => downloadCsv(`items-${range.from}-to-${range.to}.csv`, itemsCsv)}
        >
          <Download aria-hidden="true" />
          {t('reports.exportItems')}
        </Button>
      </div>

      <section className="space-y-3" aria-label={t('reports.paymentMethods')}>
        <SectionHeader
          title={t('reports.paymentMethods')}
          description={t('reports.paymentMethodsBlurb')}
        />
        {report.payments.length === 0 ? (
          <EmptyState
            title={t(
              report.orderCount === 0 ? 'reports.noSalesInRange' : 'reports.noPaymentsInRange',
            )}
            description={t('reports.methodsBlurb')}
          />
        ) : (
          <div className="space-y-4 rounded-xl border bg-card p-4 shadow-xs">
            {report.payments.map((row, index) => (
              <div key={row.method} data-testid="payment-row" data-method={row.method}>
                <MeterBar
                  label={`${t(PAYMENT_LABEL_KEYS[row.method])} · ${t(row.count === 1 ? 'common.ordersOne' : 'common.ordersOther', { count: row.count })}`}
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

      <section className="space-y-3" aria-label={t('reports.itemPerformance')}>
        <SectionHeader
          title={t('reports.itemPerformance')}
          description={t('reports.itemPerformanceBlurb')}
        />
        {report.items.length === 0 ? (
          <EmptyState
            title={t('reports.noItemsSold')}
            description={t('reports.noItemsSoldBlurb')}
          />
        ) : (
          <div className="rounded-xl border bg-card shadow-xs">
            <Table className="min-w-2xl">
              <TableHeader className="bg-muted/50">
                <TableRow className="hover:bg-transparent">
                  <TableHead>{t('reports.columnItem')}</TableHead>
                  <TableHead className="w-24 text-right">{t('reports.qtySold')}</TableHead>
                  <TableHead className="w-32 text-right">{t('reports.revenue')}</TableHead>
                  <TableHead className="w-32 text-right">{t('reports.estCost')}</TableHead>
                  <TableHead className="w-32 text-right">{t('reports.estProfit')}</TableHead>
                  <TableHead className="w-24 text-right">{t('reports.margin')}</TableHead>
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
                            {t('reports.noCostRecorded')}
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

      <section className="space-y-3" aria-label={t('reports.voidedSales')}>
        <SectionHeader
          title={t('reports.voidedSales')}
          description={t(
            report.voided.length === 1 ? 'reports.voidedSummaryOne' : 'reports.voidedSummaryOther',
            { count: report.voided.length, amount: formatMoney(report.voidedAmount) },
          )}
        />
        {report.voided.length === 0 ? (
          <EmptyState title={t('reports.noVoids')} />
        ) : (
          <div className="rounded-xl border bg-card shadow-xs">
            <Table className="min-w-2xl">
              <TableHeader className="bg-muted/50">
                <TableRow className="hover:bg-transparent">
                  <TableHead className="w-24">{t('reports.columnOrder')}</TableHead>
                  <TableHead className="w-32">{t('reports.columnDate')}</TableHead>
                  <TableHead>{t('void.reason')}</TableHead>
                  <TableHead>{t('void.by')}</TableHead>
                  <TableHead className="w-32 text-right">{t('reports.columnValue')}</TableHead>
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
