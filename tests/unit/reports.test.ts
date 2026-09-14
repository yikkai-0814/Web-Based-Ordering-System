import { say } from '../say'
import { describe, expect, it } from 'vitest'

import {
  buildReport,
  indexCostHistory,
  resolveCostAtTime,
  type CostHistoryEntry,
  type ReportOrder,
  type ReportVoidInfo,
} from '@/features/reports/aggregate'
import { escapeCsvField, toCsv } from '@/features/reports/csv'
import { MAX_RANGE_DAYS, rangeFor, validateCustomRange } from '@/features/reports/ranges'

const at = (iso: string) => new Date(iso)

const order = (over: Partial<ReportOrder> = {}): ReportOrder => ({
  id: 'o1',
  number: 1,
  businessDate: '2026-09-10',
  createdAt: at('2026-09-10T10:00:00'),
  lines: [{ menuItemId: 'i1', name: 'Flat White', unitPrice: 1250, quantity: 1 }],
  total: 1250,
  // Paid by default so every pre-existing expectation below still describes the same
  // scenario it did before payment became a separate step: a settled cash sale. Tests that
  // care about the unpaid case pass `paid: false` explicitly.
  paid: true,
  paymentMethod: 'cash',
  ...over,
})

/** An order that has been placed but not yet paid: no method, and nothing collected. */
const unpaidOrder = (over: Partial<ReportOrder> = {}): ReportOrder =>
  order({ paid: false, paymentMethod: null, ...over })

const history = (...entries: CostHistoryEntry[]) => indexCostHistory(entries)
const noVoids = new Map<string, ReportVoidInfo>()
const noCosts = new Map<string, number>()

describe('resolveCostAtTime', () => {
  it('uses the newest entry at or before the sale', () => {
    const index = history(
      { itemId: 'i1', cost: 400, effectiveFrom: at('2026-09-01T00:00:00') },
      { itemId: 'i1', cost: 500, effectiveFrom: at('2026-09-05T00:00:00') },
      { itemId: 'i1', cost: 600, effectiveFrom: at('2026-09-20T00:00:00') },
    )
    expect(resolveCostAtTime('i1', at('2026-09-03T00:00:00'), index, noCosts)).toBe(400)
    expect(resolveCostAtTime('i1', at('2026-09-10T00:00:00'), index, noCosts)).toBe(500)
    expect(resolveCostAtTime('i1', at('2026-09-25T00:00:00'), index, noCosts)).toBe(600)
  })

  it('is inclusive at the exact instant of a change', () => {
    const index = history({ itemId: 'i1', cost: 500, effectiveFrom: at('2026-09-05T12:00:00') })
    expect(resolveCostAtTime('i1', at('2026-09-05T12:00:00'), index, noCosts)).toBe(500)
    expect(resolveCostAtTime('i1', at('2026-09-05T11:59:59'), index, noCosts)).toBeNull()
  })

  it('returns null when the cost was CLEARED, without resurrecting the current cost', () => {
    // The clearing is a real event: the café stopped tracking this item's cost.
    const index = history(
      { itemId: 'i1', cost: 400, effectiveFrom: at('2026-09-01T00:00:00') },
      { itemId: 'i1', cost: null, effectiveFrom: at('2026-09-05T00:00:00') },
    )
    const current = new Map([['i1', 999]])
    expect(resolveCostAtTime('i1', at('2026-09-03T00:00:00'), index, current)).toBe(400)
    expect(resolveCostAtTime('i1', at('2026-09-10T00:00:00'), index, current)).toBeNull()
  })

  it('handles cleared then re-set', () => {
    const index = history(
      { itemId: 'i1', cost: 400, effectiveFrom: at('2026-09-01T00:00:00') },
      { itemId: 'i1', cost: null, effectiveFrom: at('2026-09-05T00:00:00') },
      { itemId: 'i1', cost: 700, effectiveFrom: at('2026-09-09T00:00:00') },
    )
    expect(resolveCostAtTime('i1', at('2026-09-07T00:00:00'), index, noCosts)).toBeNull()
    expect(resolveCostAtTime('i1', at('2026-09-10T00:00:00'), index, noCosts)).toBe(700)
  })

  it('falls back to the current cost when the item has no history at all', () => {
    // An item never edited since keeps its current cost as its only value, for all time.
    const current = new Map([['i1', 450]])
    expect(resolveCostAtTime('i1', at('2020-01-01T00:00:00'), history(), current)).toBe(450)
  })

  it('returns null when there is neither history nor a current cost', () => {
    expect(resolveCostAtTime('i1', at('2026-09-10T00:00:00'), history(), noCosts)).toBeNull()
  })

  it('returns null when history exists but every entry is AFTER the sale', () => {
    // The cost genuinely was not recorded then; a later figure would be a guess.
    const index = history({ itemId: 'i1', cost: 400, effectiveFrom: at('2026-09-20T00:00:00') })
    const current = new Map([['i1', 400]])
    expect(resolveCostAtTime('i1', at('2026-09-10T00:00:00'), index, current)).toBeNull()
  })

  it('returns null when the order has no timestamp', () => {
    const index = history({ itemId: 'i1', cost: 400, effectiveFrom: at('2026-09-01T00:00:00') })
    expect(resolveCostAtTime('i1', null, index, noCosts)).toBeNull()
  })

  it('keys on item id, so a rename or reprice changes nothing', () => {
    const index = history({ itemId: 'i1', cost: 400, effectiveFrom: at('2026-09-01T00:00:00') })
    expect(resolveCostAtTime('i1', at('2026-09-10T00:00:00'), index, noCosts)).toBe(400)
    expect(resolveCostAtTime('i2', at('2026-09-10T00:00:00'), index, noCosts)).toBeNull()
  })
})

describe('resolveCostAtTime: a backfilled opening entry keeps old sales resolvable', () => {
  it('an edit WITHOUT an opening entry loses the old sale (the bug being fixed)', () => {
    // Only the new value is journalled, dated at the edit. The earlier sale now has
    // history that starts after it, so it resolves unknown even though 200 was known.
    const index = history({ itemId: 'i1', cost: 300, effectiveFrom: at('2026-09-11T13:00:00') })
    const current = new Map([['i1', 300]])
    expect(resolveCostAtTime('i1', at('2026-09-11T11:00:00'), index, current)).toBeNull()
  })

  it('with the opening entry backfilled, the old sale resolves to the OLD cost', () => {
    const index = history(
      { itemId: 'i1', cost: 200, effectiveFrom: at('2026-09-11T10:00:00') }, // backfilled
      { itemId: 'i1', cost: 300, effectiveFrom: at('2026-09-11T13:00:00') },
    )
    const current = new Map([['i1', 300]])
    expect(resolveCostAtTime('i1', at('2026-09-11T11:00:00'), index, current)).toBe(200)
    expect(resolveCostAtTime('i1', at('2026-09-11T14:00:00'), index, current)).toBe(300)
  })

  it('walks the full set / change / clear timeline from the spec', () => {
    const index = history(
      { itemId: 'i1', cost: 200, effectiveFrom: at('2026-09-11T10:00:00') },
      { itemId: 'i1', cost: 300, effectiveFrom: at('2026-09-11T13:00:00') },
      { itemId: 'i1', cost: null, effectiveFrom: at('2026-09-11T16:00:00') },
    )
    const current = new Map<string, number>() // cleared, so no current cost
    expect(resolveCostAtTime('i1', at('2026-09-11T11:00:00'), index, current)).toBe(200) // Sale A
    expect(resolveCostAtTime('i1', at('2026-09-11T14:00:00'), index, current)).toBe(300) // Sale B
    expect(resolveCostAtTime('i1', at('2026-09-11T17:00:00'), index, current)).toBeNull() // Sale C
  })

  it('leaves the legacy no-history fallback untouched', () => {
    const current = new Map([['i1', 250]])
    expect(resolveCostAtTime('i1', at('2026-09-11T11:00:00'), history(), current)).toBe(250)
  })
})

describe('buildReport: revenue and voids', () => {
  it('sums revenue over non-voided orders', () => {
    const report = buildReport({
      orders: [order({ id: 'a', total: 1250 }), order({ id: 'b', number: 2, total: 690 })],
      voids: noVoids,
      history: history(),
      currentCosts: noCosts,
    })
    expect(report.revenue).toBe(1940)
    expect(report.orderCount).toBe(2)
    expect(report.averageOrderValue).toBe(970)
  })

  it('excludes a voided order from EVERY metric, not just revenue', () => {
    const voids = new Map<string, ReportVoidInfo>([
      ['b', { amount: 690, reason: 'Mis-rung', voidedByName: 'Ada Admin' }],
    ])
    const report = buildReport({
      orders: [
        order({ id: 'a', total: 1250 }),
        order({
          id: 'b',
          number: 2,
          total: 690,
          paymentMethod: 'ewallet',
          lines: [{ menuItemId: 'i2', name: 'Croissant', unitPrice: 690, quantity: 1 }],
        }),
      ],
      voids,
      history: history(),
      currentCosts: new Map([
        ['i1', 400],
        ['i2', 200],
      ]),
    })

    expect(report.revenue).toBe(1250)
    expect(report.orderCount).toBe(1)
    // The voided item must not appear in item performance at all.
    expect(report.items.map((row) => row.menuItemId)).toEqual(['i1'])
    // Nor in the payment breakdown.
    expect(report.payments.map((row) => row.method)).toEqual(['cash'])
    // Nor in cost.
    expect(report.estimatedCost).toBe(400)
    // It appears only under voids.
    expect(report.voided).toHaveLength(1)
    expect(report.voided[0]?.reason).toBe('Mis-rung')
    expect(report.voidedAmount).toBe(690)
  })

  it('reports zero rather than NaN for an empty range', () => {
    const report = buildReport({
      orders: [],
      voids: noVoids,
      history: history(),
      currentCosts: noCosts,
    })
    expect(report.revenue).toBe(0)
    expect(report.averageOrderValue).toBe(0)
    expect(report.marginPercent).toBeNull()
    expect(report.coverage.percent).toBeNull()
    expect(report.coverage.complete).toBe(true)
  })

  it('ignores a void whose order is outside the range', () => {
    const voids = new Map<string, ReportVoidInfo>([
      ['not-in-range', { amount: 999, reason: 'x', voidedByName: 'Ada' }],
    ])
    const report = buildReport({
      orders: [order({ id: 'a', total: 1250 })],
      voids,
      history: history(),
      currentCosts: noCosts,
    })
    expect(report.revenue).toBe(1250)
    expect(report.voided).toHaveLength(0)
    expect(report.voidedAmount).toBe(0)
  })
})

describe('buildReport: cost, profit, margin and coverage', () => {
  it('computes cost from the value in force at each sale', () => {
    const index = history(
      { itemId: 'i1', cost: 400, effectiveFrom: at('2026-09-01T00:00:00') },
      { itemId: 'i1', cost: 600, effectiveFrom: at('2026-09-08T00:00:00') },
    )
    const report = buildReport({
      orders: [
        order({ id: 'a', createdAt: at('2026-09-05T10:00:00'), total: 1250 }),
        order({ id: 'b', number: 2, createdAt: at('2026-09-10T10:00:00'), total: 1250 }),
      ],
      voids: noVoids,
      history: index,
      currentCosts: noCosts,
    })
    // 400 for the earlier sale, 600 for the later one.
    expect(report.estimatedCost).toBe(1000)
    expect(report.revenue).toBe(2500)
    expect(report.estimatedProfit).toBe(1500)
    expect(report.marginPercent).toBe(60)
    expect(report.coverage.complete).toBe(true)
  })

  it('flags incomplete coverage when some lines have no known cost', () => {
    const report = buildReport({
      orders: [
        order({
          id: 'a',
          total: 2000,
          lines: [
            { menuItemId: 'i1', name: 'Known', unitPrice: 1000, quantity: 1 },
            { menuItemId: 'i2', name: 'Unknown', unitPrice: 1000, quantity: 1 },
          ],
        }),
      ],
      voids: noVoids,
      history: history(),
      currentCosts: new Map([['i1', 400]]),
    })

    expect(report.estimatedCost).toBe(400)
    // Profit is revenue minus a PARTIAL cost, so it is a ceiling, not a fact.
    expect(report.estimatedProfit).toBe(1600)
    expect(report.coverage.knownRevenue).toBe(1000)
    expect(report.coverage.totalRevenue).toBe(2000)
    expect(report.coverage.percent).toBe(50)
    expect(report.coverage.complete).toBe(false)
  })

  it('multiplies unit cost by quantity', () => {
    const report = buildReport({
      orders: [
        order({
          total: 3750,
          lines: [{ menuItemId: 'i1', name: 'Flat White', unitPrice: 1250, quantity: 3 }],
        }),
      ],
      voids: noVoids,
      history: history(),
      currentCosts: new Map([['i1', 400]]),
    })
    expect(report.estimatedCost).toBe(1200)
    expect(report.estimatedProfit).toBe(2550)
  })

  it('stays exact in sen on prices that break naive float maths', () => {
    const report = buildReport({
      orders: [
        order({
          total: 1150 * 3 + 235 * 7,
          lines: [
            { menuItemId: 'a', name: 'A', unitPrice: 1150, quantity: 3 },
            { menuItemId: 'b', name: 'B', unitPrice: 235, quantity: 7 },
          ],
        }),
      ],
      voids: noVoids,
      history: history(),
      currentCosts: new Map([
        ['a', 115],
        ['b', 23],
      ]),
    })
    expect(report.revenue).toBe(5095)
    expect(report.estimatedCost).toBe(506)
    expect(report.estimatedProfit).toBe(4589)
    expect(Number.isInteger(report.estimatedCost)).toBe(true)
  })
})

describe('buildReport: margin is suppressed when no cost is known', () => {
  it('reports margin as null, not 100%, for an item with no recorded cost', () => {
    // revenue - 0 is always exactly 100% margin: a flattering number carrying no
    // information. It must not be presented as a performance figure.
    const report = buildReport({
      orders: [
        order({
          total: 500,
          lines: [{ menuItemId: 'nocost', name: 'Muffin', unitPrice: 500, quantity: 1 }],
        }),
      ],
      voids: noVoids,
      history: history(),
      currentCosts: noCosts,
    })
    expect(report.items[0]?.marginPercent).toBeNull()
    expect(report.marginPercent).toBeNull()
    // The money figures are untouched: profit is still the documented upper bound.
    expect(report.revenue).toBe(500)
    expect(report.estimatedCost).toBe(0)
    expect(report.estimatedProfit).toBe(500)
    expect(report.coverage.percent).toBe(0)
    expect(report.coverage.complete).toBe(false)
  })

  it('still reports a margin under PARTIAL coverage, which is a real upper bound', () => {
    const report = buildReport({
      orders: [
        order({
          total: 2000,
          lines: [
            { menuItemId: 'known', name: 'Known', unitPrice: 1000, quantity: 1 },
            { menuItemId: 'nocost', name: 'Unknown', unitPrice: 1000, quantity: 1 },
          ],
        }),
      ],
      voids: noVoids,
      history: history(),
      currentCosts: new Map([['known', 400]]),
    })
    expect(report.marginPercent).toBeCloseTo(80, 5)
    expect(report.items.find((r) => r.menuItemId === 'known')?.marginPercent).toBeCloseTo(60, 5)
    expect(report.items.find((r) => r.menuItemId === 'nocost')?.marginPercent).toBeNull()
  })

  it('still reports margin normally when every cost is known', () => {
    const report = buildReport({
      orders: [
        order({
          total: 1000,
          lines: [{ menuItemId: 'k', name: 'K', unitPrice: 1000, quantity: 1 }],
        }),
      ],
      voids: noVoids,
      history: history(),
      currentCosts: new Map([['k', 250]]),
    })
    expect(report.marginPercent).toBeCloseTo(75, 5)
    expect(report.coverage.complete).toBe(true)
  })
})

describe('buildReport: item performance', () => {
  it('groups a renamed item into ONE row, keeping the most recent name', () => {
    const report = buildReport({
      orders: [
        order({
          id: 'a',
          createdAt: at('2026-09-05T10:00:00'),
          total: 690,
          lines: [{ menuItemId: 'i1', name: 'Croissant', unitPrice: 690, quantity: 1 }],
        }),
        order({
          id: 'b',
          number: 2,
          createdAt: at('2026-09-09T10:00:00'),
          total: 990,
          lines: [{ menuItemId: 'i1', name: 'Almond Croissant', unitPrice: 990, quantity: 1 }],
        }),
      ],
      voids: noVoids,
      history: history(),
      currentCosts: noCosts,
    })

    expect(report.items).toHaveLength(1)
    expect(report.items[0]?.name).toBe('Almond Croissant')
    expect(report.items[0]?.quantity).toBe(2)
    // Revenue uses each sale's snapshotted price, not the newest one.
    expect(report.items[0]?.revenue).toBe(1680)
  })

  it('sorts items by revenue, highest first', () => {
    const report = buildReport({
      orders: [
        order({
          total: 1690,
          lines: [
            { menuItemId: 'small', name: 'Small', unitPrice: 690, quantity: 1 },
            { menuItemId: 'big', name: 'Big', unitPrice: 1000, quantity: 1 },
          ],
        }),
      ],
      voids: noVoids,
      history: history(),
      currentCosts: noCosts,
    })
    expect(report.items.map((row) => row.menuItemId)).toEqual(['big', 'small'])
  })

  it('tracks coverage per item', () => {
    const report = buildReport({
      orders: [
        order({
          total: 2000,
          lines: [
            { menuItemId: 'i1', name: 'Known', unitPrice: 1000, quantity: 1 },
            { menuItemId: 'i2', name: 'Unknown', unitPrice: 1000, quantity: 1 },
          ],
        }),
      ],
      voids: noVoids,
      history: history(),
      currentCosts: new Map([['i1', 400]]),
    })
    const known = report.items.find((row) => row.menuItemId === 'i1')
    const unknown = report.items.find((row) => row.menuItemId === 'i2')
    expect(known?.coverage.complete).toBe(true)
    expect(unknown?.coverage.complete).toBe(false)
    expect(unknown?.estimatedCost).toBe(0)
  })
})

describe('buildReport: payment breakdown', () => {
  it('counts and totals each method over non-voided orders', () => {
    const report = buildReport({
      orders: [
        order({ id: 'a', total: 1000, paymentMethod: 'cash' }),
        order({ id: 'b', number: 2, total: 2000, paymentMethod: 'ewallet' }),
        order({ id: 'c', number: 3, total: 500, paymentMethod: 'cash' }),
      ],
      voids: noVoids,
      history: history(),
      currentCosts: noCosts,
    })
    const cash = report.payments.find((row) => row.method === 'cash')
    const ewallet = report.payments.find((row) => row.method === 'ewallet')
    expect(cash).toEqual({ method: 'cash', count: 2, amount: 1500 })
    expect(ewallet).toEqual({ method: 'ewallet', count: 1, amount: 2000 })
  })
})

describe('date ranges', () => {
  // A Thursday.
  const thursday = new Date(2026, 8, 10, 14, 30)

  it('resolves today and yesterday', () => {
    expect(rangeFor('today', thursday)).toEqual({ from: '2026-09-10', to: '2026-09-10' })
    expect(rangeFor('yesterday', thursday)).toEqual({ from: '2026-09-09', to: '2026-09-09' })
  })

  it('starts the week on Monday and runs to today', () => {
    expect(rangeFor('thisWeek', thursday)).toEqual({ from: '2026-09-07', to: '2026-09-10' })
  })

  it('treats Monday itself as the start of its own week', () => {
    const monday = new Date(2026, 8, 7)
    expect(rangeFor('thisWeek', monday)).toEqual({ from: '2026-09-07', to: '2026-09-07' })
  })

  it('keeps Sunday in the week that began the previous Monday', () => {
    const sunday = new Date(2026, 8, 13)
    expect(rangeFor('thisWeek', sunday)).toEqual({ from: '2026-09-07', to: '2026-09-13' })
  })

  it('runs this month from the first to today', () => {
    expect(rangeFor('thisMonth', thursday)).toEqual({ from: '2026-09-01', to: '2026-09-10' })
  })

  it('handles the first of the month and crossing a year boundary', () => {
    expect(rangeFor('thisMonth', new Date(2026, 0, 1))).toEqual({
      from: '2026-01-01',
      to: '2026-01-01',
    })
    expect(rangeFor('yesterday', new Date(2026, 0, 1))).toEqual({
      from: '2025-12-31',
      to: '2025-12-31',
    })
  })
})

describe('validateCustomRange', () => {
  it('accepts a sane range', () => {
    expect(validateCustomRange('2026-09-01', '2026-09-10')).toEqual({
      ok: true,
      range: { from: '2026-09-01', to: '2026-09-10' },
    })
  })

  it('accepts a single day', () => {
    expect(validateCustomRange('2026-09-01', '2026-09-01').ok).toBe(true)
  })

  it('rejects a start after the end', () => {
    const result = validateCustomRange('2026-09-10', '2026-09-01')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(say(result.error)).toMatch(/not be after/i)
  })

  it('rejects malformed and impossible dates', () => {
    expect(validateCustomRange('10/09/2026', '2026-09-10').ok).toBe(false)
    expect(validateCustomRange('2026-02-31', '2026-03-01').ok).toBe(false)
    expect(validateCustomRange('2026-13-01', '2026-13-02').ok).toBe(false)
    expect(validateCustomRange('', '2026-09-10').ok).toBe(false)
  })

  it('rejects a range longer than the cap', () => {
    const result = validateCustomRange('2025-01-01', '2026-09-10')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(say(result.error)).toMatch(new RegExp(`${MAX_RANGE_DAYS} days`))
  })
})

describe('csv', () => {
  it('leaves ordinary fields unquoted', () => {
    expect(escapeCsvField('Flat White')).toBe('Flat White')
    expect(escapeCsvField(1250)).toBe('1250')
  })

  it('quotes a field containing a comma', () => {
    expect(escapeCsvField('Croissant, almond')).toBe('"Croissant, almond"')
  })

  it('doubles embedded quotes', () => {
    expect(escapeCsvField('Ali\'s "Special"')).toBe('"Ali\'s ""Special"""')
  })

  it('quotes a field containing a newline', () => {
    expect(escapeCsvField('line one\nline two')).toBe('"line one\nline two"')
  })

  it('builds rows with CRLF separators', () => {
    const csv = toCsv([
      ['Item', 'Revenue'],
      ['Flat White', 1250],
    ])
    expect(csv).toBe('Item,Revenue\r\nFlat White,1250')
  })

  it('survives a hostile item name without shifting columns', () => {
    const csv = toCsv([['a,b', 'c"d', 'plain']])
    expect(csv).toBe('"a,b","c""d",plain')
  })
})

describe('buildReport and payment status', () => {
  const build = (orders: ReportOrder[]) =>
    buildReport({ orders, voids: noVoids, history: history(), currentCosts: noCosts })

  it('counts an unpaid order as revenue, exactly as a paid one', () => {
    // The decision this whole feature rests on: a sale is counted when it is rung up, not
    // when it is settled. Changing this would silently restate every past report.
    const paid = build([order({ id: 'a', total: 1000 })])
    const unpaid = build([unpaidOrder({ id: 'a', total: 1000 })])

    expect(unpaid.revenue).toBe(paid.revenue)
    expect(unpaid.orderCount).toBe(paid.orderCount)
    expect(unpaid.averageOrderValue).toBe(paid.averageOrderValue)
    expect(unpaid.estimatedCost).toBe(paid.estimatedCost)
    expect(unpaid.estimatedProfit).toBe(paid.estimatedProfit)
    expect(unpaid.marginPercent).toBe(paid.marginPercent)
  })

  it('separates what was collected from what is still owed', () => {
    const report = build([
      order({ id: 'a', total: 1000 }),
      order({ id: 'b', number: 2, total: 2000 }),
      unpaidOrder({ id: 'c', number: 3, total: 500 }),
    ])

    expect(report.revenue).toBe(3500)
    expect(report.orderCount).toBe(3)
    expect(report.paidOrderCount).toBe(2)
    expect(report.unpaidOrderCount).toBe(1)
    expect(report.collectedRevenue).toBe(3000)
    expect(report.outstandingRevenue).toBe(500)
  })

  it('always splits revenue exactly between collected and outstanding', () => {
    const report = build([
      order({ id: 'a', total: 1234 }),
      unpaidOrder({ id: 'b', number: 2, total: 4321 }),
      unpaidOrder({ id: 'c', number: 3, total: 7 }),
    ])

    expect(report.collectedRevenue + report.outstandingRevenue).toBe(report.revenue)
    expect(report.paidOrderCount + report.unpaidOrderCount).toBe(report.orderCount)
  })

  it('reports nothing collected when no order has been paid', () => {
    const report = build([
      unpaidOrder({ id: 'a', total: 1000 }),
      unpaidOrder({ id: 'b', number: 2, total: 2000 }),
    ])

    expect(report.collectedRevenue).toBe(0)
    expect(report.outstandingRevenue).toBe(3000)
    expect(report.paidOrderCount).toBe(0)
    expect(report.payments).toEqual([])
  })

  it('leaves unpaid orders out of the payment-method breakdown', () => {
    const report = build([
      order({ id: 'a', total: 1000, paymentMethod: 'cash' }),
      order({ id: 'b', number: 2, total: 2000, paymentMethod: 'ewallet' }),
      unpaidOrder({ id: 'c', number: 3, total: 9999 }),
    ])

    // The breakdown answers "how was money taken", so the unpaid RM 99.99 has no place in
    // it — and above all must not inflate either method's figure.
    expect(report.payments).toEqual([
      { method: 'ewallet', count: 1, amount: 2000 },
      { method: 'cash', count: 1, amount: 1000 },
    ])
    expect(report.payments.reduce((sum, row) => sum + row.amount, 0)).toBe(report.collectedRevenue)
  })

  it('never counts a voided order, paid or unpaid', () => {
    const voids = new Map<string, ReportVoidInfo>([
      ['b', { amount: 2000, reason: 'Wrong item', voidedByName: 'Ada Admin' }],
      ['c', { amount: 500, reason: 'Walked out', voidedByName: 'Ada Admin' }],
    ])
    const report = buildReport({
      orders: [
        order({ id: 'a', total: 1000 }),
        order({ id: 'b', number: 2, total: 2000 }),
        unpaidOrder({ id: 'c', number: 3, total: 500 }),
      ],
      voids,
      history: history(),
      currentCosts: noCosts,
    })

    // A voided unpaid order is not outstanding money: nobody owes it any more.
    expect(report.revenue).toBe(1000)
    expect(report.collectedRevenue).toBe(1000)
    expect(report.outstandingRevenue).toBe(0)
    expect(report.unpaidOrderCount).toBe(0)
    expect(report.voidedAmount).toBe(2500)
  })

  it('reports zeroes for an empty range without dividing by zero', () => {
    const report = build([])

    expect(report.paidOrderCount).toBe(0)
    expect(report.unpaidOrderCount).toBe(0)
    expect(report.collectedRevenue).toBe(0)
    expect(report.outstandingRevenue).toBe(0)
  })

  it('still resolves cost and margin for an unpaid order', () => {
    // Cost is a property of what was sold, not of whether it was paid for.
    const report = buildReport({
      orders: [unpaidOrder({ id: 'a', total: 1250 })],
      voids: noVoids,
      history: history({ itemId: 'i1', cost: 500, effectiveFrom: at('2026-09-01T00:00:00') }),
      currentCosts: noCosts,
    })

    expect(report.estimatedCost).toBe(500)
    expect(report.estimatedProfit).toBe(750)
    expect(report.marginPercent).toBeCloseTo(60)
    expect(report.coverage.complete).toBe(true)
  })
})
