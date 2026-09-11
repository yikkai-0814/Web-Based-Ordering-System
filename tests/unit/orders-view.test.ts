import { describe, expect, it } from 'vitest'

import {
  buildOrderView,
  buildOrderViews,
  filterOrders,
  isOrderFilter,
  matchesFilter,
  matchesSearch,
  ORDER_FILTER_LABELS,
  ORDER_FILTERS,
  type OrderSidecars,
} from '@/features/pos/orders-view'
import type { Order, OrderFulfillment, OrderPayment, OrderVoid } from '@/features/pos/types'

const order = (over: Partial<Order> = {}): Order => ({
  id: 'o1',
  number: 1,
  businessDate: '2026-09-12',
  lines: [{ menuItemId: 'i1', name: 'Flat White', unitPrice: 1595, quantity: 2 }],
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

const payment = (orderId: string): OrderPayment => ({
  orderId,
  method: 'cash',
  amount: 3190,
  cashTendered: 5000,
  changeGiven: 1810,
  paidAt: null,
  paidBy: 'till-uid',
  paidByName: 'Shared Till',
  paidByStaffId: 'alice',
  paidByStaffName: 'Alice',
})

const fulfillment = (orderId: string, status: OrderFulfillment['status']): OrderFulfillment => ({
  orderId,
  status,
  updatedAt: null,
  updatedBy: 'till-uid',
  updatedByName: 'Shared Till',
  updatedByStaffId: 'bob',
  updatedByStaffName: 'Bob',
})

const voided = (orderId: string): OrderVoid => ({
  orderId,
  reason: 'Rung up twice',
  amount: 3190,
  voidedAt: null,
  voidedBy: 'admin-uid',
  voidedByName: 'Ada Admin',
})

const sidecars = (over: Partial<OrderSidecars> = {}): OrderSidecars => ({
  payments: new Map(),
  fulfillments: new Map(),
  voids: new Map(),
  ...over,
})

describe('buildOrderView', () => {
  it('resolves a fresh order as pending and unpaid', () => {
    const view = buildOrderView(order(), sidecars())
    expect(view.fulfillment).toBe('pending')
    expect(view.payment.status).toBe('unpaid')
    expect(view.voided).toBeNull()
    expect(view.overall).toBe('pending')
  })

  it('carries the sidecar records themselves, for operator attribution', () => {
    const view = buildOrderView(
      order(),
      sidecars({
        payments: new Map([['o1', payment('o1')]]),
        fulfillments: new Map([['o1', fulfillment('o1', 'preparing')]]),
      }),
    )
    // The row and the card name whoever took the money and whoever moved it last; dropping
    // these would silently fall back to the account name for every order.
    expect(view.paymentRecord?.paidByStaffName).toBe('Alice')
    expect(view.fulfillmentRecord?.updatedByStaffName).toBe('Bob')
  })

  it('reports an order that is delivered and paid as completed', () => {
    const view = buildOrderView(
      order(),
      sidecars({
        payments: new Map([['o1', payment('o1')]]),
        fulfillments: new Map([['o1', fulfillment('o1', 'delivered')]]),
      }),
    )
    expect(view.overall).toBe('completed')
  })

  it('reports a delivered but unpaid order as payment outstanding', () => {
    const view = buildOrderView(
      order(),
      sidecars({ fulfillments: new Map([['o1', fulfillment('o1', 'delivered')]]) }),
    )
    expect(view.overall).toBe('payment-outstanding')
  })

  it('reads a legacy order — payment inline, no sidecars — as delivered and paid', () => {
    // Sales rung up before payment and fulfilment were separate steps were handed over
    // across the counter in one motion. Treating them as pending would queue work nobody is
    // going to do, and as unpaid would misreport the takings.
    const view = buildOrderView(
      order({ paymentMethod: 'cash', cashTendered: 5000, changeGiven: 1810 }),
      sidecars(),
    )
    expect(view.fulfillment).toBe('delivered')
    expect(view.payment.status).toBe('paid')
    expect(view.overall).toBe('completed')
  })

  it('lets a void win over both axes', () => {
    const view = buildOrderView(
      order(),
      sidecars({
        payments: new Map([['o1', payment('o1')]]),
        fulfillments: new Map([['o1', fulfillment('o1', 'delivered')]]),
        voids: new Map([['o1', voided('o1')]]),
      }),
    )
    expect(view.overall).toBe('voided')
    expect(view.voided?.reason).toBe('Rung up twice')
  })

  it('builds one view per order, keyed by its own sidecars', () => {
    const views = buildOrderViews(
      [order({ id: 'o1', number: 1 }), order({ id: 'o2', number: 2 })],
      sidecars({ payments: new Map([['o2', payment('o2')]]) }),
    )
    expect(views).toHaveLength(2)
    expect(views[0]?.payment.status).toBe('unpaid')
    expect(views[1]?.payment.status).toBe('paid')
  })
})

describe('order filters', () => {
  it('offers exactly the ten operational questions, with All first', () => {
    expect(ORDER_FILTERS).toEqual([
      'all',
      'unpaid',
      'paid',
      'pending',
      'preparing',
      'ready',
      'delivered',
      'completed',
      'dine_in',
      'takeaway',
    ])
    for (const filter of ORDER_FILTERS) {
      expect(ORDER_FILTER_LABELS[filter]).toBeTruthy()
    }
  })

  it('recognises only those values', () => {
    expect(isOrderFilter('unpaid')).toBe(true)
    for (const value of ['', 'void', 'dine-in', 'PAID', undefined, null, 7]) {
      expect(isOrderFilter(value)).toBe(false)
    }
  })

  it('selects on the payment axis', () => {
    const unpaid = buildOrderView(order(), sidecars())
    const paid = buildOrderView(order(), sidecars({ payments: new Map([['o1', payment('o1')]]) }))

    expect(matchesFilter(unpaid, 'unpaid')).toBe(true)
    expect(matchesFilter(unpaid, 'paid')).toBe(false)
    expect(matchesFilter(paid, 'paid')).toBe(true)
    expect(matchesFilter(paid, 'unpaid')).toBe(false)
  })

  it('selects on the fulfilment axis, independently of payment', () => {
    // A paid order that is still being made is, to everyone involved, still being made.
    const view = buildOrderView(
      order(),
      sidecars({
        payments: new Map([['o1', payment('o1')]]),
        fulfillments: new Map([['o1', fulfillment('o1', 'preparing')]]),
      }),
    )
    expect(matchesFilter(view, 'preparing')).toBe(true)
    expect(matchesFilter(view, 'paid')).toBe(true)
    expect(matchesFilter(view, 'pending')).toBe(false)
    expect(matchesFilter(view, 'completed')).toBe(false)
  })

  it('treats a pending order as pending without any fulfilment record', () => {
    expect(matchesFilter(buildOrderView(order(), sidecars()), 'pending')).toBe(true)
  })

  it('requires both axes finished for completed', () => {
    const deliveredOnly = buildOrderView(
      order(),
      sidecars({ fulfillments: new Map([['o1', fulfillment('o1', 'delivered')]]) }),
    )
    const both = buildOrderView(
      order(),
      sidecars({
        payments: new Map([['o1', payment('o1')]]),
        fulfillments: new Map([['o1', fulfillment('o1', 'delivered')]]),
      }),
    )
    expect(matchesFilter(deliveredOnly, 'delivered')).toBe(true)
    expect(matchesFilter(deliveredOnly, 'completed')).toBe(false)
    expect(matchesFilter(both, 'completed')).toBe(true)
  })

  it('keeps delivered orders visible in the workspace', () => {
    // They leave the queue, but the record of them must not leave the list.
    const view = buildOrderView(
      order(),
      sidecars({ fulfillments: new Map([['o1', fulfillment('o1', 'delivered')]]) }),
    )
    expect(matchesFilter(view, 'all')).toBe(true)
    expect(matchesFilter(view, 'delivered')).toBe(true)
  })

  it('selects on order type, and leaves an untyped legacy order out of both', () => {
    const dineIn = buildOrderView(order(), sidecars())
    const takeaway = buildOrderView(order({ orderType: 'takeaway', tableNumber: null }), sidecars())
    const legacy = buildOrderView(order({ orderType: null, tableNumber: null }), sidecars())

    expect(matchesFilter(dineIn, 'dine_in')).toBe(true)
    expect(matchesFilter(dineIn, 'takeaway')).toBe(false)
    expect(matchesFilter(takeaway, 'takeaway')).toBe(true)
    // Guessing a type would invent history that never happened; All still shows it.
    expect(matchesFilter(legacy, 'dine_in')).toBe(false)
    expect(matchesFilter(legacy, 'takeaway')).toBe(false)
    expect(matchesFilter(legacy, 'all')).toBe(true)
  })

  it('shows a voided sale under All and under nothing else', () => {
    const view = buildOrderView(
      order(),
      sidecars({
        payments: new Map([['o1', payment('o1')]]),
        fulfillments: new Map([['o1', fulfillment('o1', 'delivered')]]),
        voids: new Map([['o1', voided('o1')]]),
      }),
    )
    expect(matchesFilter(view, 'all')).toBe(true)
    for (const filter of ORDER_FILTERS.filter((candidate) => candidate !== 'all')) {
      expect(matchesFilter(view, filter)).toBe(false)
    }
  })

  it('does not list a voided unpaid sale as money still owed', () => {
    const view = buildOrderView(order(), sidecars({ voids: new Map([['o1', voided('o1')]]) }))
    expect(matchesFilter(view, 'unpaid')).toBe(false)
  })
})

describe('search within the loaded date', () => {
  const view = buildOrderView(
    order({
      number: 12,
      tableNumber: 'A3',
      lines: [
        { menuItemId: 'i1', name: 'Flat White', unitPrice: 1595, quantity: 2 },
        { menuItemId: 'i2', name: 'Almond Croissant', unitPrice: 850, quantity: 1 },
      ],
    }),
    sidecars(),
  )

  it('matches everything when the term is blank', () => {
    for (const term of ['', '   ', '\t']) {
      expect(matchesSearch(view.order, term)).toBe(true)
    }
  })

  it('finds an order by its number, whole or partial', () => {
    expect(matchesSearch(view.order, '12')).toBe(true)
    expect(matchesSearch(view.order, '1')).toBe(true)
    expect(matchesSearch(view.order, '13')).toBe(false)
  })

  it('accepts a number written the way it appears on the docket', () => {
    expect(matchesSearch(view.order, '#12')).toBe(true)
    expect(matchesSearch(view.order, ' #12 ')).toBe(true)
  })

  it('finds an order by its table, ignoring case', () => {
    expect(matchesSearch(view.order, 'a3')).toBe(true)
    expect(matchesSearch(view.order, 'A3')).toBe(true)
    expect(matchesSearch(view.order, 'B3')).toBe(false)
  })

  it('finds an order by any item on it, ignoring case and matching partially', () => {
    expect(matchesSearch(view.order, 'flat')).toBe(true)
    expect(matchesSearch(view.order, 'CROISSANT')).toBe(true)
    expect(matchesSearch(view.order, 'latte')).toBe(false)
  })

  it('never matches a table on a takeaway, because there is none to match', () => {
    const takeaway = order({ orderType: 'takeaway', tableNumber: null, number: 40 })
    expect(matchesSearch(takeaway, 'a3')).toBe(false)
    expect(matchesSearch(takeaway, 'flat')).toBe(true)
  })
})

describe('filterOrders', () => {
  const views = buildOrderViews(
    [
      order({ id: 'o1', number: 1, tableNumber: '5' }),
      order({ id: 'o2', number: 2, orderType: 'takeaway', tableNumber: null }),
      order({
        id: 'o3',
        number: 3,
        lines: [{ menuItemId: 'i2', name: 'Iced Latte', unitPrice: 1200, quantity: 1 }],
      }),
    ],
    sidecars({
      payments: new Map([['o2', payment('o2')]]),
      fulfillments: new Map([['o3', fulfillment('o3', 'preparing')]]),
    }),
  )

  it('applies the filter and the search together', () => {
    expect(filterOrders(views, 'all', '').map((view) => view.order.id)).toEqual(['o1', 'o2', 'o3'])
    expect(filterOrders(views, 'unpaid', '').map((view) => view.order.id)).toEqual(['o1', 'o3'])
    expect(filterOrders(views, 'unpaid', 'iced').map((view) => view.order.id)).toEqual(['o3'])
    expect(filterOrders(views, 'paid', 'iced')).toEqual([])
  })

  it('preserves the order it was given, newest first', () => {
    const newestFirst = [...views].reverse()
    expect(filterOrders(newestFirst, 'all', '').map((view) => view.order.number)).toEqual([3, 2, 1])
  })
})
