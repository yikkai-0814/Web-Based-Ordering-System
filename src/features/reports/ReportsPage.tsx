import { useMemo, useState } from 'react'
import { AlertCircle, Download, TriangleAlert } from 'lucide-react'

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
import { cn } from '@/lib/utils'

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
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Reports</h1>
        <p className="text-muted-foreground">
          Sales for {appliedRange.from}
          {appliedRange.to !== appliedRange.from ? ` to ${appliedRange.to}` : ''}. Voided sales are
          excluded from every figure below. Revenue counts every order placed, paid or not; what has
          actually been received is shown as Collected.
        </p>
      </div>

      <div className="space-y-3 rounded-lg border p-4">
        <div className="flex flex-wrap gap-2">
          {RANGE_PRESETS.map((candidate) => (
            <Button
              key={candidate}
              type="button"
              variant={preset === candidate ? 'default' : 'outline'}
              size="lg"
              className="h-touch text-base"
              aria-pressed={preset === candidate}
              data-testid={`range-${candidate}`}
              onClick={() => choosePreset(candidate)}
            >
              {RANGE_LABELS[candidate]}
            </Button>
          ))}
        </div>

        {preset === 'custom' && (
          <div className="flex flex-wrap items-end gap-3">
            <div className="grid gap-2">
              <Label htmlFor="from">From</Label>
              <Input
                id="from"
                type="date"
                className="h-touch text-base"
                value={customFrom}
                onChange={(event) => setCustomFrom(event.target.value)}
              />
            </div>
            <div className="grid gap-2">
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
  const incomplete = !report.coverage.complete

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
      {/* The requested guard: never let an estimate be read as fact. */}
      {incomplete && (
        <Alert variant="destructive" data-testid="coverage-warning">
          <TriangleAlert aria-hidden="true" />
          <AlertDescription>
            <span className="block font-medium">
              Cost data is incomplete — estimated cost and profit below are not actual figures.
            </span>
            <span className="block">
              A recorded cost was found for {formatPercent(report.coverage.percent)} of revenue (
              {formatMoney(report.coverage.knownRevenue)} of {formatMoney(report.revenue)}). Lines
              with no recorded cost contribute nothing to estimated cost, so the profit and margin
              shown are an <strong>upper bound</strong>, not what was actually earned.
            </span>
          </AlertDescription>
        </Alert>
      )}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Tile label="Revenue" value={formatMoney(report.revenue)} testId="tile-revenue" />
        <Tile label="Orders" value={String(report.orderCount)} testId="tile-orders" />
        <Tile
          label="Average order"
          value={formatMoney(report.averageOrderValue)}
          testId="tile-average"
        />
        <Tile
          label="Voided"
          value={`${report.voided.length} · ${formatMoney(report.voidedAmount)}`}
          testId="tile-voided"
          hint="Excluded from every figure"
        />
        <Tile
          label="Collected"
          value={formatMoney(report.collectedRevenue)}
          testId="tile-collected"
          hint={`${report.paidOrderCount} of ${report.orderCount} orders paid`}
        />
        <Tile
          label="Outstanding"
          value={formatMoney(report.outstandingRevenue)}
          testId="tile-outstanding"
          warn={report.outstandingRevenue > 0}
          hint={
            report.unpaidOrderCount === 0
              ? 'Everything has been paid'
              : `${report.unpaidOrderCount} order${report.unpaidOrderCount === 1 ? '' : 's'} not yet paid`
          }
        />
        <Tile
          label={incomplete ? 'Estimated cost (incomplete)' : 'Estimated cost'}
          value={formatMoney(report.estimatedCost)}
          testId="tile-cost"
          warn={incomplete}
        />
        <Tile
          label={incomplete ? 'Estimated profit (incomplete)' : 'Estimated profit'}
          value={formatMoney(report.estimatedProfit)}
          testId="tile-profit"
          warn={incomplete}
          hint={incomplete ? 'Upper bound — some costs unknown' : undefined}
        />
        <Tile
          label={incomplete ? 'Margin (incomplete)' : 'Margin'}
          value={formatPercent(report.marginPercent)}
          testId="tile-margin"
          warn={incomplete}
        />
        <Tile
          label="Cost coverage"
          value={formatPercent(report.coverage.percent)}
          testId="tile-coverage"
          warn={incomplete}
          hint={incomplete ? 'Share of revenue with a recorded cost' : 'All costs recorded'}
        />
      </div>

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

      <section className="space-y-2">
        <h2 className="text-lg font-medium">Payment methods</h2>
        {/* Paid orders only — an unpaid order has no method to attribute. */}
        {report.payments.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {report.orderCount === 0
              ? 'No sales in this range.'
              : 'No payments recorded in this range.'}
          </p>
        ) : (
          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Method</TableHead>
                  <TableHead className="w-28 text-right">Orders</TableHead>
                  <TableHead className="w-40 text-right">Value</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {report.payments.map((row) => (
                  <TableRow key={row.method} data-testid="payment-row" data-method={row.method}>
                    <TableCell>{PAYMENT_LABELS[row.method]}</TableCell>
                    <TableCell className="text-right tabular-nums">{row.count}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatMoney(row.amount)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-medium">Item performance</h2>
        {report.items.length === 0 ? (
          <p className="text-sm text-muted-foreground">No items sold in this range.</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Item</TableHead>
                  <TableHead className="w-24 text-right">Qty</TableHead>
                  <TableHead className="w-32 text-right">Revenue</TableHead>
                  <TableHead className="w-32 text-right">Est. cost</TableHead>
                  <TableHead className="w-32 text-right">Est. profit</TableHead>
                  <TableHead className="w-24 text-right">Margin</TableHead>
                  <TableHead className="w-28 text-right">Cost data</TableHead>
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
                    <TableCell className="font-medium">{row.name}</TableCell>
                    <TableCell className="text-right tabular-nums">{row.quantity}</TableCell>
                    <TableCell className="text-right tabular-nums" data-testid="item-revenue">
                      {formatMoney(row.revenue)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatMoney(row.estimatedCost)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatMoney(row.estimatedProfit)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatPercent(row.marginPercent)}
                    </TableCell>
                    <TableCell
                      className={cn(
                        'text-right text-sm',
                        row.coverage.complete ? 'text-muted-foreground' : 'text-destructive',
                      )}
                      data-testid="item-coverage"
                    >
                      {row.coverage.complete ? 'Complete' : 'Incomplete'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-medium">Voided sales</h2>
        {report.voided.length === 0 ? (
          <p className="text-sm text-muted-foreground">No sales were voided in this range.</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
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

function Tile({
  label,
  value,
  testId,
  hint,
  warn = false,
}: {
  label: string
  value: string
  testId: string
  hint?: string
  warn?: boolean
}) {
  return (
    <div className={cn('rounded-lg border p-4', warn && 'border-destructive/40')}>
      <span className="block text-sm text-muted-foreground">{label}</span>
      <span className="block text-2xl font-semibold tabular-nums" data-testid={testId}>
        {value}
      </span>
      {hint && <span className="mt-1 block text-xs text-muted-foreground">{hint}</span>}
    </div>
  )
}
