import { describe, expect, it } from 'vitest'

import { buildDashboard } from '@/features/dashboard/summary'
import type { FulfillmentStatus } from '@/features/pos/fulfillment'
import { buildOrderView, type OrderSidecars, type OrderView } from '@/features/pos/orders-view'
import { groupQueue, QUEUE_COLUMNS } from '@/features/pos/queue'
import type { Order, OrderFulfillment, OrderPayment, OrderVoid } from '@/features/pos/types'

/**
 * Rows are built through `buildOrderView`, the same function the Orders list and the Queue
 * board build theirs with, rather than hand-written OrderView literals. A dashboard that
 * agreed with a fixture but not with the screens either side of it would be worse than
 * useless, so the resolution path is part of what is under test.
 */

const order = (over: Partial<Order> = {}): Order => ({
  id: 'o1',
  number: 1,
  businessDate: '2026-09-12',
  lines: [
    {
      menuItemId: 'i1',
      name: 'Flat White',
      basePrice: 1250,
      unitPrice: 1250,
      modifiers: [],
      quantity: 1,
    },
  ],
  total: 1250,
  orderType: 'takeaway',
  tableNumber: null,
  paymentMethod: null,
  cashTendered: null,
  changeGiven: null,
  createdAt: null,
  createdBy: 'till-uid',
  createdByName: 'Shared Till',
  staffId: 'alice',
  staffName: 'Alice',
  ...over,
})

const fulfillment = (orderId: string, status: FulfillmentStatus): OrderFulfillment => ({
  orderId,
  status,
  updatedAt: null,
  updatedBy: 'till-uid',
  updatedByName: 'Shared Till',
  updatedByStaffId: 'bob',
  updatedByStaffName: 'Bob',
  readyAt: null,
  deliveredAt: null,
})

const payment = (orderId: string, amount: number): OrderPayment => ({
  orderId,
  method: 'ewallet',
  amount,
  cashTendered: null,
  changeGiven: null,
  paidAt: null,
  paidBy: 'till-uid',
  paidByName: 'Shared Till',
  paidByStaffId: 'alice',
  paidByStaffName: 'Alice',
})

const voided = (orderId: string, amount: number): OrderVoid => ({
  orderId,
  reason: 'Customer left',
  amount,
  voidedAt: null,
  voidedBy: 'admin-uid',
  voidedByName: 'Ada Admin',
  initiatedByStaffId: 'alice',
  initiatedByStaffName: 'Alice',
})

const sidecars = (over: Partial<OrderSidecars> = {}): OrderSidecars => ({
  payments: new Map(),
  fulfillments: new Map(),
  voids: new Map(),
  ...over,
})

const view = (o: Order, s: OrderSidecars = sidecars()): OrderView => buildOrderView(o, s)

describe('buildDashboard counts', () => {
  it('counts the day’s orders and leaves voided sales out of the total', () => {
    const kept = order({ id: 'o1', number: 1 })
    const cancelled = order({ id: 'o2', number: 2 })

    const summary = buildDashboard(
      [view(kept), view(cancelled, sidecars({ voids: new Map([['o2', voided('o2', 1250)]]) }))],
      'staff',
    )

    expect(summary.orderCount).toBe(1)
    expect(summary.voidedCount).toBe(1)
  })

  it('counts unpaid orders, and never counts a voided sale as unpaid', () => {
    // A cancelled sale is not money owed. Listing it would send somebody chasing a customer
    // for an order that no longer exists.
    const unpaid = order({ id: 'o1', number: 1 })
    const paid = order({ id: 'o2', number: 2 })
    const cancelledAndUnpaid = order({ id: 'o3', number: 3 })

    const summary = buildDashboard(
      [
        view(unpaid),
        view(paid, sidecars({ payments: new Map([['o2', payment('o2', 1250)]]) })),
        view(cancelledAndUnpaid, sidecars({ voids: new Map([['o3', voided('o3', 1250)]]) })),
      ],
      'staff',
    )

    expect(summary.orderCount).toBe(2)
    expect(summary.unpaidCount).toBe(1)
    expect(summary.voidedCount).toBe(1)
  })

  it('is all zeroes for a day with no orders', () => {
    const summary = buildDashboard([], 'admin')

    expect(summary.orderCount).toBe(0)
    expect(summary.unpaidCount).toBe(0)
    expect(summary.voidedCount).toBe(0)
    expect(summary.queue).toEqual({ pending: 0, preparing: 0, ready: 0 })
    expect(summary.finance).toEqual({ revenue: 0, collected: 0, outstanding: 0 })
  })
})

describe('buildDashboard queue depth', () => {
  const rows = (): OrderView[] => [
    // No fulfilment record at all: pending is the ABSENCE of the document.
    view(order({ id: 'o1', number: 1 })),
    view(order({ id: 'o2', number: 2 })),
    view(
      order({ id: 'o3', number: 3 }),
      sidecars({ fulfillments: new Map([['o3', fulfillment('o3', 'preparing')]]) }),
    ),
    view(
      order({ id: 'o4', number: 4 }),
      sidecars({ fulfillments: new Map([['o4', fulfillment('o4', 'ready')]]) }),
    ),
    // Delivered leaves the board.
    view(
      order({ id: 'o5', number: 5 }),
      sidecars({ fulfillments: new Map([['o5', fulfillment('o5', 'delivered')]]) }),
    ),
    // Voided leaves the board too, even though it is only pending.
    view(
      order({ id: 'o6', number: 6 }),
      sidecars({ voids: new Map([['o6', voided('o6', 1250)]]) }),
    ),
  ]

  it('counts each column, excluding delivered and voided orders', () => {
    const summary = buildDashboard(rows(), 'staff')

    expect(summary.queue).toEqual({ pending: 2, preparing: 1, ready: 1 })
  })

  it('agrees exactly with the kitchen board on the same rows', () => {
    // The point of the whole design: one source for membership, so the dashboard cannot
    // report a queue depth the board does not show.
    const summary = buildDashboard(rows(), 'staff')
    const board = groupQueue(rows())

    for (const column of QUEUE_COLUMNS) {
      const group = board.find((candidate) => candidate.status === column)
      expect(summary.queue[column]).toBe(group?.views.length)
    }
  })
})

describe('buildDashboard role visibility', () => {
  const rows = (): OrderView[] => [
    view(order({ id: 'o1', number: 1, total: 1250 })),
    view(
      order({ id: 'o2', number: 2, total: 800 }),
      sidecars({ payments: new Map([['o2', payment('o2', 800)]]) }),
    ),
  ]

  it('gives an admin revenue, collected and outstanding, and they reconcile', () => {
    const summary = buildDashboard(rows(), 'admin')

    expect(summary.finance).toEqual({ revenue: 2050, collected: 800, outstanding: 1250 })
    // Stated separately because it is the invariant, not just these numbers.
    expect(summary.finance!.collected + summary.finance!.outstanding).toBe(summary.finance!.revenue)
  })

  it('gives a staff member NO financial figures at all', () => {
    const summary = buildDashboard(rows(), 'staff')

    // Null rather than zeroed fields: absent from the data, so no component can render it.
    expect(summary.finance).toBeNull()
  })

  it('gives a staff member the same operational counts as an admin', () => {
    const asStaff = buildDashboard(rows(), 'staff')
    const asAdmin = buildDashboard(rows(), 'admin')

    expect(asStaff.orderCount).toBe(asAdmin.orderCount)
    expect(asStaff.unpaidCount).toBe(asAdmin.unpaidCount)
    expect(asStaff.queue).toEqual(asAdmin.queue)
  })

  it('excludes voided sales from revenue as well as from the order count', () => {
    const summary = buildDashboard(
      [
        view(order({ id: 'o1', number: 1, total: 1250 })),
        view(
          order({ id: 'o2', number: 2, total: 9900 }),
          sidecars({ voids: new Map([['o2', voided('o2', 9900)]]) }),
        ),
      ],
      'admin',
    )

    expect(summary.finance).toEqual({ revenue: 1250, collected: 0, outstanding: 1250 })
  })
})

describe('buildDashboard legacy orders', () => {
  it('reads an order with inline payment as paid, and counts it as collected', () => {
    // Sales rung up before payment became a separate step carry the method on the order
    // itself and always meant "paid". `resolvePaymentState` says so, and the dashboard
    // inherits that rather than deciding it again.
    const legacy = order({
      id: 'o1',
      number: 1,
      total: 1500,
      paymentMethod: 'cash',
      cashTendered: 2000,
      changeGiven: 500,
    })

    const summary = buildDashboard([view(legacy)], 'admin')

    expect(summary.unpaidCount).toBe(0)
    expect(summary.finance).toEqual({ revenue: 1500, collected: 1500, outstanding: 0 })
  })

  it('keeps a legacy order off the queue, because it reads as delivered', () => {
    // Sales rung up and handed over in one motion were delivered. Showing every historical
    // order as pending would bury the board under work nobody is going to do.
    const legacy = order({ id: 'o1', number: 1, paymentMethod: 'cash' })

    const summary = buildDashboard([view(legacy)], 'staff')

    expect(summary.queue).toEqual({ pending: 0, preparing: 0, ready: 0 })
    expect(summary.orderCount).toBe(1)
  })

  it('reads an order with no fulfilment record as pending', () => {
    const summary = buildDashboard([view(order({ id: 'o1', number: 1 }))], 'staff')

    expect(summary.queue.pending).toBe(1)
  })
})
