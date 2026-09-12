// @vitest-environment jsdom
/**
 * The cart as the operator sees it.
 *
 * `cartTotal` and `lineTotal` are proven in tests/unit; what is proven here is that the
 * panel shows those numbers and reports the right line back when a button is tapped. A
 * decrement wired to the wrong id is invisible to every other suite in this project and
 * obvious the moment somebody serves with it.
 */
import { screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { CartPanel } from '@/features/pos/CartPanel'
import type { Cart } from '@/features/pos/cart'

import { renderComponent } from './render'

const CART: Cart = [
  { menuItemId: 'flat-white', name: 'Flat White', unitPrice: 1250, quantity: 2 },
  { menuItemId: 'croissant', name: 'Croissant', unitPrice: 690, quantity: 1 },
]

function setup(cart: Cart = CART) {
  const handlers = {
    onIncrement: vi.fn(),
    onDecrement: vi.fn(),
    onRemove: vi.fn(),
    onClear: vi.fn(),
  }
  const rendered = renderComponent(<CartPanel cart={cart} {...handlers} />)
  return { ...rendered, ...handlers }
}

describe('CartPanel: what it shows', () => {
  it('totals the cart and each line', () => {
    setup()
    expect(screen.getByTestId('cart-total').textContent).toBe('RM 31.90')

    const lineTotals = screen.getAllByTestId('line-total').map((node) => node.textContent)
    expect(lineTotals).toEqual(['RM 25.00', 'RM 6.90'])
  })

  it('counts items rather than lines', () => {
    // Three items across two lines: the count a customer would recognise.
    setup()
    expect(screen.getByTestId('cart-count').textContent).toBe('3 items')
  })

  it('says “1 item” in the singular', () => {
    setup([{ menuItemId: 'croissant', name: 'Croissant', unitPrice: 690, quantity: 1 }])
    expect(screen.getByTestId('cart-count').textContent).toBe('1 item')
  })

  it('invites the first tap when empty, and offers nothing to clear', () => {
    setup([])
    expect(screen.getByText('No items yet')).not.toBeNull()
    expect(screen.getByText('Tap an item on the left to add it.')).not.toBeNull()
    expect(screen.queryByRole('button', { name: 'Clear' })).toBeNull()
    expect(screen.getByTestId('cart-total').textContent).toBe('RM 0.00')
  })
})

describe('CartPanel: what it reports back', () => {
  it('names the line that was incremented, decremented or removed', async () => {
    const { user, onIncrement, onDecrement, onRemove } = setup()

    await user.click(screen.getByLabelText('Add one Croissant'))
    expect(onIncrement).toHaveBeenCalledWith('croissant')

    await user.click(screen.getByLabelText('Remove one Flat White'))
    expect(onDecrement).toHaveBeenCalledWith('flat-white')

    await user.click(screen.getByLabelText('Remove Flat White from the order'))
    expect(onRemove).toHaveBeenCalledWith('flat-white')
  })

  it('clears the whole cart on request', async () => {
    const { user, onClear } = setup()
    await user.click(screen.getByRole('button', { name: 'Clear' }))
    expect(onClear).toHaveBeenCalledOnce()
  })

  it('accepts no taps at all while disabled', async () => {
    const handlers = {
      onIncrement: vi.fn(),
      onDecrement: vi.fn(),
      onRemove: vi.fn(),
      onClear: vi.fn(),
    }
    // Disabled is what the till does while an order is being written. A tap that still
    // registered then could change a cart that is already on its way to Firestore.
    const { user } = renderComponent(<CartPanel cart={CART} {...handlers} disabled />)

    await user.click(screen.getByLabelText('Add one Croissant'))
    await user.click(screen.getByRole('button', { name: 'Clear' }))

    expect(handlers.onIncrement).not.toHaveBeenCalled()
    expect(handlers.onClear).not.toHaveBeenCalled()
  })
})
