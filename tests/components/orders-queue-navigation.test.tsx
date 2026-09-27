// @vitest-environment jsdom
/**
 * Switching between Orders and the queue board shows the day at once.
 *
 * Both pages read the same day through `useOrdersWorkspace`, but each mounts its own copy, and
 * a copy that has just mounted has nothing: Firestore's first snapshot is always delivered
 * asynchronously, and the sidecar listeners cannot open until the orders have arrived. So every
 * switch drew the grey placeholder for two asynchronous hops even though the rows had been on
 * screen an instant before — measured in a browser at 10 of 10 Queue → Orders switches, a median
 * of 113 ms with the CPU throttled like a mid-range Android tablet.
 *
 * The page being left now hands its last complete result to the page being opened, for the
 * same date. These run the REAL workspace and the real pages through real navigation; only
 * the Firestore listeners are stood in for, and they start out unanswered on every mount,
 * exactly as the real ones do.
 */
import { act, screen } from '@testing-library/react'
import { useSyncExternalStore } from 'react'
import { Link, MemoryRouter, Route, Routes } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { Order } from '@/features/pos/types'

import { renderComponent } from './render'

const TODAY = '2026-09-28'

function orderOf(number: number): Order {
  return {
    id: `order-${number}`,
    number,
    businessDate: TODAY,
    lines: [
      {
        menuItemId: 'i1',
        name: 'Roti Canai',
        basePrice: 850,
        unitPrice: 850,
        modifiers: [],
        quantity: 1,
      },
    ],
    total: 850,
    orderType: 'takeaway',
    tableNumber: null,
    paymentMethod: null,
    cashTendered: null,
    changeGiven: null,
    createdAt: { toDate: () => new Date('2026-09-28T02:00:00.000Z') } as Order['createdAt'],
    createdBy: 'till-uid',
    createdByName: 'Counter Tablet',
    staffId: 'alice',
    staffName: 'Alice',
  }
}

/**
 * The listeners. `answered` says whether they have delivered; the test flips it off just
 * before a navigation so the page being opened starts unanswered, as a new subscription does.
 */
let answered = true
let orders: Order[] = [orderOf(2), orderOf(1)]
let version = 0
const listeners = new Set<() => void>()
function deliver(next?: Order[]) {
  act(() => {
    if (next) orders = next
    answered = true
    version += 1
    for (const listener of listeners) listener()
  })
}
const useVersion = () =>
  useSyncExternalStore(
    (listener: () => void) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => version,
  )

const NO_RECORDS = new Map()

vi.mock('@/features/pos/useOrders', () => ({
  useOrders: () => {
    // Subscribed so a delivery re-renders; `orders` itself only changes identity when the test
    // delivers new rows, as the real hook's list only changes with a snapshot.
    useVersion()
    return answered
      ? { orders, loading: false, error: null }
      : { orders: [], loading: true, error: null }
  },
}))
vi.mock('@/features/pos/useOrderPayments', () => ({
  useOrderPayments: () => ({ payments: NO_RECORDS, loading: !answered, error: null }),
}))
vi.mock('@/features/pos/useOrderVoids', () => ({
  useOrderVoids: () => ({ voids: NO_RECORDS, loading: !answered, error: null }),
}))
vi.mock('@/features/pos/useOrderFulfillments', () => ({
  useOrderFulfillments: () => ({ fulfillments: NO_RECORDS, loading: !answered, error: null }),
}))
vi.mock('@/features/auth/useAuth', () => ({
  useAuth: () => ({
    profile: { uid: 'till-uid', displayName: 'Counter Tablet', role: 'staff', active: true },
    status: 'authenticated',
    role: 'staff',
  }),
}))
vi.mock('@/features/staff/useStaffSession', () => ({
  useStaffSession: () => ({ operator: null, operators: [], loading: false, select: () => {} }),
}))
vi.mock('@/features/pos/useBusinessToday', () => ({
  useShownBusinessDate: () => ({ businessDate: TODAY, showDate: () => {} }),
}))
vi.mock('@/features/pos/BusinessDateBar', () => ({
  BusinessDateBar: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
}))
vi.mock('@/features/pos/fulfillment-api', () => ({
  setFulfillment: vi.fn(),
  correctFulfillment: vi.fn(),
}))

import { OrdersListPage } from '@/features/pos/OrdersListPage'
import { QueuePage } from '@/features/pos/QueuePage'

function renderApp(start: string) {
  return renderComponent(
    <MemoryRouter initialEntries={[start]}>
      <nav>
        <Link to="/orders">Orders</Link>
        <Link to="/queue">Queue</Link>
        <Link to="/pos">New Order</Link>
      </nav>
      <Routes>
        <Route path="/orders" element={<OrdersListPage />} />
        <Route path="/queue" element={<QueuePage />} />
        <Route path="/pos" element={<p>New Order</p>} />
      </Routes>
    </MemoryRouter>,
  )
}

const skeleton = () => document.querySelector('[data-slot="skeleton"]')
const orderRows = () => screen.queryAllByTestId('order-row').length
const queueCards = () => screen.queryAllByTestId('queue-card').length

/** A navigation whose new page's listeners have not answered yet. */
async function go(user: ReturnType<typeof renderApp>['user'], label: string) {
  answered = false
  await user.click(screen.getByRole('link', { name: label }))
}

beforeEach(() => {
  answered = true
  orders = [orderOf(2), orderOf(1)]
  version = 0
  listeners.clear()
})

describe('Queue → Orders', () => {
  it('shows the day’s orders at once, with no placeholder', async () => {
    const { user } = renderApp('/queue')
    expect(queueCards()).toBe(2)

    await go(user, 'Orders')

    expect(skeleton()).toBeNull()
    expect(orderRows()).toBe(2)
  })

  it('takes the live result the moment its own listeners answer', async () => {
    const { user } = renderApp('/queue')
    await go(user, 'Orders')

    deliver([orderOf(3), orderOf(2), orderOf(1)])

    expect(orderRows()).toBe(3)
    expect(skeleton()).toBeNull()
  })

  it('keeps working back and forth, many times', async () => {
    const { user } = renderApp('/queue')

    for (let round = 0; round < 5; round += 1) {
      await go(user, 'Orders')
      expect(skeleton()).toBeNull()
      expect(orderRows()).toBe(2)
      deliver()

      await go(user, 'Queue')
      expect(skeleton()).toBeNull()
      expect(queueCards()).toBe(2)
      deliver()
    }
  })
})

describe('Orders → Queue', () => {
  it('shows the board at once, with no placeholder', async () => {
    const { user } = renderApp('/orders')
    expect(orderRows()).toBe(2)

    await go(user, 'Queue')

    expect(skeleton()).toBeNull()
    expect(queueCards()).toBe(2)
  })
})

describe('a real first load still shows the placeholder', () => {
  it('when arriving from a screen that does not show the day', async () => {
    const { user } = renderApp('/pos')

    await go(user, 'Orders')

    expect(skeleton()).not.toBeNull()
    expect(orderRows()).toBe(0)
  })

  it('when coming back later — nothing stale is kept once both pages have been left', async () => {
    const { user } = renderApp('/queue')
    await go(user, 'New Order')
    deliver()

    await go(user, 'Orders')

    expect(skeleton()).not.toBeNull()
    deliver()
    expect(orderRows()).toBe(2)
  })
})
