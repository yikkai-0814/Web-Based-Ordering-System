// @vitest-environment jsdom
/**
 * New Order asks who is making **this** order, every time.
 *
 * Two people share one counter. The person who took the last order is not necessarily
 * taking the next, so carrying the previous name forward would file one person's sale under
 * another's — permanently, orders being immutable, and silently, which is worse. The prompt
 * is therefore deliberate friction rather than a rough edge to smooth off.
 *
 * The staff session is stubbed with a real, stateful stand-in rather than a fixed value:
 * picking a name has to actually change what the page sees, or none of this is tested. The
 * uid-scoping that makes the underlying persistence safe is Phase 13's and is covered in
 * StaffSessionProvider.test.tsx — untouched by this phase.
 */
import { useSyncExternalStore } from 'react'

import { screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Operator } from '@/features/staff/staff-session'
import { createOrder } from '@/features/pos/pos-api'
import { TerminalPage } from '@/features/pos/TerminalPage'

import { renderComponent } from './render'

const ALICE: Operator = { id: 'alice', name: 'Alice', isSelf: false }
const BOB: Operator = { id: 'bob', name: 'Bob', isSelf: false }
const TILL: Operator = { id: 'till-uid', name: 'Shared Till', isSelf: true }
const ROSTER = [TILL, ALICE, BOB]

/**
 * A single shared operator, the way the real provider shares one through context.
 *
 * Giving each caller its own `useState` would be wrong in a way that hides the bug: the
 * page and the picker inside it both call `useStaffSession`, so a name chosen in the picker
 * has to be visible to the page. An external store is the smallest thing that behaves like
 * the provider without dragging in Firestore or localStorage.
 */
let currentOperator: Operator | null = null
const listeners = new Set<() => void>()

function setCurrentOperator(next: Operator | null) {
  currentOperator = next
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** What the persisted session already holds when the page mounts. */
let storedOperator: Operator | null = null
let staffLoading = false

vi.mock('@/features/auth/useAuth', () => ({
  useAuth: () => ({
    profile: { uid: 'till-uid', displayName: 'Shared Till', role: 'staff', active: true },
    status: 'authenticated',
    role: 'staff',
  }),
}))

/**
 * A stand-in for the real provider: `select` changes who the page sees, exactly as the
 * uid-scoped one does, without reaching for Firestore or localStorage.
 */
vi.mock('@/features/staff/useStaffSession', () => ({
  useStaffSession: () => ({
    operator: useSyncExternalStore(subscribe, () => currentOperator),
    operators: ROSTER,
    loading: staffLoading,
    select: (id: string) =>
      setCurrentOperator(ROSTER.find((candidate) => candidate.id === id) ?? null),
  }),
}))

vi.mock('@/features/menu/useCategories', () => ({
  useCategories: () => ({
    categories: [{ id: 'coffee', name: 'Coffee', sortOrder: 1, active: true }],
    data: [],
    loading: false,
    error: null,
  }),
}))

vi.mock('@/features/menu/useMenuItems', () => ({
  useMenuItems: () => ({
    items: [
      {
        id: 'flat-white',
        name: 'Flat White',
        categoryId: 'coffee',
        price: 1250,
        sortOrder: 1,
        active: true,
        modifierGroupIds: [],
      },
    ],
    data: [],
    loading: false,
    error: null,
  }),
}))

vi.mock('@/features/pos/pos-api', () => ({
  createOrder: vi.fn(),
}))

const createOrderMock = vi.mocked(createOrder)
let orderNumber = 0

beforeEach(() => {
  storedOperator = null
  currentOperator = null
  staffLoading = false
  orderNumber = 0
  createOrderMock.mockReset()
  createOrderMock.mockImplementation(async () => {
    orderNumber += 1
    return { id: `order-${orderNumber}`, number: orderNumber }
  })
})

afterEach(() => {
  vi.clearAllMocks()
})

const asking = () => screen.queryByText('Who is making this order?') !== null

/** Everything between choosing a name and the order being written. */
async function placeAnOrderAs(user: ReturnType<typeof renderComponent>['user'], name: string) {
  await user.click(screen.getByText(name))
  await user.click(screen.getByText('Flat White'))
  await user.type(screen.getByLabelText('Table number'), '5')
  await user.click(screen.getByTestId('place-order'))
}

/** Who the most recent createOrder call named as the operator. */
const lastOperator = () => createOrderMock.mock.calls.at(-1)?.[0].staff

describe('New Order: every order asks who is making it', () => {
  it('asks before anything can be rung up', () => {
    renderComponent(<TerminalPage />)
    expect(asking()).toBe(true)
    expect(screen.queryByText('Flat White')).toBeNull()
  })

  it('asks even when the session already remembers somebody', () => {
    // The heart of this phase. A stored selection is where the answer is KEPT; it is not an
    // answer to a question that has not been asked for this order.
    storedOperator = ALICE
    setCurrentOperator(storedOperator)
    renderComponent(<TerminalPage />)
    expect(asking()).toBe(true)
  })

  it('opens the order once a name is chosen', async () => {
    const { user } = renderComponent(<TerminalPage />)
    await user.click(screen.getByText('Alice'))

    expect(asking()).toBe(false)
    expect(screen.getByRole('heading', { name: 'New Order' })).not.toBeNull()
    expect(screen.getByText('Flat White')).not.toBeNull()
  })

  it('waits for the roster rather than asking too early', () => {
    staffLoading = true
    renderComponent(<TerminalPage />)
    expect(asking()).toBe(false)
  })
})

describe('New Order: the next order starts from the question again', () => {
  it('asks again as soon as an order is placed', async () => {
    const { user } = renderComponent(<TerminalPage />)
    await placeAnOrderAs(user, 'Alice')

    expect(createOrderMock).toHaveBeenCalledOnce()
    expect(asking()).toBe(true)
  })

  it('reports the order just placed on the screen that asks', async () => {
    const { user } = renderComponent(<TerminalPage />)
    await placeAnOrderAs(user, 'Alice')

    const confirmation = screen.getByTestId('order-confirmation')
    expect(confirmation.textContent).toContain('Order #1 placed')
    expect(confirmation.textContent).toContain('RM 12.50')
  })

  it('clears that confirmation once the next order has an operator', async () => {
    const { user } = renderComponent(<TerminalPage />)
    await placeAnOrderAs(user, 'Alice')
    await user.click(screen.getByText('Bob'))

    expect(screen.queryByTestId('order-confirmation')).toBeNull()
  })

  it('does not pre-select the person who took the last order', async () => {
    const { user } = renderComponent(<TerminalPage />)
    await placeAnOrderAs(user, 'Alice')

    // Alice is still the stored operator, and the page is still asking. Nothing is rung up
    // against her until somebody says so again.
    expect(asking()).toBe(true)
    expect(screen.queryByText('Flat White')).toBeNull()
  })
})

describe('New Order: consecutive orders can be different people', () => {
  it('attributes each order to the person chosen for it', async () => {
    const { user } = renderComponent(<TerminalPage />)

    await placeAnOrderAs(user, 'Alice')
    expect(lastOperator()).toEqual({ id: 'alice', name: 'Alice' })

    await placeAnOrderAs(user, 'Bob')
    expect(lastOperator()).toEqual({ id: 'bob', name: 'Bob' })

    await placeAnOrderAs(user, 'Alice')
    expect(lastOperator()).toEqual({ id: 'alice', name: 'Alice' })

    // Alice, Bob, Alice — the example from the counter, in order.
    expect(createOrderMock.mock.calls.map((call) => call[0].staff.name)).toEqual([
      'Alice',
      'Bob',
      'Alice',
    ])
  })

  it('still sends the signed-in account alongside the operator', async () => {
    // Two identities on one sale, unchanged by this phase: the credential that wrote it and
    // the person who took it. The rules check both.
    const { user } = renderComponent(<TerminalPage />)
    await placeAnOrderAs(user, 'Bob')

    const [params] = createOrderMock.mock.calls[0] ?? []
    expect(params?.user).toEqual({ uid: 'till-uid', displayName: 'Shared Till' })
    expect(params?.staff).toEqual({ id: 'bob', name: 'Bob' })
  })

  it('carries nothing else from one order into the next', async () => {
    const { user } = renderComponent(<TerminalPage />)
    await placeAnOrderAs(user, 'Alice')
    await user.click(screen.getByText('Bob'))

    // The cart and the table number are already cleared on success; this is the check that
    // the second order genuinely starts empty rather than inheriting the first.
    expect(screen.getByTestId('cart-total').textContent).toBe('RM 0.00')
    expect((screen.getByLabelText('Table number') as HTMLInputElement).value).toBe('')
  })
})
