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
import { lineKeyOf } from '@/features/menu/modifiers'

import { renderComponent } from './render'

/** A plain line: no customisation, so its identity is just the menu item. */
function plain(menuItemId: string, name: string, unitPrice: number, quantity: number) {
  return {
    lineId: lineKeyOf({ menuItemId, modifiers: [] }),
    menuItemId,
    name,
    basePrice: unitPrice,
    unitPrice,
    modifiers: [],
    quantity,
  }
}

const CART: Cart = [
  plain('flat-white', 'Flat White', 1250, 2),
  plain('croissant', 'Croissant', 690, 1),
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
    setup([plain('croissant', 'Croissant', 690, 1)])
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
    expect(onIncrement).toHaveBeenCalledWith(lineKeyOf({ menuItemId: 'croissant', modifiers: [] }))

    await user.click(screen.getByLabelText('Remove one Flat White'))
    expect(onDecrement).toHaveBeenCalledWith(lineKeyOf({ menuItemId: 'flat-white', modifiers: [] }))

    await user.click(screen.getByLabelText('Remove Flat White from the order'))
    expect(onRemove).toHaveBeenCalledWith(lineKeyOf({ menuItemId: 'flat-white', modifiers: [] }))
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
