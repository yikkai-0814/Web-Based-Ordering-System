import { describe, expect, it } from 'vitest'

import {
  chunkOrderIds,
  SIDECAR_QUERY_LIMIT,
  type ChunkableOrder,
} from '@/features/pos/order-sidecars'
import { businessDateOf, shiftBusinessDate } from '@/features/pos/types'

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
