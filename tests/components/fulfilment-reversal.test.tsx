// @vitest-environment jsdom
/**
 * Undoing a fulfilment step, on the one screen both roles can reach.
 *
 * The domain already modelled backward steps — `previousFulfillment`, `isBackwardStep` and the
 * timestamp tables all covered them — and `correctFulfillment` already wrote them, journalled,
 * with firestore.rules permitting a step back only for an admin. What was missing was any way
 * to ask for one: the page offered the forward button alone, so "Mark ready" was a one-way
 * door.
 *
 * These tests pin the seam that was added: who is offered the control, what it asks for, and
 * that the two buttons cannot race each other.
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

let role: 'admin' | 'staff' = 'admin'
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
let status: 'pending' | 'preparing' | 'ready' | 'delivered' = 'ready'

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
  role = 'admin'
  status = 'ready'
})

describe('stepping an order back', () => {
  it('3. reverses ready to preparing', async () => {
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

  it('4. reverses preparing to pending', async () => {
    status = 'preparing'
    const { user } = renderDetail()
    expect(back()?.getAttribute('data-previous')).toBe('pending')

    await user.click(back() as HTMLElement)

    const [, params] = correctFulfillment.mock.calls[0] as [string, Record<string, unknown>]
    expect(params.from).toBe('preparing')
    expect(params.to).toBe('pending')
  })

  it('reverses delivered to ready', async () => {
    status = 'delivered'
    const { user } = renderDetail()
    await user.click(back() as HTMLElement)

    const [, params] = correctFulfillment.mock.calls[0] as [string, Record<string, unknown>]
    expect(params.from).toBe('delivered')
    expect(params.to).toBe('ready')
  })

  it('offers nothing to undo at the first step', () => {
    status = 'pending'
    renderDetail()
    expect(back()).toBeNull()
    // The way forward is still there.
    expect(forward()).not.toBeNull()
  })

  it('offers the two kitchen steps to staff as well', () => {
    role = 'staff'
    status = 'ready'
    renderDetail()
    // The counter owns recovering from its own mis-tap; it does not need an admin mid-rush.
    expect(back()?.getAttribute('data-previous')).toBe('preparing')
    expect(forward()).not.toBeNull()
  })

  /**
   * The bug this page actually had.
   *
   * A delivered order offers no way forward — there is none — and no way back, because the
   * rules reserve corrections for an admin. Staff were therefore shown a screen with no
   * actions and no reason, which reads as the feature being broken rather than as a
   * permission: exactly how it was reported. Verified against live emulator data before the
   * fix, on a real delivered order, signed in as staff.
   */
  it('withholds only the delivered reopen from staff, and says why', () => {
    role = 'staff'
    status = 'delivered'
    renderDetail()

    // Reopening a handover is a correction to the record, not a step in the workflow.
    expect(back()).toBeNull()
    // Delivered is the end of the forward path, so this really is a screen with no actions —
    // which is exactly why it has to explain itself rather than simply ending.
    expect(forward()).toBeNull()
    expect(screen.getByTestId('reverse-admin-only')).toBeTruthy()
  })

  it('says nothing to staff on a step they CAN take', () => {
    role = 'staff'
    status = 'preparing'
    renderDetail()
    expect(back()?.getAttribute('data-previous')).toBe('pending')
    expect(screen.queryByTestId('reverse-admin-only')).toBeNull()
  })

  it('does not tell an admin that, because they have the button', () => {
    status = 'delivered'
    renderDetail()
    expect(back()).not.toBeNull()
    expect(screen.queryByTestId('reverse-admin-only')).toBeNull()
  })

  it('says nothing at the first step, where there is genuinely nothing to undo', () => {
    role = 'staff'
    status = 'pending'
    renderDetail()
    expect(screen.queryByTestId('reverse-admin-only')).toBeNull()
    // The way forward is still offered, so the screen is not empty.
    expect(forward()).not.toBeNull()
  })
})

describe('the forward steps are untouched', () => {
  it('1. pending to preparing', async () => {
    status = 'pending'
    const { user } = renderDetail()
    expect(forward()?.getAttribute('data-next')).toBe('preparing')

    await user.click(forward() as HTMLElement)
    const [, params] = setFulfillment.mock.calls[0] as [string, Record<string, unknown>]
    expect(params).toMatchObject({ from: 'pending', to: 'preparing' })
    expect(correctFulfillment).not.toHaveBeenCalled()
  })

  it('2. preparing to ready', async () => {
    status = 'preparing'
    const { user } = renderDetail()
    await user.click(forward() as HTMLElement)
    const [, params] = setFulfillment.mock.calls[0] as [string, Record<string, unknown>]
    expect(params).toMatchObject({ from: 'preparing', to: 'ready' })
  })

  it('ready to delivered', async () => {
    const { user } = renderDetail()
    await user.click(forward() as HTMLElement)
    const [, params] = setFulfillment.mock.calls[0] as [string, Record<string, unknown>]
    expect(params).toMatchObject({ from: 'ready', to: 'delivered' })
  })
})

describe('8. in-flight protection', () => {
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
