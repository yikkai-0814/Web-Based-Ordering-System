// @vitest-environment jsdom
/**
 * Naming a menu item in three languages, and reading it back in one.
 *
 * The form is the only place translations are entered, and the till is the place they have
 * to be right: a counter set to Malay shows Malay, an item with no Malay name shows English
 * rather than a gap, and whichever name the counter was showing is the one that lands on the
 * order — permanently, because an order is a record of what was said at the time.
 *
 * The language is set the way a device sets it, through the stored preference the provider
 * reads at mount, rather than by a second language state invented for tests.
 */
import { screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { LANGUAGE_STORAGE_KEY } from '@/features/i18n/languages'

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
  { id: 'cat-mains', name: 'Mains', sortOrder: 0, active: true, createdAt: null, updatedAt: null },
]

/** Parsed items, as every hook hands them out: English in `name`, all three in `names`. */
const FRIED_RICE = {
  id: 'item-fried-rice',
  name: 'Fried Rice',
  names: { en: 'Fried Rice', ms: 'Nasi Goreng', zh: '炒饭' },
  description: '',
  categoryId: 'cat-mains',
  price: 800,
  sortOrder: 0,
  active: true,
  modifierGroupIds: [],
  createdAt: null,
  updatedAt: null,
}

/** An item as it exists today in the vendor's data: one name, no translations. */
const TEH_TARIK = {
  ...FRIED_RICE,
  id: 'item-teh',
  name: 'Teh Tarik',
  names: { en: 'Teh Tarik', ms: '', zh: '' },
  price: 250,
  sortOrder: 1,
}

let items = [FRIED_RICE, TEH_TARIK]

vi.mock('@/features/menu/useCategories', () => ({
  useCategories: () => ({ categories: CATEGORIES, loading: false, error: null }),
}))
vi.mock('@/features/menu/useMenuItems', () => ({
  useMenuItems: () => ({ items, loading: false, error: null }),
}))
vi.mock('@/features/menu/useItemCosts', () => ({
  useItemCosts: () => ({
    costs: new Map([
      ['item-fried-rice', 300],
      ['item-teh', 80],
    ]),
    loading: false,
    error: null,
  }),
}))
vi.mock('@/features/menu/useModifierGroups', () => ({
  useModifierGroups: () => ({ groups: [], loading: false, error: null }),
}))

import { MenuItemFormPage } from '@/features/menu/MenuItemFormPage'
import { MenuListPage } from '@/features/menu/MenuListPage'

function speakingIn(language: string) {
  window.localStorage.setItem(LANGUAGE_STORAGE_KEY, language)
}

function renderForm(path: string) {
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

function renderMenuList() {
  return renderComponent(
    <MemoryRouter>
      <MenuListPage />
    </MemoryRouter>,
  )
}

const english = () => screen.getByLabelText(/English/) as HTMLInputElement
const malay = () => screen.getByLabelText('Bahasa Melayu') as HTMLInputElement
const chinese = () => screen.getByLabelText('中文') as HTMLInputElement

/** What the last save was told this item is called. */
const savedInput = (mock: typeof createMenuItem) =>
  mock.mock.calls.at(-1)?.[0] as Record<string, unknown>

beforeEach(() => {
  window.localStorage.clear()
  items = [FRIED_RICE, TEH_TARIK]
  createMenuItem.mockReset()
  createMenuItem.mockResolvedValue('new-id')
  updateMenuItem.mockReset()
  updateMenuItem.mockResolvedValue(undefined)
})

afterEach(() => {
  window.localStorage.clear()
  document.documentElement.removeAttribute('lang')
})

describe('the form takes a name in each language', () => {
  it('offers one field per language, with English required', () => {
    renderForm('/menu/new')

    expect(screen.getByText('Menu item name')).not.toBeNull()
    expect(english().required).toBe(true)
    expect(malay().required).toBe(false)
    expect(chinese().required).toBe(false)
    // Said once, where the optional fields are, rather than repeated on each label.
    expect(screen.getByText(/Translations are optional/)).not.toBeNull()
  })

  it('saves all three when an admin fills all three in', async () => {
    const { user } = renderForm('/menu/new')

    await user.type(english(), 'Fried Rice')
    await user.type(malay(), 'Nasi Goreng')
    await user.type(chinese(), '炒饭')
    await user.type(screen.getByLabelText(/Price/), '8.00')
    await user.type(screen.getByTestId('cost'), '3.00')
    await user.click(screen.getByRole('button', { name: 'Create item' }))

    expect(savedInput(createMenuItem).name).toBe('Fried Rice')
    expect(savedInput(createMenuItem).names).toEqual({ ms: 'Nasi Goreng', zh: '炒饭' })
  })

  it('saves an item with no translations at all, exactly as before', async () => {
    const { user } = renderForm('/menu/new')

    await user.type(english(), 'Teh Tarik')
    await user.type(screen.getByLabelText(/Price/), '2.50')
    await user.type(screen.getByTestId('cost'), '0.80')
    await user.click(screen.getByRole('button', { name: 'Create item' }))

    expect(savedInput(createMenuItem).name).toBe('Teh Tarik')
    expect(savedInput(createMenuItem).names).toEqual({})
  })

  it('refuses to save without an English name, whatever else was typed', async () => {
    const { user } = renderForm('/menu/new')

    await user.type(malay(), 'Nasi Goreng')
    await user.type(screen.getByLabelText(/Price/), '8.00')
    await user.type(screen.getByTestId('cost'), '3.00')
    await user.click(screen.getByRole('button', { name: 'Create item' }))

    expect(createMenuItem).not.toHaveBeenCalled()
    expect(screen.getByText('Enter a name for this item.')).not.toBeNull()
  })

  it('treats a translation of nothing but spaces as no translation', async () => {
    const { user } = renderForm('/menu/new')

    await user.type(english(), 'Teh Tarik')
    await user.type(malay(), '   ')
    await user.type(screen.getByLabelText(/Price/), '2.50')
    await user.type(screen.getByTestId('cost'), '0.80')
    await user.click(screen.getByRole('button', { name: 'Create item' }))

    expect(savedInput(createMenuItem).names).toEqual({})
  })
})

describe('editing an item that already exists', () => {
  it('loads the English name into the English field', () => {
    renderForm('/menu/item-teh/edit')

    expect(english().value).toBe('Teh Tarik')
    expect(malay().value).toBe('')
    expect(chinese().value).toBe('')
  })

  it('loads every translation it already has', () => {
    renderForm('/menu/item-fried-rice/edit')

    expect(english().value).toBe('Fried Rice')
    expect(malay().value).toBe('Nasi Goreng')
    expect(chinese().value).toBe('炒饭')
  })

  it('does not erase Chinese when only Malay is edited', async () => {
    const { user } = renderForm('/menu/item-fried-rice/edit')

    await user.clear(malay())
    await user.type(malay(), 'Nasi Goreng Special')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    expect(updateMenuItem.mock.calls.at(-1)?.[1].names).toEqual({
      ms: 'Nasi Goreng Special',
      zh: '炒饭',
    })
  })

  it('does not erase Malay when only Chinese is edited', async () => {
    const { user } = renderForm('/menu/item-fried-rice/edit')

    await user.clear(chinese())
    await user.type(chinese(), '特制炒饭')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    expect(updateMenuItem.mock.calls.at(-1)?.[1].names).toEqual({
      ms: 'Nasi Goreng',
      zh: '特制炒饭',
    })
  })

  it('clears a translation the admin deliberately emptied', async () => {
    // The map is written whole, so removing a name removes it from the document too.
    const { user } = renderForm('/menu/item-fried-rice/edit')

    await user.clear(malay())
    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    expect(updateMenuItem.mock.calls.at(-1)?.[1].names).toEqual({ zh: '炒饭' })
  })

  it('never sends English inside the translations', async () => {
    const { user } = renderForm('/menu/item-fried-rice/edit')

    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    const input = updateMenuItem.mock.calls.at(-1)?.[1] as Record<string, unknown>
    expect(input.name).toBe('Fried Rice')
    expect(Object.keys(input.names as object)).toEqual(['ms', 'zh'])
  })
})

describe('the admin menu list speaks the language of the screen', () => {
  it('shows English names in English', () => {
    renderMenuList()
    expect(screen.getByText('Fried Rice')).not.toBeNull()
    expect(screen.getByText('Teh Tarik')).not.toBeNull()
  })

  it('shows the Malay name, and falls back for the item that has none', () => {
    speakingIn('ms')
    renderMenuList()

    expect(screen.getByText('Nasi Goreng')).not.toBeNull()
    expect(screen.queryByText('Fried Rice')).toBeNull()
    // No Malay name: the English one, rather than an empty cell.
    expect(screen.getByText('Teh Tarik')).not.toBeNull()
  })

  it('shows the Chinese name, and falls back for the item that has none', () => {
    speakingIn('zh')
    renderMenuList()

    expect(screen.getByText('炒饭')).not.toBeNull()
    expect(screen.getByText('Teh Tarik')).not.toBeNull()
  })
})
