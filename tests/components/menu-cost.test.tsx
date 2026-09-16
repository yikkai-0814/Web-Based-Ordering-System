// @vitest-environment jsdom
/**
 * Cost is mandatory, on the way in and on the way out.
 *
 * An item with no recorded cost is not a tidy blank: `buildReport` cannot resolve what it
 * cost to make, so every margin, profit figure and coverage percentage it appears in becomes
 * an upper bound, and the Reports page has a whole warning band saying so. The cheapest
 * place to stop that is the form that creates the item.
 *
 * Two halves are proven here. The form refuses to submit without a usable cost, says so
 * under the field and puts the cursor back in it; and the menu table stops rendering an
 * absent cost as a dash — which read as "zero" at a glance — in favour of something that
 * says what is wrong and links to where it is fixed.
 */
import { screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { MenuItemFormPage } from '@/features/menu/MenuItemFormPage'
import { MenuListPage } from '@/features/menu/MenuListPage'

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

const ITEMS = [
  {
    id: 'item-kopi',
    name: 'Kopi O',
    description: '',
    categoryId: 'cat-coffee',
    price: 250,
    sortOrder: 0,
    active: true,
    createdAt: null,
    updatedAt: null,
  },
  {
    id: 'item-ckt',
    name: 'Char Kway Teow',
    description: '',
    categoryId: 'cat-coffee',
    price: 1000,
    sortOrder: 1,
    active: true,
    createdAt: null,
    updatedAt: null,
  },
]

/** Only Kopi O has one — Char Kway Teow is the item this feature exists for. */
let costs = new Map<string, number>([['item-kopi', 80]])

vi.mock('@/features/menu/useCategories', () => ({
  useCategories: () => ({ categories: CATEGORIES, loading: false, error: null }),
}))
vi.mock('@/features/menu/useMenuItems', () => ({
  useMenuItems: () => ({ items: ITEMS, loading: false, error: null }),
}))
vi.mock('@/features/menu/useItemCosts', () => ({
  useItemCosts: () => ({ costs, loading: false, error: null }),
}))
vi.mock('@/features/menu/useModifierGroups', () => ({
  useModifierGroups: () => ({ groups: [], loading: false, error: null }),
}))

beforeEach(() => {
  createMenuItem.mockReset()
  createMenuItem.mockResolvedValue('new-id')
  updateMenuItem.mockReset()
  updateMenuItem.mockResolvedValue(undefined)
  costs = new Map<string, number>([['item-kopi', 80]])
})

afterEach(() => {
  document.documentElement.removeAttribute('lang')
})

function renderNewItemForm() {
  return renderComponent(
    <MemoryRouter initialEntries={['/menu/new']}>
      <Routes>
        <Route path="/menu/new" element={<MenuItemFormPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

const costField = () => screen.getByTestId('cost') as HTMLInputElement
const submit = () => screen.getByRole('button', { name: 'Create item' })

describe('the cost field is compulsory', () => {
  it('marks itself required, for the eye and for assistive technology', () => {
    renderNewItemForm()
    expect(costField().required).toBe(true)
    // The asterisk is decoration beside the label; `required` is what is announced. Asked of
    // the cost field's own label rather than of the page, because the English name field is
    // marked the same way and there are now two of them.
    expect(document.querySelector('label[for="cost"]')?.textContent).toContain('*')
  })

  it('suggests a figure rather than telling people to leave it blank', () => {
    renderNewItemForm()
    expect(costField().placeholder).toBe('4.50')
    expect(screen.queryByText(/Leave blank/)).toBeNull()
  })

  it('no longer says that blank is different from zero', () => {
    renderNewItemForm()
    expect(screen.queryByText(/that is not the same as zero/)).toBeNull()
  })

  it('blocks a submit with no cost, and says so under the field', async () => {
    const { user } = renderNewItemForm()
    await user.type(screen.getByLabelText(/English/), 'Teh Tarik')
    await user.type(screen.getByLabelText(/Price/), '3.50')
    await user.click(submit())

    expect(createMenuItem).not.toHaveBeenCalled()
    expect(screen.getByTestId('cost-error').textContent).toBe('Cost is required.')
  })

  it('puts the cursor back in the field it is complaining about', async () => {
    const { user } = renderNewItemForm()
    await user.type(screen.getByLabelText(/English/), 'Teh Tarik')
    await user.type(screen.getByLabelText(/Price/), '3.50')
    await user.click(submit())

    expect(document.activeElement).toBe(costField())
    expect(costField().getAttribute('aria-invalid')).toBe('true')
  })

  it('blocks a submit when the field holds only whitespace', async () => {
    const { user } = renderNewItemForm()
    await user.type(screen.getByLabelText(/English/), 'Teh Tarik')
    await user.type(screen.getByLabelText(/Price/), '3.50')
    await user.type(costField(), '   ')
    await user.click(submit())

    expect(createMenuItem).not.toHaveBeenCalled()
    expect(screen.getByTestId('cost-error').textContent).toBe('Cost is required.')
  })

  it('blocks a negative cost', async () => {
    const { user } = renderNewItemForm()
    await user.type(screen.getByLabelText(/English/), 'Teh Tarik')
    await user.type(screen.getByLabelText(/Price/), '3.50')
    await user.type(costField(), '-1')
    await user.click(submit())

    expect(createMenuItem).not.toHaveBeenCalled()
    expect(screen.getByTestId('cost-error').textContent).toBe('A price cannot be negative.')
  })

  it('blocks a cost that is not a number', async () => {
    const { user } = renderNewItemForm()
    await user.type(screen.getByLabelText(/English/), 'Teh Tarik')
    await user.type(screen.getByLabelText(/Price/), '3.50')
    await user.type(costField(), 'free')
    await user.click(submit())

    expect(createMenuItem).not.toHaveBeenCalled()
    expect(screen.getByTestId('cost-error')).not.toBeNull()
  })

  it('clears the complaint as soon as somebody starts typing', async () => {
    const { user } = renderNewItemForm()
    await user.type(screen.getByLabelText(/English/), 'Teh Tarik')
    await user.type(screen.getByLabelText(/Price/), '3.50')
    await user.click(submit())
    expect(screen.getByTestId('cost-error')).not.toBeNull()

    await user.type(costField(), '1')
    expect(screen.queryByTestId('cost-error')).toBeNull()
  })

  it('saves once a cost is supplied, in whole sen', async () => {
    const { user } = renderNewItemForm()
    await user.type(screen.getByLabelText(/English/), 'Teh Tarik')
    await user.type(screen.getByLabelText(/Price/), '3.50')
    await user.type(costField(), '1.20')
    await user.click(submit())

    expect(createMenuItem).toHaveBeenCalledTimes(1)
    expect(createMenuItem.mock.calls[0]?.[1]).toBe(120)
  })

  it('accepts zero — free to make is an answer, not a blank', async () => {
    const { user } = renderNewItemForm()
    await user.type(screen.getByLabelText(/English/), 'Tap water')
    await user.type(screen.getByLabelText(/Price/), '0')
    await user.type(costField(), '0')
    await user.click(submit())

    expect(createMenuItem).toHaveBeenCalledTimes(1)
    expect(createMenuItem.mock.calls[0]?.[1]).toBe(0)
  })
})

describe('the menu table flags an item with no cost', () => {
  function renderMenu() {
    return renderComponent(
      <MemoryRouter>
        <MenuListPage />
      </MemoryRouter>,
    )
  }

  it('names the problem instead of showing a dash', () => {
    renderMenu()
    const pill = screen.getByTestId('item-missing-cost')
    expect(pill.textContent).toContain('Missing cost')
  })

  it('links straight to the form that fixes it', () => {
    renderMenu()
    expect(screen.getByTestId('item-missing-cost').getAttribute('href')).toBe('/menu/item-ckt/edit')
  })

  it('flags only the item that is actually missing one', () => {
    renderMenu()
    expect(screen.getAllByTestId('item-missing-cost')).toHaveLength(1)
    // The item that has a cost still shows the figure.
    expect(screen.getByText('RM 0.80')).not.toBeNull()
  })

  it('says nothing when every item has a cost', () => {
    costs = new Map<string, number>([
      ['item-kopi', 80],
      ['item-ckt', 520],
    ])
    renderMenu()
    expect(screen.queryByTestId('item-missing-cost')).toBeNull()
  })
})
