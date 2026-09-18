// @vitest-environment jsdom
/**
 * The sort-order field, and the two small arrows now beside it.
 *
 * The figure itself is unchanged — a whole number, lower first, ties broken by name — and so
 * is everything that reads it. What is new is a second way to set it, for the common case of
 * nudging one item up or down a place rather than knowing the number you want. Typing still
 * works and is still the same state, which is the thing worth pinning: the arrows are a way
 * of editing the field, not a control of their own with a value beside it.
 *
 * The other thing pinned here is that the arrows are `type="button"`. A bare `<button>` in a
 * form submits it, so getting this wrong would create the item on the first click of an
 * arrow — silently, and only ever on this form.
 */
import { screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { MenuItemFormPage } from '@/features/menu/MenuItemFormPage'

import { renderComponent } from './render'

const createMenuItem = vi.hoisted(() => vi.fn())
const updateMenuItem = vi.hoisted(() => vi.fn())

vi.mock('@/features/menu/menu-api', () => ({
  createMenuItem,
  updateMenuItem,
  deleteMenuItem: vi.fn(),
  setMenuItemActive: vi.fn(),
}))

vi.mock('@/features/auth/useAuth', () => ({
  useAuth: () => ({ role: 'admin', profile: { uid: 'u1', role: 'admin' } }),
}))

const CATEGORIES = [
  {
    id: 'cat-coffee',
    name: 'Coffee',
    sortOrder: 0,
    active: true,
    createdAt: null,
    updatedAt: null,
  },
]

/** An item already in third place, so an edit starts from something other than zero. */
const ITEMS = [
  {
    id: 'item-kopi',
    name: 'Kopi O',
    names: { en: 'Kopi O', ms: '', zh: '' },
    description: '',
    categoryId: 'cat-coffee',
    price: 250,
    sortOrder: 3,
    active: true,
    modifierGroupIds: [],
    createdAt: null,
    updatedAt: null,
  },
]

vi.mock('@/features/menu/useCategories', () => ({
  useCategories: () => ({ categories: CATEGORIES, loading: false, error: null }),
}))
vi.mock('@/features/menu/useMenuItems', () => ({
  useMenuItems: () => ({ items: ITEMS, loading: false, error: null }),
}))
vi.mock('@/features/menu/useItemCosts', () => ({
  useItemCosts: () => ({ costs: new Map([['item-kopi', 80]]), loading: false, error: null }),
}))
vi.mock('@/features/menu/useModifierGroups', () => ({
  useModifierGroups: () => ({ groups: [], loading: false, error: null }),
}))

function renderForm(path = '/menu/new') {
  return renderComponent(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/menu/new" element={<MenuItemFormPage />} />
        <Route path="/menu/:itemId/edit" element={<MenuItemFormPage />} />
        <Route path="/menu" element={<p>Menu</p>} />
      </Routes>
    </MemoryRouter>,
  )
}

const sortOrder = () => screen.getByLabelText('Sort order') as HTMLInputElement
const increase = () => screen.getByTestId('sort-order-increase')
const decrease = () => screen.getByTestId('sort-order-decrease')

/** Everything else the form insists on, so a submit can actually reach the write API. */
async function fillTheRest(user: { type: (element: Element, text: string) => Promise<void> }) {
  await user.type(screen.getByTestId('name'), 'Kopi O')
  await user.type(screen.getByLabelText(/Price/), '2.50')
  await user.type(screen.getByTestId('cost'), '0.80')
}

beforeEach(() => {
  createMenuItem.mockReset()
  createMenuItem.mockResolvedValue('new-id')
  updateMenuItem.mockReset()
  updateMenuItem.mockResolvedValue(undefined)
})

afterEach(() => {
  document.documentElement.removeAttribute('lang')
})

describe('the field itself', () => {
  it('is a number input, so the browser handles the keyboard and the keypad', () => {
    renderForm()

    expect(sortOrder().type).toBe('number')
    // Arrow Up and Arrow Down stepping is the browser's, which is why it is not reimplemented
    // here; jsdom does not run it, so this asserts the contract rather than the keystroke.
    expect(sortOrder().step).toBe('1')
    expect(sortOrder().getAttribute('inputMode')).toBe('numeric')
  })

  it('starts a new item at zero, exactly as before', () => {
    renderForm()

    expect(sortOrder().value).toBe('0')
  })

  it("loads an existing item's own place", () => {
    renderForm('/menu/item-kopi/edit')

    expect(sortOrder().value).toBe('3')
  })

  it('still takes a typed value', async () => {
    const { user } = renderForm()

    await user.clear(sortOrder())
    await user.type(sortOrder(), '7')

    expect(sortOrder().value).toBe('7')
  })
})

describe('the arrows', () => {
  it('are labelled, because the glyph alone does not say what it changes', () => {
    renderForm()

    expect(increase().getAttribute('aria-label')).toBe('Increase sort order')
    expect(decrease().getAttribute('aria-label')).toBe('Decrease sort order')
    expect(screen.getByRole('button', { name: 'Increase sort order' })).toBe(increase())
    expect(screen.getByRole('button', { name: 'Decrease sort order' })).toBe(decrease())
  })

  it('are buttons, not submits — a click must never create the item', async () => {
    const { user } = renderForm()

    expect(increase().getAttribute('type')).toBe('button')
    expect(decrease().getAttribute('type')).toBe('button')

    await fillTheRest(user)
    await user.click(increase())
    await user.click(decrease())

    expect(createMenuItem).not.toHaveBeenCalled()
  })

  it('adds one', async () => {
    const { user } = renderForm()

    await user.click(increase())
    expect(sortOrder().value).toBe('1')

    await user.click(increase())
    expect(sortOrder().value).toBe('2')
  })

  it('takes one away', async () => {
    const { user } = renderForm('/menu/item-kopi/edit')

    await user.click(decrease())
    expect(sortOrder().value).toBe('2')
  })

  it('steps from whatever was typed, rather than from a count of its own', async () => {
    const { user } = renderForm()

    await user.clear(sortOrder())
    await user.type(sortOrder(), '9')
    await user.click(increase())

    expect(sortOrder().value).toBe('10')
  })

  it('reads an emptied field as zero, which is what the form already saves for one', async () => {
    const { user } = renderForm()

    await user.clear(sortOrder())
    await user.click(increase())

    expect(sortOrder().value).toBe('1')
  })

  /**
   * There is no minimum and no maximum, and this feature did not invent one.
   *
   * The form has only ever required a whole number and the security rule only `sortOrder is
   * int`, so nothing is clamped and neither arrow is ever disabled for hitting a limit. If a
   * floor is wanted later it belongs in the validation and the rule, not only in these two
   * buttons — which is why this is asserted rather than left to be assumed either way.
   */
  it('goes below zero, because nothing in this system says it may not', async () => {
    const { user } = renderForm()

    await user.click(decrease())
    expect(sortOrder().value).toBe('-1')
    expect(decrease().hasAttribute('disabled')).toBe(false)
  })
})

describe('what the form saves', () => {
  it('saves a stepped value as a whole number, in the same field as always', async () => {
    const { user } = renderForm()

    await fillTheRest(user)
    await user.click(increase())
    await user.click(increase())
    await user.click(screen.getByRole('button', { name: 'Create item' }))

    const input = createMenuItem.mock.calls.at(-1)?.[0] as Record<string, unknown> | undefined
    expect(input?.sortOrder).toBe(2)
  })

  it('saves a typed value unchanged, as it always did', async () => {
    const { user } = renderForm()

    await fillTheRest(user)
    await user.clear(sortOrder())
    await user.type(sortOrder(), '5')
    await user.click(screen.getByRole('button', { name: 'Create item' }))

    const input = createMenuItem.mock.calls.at(-1)?.[0] as Record<string, unknown> | undefined
    expect(input?.sortOrder).toBe(5)
  })

  it('still refuses a sort order that is not a whole number', async () => {
    const { user } = renderForm()

    await fillTheRest(user)
    await user.clear(sortOrder())
    await user.type(sortOrder(), '1.5')
    await user.click(screen.getByRole('button', { name: 'Create item' }))

    expect(createMenuItem).not.toHaveBeenCalled()
    expect(screen.getByText('Sort order must be a whole number.')).not.toBeNull()
  })
})
