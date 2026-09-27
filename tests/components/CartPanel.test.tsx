// @vitest-environment jsdom
/**
 * The cart as the operator sees it.
 *
 * `cartTotal` and `lineTotal` are proven in tests/unit; what is proven here is that the
 * panel shows those numbers and reports the right line back when a button is tapped. A
 * decrement wired to the wrong id is invisible to every other suite in this project and
 * obvious the moment somebody serves with it.
 */
import { screen, within } from '@testing-library/react'
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

/**
 * The line's two layouts. jsdom evaluates no container queries, so these pin the classes that
 * choose between them and the order the controls come in, which is the same in both.
 */
describe('CartPanel: the line at any cart width', () => {
  const firstLine = () => screen.getAllByTestId('cart-line')[0]!

  it('lays itself out by the width of the panel, not of the screen', () => {
    const { container } = setup()

    expect((container.firstElementChild as HTMLElement).className).toContain('@container')
  })

  it('is two rows when the panel is narrow and one row from 25rem', () => {
    setup()

    const classes = firstLine().className.split(/\s+/)
    expect(classes).toEqual(
      expect.arrayContaining([
        'grid-cols-[minmax(0,1fr)_auto]',
        '@[25rem]:grid-cols-[minmax(0,1fr)_auto_auto_auto]',
      ]),
    )
    // Two rows: the quantity and delete drop beneath the name and the total.
    expect(screen.getAllByTestId('line-quantity')[0]!.parentElement?.className).toContain(
      'row-start-2',
    )
    expect(
      screen.getByRole('button', { name: 'Remove Flat White from the order' }).className,
    ).toContain('row-start-2')
  })

  it('keeps one reading and tab order in both layouts', () => {
    setup()

    const controls = within(firstLine())
      .getAllByRole('button')
      .map((button) => button.getAttribute('aria-label'))
    expect(controls).toEqual([
      'Remove one Flat White',
      'Add one Flat White',
      'Remove Flat White from the order',
    ])
    expect(firstLine().textContent?.indexOf('Flat White')).toBe(0)
  })

  it('gives the quantity and delete buttons a thumb-sized 40px target', () => {
    setup()

    for (const button of within(firstLine()).getAllByRole('button')) {
      expect(button.className.split(/\s+/)).toContain('size-10')
      expect(button.className.split(/\s+/)).not.toContain('size-8')
    }
  })

  it('lets a long name wrap on two rows rather than cutting it to a letter', () => {
    setup([plain('nasi', 'Nasi Lemak Ayam Goreng Berempah Special', 1290, 1)])

    const name = within(firstLine()).getByText('Nasi Lemak Ayam Goreng Berempah Special')
    expect(name.className.split(/\s+/)).toEqual(
      expect.arrayContaining(['wrap-break-word', '@[25rem]:truncate']),
    )
  })

  it('keeps its natural height on a short screen, where the whole column scrolls instead', () => {
    const { container } = setup()

    const root = container.firstElementChild as HTMLElement
    expect(root.className.split(/\s+/)).toContain('short:flex-none')
    const list = screen.getAllByTestId('cart-line')[0]!.closest('ul')!.parentElement!
    expect(list.className.split(/\s+/)).toContain('short:overflow-visible')
  })

  it('can be shorter than its lines, so the list scrolls instead of growing', () => {
    const { container } = setup()

    const root = container.firstElementChild as HTMLElement
    expect(root.className.split(/\s+/)).toEqual(expect.arrayContaining(['min-h-0', 'flex-1']))
    const list = screen.getAllByTestId('cart-line')[0]!.closest('ul')!.parentElement!
    expect(list.className.split(/\s+/)).toEqual(
      expect.arrayContaining(['min-h-0', 'overflow-y-auto']),
    )
  })
})

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
