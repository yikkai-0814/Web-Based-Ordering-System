import { describe, expect, it } from 'vitest'

import {
  chunkOrderIds,
  SIDECAR_QUERY_LIMIT,
  type ChunkableOrder,
} from '@/features/pos/order-sidecars'
import { businessDateOf, msUntilNextBusinessDate, shiftBusinessDate } from '@/features/pos/types'

const day = (count: number, from = 1): ChunkableOrder[] =>
  Array.from({ length: count }, (_, index) => ({
    id: `order-${from + index}`,
    number: from + index,
  }))

describe('chunkOrderIds', () => {
  it('stays inside the limit Firestore puts on an `in` filter', () => {
    expect(SIDECAR_QUERY_LIMIT).toBe(30)
    for (const chunk of chunkOrderIds(day(95))) {
      expect(chunk.length).toBeLessThanOrEqual(SIDECAR_QUERY_LIMIT)
    }
  })

  it('opens no listeners at all when there are no orders', () => {
    // An empty chunk list must mean "ask for nothing", never "ask for everything".
    expect(chunkOrderIds([])).toEqual([])
  })

  it('puts a small day in a single chunk', () => {
    expect(chunkOrderIds(day(4))).toEqual([['order-1', 'order-2', 'order-3', 'order-4']])
  })

  it('cuts on the order number, so each chunk freezes once it is full', () => {
    const chunks = chunkOrderIds(day(65))
    expect(chunks).toHaveLength(3)
    expect(chunks[0]).toHaveLength(30)
    expect(chunks[1]).toHaveLength(30)
    expect(chunks[2]).toHaveLength(5)
    expect(chunks[0]?.[0]).toBe('order-1')
    expect(chunks[1]?.[0]).toBe('order-31')
    expect(chunks[2]?.[0]).toBe('order-61')
  })

  it('leaves every filled chunk untouched as the day goes on', () => {
    // This is the whole reason for cutting on the number: a sale being rung up must not
    // resubscribe every listener on the busiest screen in the café.
    const before = chunkOrderIds(day(45))
    const after = chunkOrderIds(day(46))

    expect(after[0]).toEqual(before[0])
    expect(after[1]).toEqual([...(before[1] ?? []), 'order-46'])
  })

  it('does not care what order the orders arrive in', () => {
    const ascending = chunkOrderIds(day(40))
    const shuffled = chunkOrderIds([...day(40)].reverse())
    expect(shuffled).toEqual(ascending)
  })

  it('honours a smaller chunk size, so the behaviour is testable at any scale', () => {
    expect(chunkOrderIds(day(5), 2)).toEqual([
      ['order-1', 'order-2'],
      ['order-3', 'order-4'],
      ['order-5'],
    ])
  })

  it('refuses a chunk size that could never form a query', () => {
    expect(() => chunkOrderIds(day(3), 0)).toThrow()
  })

  it('splits a bucket that somehow holds more ids than the limit', () => {
    // Duplicate numbers should be impossible — the counter transaction hands out each one
    // exactly once — but a query that exceeded the limit would fail outright, so the split
    // is guarded rather than assumed.
    const duplicates: ChunkableOrder[] = Array.from({ length: 5 }, (_, index) => ({
      id: `dup-${index}`,
      number: 1,
    }))
    for (const chunk of chunkOrderIds(duplicates, 2)) {
      expect(chunk.length).toBeLessThanOrEqual(2)
    }
    expect(chunkOrderIds(duplicates, 2).flat()).toHaveLength(5)
  })

  it('never loses or duplicates an order', () => {
    const orders = day(97)
    const flattened = chunkOrderIds(orders).flat()
    expect(flattened).toHaveLength(orders.length)
    expect(new Set(flattened).size).toBe(orders.length)
  })

  /**
   * Reports fetch their sidecars the same way the workspace does, but over a date RANGE,
   * and order numbers restart at 1 each business date. So the same number arrives many
   * times, which puts far more than 30 orders in one number bucket.
   *
   * The stability guarantee does not survive that, and does not need to: it exists to keep
   * live listeners attached, and reports use one-shot reads. What must survive is the hard
   * limit, because a chunk of 31 is a query Firestore refuses outright.
   */
  const range = (days: number, perDay: number): ChunkableOrder[] =>
    Array.from({ length: days }, (_, dayIndex) =>
      day(perDay).map((order) => ({ ...order, id: `d${dayIndex}-${order.id}` })),
    ).flat()

  it('keeps every chunk inside the limit when order numbers repeat across days', () => {
    const orders = range(14, 40)
    const chunks = chunkOrderIds(orders)

    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(SIDECAR_QUERY_LIMIT)
      expect(chunk.length).toBeGreaterThan(0)
    }
  })

  it('still loses nothing across a multi-day range', () => {
    const orders = range(14, 40)
    const flattened = chunkOrderIds(orders).flat()

    expect(flattened).toHaveLength(orders.length)
    expect(new Set(flattened).size).toBe(orders.length)
    expect(new Set(flattened)).toEqual(new Set(orders.map((order) => order.id)))
  })
})

describe('shiftBusinessDate', () => {
  it('steps a day in each direction', () => {
    expect(shiftBusinessDate('2026-09-12', -1)).toBe('2026-09-11')
    expect(shiftBusinessDate('2026-09-12', 1)).toBe('2026-09-13')
    expect(shiftBusinessDate('2026-09-12', 0)).toBe('2026-09-12')
  })

  it('crosses month and year boundaries', () => {
    expect(shiftBusinessDate('2026-09-01', -1)).toBe('2026-08-31')
    expect(shiftBusinessDate('2026-12-31', 1)).toBe('2027-01-01')
    expect(shiftBusinessDate('2026-01-01', -1)).toBe('2025-12-31')
  })

  it('gets a leap year right', () => {
    expect(shiftBusinessDate('2028-02-28', 1)).toBe('2028-02-29')
    expect(shiftBusinessDate('2028-03-01', -1)).toBe('2028-02-29')
    expect(shiftBusinessDate('2027-02-28', 1)).toBe('2027-03-01')
  })

  it('agrees with businessDateOf, so it cannot land on a day the till never files under', () => {
    // Both build a local date. Parsing "2026-09-12" with new Date() would read it as UTC and
    // could step onto the wrong day west of Greenwich.
    const local = new Date(2026, 8, 12)
    expect(shiftBusinessDate(businessDateOf(local), 1)).toBe(businessDateOf(new Date(2026, 8, 13)))
  })

  it('returns an unusable input unchanged rather than throwing', () => {
    for (const value of ['', 'today', '2026-09', 'x-y-z']) {
      expect(shiftBusinessDate(value, 1)).toBe(value)
    }
  })
})

/**
 * Phase 14. How long until `businessDateOf` answers differently.
 *
 * The screens that show "today" arm a timer with this, so being wrong here means a till
 * that misses the rollover — the kitchen board showing yesterday while the counter files
 * sales under the new day.
 *
 * Local time throughout, deliberately: the whole point is when the LOCAL date changes, and
 * these assertions therefore hold in any timezone the machine happens to be set to.
 */
describe('msUntilNextBusinessDate', () => {
  const HOUR = 60 * 60 * 1000
  const DAY = 24 * HOUR

  /** Local midnight at the start of the given day. */
  const midnight = (year: number, month: number, day: number) =>
    new Date(year, month - 1, day, 0, 0, 0, 0)

  it('is a whole day at the very start of one', () => {
    // Except where the clocks change, which the next test covers.
    expect(msUntilNextBusinessDate(midnight(2026, 9, 12))).toBeLessThanOrEqual(25 * HOUR)
    expect(msUntilNextBusinessDate(midnight(2026, 9, 12))).toBeGreaterThanOrEqual(23 * HOUR)
  })

  it('is one millisecond at one millisecond before midnight', () => {
    const almost = new Date(2026, 8, 12, 23, 59, 59, 999)
    expect(msUntilNextBusinessDate(almost)).toBe(1)
  })

  it('counts down across the day', () => {
    const morning = new Date(2026, 8, 12, 9, 0, 0, 0)
    const evening = new Date(2026, 8, 12, 21, 0, 0, 0)
    expect(msUntilNextBusinessDate(morning)).toBeGreaterThan(msUntilNextBusinessDate(evening))
  })

  it('always lands exactly on a date change, never before or after', () => {
    // The contract the timer depends on: wait this long, and businessDateOf has moved on —
    // wait a millisecond less, and it has not.
    for (const at of [
      new Date(2026, 8, 12, 0, 0, 0, 0),
      new Date(2026, 8, 12, 13, 37, 42, 123),
      new Date(2026, 8, 12, 23, 59, 59, 999),
      new Date(2026, 11, 31, 22, 0, 0, 0),
      new Date(2028, 1, 28, 18, 30, 0, 0),
    ]) {
      const today = businessDateOf(at)
      const atBoundary = new Date(at.getTime() + msUntilNextBusinessDate(at))
      const justBefore = new Date(atBoundary.getTime() - 1)

      expect(businessDateOf(atBoundary)).not.toBe(today)
      expect(businessDateOf(justBefore)).toBe(today)
    }
  })

  it('steps onto the next calendar day across a month end, a year end and a leap day', () => {
    const cases: [Date, string][] = [
      [new Date(2026, 8, 30, 23, 0, 0, 0), '2026-10-01'],
      [new Date(2026, 11, 31, 23, 0, 0, 0), '2027-01-01'],
      [new Date(2028, 1, 28, 23, 0, 0, 0), '2028-02-29'],
      [new Date(2028, 1, 29, 23, 0, 0, 0), '2028-03-01'],
    ]
    for (const [at, expected] of cases) {
      const next = new Date(at.getTime() + msUntilNextBusinessDate(at))
      expect(businessDateOf(next)).toBe(expected)
    }
  })

  it('is never zero, negative, or long enough to sleep through a day', () => {
    // A non-positive answer would spin the timer; more than 25 hours would sleep past a
    // rollover. 25 rather than 24 because a clocks-back day really is 25 hours long.
    for (let hour = 0; hour < 24; hour += 1) {
      for (const minute of [0, 30, 59]) {
        const gap = msUntilNextBusinessDate(new Date(2026, 8, 12, hour, minute, 0, 0))
        expect(gap).toBeGreaterThan(0)
        expect(gap).toBeLessThanOrEqual(25 * HOUR)
      }
    }
  })

  it('never exceeds a day plus the widest clock change', () => {
    expect(msUntilNextBusinessDate(new Date(2026, 8, 12, 0, 0, 0, 0))).toBeLessThanOrEqual(
      DAY + HOUR,
    )
  })
})
