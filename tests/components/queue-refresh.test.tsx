// @vitest-environment jsdom
/**
 * The queue board must not go grey while its own day refreshes.
 *
 * The workspace reports "loading" whenever any of its listeners has not answered yet — on the
 * first load of a day, and also every time a sale is rung up at another till, because the
 * newest order joins the last chunk of ids and opens a fresh listener for its sidecars. The
 * board used to draw its skeleton straight from that flag, so every sale anywhere, every
 * reconnect, and the first visit to a day blanked the whole board to a grey block for a
 * network round trip. Measured in a browser at 300ms of latency: 325-346ms per sale, 733ms
 * for a day loaded from nothing. On a slow connection that is the "grey screen".
 *
 * What these pin: the skeleton appears only when nothing has arrived for the day being shown;
 * a refresh of the same day keeps the board up; and a different day never borrows this one's
 * cards, which is the one thing holding the old board must not do.
 */
import { act, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useSyncExternalStore } from 'react'

import type { Message } from '@/features/i18n/messages'
import { buildOrderViews, type OrderView } from '@/features/pos/orders-view'
import type { Order } from '@/features/pos/types'

import { renderComponent } from './render'

const TODAY = '2026-09-28'
const YESTERDAY = '2026-09-27'

function orderOf(number: number, businessDate = TODAY): Order {
  return {
    id: `order-${businessDate}-${number}`,
    number,
    businessDate,
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

const viewsOf = (orders: Order[]): OrderView[] =>
  buildOrderViews(orders, { payments: new Map(), fulfillments: new Map(), voids: new Map() })

/** The workspace and the shown date, as one store the test moves by hand. */
interface Workspace {
  businessDate: string
  views: OrderView[]
  loading: boolean
  error: Message | null
}
let state: Workspace
const listeners = new Set<() => void>()
function set(patch: Partial<Workspace>) {
  act(() => {
    state = { ...state, ...patch }
    for (const listener of listeners) listener()
  })
}
const useStore = () =>
  useSyncExternalStore(
    (listener: () => void) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => state,
  )

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
vi.mock('@/features/pos/BusinessDateBar', () => ({ BusinessDateBar: () => null }))
vi.mock('@/features/pos/fulfillment-api', () => ({
  setFulfillment: vi.fn(),
  correctFulfillment: vi.fn(),
}))
vi.mock('@/features/pos/useBusinessToday', () => ({
  useShownBusinessDate: () => ({ businessDate: useStore().businessDate, showDate: () => {} }),
}))
vi.mock('@/features/pos/useOrdersWorkspace', () => ({
  useOrdersWorkspace: (businessDate: string) => {
    const current = useStore()
    // The real hook's contract: nothing, and loading, until THIS date's listeners answer.
    return current.businessDate === businessDate
      ? { views: current.views, loading: current.loading, error: current.error }
      : { views: [], loading: true, error: null }
  },
}))

import { QueuePage } from '@/features/pos/QueuePage'

function renderQueue() {
  return renderComponent(
    <MemoryRouter>
      <QueuePage />
    </MemoryRouter>,
  )
}

const skeleton = () => document.querySelector('[data-slot="skeleton"]')
const cardNumbers = () =>
  screen.getAllByTestId('queue-card').map((card) => card.textContent?.match(/#(\d+)/)?.[1])
const board = () => screen.getAllByTestId('queue-column')[0]!.parentElement!

beforeEach(() => {
  listeners.clear()
  state = { businessDate: TODAY, views: [], loading: true, error: null }
})

describe('the queue board while its data refreshes', () => {
  it('shows the placeholder while nothing has arrived for the day', () => {
    renderQueue()

    expect(skeleton()).not.toBeNull()
    expect(screen.queryAllByTestId('queue-card')).toEqual([])
  })

  it('keeps the board up while the same day refreshes — a sale rung up elsewhere', () => {
    renderQueue()
    set({ views: viewsOf([orderOf(2), orderOf(1)]), loading: false })
    expect(cardNumbers().sort()).toEqual(['1', '2'])

    // The newest order opens a fresh sidecar listener: the workspace reports loading, with no
    // rows, exactly as the real hooks do for that round trip.
    set({ views: [], loading: true })

    expect(skeleton()).toBeNull()
    expect(cardNumbers().sort()).toEqual(['1', '2'])
    expect(board().getAttribute('aria-busy')).toBe('true')
  })

  it('shows the new order the moment the refresh is complete', () => {
    renderQueue()
    set({ views: viewsOf([orderOf(1)]), loading: false })
    set({ views: [], loading: true })

    set({ views: viewsOf([orderOf(3), orderOf(1)]), loading: false })

    expect(cardNumbers().sort()).toEqual(['1', '3'])
    expect(board().getAttribute('aria-busy')).toBe('false')
  })

  it('never shows one day’s cards under another day', () => {
    renderQueue()
    set({ views: viewsOf([orderOf(1), orderOf(2)]), loading: false })

    // Somebody steps back a day: nothing has arrived for it yet.
    set({ businessDate: YESTERDAY, views: [], loading: true })

    expect(screen.queryAllByTestId('queue-card')).toEqual([])
    expect(skeleton()).not.toBeNull()

    set({ views: viewsOf([orderOf(5, YESTERDAY)]), loading: false })
    expect(cardNumbers()).toEqual(['5'])
  })

  it('keeps the board and shows the error when a refresh fails', () => {
    renderQueue()
    set({ views: viewsOf([orderOf(1)]), loading: false })

    set({ views: [], loading: true, error: { key: 'load.paymentsDate' } })

    expect(cardNumbers()).toEqual(['1'])
    expect(screen.getByRole('alert')).not.toBeNull()
  })
})
