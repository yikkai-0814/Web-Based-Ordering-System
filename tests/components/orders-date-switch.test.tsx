// @vitest-environment jsdom
/**
 * What the Orders list shows while it is changing business date.
 *
 * The date IS the query, so choosing another day builds a new Firestore query and
 * `useQueryDocs` reports "loading" with no rows from the very render that changes it. The
 * page used to render its skeleton straight from that flag, so the whole list was replaced by
 * a grey surface on every switch — measured against the emulator at 14-30 ms for a day that
 * had been viewed before, which is a flicker rather than a wait.
 *
 * Keeping the previous rows up is only acceptable if the page stops asserting anything about
 * the selected date while they are there, and if the switch always completes. Both halves are
 * pinned below, along with the states that must still show a skeleton or an empty state.
 *
 * The switch is also **silent**: no message, no dimming, nothing that reads as a reload. For a
 * day that has been viewed before Firestore answers in 27-48 ms, so anything announcing that
 * would be a flicker rather than information. `aria-busy` carries it for assistive technology
 * instead, and the assertions below insist on both halves — busy set, nothing visible.
 */
import { useSyncExternalStore } from 'react'

import { act, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { OrderView } from '@/features/pos/orders-view'
import type { Order } from '@/features/pos/types'

import { renderComponent } from './render'

/** Business dates the page steps through; `previous-day` walks backwards from today. */
function dayOffset(days: number): string {
  const date = new Date()
  date.setDate(date.getDate() - days)
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}
const DAY_0 = dayOffset(0)
const DAY_1 = dayOffset(1)
const DAY_2 = dayOffset(2)

/** Dates whose data has arrived, with the rows for each. A missing date is still loading. */
const loaded = new Map<string, OrderView[]>()
let version = 0
const listeners = new Set<() => void>()

function publish() {
  version += 1
  for (const listener of listeners) listener()
}

function viewOf(date: string, number: number): OrderView {
  const order = {
    id: `${date}-${number}`,
    number,
    businessDate: date,
    lines: [
      {
        menuItemId: 'm1',
        name: 'Flat White',
        basePrice: 500,
        unitPrice: 500,
        modifiers: [],
        quantity: 1,
      },
    ],
    total: 500,
    orderType: 'takeaway',
    tableNumber: null,
    paymentMethod: null,
    cashTendered: null,
    changeGiven: null,
    createdAt: null,
    createdBy: 'u1',
    createdByName: 'Test User',
    staffId: 's1',
    staffName: 'Alice',
  } as unknown as Order

  return {
    order,
    fulfillment: 'pending',
    payment: { status: 'unpaid' },
    voided: null,
    overall: 'pending',
  } as unknown as OrderView
}

/** Marks a date as settled with the given orders, as a snapshot landing would. */
function arrive(date: string, numbers: number[]) {
  loaded.set(
    date,
    numbers.map((number) => viewOf(date, number)),
  )
  publish()
}

vi.mock('@/features/pos/useOrdersWorkspace', () => ({
  useOrdersWorkspace: (businessDate: string) => {
    useSyncExternalStore(
      (listener: () => void) => {
        listeners.add(listener)
        return () => listeners.delete(listener)
      },
      () => version,
    )
    const views = loaded.get(businessDate)
    // Exactly the contract the real hook has: nothing to show, and loading, until the
    // snapshot for THIS date arrives.
    return views
      ? { views, loading: false, error: null }
      : { views: [], loading: true, error: null }
  },
}))

import { OrdersListPage } from '@/features/pos/OrdersListPage'

function renderOrders() {
  return renderComponent(
    <MemoryRouter>
      <OrdersListPage />
    </MemoryRouter>,
  )
}

function shownOrderNumbers(): string[] {
  return screen
    .queryAllByTestId('order-row')
    .map((row) => row.getAttribute('data-order-number') ?? '')
}

function skeleton(container: HTMLElement): Element | null {
  return container.querySelector('[data-slot="skeleton"]')
}

function busy(container: HTMLElement): boolean {
  return container.querySelector('[aria-busy="true"]') !== null
}

/**
 * Nothing on screen may announce the load. Asserted by text rather than by test id so that
 * reintroducing a message under any name fails this.
 */
function announcesLoading(): boolean {
  return /loading|memuatkan|加载/i.test(document.body.textContent ?? '')
}

async function stepBack(user: ReturnType<typeof renderOrders>['user']) {
  await user.click(screen.getByTestId('previous-day'))
}

beforeEach(() => {
  loaded.clear()
  version = 0
  listeners.clear()
})

describe('Orders list during a business-date change', () => {
  it('shows the skeleton on the first load, when there is genuinely nothing to show', () => {
    const { container } = renderOrders()

    expect(skeleton(container)).not.toBeNull()
    expect(shownOrderNumbers()).toEqual([])
    expect(screen.queryByTestId('orders-count')).toBeNull()
    // Not an empty state either: "no sales on this date" would be a claim, and nothing is
    // known about the date yet.
    expect(screen.queryByTestId('orders-empty')).toBeNull()
  })

  it('does not blank the page when the date changes over rows that are already up', async () => {
    const { container, user } = renderOrders()
    act(() => arrive(DAY_0, [3, 2, 1]))
    expect(shownOrderNumbers()).toEqual(['3', '2', '1'])

    await stepBack(user)

    // The whole point: no grey surface, and the rows stay on screen.
    expect(skeleton(container)).toBeNull()
    expect(shownOrderNumbers()).toEqual(['3', '2', '1'])
    // The load is carried by aria-busy alone — nothing visible announces it.
    expect(busy(container)).toBe(true)
    expect(announcesLoading()).toBe(false)
    // And every claim about the new date is withheld until its rows are actually here.
    expect(screen.queryByTestId('orders-count')).toBeNull()
  })

  it('replaces the old rows completely once the new date arrives', async () => {
    const { container, user } = renderOrders()
    act(() => arrive(DAY_0, [3, 2, 1]))
    await stepBack(user)
    act(() => arrive(DAY_1, [9]))

    // Replaced, not merged: the previous day's single order and nothing of today's.
    expect(shownOrderNumbers()).toEqual(['9'])
    expect(busy(container)).toBe(false)
    expect(announcesLoading()).toBe(false)
    const count = screen.getByTestId('orders-count')
    expect(within(count).getByText(new RegExp(DAY_1))).toBeTruthy()
  })

  it('shows the empty state for a date with no orders', async () => {
    const { container, user } = renderOrders()
    act(() => arrive(DAY_0, [1]))
    await stepBack(user)
    act(() => arrive(DAY_1, []))

    expect(screen.getByTestId('orders-empty')).toBeTruthy()
    expect(shownOrderNumbers()).toEqual([])
    expect(skeleton(container)).toBeNull()
    expect(busy(container)).toBe(false)
  })

  it('never leaves the wrong date on screen when dates are changed quickly', async () => {
    const { container, user } = renderOrders()
    act(() => arrive(DAY_0, [3, 2, 1]))

    // Two steps back in quick succession, neither settled yet.
    await stepBack(user)
    await stepBack(user)
    expect(busy(container)).toBe(true)

    // The skipped-over day answers late — it must not be painted, because it is not the
    // date that is selected.
    act(() => arrive(DAY_1, [77]))
    expect(shownOrderNumbers()).toEqual(['3', '2', '1'])
    expect(busy(container)).toBe(true)
    expect(screen.queryByTestId('orders-count')).toBeNull()

    // The selected day answers, and only now does the list change.
    act(() => arrive(DAY_2, [55]))
    expect(shownOrderNumbers()).toEqual(['55'])
    expect(busy(container)).toBe(false)
    expect(announcesLoading()).toBe(false)
    const count = screen.getByTestId('orders-count')
    expect(within(count).getByText(new RegExp(DAY_2))).toBeTruthy()
  })
})
