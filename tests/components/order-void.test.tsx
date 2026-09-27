// @vitest-environment jsdom
/**
 * Voiding from an order's own page — the handler between the dialog and the write.
 *
 * This is the layer the admin's void broke in. The rules and `voidOrder` were right all along
 * and their suites passed; but the page refused to void anything until a till operator had
 * been selected, and an admin never has one — the operator picker lives on the staff-only
 * till. So an admin pressed Void, the dialog closed as if it had worked, and nothing was
 * written. Every other suite stubbed an operator in, which is why none of them saw it.
 *
 * The initiator is now the same identity a payment or a fulfilment step records here: the
 * selected operator when there is one, otherwise the signed-in account — which the rules
 * accept as the self-operator form for an admin, and as the till account for a
 * manager-authorised staff void.
 */
import { screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { Operator } from '@/features/staff/staff-session'

import { renderComponent } from './render'

const voidOrder = vi.hoisted(() => vi.fn())
const withManagerAuthorization = vi.hoisted(() => vi.fn())
/** Stands in for the manager session's own Firestore handle. */
const MANAGER_FIRESTORE = vi.hoisted(() => ({ name: 'manager-session' }))

vi.mock('@/features/pos/void-api', () => ({ voidOrder }))
vi.mock('@/features/pos/manager-authorization', () => ({ withManagerAuthorization }))
vi.mock('@/features/pos/payment-api', () => ({ recordPayment: vi.fn() }))
vi.mock('@/features/pos/fulfillment-api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/pos/fulfillment-api')>()
  return { ...actual, setFulfillment: vi.fn(), correctFulfillment: vi.fn() }
})

let role: 'admin' | 'staff' = 'admin'
const PROFILES = {
  admin: { uid: 'admin-uid', displayName: 'Ada Admin', email: 'ada@x.y', role: 'admin' },
  staff: { uid: 'till-uid', displayName: 'Counter Tablet', email: 'till@x.y', role: 'staff' },
} as const

vi.mock('@/features/auth/useAuth', () => ({
  useAuth: () => ({
    role,
    status: 'authenticated',
    profile: { ...PROFILES[role], active: true },
  }),
}))

/** Null is the state that broke: nobody picked on this device, as for every admin. */
let operator: Operator | null = null
vi.mock('@/features/staff/useStaffSession', () => ({
  useStaffSession: () => ({ operator, operators: [], loading: false, select: () => {} }),
}))

const ORDER_ID = 'order-7'
const TOTAL = 1700

vi.mock('@/features/pos/useOrderDetail', () => ({
  useOrderDetail: () => ({
    view: {
      order: {
        id: ORDER_ID,
        number: 7,
        businessDate: '2026-09-27',
        lines: [
          {
            menuItemId: 'm1',
            name: 'Roti Canai',
            basePrice: 850,
            unitPrice: 850,
            modifiers: [],
            quantity: 2,
          },
        ],
        total: TOTAL,
        orderType: 'takeaway',
        tableNumber: null,
        paymentMethod: null,
        cashTendered: null,
        changeGiven: null,
        createdAt: { toDate: () => new Date('2026-09-27T02:00:00.000Z') },
        createdBy: 'till-uid',
        createdByName: 'Counter Tablet',
        staffId: 's1',
        staffName: 'Aisyah',
      },
      // Handed over. Payment state has no bearing on this handler; a sale that is paid AND
      // delivered is voided against the real rules in tests/integration/write-apis.test.ts.
      fulfillment: 'delivered',
      payment: { status: 'unpaid' },
      voided: null,
      overall: 'payment-outstanding',
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

/** Opens the dialog and picks a quick reason. */
async function startVoid(user: ReturnType<typeof renderDetail>['user']) {
  await user.click(screen.getByTestId('void-order'))
  await user.selectOptions(screen.getByTestId('void-reason'), 'wrong-item')
}

const dialogOpen = () => screen.queryByRole('alertdialog') !== null

beforeEach(() => {
  role = 'admin'
  operator = null
  voidOrder.mockReset()
  voidOrder.mockResolvedValue(undefined)
  withManagerAuthorization.mockReset()
  withManagerAuthorization.mockImplementation(async (_credentials, action) =>
    action({ uid: 'admin-uid', displayName: 'Ada Admin' }, MANAGER_FIRESTORE),
  )
})

describe('an admin voids a sale', () => {
  it('in one step, with no operator selected — the case that used to do nothing', async () => {
    const { user } = renderDetail()
    await startVoid(user)

    await user.click(screen.getByTestId('confirm-void'))

    expect(voidOrder).toHaveBeenCalledTimes(1)
    const [orderId, params, firestore] = voidOrder.mock.calls[0] as [
      string,
      Record<string, unknown>,
      unknown,
    ]
    expect(orderId).toBe(ORDER_ID)
    expect(params).toEqual({
      amount: TOTAL,
      reason: 'Wrong item',
      authorizedBy: { uid: 'admin-uid', displayName: 'Ada Admin' },
      // The admin's own account: the self-operator form the rules accept.
      initiatedBy: { staffId: 'admin-uid', staffName: 'Ada Admin' },
    })
    // Their own session — no manager sign-in for an admin.
    expect(firestore).toBeUndefined()
    expect(withManagerAuthorization).not.toHaveBeenCalled()
    await waitFor(() => expect(dialogOpen()).toBe(false))
  })

  it('still records a selected operator as the initiator when there is one', async () => {
    operator = { id: 's1', name: 'Aisyah', isSelf: false }
    const { user } = renderDetail()
    await startVoid(user)

    await user.click(screen.getByTestId('confirm-void'))

    const [, params] = voidOrder.mock.calls[0] as [string, Record<string, unknown>]
    expect(params.initiatedBy).toEqual({ staffId: 's1', staffName: 'Aisyah' })
    expect(params.authorizedBy).toEqual({ uid: 'admin-uid', displayName: 'Ada Admin' })
  })

  it('keeps the dialog open with a message when the write is refused', async () => {
    voidOrder.mockRejectedValue(Object.assign(new Error('denied'), { code: 'permission-denied' }))
    const { user } = renderDetail()
    await startVoid(user)

    await user.click(screen.getByTestId('confirm-void'))

    // Never the silent close: a void that did not happen must not look like one that did.
    await waitFor(() => within(screen.getByRole('alertdialog')).getByRole('alert'))
    expect(dialogOpen()).toBe(true)
  })
})

describe('staff start a void, and a manager authorises it', () => {
  beforeEach(() => {
    role = 'staff'
  })

  async function authorise(user: ReturnType<typeof renderDetail>['user']) {
    await startVoid(user)
    await user.click(screen.getByTestId('continue-void'))
    await user.type(screen.getByTestId('manager-email'), 'ada@x.y')
    await user.type(screen.getByTestId('manager-password'), 'secret')
    await user.click(screen.getByTestId('confirm-void'))
  }

  it('is two steps, and writes with the manager’s session — never the till’s', async () => {
    operator = { id: 's1', name: 'Aisyah', isSelf: false }
    const { user } = renderDetail()

    await authorise(user)

    expect(withManagerAuthorization).toHaveBeenCalledWith(
      { email: 'ada@x.y', password: 'secret' },
      expect.any(Function),
    )
    const [, params, firestore] = voidOrder.mock.calls[0] as [
      string,
      Record<string, unknown>,
      unknown,
    ]
    expect(firestore).toBe(MANAGER_FIRESTORE)
    expect(params.authorizedBy).toEqual({ uid: 'admin-uid', displayName: 'Ada Admin' })
    expect(params.initiatedBy).toEqual({ staffId: 's1', staffName: 'Aisyah' })
  })

  it('records the till account itself when no operator has been picked yet', async () => {
    const { user } = renderDetail()

    await authorise(user)

    const [, params] = voidOrder.mock.calls[0] as [string, Record<string, unknown>]
    expect(params.initiatedBy).toEqual({ staffId: 'till-uid', staffName: 'Counter Tablet' })
  })

  it('never voids from the staff session alone', async () => {
    const { user } = renderDetail()
    await startVoid(user)

    // The first step only leads to the manager's sign-in; it writes nothing.
    await user.click(screen.getByTestId('continue-void'))

    expect(voidOrder).not.toHaveBeenCalled()
    expect(screen.getByTestId('manager-email')).not.toBeNull()
  })
})
