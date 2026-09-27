// @vitest-environment jsdom
/**
 * The same sort-order arrows, on every sort order an admin can set.
 *
 * The menu item form had them first (see menu-sort-order.test.tsx). The other three fields —
 * a new category, a category being edited in its row, and a modifier group — now use the one
 * shared field, so what is pinned here is that each of them behaves the same way: a number
 * input that still takes typing, two `type="button"` arrows that move it by exactly one with no
 * floor or ceiling, labels in the device's language, and each form's own whole-number check
 * left exactly as it was.
 */
import { screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { LANGUAGE_STORAGE_KEY } from '@/features/i18n/languages'

import { renderComponent } from './render'

const createCategory = vi.hoisted(() => vi.fn())
const updateCategory = vi.hoisted(() => vi.fn())

vi.mock('@/features/auth/useAuth', () => ({
  useAuth: () => ({ role: 'admin', profile: { uid: 'u1', role: 'admin' } }),
}))
vi.mock('@/features/menu/menu-api', () => ({
  createCategory,
  updateCategory,
  deleteCategory: vi.fn(),
  setCategoryActive: vi.fn(),
  createModifierGroupForItem: vi.fn(),
  attachModifierGroup: vi.fn(),
  detachModifierGroup: vi.fn(),
  deleteModifierGroup: vi.fn(),
  setModifierGroupActive: vi.fn(),
  updateModifierGroup: vi.fn(),
  itemsUsingGroup: vi.fn().mockResolvedValue([]),
}))

/** One category already in fourth place, so an edit starts from something other than zero. */
const CATEGORIES = [
  {
    id: 'cat-coffee',
    name: 'Coffee',
    sortOrder: 4,
    active: true,
    createdAt: null,
    updatedAt: null,
  },
]

vi.mock('@/features/menu/useCategories', () => ({
  useCategories: () => ({ categories: CATEGORIES, loading: false, error: null }),
}))
vi.mock('@/features/menu/useMenuItems', () => ({
  useMenuItems: () => ({ items: [], loading: false, error: null }),
}))
vi.mock('@/features/menu/useModifierGroups', () => ({
  useModifierGroups: () => ({ groups: [], loading: false }),
}))
vi.mock('@/features/menu/useModifierOptionCosts', () => ({
  useModifierOptionCosts: () => ({ costs: new Map(), loading: false }),
}))

import { CategoriesPage } from '@/features/menu/CategoriesPage'
import { GroupForm } from '@/features/menu/ModifierGroupsEditor'
import type { ModifierGroup } from '@/features/menu/modifiers'

const onSave = vi.fn()

/** A group that passes every other check the form makes, so a save reaches the sort order. */
const group = (): ModifierGroup => ({
  id: 'g-sugar',
  itemId: null,
  name: 'Sugar Level',
  selection: 'single',
  required: true,
  sortOrder: 2,
  active: true,
  options: [
    {
      id: 'o-normal',
      name: 'Normal',
      names: { en: 'Normal', ms: '', zh: '' },
      priceAdjustment: 0,
      active: true,
    },
  ],
  createdAt: null,
  updatedAt: null,
})

const renderCategories = () =>
  renderComponent(
    <MemoryRouter>
      <CategoriesPage />
    </MemoryRouter>,
  )
const renderGroup = (existing: ModifierGroup | null = group()) =>
  renderComponent(<GroupForm group={existing} onSave={onSave} onCancel={() => {}} />)

const field = (id: string) => document.getElementById(id) as HTMLInputElement
const arrow = (testId: string, way: 'increase' | 'decrease') =>
  screen.getByTestId(`${testId}-${way}`) as HTMLButtonElement

beforeEach(() => {
  window.localStorage.clear()
  createCategory.mockReset()
  createCategory.mockResolvedValue(undefined)
  updateCategory.mockReset()
  updateCategory.mockResolvedValue(undefined)
  onSave.mockReset()
})

afterEach(() => {
  window.localStorage.clear()
  document.documentElement.removeAttribute('lang')
})

/**
 * The three fields, each described by how to put it on screen and what its arrows are called.
 * The shared behaviour is asserted once per field from this list, so a fourth sort order added
 * later is one more row rather than one more copy of every test.
 */
const FIELDS = [
  {
    name: 'a new category',
    inputId: 'new-category-sort',
    testId: 'new-category-sort-order',
    start: '0',
    show: async () => renderCategories(),
  },
  {
    name: 'a category being edited',
    inputId: 'edit-category-sort',
    testId: 'category-sort-order',
    start: '4',
    show: async () => {
      const rendered = renderCategories()
      await rendered.user.click(screen.getByRole('button', { name: 'Rename Coffee' }))
      return rendered
    },
  },
  {
    name: 'a modifier group',
    inputId: 'group-sort',
    testId: 'group-sort-order',
    start: '2',
    show: async () => renderGroup(),
  },
] as const

describe.each(FIELDS)('the sort order of $name', ({ inputId, testId, start, show }) => {
  it('is a number input stepping by one, starting from its current value', async () => {
    await show()

    expect(field(inputId).type).toBe('number')
    expect(field(inputId).step).toBe('1')
    expect(field(inputId).getAttribute('inputMode')).toBe('numeric')
    expect(field(inputId).value).toBe(start)
  })

  it('has two labelled arrows, neither of which submits anything', async () => {
    await show()

    expect(arrow(testId, 'increase').type).toBe('button')
    expect(arrow(testId, 'decrease').type).toBe('button')
    expect(arrow(testId, 'increase').getAttribute('aria-label')).toBe('Increase sort order')
    expect(arrow(testId, 'decrease').getAttribute('aria-label')).toBe('Decrease sort order')
    expect(arrow(testId, 'increase').getAttribute('aria-controls')).toBe(inputId)
  })

  it('adds exactly one', async () => {
    const { user } = await show()

    await user.click(arrow(testId, 'increase'))
    expect(field(inputId).value).toBe(String(Number(start) + 1))

    await user.click(arrow(testId, 'increase'))
    expect(field(inputId).value).toBe(String(Number(start) + 2))
  })

  it('takes away exactly one, and goes below zero because nothing says it may not', async () => {
    const { user } = await show()

    for (let step = 1; step <= Number(start) + 2; step += 1) {
      await user.click(arrow(testId, 'decrease'))
    }

    expect(field(inputId).value).toBe('-2')
    expect(arrow(testId, 'decrease').disabled).toBe(false)
  })

  it('still takes a typed value, and steps from it', async () => {
    const { user } = await show()

    await user.clear(field(inputId))
    await user.type(field(inputId), '7')
    expect(field(inputId).value).toBe('7')

    await user.click(arrow(testId, 'decrease'))
    expect(field(inputId).value).toBe('6')
  })

  it('reads an emptied field as zero', async () => {
    const { user } = await show()

    await user.clear(field(inputId))
    await user.click(arrow(testId, 'increase'))

    expect(field(inputId).value).toBe('1')
  })
})

describe('arrow labels in the device language', () => {
  it.each([
    ['ms', 'Tambah susunan', 'Kurangkan susunan'],
    ['zh', '增加排序值', '减少排序值'],
  ])('are translated into %s on every sort-order field', async (language, up, down) => {
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, language)
    const { user } = renderCategories()
    // The row's first action is Rename; found by position because its label is translated too.
    await user.click(within(screen.getByTestId('category-row')).getAllByRole('button')[0]!)

    for (const testId of ['new-category-sort-order', 'category-sort-order']) {
      expect(arrow(testId, 'increase').getAttribute('aria-label')).toBe(up)
      expect(arrow(testId, 'decrease').getAttribute('aria-label')).toBe(down)
    }
  })

  it.each([
    ['ms', 'Tambah susunan', 'Kurangkan susunan'],
    ['zh', '增加排序值', '减少排序值'],
  ])('are translated into %s on the modifier group form', (language, up, down) => {
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, language)
    renderGroup()

    expect(arrow('group-sort-order', 'increase').getAttribute('aria-label')).toBe(up)
    expect(arrow('group-sort-order', 'decrease').getAttribute('aria-label')).toBe(down)
  })
})

describe('what the category forms save, unchanged', () => {
  it('creates a category with a stepped sort order', async () => {
    const { user } = renderCategories()

    await user.type(screen.getByLabelText('New category'), 'Tea')
    await user.click(arrow('new-category-sort-order', 'increase'))
    await user.click(arrow('new-category-sort-order', 'increase'))
    await user.click(screen.getByRole('button', { name: 'Add' }))

    expect(createCategory).toHaveBeenCalledWith({ name: 'Tea', sortOrder: 2, active: true })
  })

  it('does not create anything when an arrow is clicked', async () => {
    const { user } = renderCategories()

    await user.type(screen.getByLabelText('New category'), 'Tea')
    await user.click(arrow('new-category-sort-order', 'increase'))
    await user.click(arrow('new-category-sort-order', 'decrease'))

    expect(createCategory).not.toHaveBeenCalled()
  })

  it('still refuses a sort order that is not a whole number when creating', async () => {
    const { user } = renderCategories()

    await user.type(screen.getByLabelText('New category'), 'Tea')
    await user.clear(field('new-category-sort'))
    await user.type(field('new-category-sort'), '1.5')
    await user.click(screen.getByRole('button', { name: 'Add' }))

    expect(createCategory).not.toHaveBeenCalled()
    expect(screen.getByText('Sort order must be a whole number.')).not.toBeNull()
  })

  it('saves an edited category with a stepped sort order', async () => {
    const { user } = renderCategories()

    await user.click(screen.getByRole('button', { name: 'Rename Coffee' }))
    await user.click(arrow('category-sort-order', 'decrease'))
    const row = screen.getByTestId('category-row')
    await user.click(within(row).getByRole('button', { name: 'Save' }))

    expect(updateCategory).toHaveBeenCalledWith('cat-coffee', {
      name: 'Coffee',
      sortOrder: 3,
      active: true,
    })
  })

  it('still refuses a sort order that is not a whole number when editing', async () => {
    const { user } = renderCategories()

    await user.click(screen.getByRole('button', { name: 'Rename Coffee' }))
    await user.clear(field('edit-category-sort'))
    await user.type(field('edit-category-sort'), '2.5')
    await user.click(
      within(screen.getByTestId('category-row')).getByRole('button', { name: 'Save' }),
    )

    expect(updateCategory).not.toHaveBeenCalled()
    expect(screen.getByText('Sort order must be a whole number.')).not.toBeNull()
  })
})

describe('what the modifier group form saves, unchanged', () => {
  const saved = () => onSave.mock.calls.at(-1)?.[0] as { sortOrder: number } | undefined

  it('saves a stepped sort order', async () => {
    const { user } = renderGroup()

    await user.click(arrow('group-sort-order', 'increase'))
    await user.click(screen.getByRole('button', { name: 'Save group' }))

    expect(saved()?.sortOrder).toBe(3)
  })

  it('saves a typed sort order', async () => {
    const { user } = renderGroup()

    await user.clear(field('group-sort'))
    await user.type(field('group-sort'), '9')
    await user.click(screen.getByRole('button', { name: 'Save group' }))

    expect(saved()?.sortOrder).toBe(9)
  })

  it('does not save when an arrow is clicked', async () => {
    const { user } = renderGroup()

    await user.click(arrow('group-sort-order', 'increase'))
    await user.click(arrow('group-sort-order', 'decrease'))

    expect(onSave).not.toHaveBeenCalled()
  })

  it('still refuses a sort order that is not a whole number', async () => {
    const { user } = renderGroup()

    await user.clear(field('group-sort'))
    await user.type(field('group-sort'), '1.5')
    await user.click(screen.getByRole('button', { name: 'Save group' }))

    expect(onSave).not.toHaveBeenCalled()
    expect(screen.getByText('Sort order must be a whole number.')).not.toBeNull()
  })
})
