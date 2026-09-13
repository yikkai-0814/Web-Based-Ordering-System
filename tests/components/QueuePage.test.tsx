// @vitest-environment jsdom
/**
 * The queue board has to feel immediate.
 *
 * The board never waited on the network to *show* a change — Firestore applies a write to
 * its local cache first, so the snapshot listener reports the new status within a frame.
 * What it did wait on was the acknowledgement, and it did so in the one place a person
 * notices: the card's button stayed disabled, keyed by order id, until the server answered.
 * So the card would visibly move into Preparing while its "Mark ready" button sat greyed
 * out — correct state, unusable control.
 *
 * These tests drive that seam directly. `useOrdersWorkspace` is stubbed with a store the
 * test advances by hand, standing in for the listener, and `setFulfillment` with a promise
 * the test resolves when it chooses. That is the only way to hold a write "in flight" long
 * enough to assert what the board does meanwhile.
 */
import { useSyncExternalStore } from 'react'

import { act, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { setFulfillment } from '@/features/pos/fulfillment-api'
import type { FulfillmentStatus } from '@/features/pos/fulfillment'
import { buildOrderViews } from '@/features/pos/orders-view'
import type { Order, OrderFulfillment } from '@/features/pos/types'
import { QueuePage } from '@/features/pos/QueuePage'

import { renderComponent } from './render'

const BUSINESS_DATE = '2026-09-13'
const ORDER_ID = 'order-1'

function orderOf(): Order {
  return {
    id: ORDER_ID,
    number: 1,
    businessDate: BUSINESS_DATE,
    lines: [{ menuItemId: 'i1', name: 'Flat White', unitPrice: 1250, quantity: 1 }],
    total: 1250,
    orderType: 'takeaway',
    tableNumber: null,
    paymentMethod: null,
    cashTendered: null,
    changeGiven: null,
    createdAt: { toDate: () => new Date('2026-09-13T19:30:00.000Z') } as Order['createdAt'],
    createdBy: 'till-uid',
    createdByName: 'Shared Till',
    staffId: 'alice',
    staffName: 'Alice',
  }
}

function fulfillmentOf(status: FulfillmentStatus): OrderFulfillment {
  return {
    orderId: ORDER_ID,
    status,
    updatedAt: null,
    updatedBy: 'till-uid',
    updatedByName: 'Shared Till',
    updatedByStaffId: 'alice',
    updatedByStaffName: 'Alice',
    readyAt: null,
  }
}

/**
 * The listener, as a store the test advances by hand.
 *
 * `null` means no fulfilment document, which is how `pending` is represented.
 */
let currentStatus: FulfillmentStatus | null = null
const listeners = new Set<() => void>()

/**
 * What Firestore's local cache does the instant a write is issued.
 *
 * Wrapped in `act` because the update comes from an external store rather than from
 * anything Testing Library called, so nothing else would flush the re-render.
 */
function listenerReports(status: FulfillmentStatus | null) {
  act(() => {
    currentStatus = status
    for (const listener of listeners) listener()
  })
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

vi.mock('@/features/auth/useAuth', () => ({
  useAuth: () => ({
    profile: { uid: 'till-uid', displayName: 'Shared Till', role: 'staff', active: true },
    status: 'authenticated',
    role: 'staff',
  }),
}))

vi.mock('@/features/staff/useStaffSession', () => ({
  useStaffSession: () => ({
    operator: { id: 'alice', name: 'Alice', isSelf: false },
    operators: [],
    loading: false,
    select: () => undefined,
  }),
}))

vi.mock('@/features/pos/useBusinessToday', () => ({
  useShownBusinessDate: () => ({ businessDate: BUSINESS_DATE, showDate: () => undefined }),
}))

vi.mock('@/features/pos/BusinessDateBar', () => ({
  BusinessDateBar: () => null,
}))

vi.mock('@/features/pos/useOrdersWorkspace', () => ({
  useOrdersWorkspace: () => {
    const status = useSyncExternalStore(subscribe, () => currentStatus)
    const fulfillments = new Map<string, OrderFulfillment>()
    if (status !== null) fulfillments.set(ORDER_ID, fulfillmentOf(status))
    return {
      views: buildOrderViews([orderOf()], {
        payments: new Map(),
        fulfillments,
        voids: new Map(),
      }),
      loading: false,
      error: null,
    }
  },
}))

vi.mock('@/features/pos/fulfillment-api', () => ({
  setFulfillment: vi.fn(),
}))

const setFulfillmentMock = vi.mocked(setFulfillment)

/** A write held open until the test decides its fate. */
function deferred() {
  let resolve!: () => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<void>((res, rej) => {
    resolve = () => res()
    reject = rej
  })
  return { promise, resolve, reject }
}

beforeEach(() => {
  currentStatus = null
  setFulfillmentMock.mockReset()
})

afterEach(() => {
  listeners.clear()
})

/** The card links to its receipt, so the page needs a router around it. */
function renderQueue() {
  return renderComponent(
    <MemoryRouter>
      <QueuePage />
    </MemoryRouter>,
  )
}

const card = () => screen.getByTestId('queue-card')
const advanceButton = () => within(card()).getByTestId('queue-advance')
const columnOf = () => card().closest('[data-testid="queue-column"]')?.getAttribute('data-status')

describe('the queue board does not wait for the server', () => {
  it('offers the next step as soon as the listener moves the card, mid-write', async () => {
    const first = deferred()
    setFulfillmentMock.mockReturnValueOnce(first.promise)

    const { user } = renderQueue()
    expect(columnOf()).toBe('pending')
    expect(advanceButton().textContent).toContain('Start preparing')

    await user.click(advanceButton())
    expect(setFulfillmentMock).toHaveBeenCalledTimes(1)

    // Firestore's local cache has applied the write; the server has NOT answered yet.
    listenerReports('preparing')

    // This is the regression: the card has moved, so the step it now offers is a different
    // one and must be pressable immediately — even though the first write is still open.
    expect(columnOf()).toBe('preparing')
    expect(advanceButton().textContent).toContain('Mark ready')
    expect((advanceButton() as HTMLButtonElement).disabled).toBe(false)

    // And it really is usable: the next step goes through while the first is unacknowledged.
    const second = deferred()
    setFulfillmentMock.mockReturnValueOnce(second.promise)
    await user.click(advanceButton())
    expect(setFulfillmentMock).toHaveBeenCalledTimes(2)
    expect(setFulfillmentMock.mock.calls[1]?.[1]).toMatchObject({ from: 'preparing', to: 'ready' })

    first.resolve()
    second.resolve()
  })

  it('sends the step exactly once however many times the same button is pressed', async () => {
    const held = deferred()
    setFulfillmentMock.mockReturnValue(held.promise)

    const { user } = renderQueue()
    const button = advanceButton()

    // Three impatient presses before anything has come back.
    await user.click(button)
    await user.click(button)
    await user.click(button)

    expect(setFulfillmentMock).toHaveBeenCalledTimes(1)
    expect(setFulfillmentMock.mock.calls[0]?.[1]).toMatchObject({
      from: 'pending',
      to: 'preparing',
    })

    held.resolve()
  })

  it('disables only the step in flight, so a stalled write cannot freeze the board', async () => {
    const held = deferred()
    setFulfillmentMock.mockReturnValue(held.promise)

    const { user } = renderQueue()
    await user.click(advanceButton())

    // Still pending as far as the listener is concerned: the write has not landed anywhere.
    expect(columnOf()).toBe('pending')
    expect((advanceButton() as HTMLButtonElement).disabled).toBe(true)
    expect(advanceButton().textContent).toContain('Saving')

    held.resolve()
  })
})

describe('when the write is refused', () => {
  it('shows why, and lets the reverted card be tried again', async () => {
    const refused = deferred()
    setFulfillmentMock.mockReturnValueOnce(refused.promise)

    const { user } = renderQueue()
    await user.click(advanceButton())

    // Optimistically applied locally...
    listenerReports('preparing')
    expect(columnOf()).toBe('preparing')

    // ...then refused by the rules. Firestore rolls the local change back, which reaches the
    // board as another snapshot — the test plays both halves, because that is what happens.
    refused.reject(Object.assign(new Error('permission denied'), { code: 'permission-denied' }))
    await vi.waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain('could not be saved')
    })
    listenerReports(null)

    expect(columnOf()).toBe('pending')
    expect(advanceButton().textContent).toContain('Start preparing')

    // The failed step is no longer in flight, so the same move can be attempted again.
    const retry = deferred()
    setFulfillmentMock.mockReturnValueOnce(retry.promise)
    await user.click(advanceButton())
    expect(setFulfillmentMock).toHaveBeenCalledTimes(2)
    retry.resolve()
  })
})

describe('the preparation timer on a card', () => {
  it('is running on a pending, unpaid order that nobody has touched', () => {
    renderQueue()

    const readout = within(card()).getByTestId('preparation-time')
    expect(readout.getAttribute('data-running')).toBe('true')
    expect(readout.textContent).toContain('Prep time')
  })
})
