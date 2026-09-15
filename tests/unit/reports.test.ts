import { say } from '../say'
import { describe, expect, it } from 'vitest'

import {
  buildReport,
  indexCostHistory,
  resolveCostAtTime,
  indexModifierCostHistory,
  type CostHistoryEntry,
  type ModifierCostHistoryEntry,
  type ReportOrder,
  type ReportOrderLine,
  type ReportVoidInfo,
} from '@/features/reports/aggregate'
import { modifierCostKey } from '@/features/menu/modifier-cost'
import { escapeCsvField, toCsv } from '@/features/reports/csv'
import { MAX_RANGE_DAYS, rangeFor, validateCustomRange } from '@/features/reports/ranges'

const at = (iso: string) => new Date(iso)

/**
 * A plain line: no customisation, so its base IS what was charged.
 *
 * `basePrice` and `modifiers` are what `parseOrder` guarantees on every order document,
 * including ones written before customisation existed — those parse with the base defaulted
 * to the unit price and no options, which is exactly what this produces.
 */
const line = (
  menuItemId: string,
  name: string,
  unitPrice: number,
  quantity: number,
): ReportOrderLine => ({
  menuItemId,
  name,
  basePrice: unitPrice,
  unitPrice,
  modifiers: [],
  quantity,
})

/** One chosen option, priced as it was charged. */
const chose = (groupId: string, optionId: string, priceAdjustment: number) => ({
  groupId,
  optionId,
  priceAdjustment,
})

/**
 * A line with options on it: the base, the choices, and the unit price the till actually
 * charged — which is the base plus every adjustment, exactly as `unitPriceWith` computes it.
 */
const customised = (
  menuItemId: string,
  basePrice: number,
  modifiers: readonly { groupId: string; optionId: string; priceAdjustment: number }[],
  quantity = 1,
  name = 'Configured',
): ReportOrderLine => ({
  menuItemId,
  name,
  basePrice,
  unitPrice: basePrice + modifiers.reduce((sum, m) => sum + m.priceAdjustment, 0),
  modifiers,
  quantity,
})

const order = (over: Partial<ReportOrder> = {}): ReportOrder => ({
  id: 'o1',
  number: 1,
  businessDate: '2026-09-10',
  createdAt: at('2026-09-10T10:00:00'),
  lines: [line('i1', 'Flat White', 1250, 1)],
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
const modifierHistory = (...entries: ModifierCostHistoryEntry[]) =>
  indexModifierCostHistory(entries)
const noModifierCosts = new Map<string, number>()
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
          lines: [line('i2', 'Croissant', 690, 1)],
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
          lines: [line('i1', 'Known', 1000, 1), line('i2', 'Unknown', 1000, 1)],
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
          lines: [line('i1', 'Flat White', 1250, 3)],
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
          lines: [line('a', 'A', 1150, 3), line('b', 'B', 235, 7)],
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
          lines: [line('nocost', 'Muffin', 500, 1)],
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
          lines: [line('known', 'Known', 1000, 1), line('nocost', 'Unknown', 1000, 1)],
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
          lines: [line('k', 'K', 1000, 1)],
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

/**
 * Historical resolution, asked of a modifier option rather than a menu item.
 *
 * The same walk answers both — `resolveCostAtTime` takes an identity and knows nothing about
 * what kind of thing it names — so these cases exist to prove the option index is built with
 * the key the report actually looks up, not to re-test the algorithm.
 */
describe('resolveCostAtTime: modifier options', () => {
  const EGG = modifierCostKey('g1', 'opt-egg')

  it('uses a cost recorded before the order', () => {
    const index = modifierHistory({
      groupId: 'g1',
      optionId: 'opt-egg',
      cost: 40,
      effectiveFrom: at('2026-09-01T00:00:00'),
    })
    expect(resolveCostAtTime(EGG, at('2026-09-10T10:00:00'), index, noModifierCosts)).toBe(40)
  })

  it('leaves an older sale on the older cost when the option is repriced', () => {
    const index = modifierHistory(
      {
        groupId: 'g1',
        optionId: 'opt-egg',
        cost: 40,
        effectiveFrom: at('2026-09-01T00:00:00'),
      },
      {
        groupId: 'g1',
        optionId: 'opt-egg',
        cost: 60,
        effectiveFrom: at('2026-09-08T00:00:00'),
      },
    )
    // The sale that happened before the change keeps what it cost then...
    expect(resolveCostAtTime(EGG, at('2026-09-05T10:00:00'), index, noModifierCosts)).toBe(40)
    // ...and a later one gets the new figure.
    expect(resolveCostAtTime(EGG, at('2026-09-09T10:00:00'), index, noModifierCosts)).toBe(60)
  })

  it('treats a cleared cost as unknown from that moment, never falling back', () => {
    const index = modifierHistory(
      {
        groupId: 'g1',
        optionId: 'opt-egg',
        cost: 40,
        effectiveFrom: at('2026-09-01T00:00:00'),
      },
      {
        groupId: 'g1',
        optionId: 'opt-egg',
        cost: null,
        effectiveFrom: at('2026-09-08T00:00:00'),
      },
    )
    const current = new Map([[EGG, 99]])
    expect(resolveCostAtTime(EGG, at('2026-09-09T10:00:00'), index, current)).toBeNull()
    // Clearing is an event, not a gap: before it, the cost is still what it was.
    expect(resolveCostAtTime(EGG, at('2026-09-05T10:00:00'), index, current)).toBe(40)
  })

  it('falls back to the current cost when the option has no history at all', () => {
    expect(
      resolveCostAtTime(EGG, at('2026-09-10T10:00:00'), modifierHistory(), new Map([[EGG, 40]])),
    ).toBe(40)
  })

  it('is unknown when history exists but every entry is later than the order', () => {
    const index = modifierHistory({
      groupId: 'g1',
      optionId: 'opt-egg',
      cost: 40,
      effectiveFrom: at('2026-09-20T00:00:00'),
    })
    // A figure recorded afterwards is a guess about that sale, not a fact.
    expect(
      resolveCostAtTime(EGG, at('2026-09-10T10:00:00'), index, new Map([[EGG, 40]])),
    ).toBeNull()
  })

  it('is unknown when the order carries no timestamp', () => {
    const index = modifierHistory({
      groupId: 'g1',
      optionId: 'opt-egg',
      cost: 40,
      effectiveFrom: at('2026-09-01T00:00:00'),
    })
    expect(resolveCostAtTime(EGG, null, index, noModifierCosts)).toBeNull()
  })

  it('keys on group AND option, so the same option id in another group is a different cost', () => {
    const index = modifierHistory(
      { groupId: 'g1', optionId: 'opt-a', cost: 40, effectiveFrom: at('2026-09-01T00:00:00') },
      { groupId: 'g2', optionId: 'opt-a', cost: 250, effectiveFrom: at('2026-09-01T00:00:00') },
    )
    const when = at('2026-09-10T10:00:00')
    expect(resolveCostAtTime(modifierCostKey('g1', 'opt-a'), when, index, noModifierCosts)).toBe(40)
    expect(resolveCostAtTime(modifierCostKey('g2', 'opt-a'), when, index, noModifierCosts)).toBe(
      250,
    )
  })
})

/**
 * What a configured line costs: the item plus everything chosen with it.
 *
 * Revenue is NOT touched by any of this. A line's `unitPrice` has always included its
 * options' adjustments, so the money side of these reports is exactly what it was before
 * modifier costs existed — what changes is how much of that money is accounted for.
 */
describe('buildReport: modifier costs', () => {
  const EGG = modifierCostKey('g1', 'opt-egg')
  const CHICKEN = modifierCostKey('g1', 'opt-chicken')

  const withOptions = (
    modifiers: readonly { groupId: string; optionId: string; priceAdjustment: number }[],
    quantity = 1,
  ) => {
    const lines = [customised('i1', 600, modifiers, quantity)]
    return order({ lines, total: lines[0]!.unitPrice * quantity })
  }

  it('costs the item alone when the line has no options', () => {
    const report = buildReport({
      orders: [order({ total: 1250 })],
      voids: noVoids,
      history: history(),
      currentCosts: new Map([['i1', 500]]),
      modifierCurrentCosts: new Map([[EGG, 40]]),
    })
    // The egg is costed and sitting right there in the index; this line simply has none.
    expect(report.estimatedCost).toBe(500)
    expect(report.coverage.complete).toBe(true)
  })

  it('adds a single option to the item cost', () => {
    const report = buildReport({
      orders: [withOptions([chose('g1', 'opt-egg', 100)])],
      voids: noVoids,
      history: history(),
      currentCosts: new Map([['i1', 250]]),
      modifierCurrentCosts: new Map([[EGG, 40]]),
    })

    expect(report.revenue).toBe(700)
    expect(report.estimatedCost).toBe(290)
    expect(report.estimatedProfit).toBe(410)
    expect(report.coverage.complete).toBe(true)
  })

  /** The worked example: RM6.00 item, RM1.00 egg, RM3.00 chicken. */
  it('adds several options, and profit comes out at revenue less every component', () => {
    const report = buildReport({
      orders: [withOptions([chose('g1', 'opt-egg', 100), chose('g1', 'opt-chicken', 300)])],
      voids: noVoids,
      history: history(),
      currentCosts: new Map([['i1', 250]]),
      modifierCurrentCosts: new Map([
        [EGG, 40],
        [CHICKEN, 120],
      ]),
    })

    expect(report.revenue).toBe(1000)
    expect(report.estimatedCost).toBe(410)
    expect(report.estimatedProfit).toBe(590)
    expect(report.coverage.complete).toBe(true)
  })

  it('costs an option even when the ITEM has no cost recorded', () => {
    const report = buildReport({
      orders: [withOptions([chose('g1', 'opt-chicken', 300)])],
      voids: noVoids,
      history: history(),
      currentCosts: noCosts,
      modifierCurrentCosts: new Map([[CHICKEN, 120]]),
    })

    // Only the option is known, so only the option's cost and its own revenue are counted.
    expect(report.estimatedCost).toBe(120)
    expect(report.coverage.knownRevenue).toBe(300)
    expect(report.coverage.totalRevenue).toBe(900)
    expect(report.coverage.complete).toBe(false)
  })

  it('multiplies every component by the line quantity', () => {
    const report = buildReport({
      orders: [withOptions([chose('g1', 'opt-egg', 100), chose('g1', 'opt-chicken', 300)], 3)],
      voids: noVoids,
      history: history(),
      currentCosts: new Map([['i1', 250]]),
      modifierCurrentCosts: new Map([
        [EGG, 40],
        [CHICKEN, 120],
      ]),
    })

    // Three portions, each with an egg and a chicken.
    expect(report.revenue).toBe(3000)
    expect(report.estimatedCost).toBe(1230)
    expect(report.estimatedProfit).toBe(1770)
    expect(report.coverage.complete).toBe(true)
  })

  it('handles a free option that costs nothing — "No egg" is known, not unknown', () => {
    const report = buildReport({
      orders: [withOptions([chose('g1', 'opt-none', 0)])],
      voids: noVoids,
      history: history(),
      currentCosts: new Map([['i1', 250]]),
      modifierCurrentCosts: new Map([[modifierCostKey('g1', 'opt-none'), 0]]),
    })

    expect(report.estimatedCost).toBe(250)
    // Zero cost is a statement, so the line is fully accounted for.
    expect(report.coverage.complete).toBe(true)
  })

  it('leaves an uncosted option out of the cost, and out of known revenue', () => {
    const report = buildReport({
      orders: [withOptions([chose('g1', 'opt-chicken', 300)])],
      voids: noVoids,
      history: history(),
      currentCosts: new Map([['i1', 250]]),
      modifierCurrentCosts: noModifierCosts,
    })

    expect(report.estimatedCost).toBe(250)
    // Profit is a ceiling: the chicken really did cost something, and it is not in here.
    expect(report.estimatedProfit).toBe(650)
    expect(report.coverage.knownRevenue).toBe(600)
    expect(report.coverage.totalRevenue).toBe(900)
    expect(report.coverage.percent).toBeCloseTo(66.67)
    expect(report.coverage.complete).toBe(false)
  })

  it('counts the known options and not the unknown ones, on the same line', () => {
    const report = buildReport({
      orders: [withOptions([chose('g1', 'opt-egg', 100), chose('g1', 'opt-chicken', 300)])],
      voids: noVoids,
      history: history(),
      currentCosts: new Map([['i1', 250]]),
      modifierCurrentCosts: new Map([[EGG, 40]]),
    })

    // Item 250 + egg 40. The chicken contributes neither cost nor covered revenue.
    expect(report.estimatedCost).toBe(290)
    expect(report.coverage.knownRevenue).toBe(700)
    expect(report.coverage.totalRevenue).toBe(1000)
    expect(report.coverage.percent).toBe(70)
  })

  it('resolves each option against the cost in force when the order was rung up', () => {
    const report = buildReport({
      orders: [
        {
          ...withOptions([chose('g1', 'opt-egg', 100)]),
          id: 'a',
          createdAt: at('2026-09-05T10:00:00'),
        },
        {
          ...withOptions([chose('g1', 'opt-egg', 100)]),
          id: 'b',
          number: 2,
          createdAt: at('2026-09-10T10:00:00'),
        },
      ],
      voids: noVoids,
      history: history({ itemId: 'i1', cost: 250, effectiveFrom: at('2026-09-01T00:00:00') }),
      currentCosts: noCosts,
      modifierHistory: modifierHistory(
        { groupId: 'g1', optionId: 'opt-egg', cost: 40, effectiveFrom: at('2026-09-01T00:00:00') },
        { groupId: 'g1', optionId: 'opt-egg', cost: 90, effectiveFrom: at('2026-09-08T00:00:00') },
      ),
    })

    // 250+40 for the earlier sale, 250+90 for the later one. Repricing the egg today did not
    // reach back and rewrite what last week's order cost.
    expect(report.estimatedCost).toBe(630)
    expect(report.coverage.complete).toBe(true)
  })

  it('rolls option costs into the ITEM performance row rather than a row of their own', () => {
    const report = buildReport({
      orders: [withOptions([chose('g1', 'opt-chicken', 300)])],
      voids: noVoids,
      history: history(),
      currentCosts: new Map([['i1', 400]]),
      modifierCurrentCosts: new Map([[CHICKEN, 200]]),
    })

    expect(report.items).toHaveLength(1)
    const row = report.items[0]!
    expect(row.menuItemId).toBe('i1')
    expect(row.revenue).toBe(900)
    // The dish and the duck that went on it, on one line of the table.
    expect(row.estimatedCost).toBe(600)
    expect(row.estimatedProfit).toBe(300)
    expect(row.coverage.complete).toBe(true)
  })

  it('costs a legacy line — no base price, no options — exactly as it always did', () => {
    // What `parseOrder` produces for an order written before customisation existed.
    const report = buildReport({
      orders: [order({ lines: [line('i1', 'Flat White', 1250, 2)], total: 2500 })],
      voids: noVoids,
      history: history(),
      currentCosts: new Map([['i1', 500]]),
    })

    expect(report.estimatedCost).toBe(1000)
    expect(report.coverage.complete).toBe(true)
  })

  /**
   * The clamped line, which the split cannot describe honestly.
   *
   * `unitPriceWith` floors a unit price at zero, so a hand-written order whose negative
   * adjustments exceed its base charges less than its components add up to. Attributing
   * revenue component-wise would then mark more money as covered than the line took, so such
   * a line is costed all-or-nothing instead.
   */
  it('falls back to all-or-nothing when the components do not sum to what was charged', () => {
    const clamped = {
      menuItemId: 'i1',
      name: 'Odd',
      basePrice: 600,
      // Charged 0 after clamping, though the parts say -400.
      unitPrice: 0,
      modifiers: [chose('g1', 'opt-weird', -1000)],
      quantity: 1,
    }

    const everything = buildReport({
      orders: [order({ lines: [clamped], total: 0 })],
      voids: noVoids,
      history: history(),
      currentCosts: new Map([['i1', 250]]),
      modifierCurrentCosts: new Map([[modifierCostKey('g1', 'opt-weird'), 10]]),
    })
    // Every component known, so the whole line is costed and nothing exceeds its revenue.
    expect(everything.estimatedCost).toBe(260)
    expect(everything.coverage.knownRevenue).toBe(0)

    const partial = buildReport({
      orders: [order({ lines: [clamped], total: 0 })],
      voids: noVoids,
      history: history(),
      currentCosts: new Map([['i1', 250]]),
      modifierCurrentCosts: noModifierCosts,
    })
    // One component missing, so the line contributes nothing rather than a misleading share.
    expect(partial.estimatedCost).toBe(0)
    expect(partial.coverage.knownRevenue).toBe(0)
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
          lines: [line('i1', 'Croissant', 690, 1)],
        }),
        order({
          id: 'b',
          number: 2,
          createdAt: at('2026-09-09T10:00:00'),
          total: 990,
          lines: [line('i1', 'Almond Croissant', 990, 1)],
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
          lines: [line('small', 'Small', 690, 1), line('big', 'Big', 1000, 1)],
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
          lines: [line('i1', 'Known', 1000, 1), line('i2', 'Unknown', 1000, 1)],
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
