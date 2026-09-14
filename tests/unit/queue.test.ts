import { describe, expect, it } from 'vitest'

import { FULFILLMENT_STATUSES, type FulfillmentStatus } from '@/features/pos/fulfillment'
import { buildOrderView, type OrderSidecars, type OrderView } from '@/features/pos/orders-view'
import {
  groupQueue,
  isQueued,
  itemCountOf,
  QUEUE_COLUMNS,
  queueActionFor,
} from '@/features/pos/queue'
import type { Order, OrderFulfillment, OrderPayment, OrderVoid } from '@/features/pos/types'

const order = (over: Partial<Order> = {}): Order => ({
  id: 'o1',
  number: 1,
  businessDate: '2026-09-12',
  lines: [
    {
      menuItemId: 'i1',
      name: 'Flat White',
      basePrice: 1595,
      unitPrice: 1595,
      modifiers: [],
      quantity: 2,
    },
  ],
  total: 3190,
  orderType: 'dine_in',
  tableNumber: '5',
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

const payment = (orderId: string): OrderPayment => ({
  orderId,
  method: 'ewallet',
  amount: 3190,
  cashTendered: null,
  changeGiven: null,
  paidAt: null,
  paidBy: 'till-uid',
  paidByName: 'Shared Till',
  paidByStaffId: 'alice',
  paidByStaffName: 'Alice',
})

const voided = (orderId: string): OrderVoid => ({
  orderId,
  reason: 'Customer left',
  amount: 3190,
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

/** An order at a given point on the progression, with no payment and no void. */
function at(status: FulfillmentStatus, over: Partial<Order> = {}): OrderView {
  const built = order(over)
  return buildOrderView(
    built,
    sidecars({
      fulfillments:
        status === 'pending' ? new Map() : new Map([[built.id, fulfillment(built.id, status)]]),
    }),
  )
}

describe('queue columns', () => {
  it('shows the three statuses that still have work in them, in workflow order', () => {
    expect(QUEUE_COLUMNS).toEqual(['pending', 'preparing', 'ready'])
  })

  it('leaves delivered off the board', () => {
    // The queue is what still needs doing; the Orders workspace keeps the delivered ones.
    expect(QUEUE_COLUMNS).not.toContain('delivered')
    expect(FULFILLMENT_STATUSES).toContain('delivered')
  })
})

describe('isQueued', () => {
  it('keeps orders that are pending, preparing or ready', () => {
    for (const status of QUEUE_COLUMNS) {
      expect(isQueued(at(status))).toBe(true)
    }
  })

  it('drops a delivered order', () => {
    expect(isQueued(at('delivered'))).toBe(false)
  })

  it('drops a voided order at every stage', () => {
    for (const status of QUEUE_COLUMNS) {
      const built = order()
      const view = buildOrderView(
        built,
        sidecars({
          fulfillments:
            status === 'pending' ? new Map() : new Map([[built.id, fulfillment(built.id, status)]]),
          voids: new Map([[built.id, voided(built.id)]]),
        }),
      )
      expect(isQueued(view)).toBe(false)
    }
  })

  it('drops a legacy order, which was handed over as it was rung up', () => {
    const legacy = order({ paymentMethod: 'cash', cashTendered: 5000, changeGiven: 1810 })
    const view = buildOrderView(legacy, sidecars())
    expect(view.fulfillment).toBe('delivered')
    expect(isQueued(view)).toBe(false)
  })

  it('keeps an unpaid order on the board — the kitchen still has to make it', () => {
    expect(isQueued(at('preparing'))).toBe(true)
  })
})

describe('groupQueue', () => {
  it('returns all three columns even when they are empty', () => {
    expect(groupQueue([]).map((group) => group.status)).toEqual(['pending', 'preparing', 'ready'])
    expect(groupQueue([]).every((group) => group.views.length === 0)).toBe(true)
  })

  it('files each order under its resolved status', () => {
    const groups = groupQueue([
      at('ready', { id: 'a', number: 3 }),
      at('pending', { id: 'b', number: 1 }),
      at('preparing', { id: 'c', number: 2 }),
      at('delivered', { id: 'd', number: 4 }),
    ])

    expect(groups[0]?.views.map((view) => view.order.id)).toEqual(['b'])
    expect(groups[1]?.views.map((view) => view.order.id)).toEqual(['c'])
    expect(groups[2]?.views.map((view) => view.order.id)).toEqual(['a'])
  })

  it('orders each column oldest first, which is the order they were rung up', () => {
    const groups = groupQueue([
      at('pending', { id: 'c', number: 9 }),
      at('pending', { id: 'a', number: 2 }),
      at('pending', { id: 'b', number: 5 }),
    ])
    expect(groups[0]?.views.map((view) => view.order.number)).toEqual([2, 5, 9])
  })

  it('excludes voided and delivered orders from every column', () => {
    const built = order({ id: 'v', number: 7 })
    const voidedView = buildOrderView(built, sidecars({ voids: new Map([['v', voided('v')]]) }))
    const groups = groupQueue([voidedView, at('delivered', { id: 'd', number: 8 })])
    expect(groups.every((group) => group.views.length === 0)).toBe(true)
  })
})

describe('queueActionFor', () => {
  it('offers exactly one step forward from each column', () => {
    expect(queueActionFor(at('pending'))).toEqual({
      next: 'preparing',
      labelKey: 'queue.startPreparing',
    })
    expect(queueActionFor(at('preparing'))).toEqual({ next: 'ready', labelKey: 'queue.markReady' })
    expect(queueActionFor(at('ready'))).toEqual({
      next: 'delivered',
      labelKey: 'queue.markDelivered',
    })
  })

  it('never offers a step that skips one', () => {
    // The button can only ever produce the next status, so a card cannot jump to delivered.
    for (const status of QUEUE_COLUMNS) {
      const action = queueActionFor(at(status))
      const index = FULFILLMENT_STATUSES.indexOf(status)
      expect(action?.next).toBe(FULFILLMENT_STATUSES[index + 1])
    }
  })

  it('offers nothing on a delivered order', () => {
    expect(queueActionFor(at('delivered'))).toBeNull()
  })

  it('offers nothing on a voided order, at any stage', () => {
    for (const status of [...QUEUE_COLUMNS, 'delivered' as const]) {
      const built = order()
      const view = buildOrderView(
        built,
        sidecars({
          fulfillments:
            status === 'pending' ? new Map() : new Map([[built.id, fulfillment(built.id, status)]]),
          voids: new Map([[built.id, voided(built.id)]]),
        }),
      )
      expect(queueActionFor(view)).toBeNull()
    }
  })

  it('offers the step regardless of whether the order has been paid', () => {
    // The two axes are independent: money arriving early or late changes nothing in the
    // kitchen.
    const built = order()
    const paid = buildOrderView(
      built,
      sidecars({ payments: new Map([[built.id, payment(built.id)]]) }),
    )
    expect(queueActionFor(paid)).toEqual({ next: 'preparing', labelKey: 'queue.startPreparing' })
  })
})

describe('itemCountOf', () => {
  it('counts units, not lines', () => {
    const view = at('pending', {
      lines: [
        {
          menuItemId: 'i1',
          name: 'Flat White',
          basePrice: 1595,
          unitPrice: 1595,
          modifiers: [],
          quantity: 2,
        },
        {
          menuItemId: 'i2',
          name: 'Croissant',
          basePrice: 850,
          unitPrice: 850,
          modifiers: [],
          quantity: 3,
        },
      ],
    })
    expect(itemCountOf(view)).toBe(5)
  })
})
