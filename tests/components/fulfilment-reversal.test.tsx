// @vitest-environment jsdom
/**
 * Who may work an order's fulfilment, on the one screen both roles can reach.
 *
 * The permission model this pins: the kitchen workflow is STAFF's, end to end. They take it
 * forward, they take back the two steps the kitchen owns, and nobody — staff or admin —
 * reopens a delivered order. An admin is a back-office account: it reads the receipt, takes
 * money and voids, but it does not move food through the kitchen, so this page offers it no
 * fulfilment control at any status.
 *
 * `delivered → ready` is gone entirely rather than moved to another role. A handover that
 * was wrong is corrected by VOIDING the sale — a counter-entry with a reason and an
 * authoriser — not by rewinding the record behind it.
 */
import { screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { renderComponent } from './render'

const setFulfillment = vi.hoisted(() => vi.fn())
const correctFulfillment = vi.hoisted(() => vi.fn())

vi.mock('@/features/pos/fulfillment-api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/pos/fulfillment-api')>()
  return { ...actual, setFulfillment, correctFulfillment }
})
vi.mock('@/features/pos/payment-api', () => ({ recordPayment: vi.fn() }))
vi.mock('@/features/pos/void-api', () => ({ voidOrder: vi.fn() }))

let role: 'admin' | 'staff' = 'staff'
vi.mock('@/features/auth/useAuth', () => ({
  useAuth: () => ({
    role,
    status: 'authenticated',
    profile: { uid: 'u1', displayName: 'Ana', email: 'a@b.c', role, active: true },
  }),
}))
vi.mock('@/features/staff/useStaffSession', () => ({
  useStaffSession: () => ({
    operator: { id: 's1', name: 'Alice', isSelf: false },
    operators: [],
    loading: false,
    select: () => {},
  }),
}))

const ORDER_ID = 'order-1'
const STATUSES = ['pending', 'preparing', 'ready', 'delivered'] as const
let status: (typeof STATUSES)[number] = 'ready'

vi.mock('@/features/pos/useOrderDetail', () => ({
  useOrderDetail: () => ({
    view: {
      order: {
        id: ORDER_ID,
        number: 7,
        businessDate: '2026-09-15',
        lines: [
          {
            menuItemId: 'm1',
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
        createdAt: { toDate: () => new Date('2026-09-15T02:00:00.000Z') },
        createdBy: 'u1',
        createdByName: 'Ana',
        staffId: 's1',
        staffName: 'Alice',
      },
      fulfillment: status,
      payment: { status: 'unpaid' },
      voided: null,
      overall: status === 'delivered' ? 'payment-outstanding' : status,
      fulfillmentRecord: null,
      paymentRecord: null,
    },
    loading: false,
    error: null,
  }),
}))

import { OrderDetailPage } from '@/features/pos/OrderDetailPage'

function renderDetail() {
  return renderComponent(
    <MemoryRouter initialEntries={[`/orders/${ORDER_ID}`]}>
      <Routes>
        <Route path="/orders/:orderId" element={<OrderDetailPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

const back = () => screen.queryByTestId('reverse-fulfillment')
const forward = () => screen.queryByTestId('advance-fulfillment')

beforeEach(() => {
  setFulfillment.mockReset()
  setFulfillment.mockResolvedValue(undefined)
  correctFulfillment.mockReset()
  correctFulfillment.mockResolvedValue(undefined)
  role = 'staff'
  status = 'ready'
})

describe('staff step an order back', () => {
  it('4. reverses ready to preparing', async () => {
    const { user } = renderDetail()
    expect(back()?.getAttribute('data-previous')).toBe('preparing')

    await user.click(back() as HTMLElement)

    expect(correctFulfillment).toHaveBeenCalledTimes(1)
    const [orderId, params] = correctFulfillment.mock.calls[0] as [string, Record<string, unknown>]
    expect(orderId).toBe(ORDER_ID)
    expect(params.from).toBe('ready')
    expect(params.to).toBe('preparing')
    // Never the forward writer, which the rules judge by a different clause.
    expect(setFulfillment).not.toHaveBeenCalled()
  })

  it('2. reverses preparing to pending', async () => {
    status = 'preparing'
    const { user } = renderDetail()
    expect(back()?.getAttribute('data-previous')).toBe('pending')

    await user.click(back() as HTMLElement)

    const [, params] = correctFulfillment.mock.calls[0] as [string, Record<string, unknown>]
    expect(params.from).toBe('preparing')
    expect(params.to).toBe('pending')
  })

  it('offers nothing to undo at the first step', () => {
    status = 'pending'
    renderDetail()
    expect(back()).toBeNull()
    // The way forward is still there.
    expect(forward()).not.toBeNull()
  })

  /**
   * 6. The handover is the end of the road.
   *
   * Staff took this order all the way through the kitchen and cannot take the last step
   * back — nor can anyone else. A delivered order with nothing left to press is the correct
   * reading of the screen, not a permission being withheld from this account: there is no
   * other account it is being held for. Correcting a delivered sale is a void.
   */
  it('gives staff no way to reopen a delivered order', () => {
    status = 'delivered'
    renderDetail()

    expect(back()).toBeNull()
    expect(forward()).toBeNull()
    // The line that used to point at an admin is gone: it would now be untrue.
    expect(screen.queryByTestId('reverse-admin-only')).toBeNull()
  })
})

describe('staff drive the order forward', () => {
  it('1. pending to preparing', async () => {
    status = 'pending'
    const { user } = renderDetail()
    expect(forward()?.getAttribute('data-next')).toBe('preparing')

    await user.click(forward() as HTMLElement)
    const [, params] = setFulfillment.mock.calls[0] as [string, Record<string, unknown>]
    expect(params).toMatchObject({ from: 'pending', to: 'preparing' })
    expect(correctFulfillment).not.toHaveBeenCalled()
  })

  it('3. preparing to ready', async () => {
    status = 'preparing'
    const { user } = renderDetail()
    await user.click(forward() as HTMLElement)
    const [, params] = setFulfillment.mock.calls[0] as [string, Record<string, unknown>]
    expect(params).toMatchObject({ from: 'preparing', to: 'ready' })
  })

  it('5. ready to delivered', async () => {
    const { user } = renderDetail()
    await user.click(forward() as HTMLElement)
    const [, params] = setFulfillment.mock.calls[0] as [string, Record<string, unknown>]
    expect(params).toMatchObject({ from: 'ready', to: 'delivered' })
  })
})

/**
 * 7, 8, 9. The admin half of the change.
 *
 * An admin reaches this page — Orders is on their navigation and the receipt is what they
 * read to answer a question about a sale — so the page has to keep working for them. What it
 * must not do is offer a single control that moves the food, at any status, in either
 * direction. firestore.rules refuses such a write from an admin account, so a button here
 * would be an offer of a refusal.
 */
describe('7, 8. an admin is offered no fulfilment control at all', () => {
  beforeEach(() => {
    role = 'admin'
  })

  it.each(STATUSES)('shows neither direction at %s', (current) => {
    status = current
    renderDetail()

    expect(forward()).toBeNull()
    expect(back()).toBeNull()
  })

  it('cannot reopen a delivered order, and is told nothing that suggests otherwise', () => {
    status = 'delivered'
    renderDetail()

    expect(back()).toBeNull()
    expect(screen.queryByTestId('reverse-admin-only')).toBeNull()
  })

  it('writes nothing through either fulfilment API', () => {
    status = 'preparing'
    renderDetail()

    expect(setFulfillment).not.toHaveBeenCalled()
    expect(correctFulfillment).not.toHaveBeenCalled()
  })
})

describe('9, 10. what an admin can still do here is untouched', () => {
  beforeEach(() => {
    role = 'admin'
    status = 'preparing'
  })

  it('reads the whole receipt — number, lines, total and status', () => {
    renderDetail()

    expect(screen.getByTestId('receipt-number')).toBeTruthy()
    expect(screen.getByTestId('receipt-total')).toBeTruthy()
    expect(screen.getByTestId('status-summary')).toBeTruthy()
    expect(screen.getByTestId('receipt-line')).toBeTruthy()
    expect(screen.getByTestId('receipt-operator')).toBeTruthy()
  })

  it('still sees the payment state, which is a separate axis from fulfilment', () => {
    renderDetail()
    // Unpaid, and the order is only being prepared: fulfilment says nothing about money.
    expect(screen.getByTestId('receipt-unpaid')).toBeTruthy()
    expect(screen.getByTestId('record-payment')).toBeTruthy()
  })

  it('still sees the elapsed timer, which is read from the order rather than the workflow', () => {
    renderDetail()
    expect(screen.getByTestId('order-elapsed')).toBeTruthy()
  })

  it('still sees the void control — correcting a sale is the admin path that remains', () => {
    renderDetail()
    expect(screen.getByTestId('void-order')).toBeTruthy()
  })
})

describe('in-flight protection', () => {
  it('disables BOTH directions while a move is in flight, so they cannot race', async () => {
    let release: () => void = () => {}
    correctFulfillment.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          release = resolve
        }),
    )

    const { user } = renderDetail()
    await user.click(back() as HTMLElement)

    // The same guard covers both buttons: they move the same order, and whichever landed
    // second would be refused for a `from` that no longer matched.
    expect((back() as HTMLButtonElement).disabled).toBe(true)
    expect((forward() as HTMLButtonElement).disabled).toBe(true)

    // A second click while it is in flight writes nothing further.
    await user.click(back() as HTMLElement)
    expect(correctFulfillment).toHaveBeenCalledTimes(1)

    release()
    await waitFor(() => expect((back() as HTMLButtonElement).disabled).toBe(false))
  })
})
