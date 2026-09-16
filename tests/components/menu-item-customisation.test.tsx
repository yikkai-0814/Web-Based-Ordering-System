// @vitest-environment jsdom
/**
 * Creating a menu item and its customisation as one action.
 *
 * Before this, a group was keyed to an item id, so there was nothing to key one to until the
 * item existed and the form said "save the item first". Groups are now shared definitions and
 * the item records which it offers, which makes the whole configuration expressible before
 * anything is written — so the create form holds it and the API writes item, brand-new groups
 * and attachments in one batch.
 *
 * What is pinned here is the contract between the form and that batch: which ids are attached,
 * which definitions are new, and that editing an existing item still goes nowhere near it.
 */
import { screen, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { renderComponent } from './render'

const createMenuItem = vi.hoisted(() => vi.fn())
const updateMenuItem = vi.hoisted(() => vi.fn())

vi.mock('@/features/menu/menu-api', () => ({
  createMenuItem,
  updateMenuItem,
  createModifierGroupForItem: vi.fn(),
  attachModifierGroup: vi.fn(),
  detachModifierGroup: vi.fn(),
  deleteModifierGroup: vi.fn(),
  setModifierGroupActive: vi.fn(),
  updateModifierGroup: vi.fn(),
  itemsUsingGroup: vi.fn().mockResolvedValue([]),
}))

vi.mock('@/features/auth/useAuth', () => ({
  useAuth: () => ({ role: 'admin', profile: { uid: 'u1', role: 'admin' } }),
}))

const CATEGORIES = [
  {
    id: 'cat-drinks',
    name: 'Drinks',
    sortOrder: 0,
    active: true,
    createdAt: null,
    updatedAt: null,
  },
]

/** Two shared definitions that already exist — the pool a new item can reuse. */
const SUGAR = {
  id: 'g-sugar',
  itemId: null,
  name: 'Sugar Level',
  selection: 'single' as const,
  required: true,
  sortOrder: 0,
  active: true,
  options: [{ id: 'o-normal', name: 'Normal', priceAdjustment: 0, active: true }],
  createdAt: null,
  updatedAt: null,
}
const ICE = { ...SUGAR, id: 'g-ice', name: 'Ice Level' }
/** Owned by another item — item-specific, and therefore not reusable here. */
const OWNED = { ...SUGAR, id: 'g-owned', itemId: 'item-burger', name: 'Patty Cooking Level' }

vi.mock('@/features/menu/useCategories', () => ({
  useCategories: () => ({ categories: CATEGORIES, loading: false, error: null }),
}))
vi.mock('@/features/menu/useMenuItems', () => ({
  useMenuItems: () => ({ items: [], loading: false, error: null }),
}))
vi.mock('@/features/menu/useItemCosts', () => ({
  useItemCosts: () => ({ costs: new Map<string, number>(), loading: false, error: null }),
}))
vi.mock('@/features/menu/useModifierGroups', () => ({
  useModifierGroups: () => ({ groups: [SUGAR, ICE, OWNED], loading: false, error: null }),
}))

import { MenuItemFormPage } from '@/features/menu/MenuItemFormPage'

function renderNewItemForm() {
  return renderComponent(
    <MemoryRouter initialEntries={['/menu/new']}>
      <Routes>
        <Route path="/menu/new" element={<MenuItemFormPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

type User = ReturnType<typeof renderNewItemForm>['user']

/** Fills the fields that are compulsory, so a submit reaches the API. */
async function fillDetails(user: User) {
  await user.type(screen.getByLabelText(/English/), 'Milk Tea')
  await user.type(screen.getByTestId('cost'), '1.20')
  await user.type(screen.getByLabelText(/Price/), '4.50')
}

async function attachExisting(user: User, label: string) {
  await user.selectOptions(screen.getByTestId('reuse-group-select'), label)
  await user.click(screen.getByTestId('reuse-group-add'))
}

/** Creates a group through the very form the edit screen uses. */
async function createGroup(
  user: User,
  name: string,
  optionName: string,
  sharing?: 'shared' | 'item',
) {
  await user.click(screen.getByTestId('create-new-group'))
  const form = screen.getByTestId('modifier-group-form')
  await user.type(within(form).getByLabelText('Group name'), name)
  if (sharing) {
    await user.selectOptions(within(form).getByTestId('group-sharing'), sharing)
  }
  const firstOption = within(form).getAllByTestId('option-row')[0] as HTMLElement
  await user.type(within(firstOption).getByLabelText('Name'), optionName)
  await user.click(within(form).getByTestId('modifier-save-group'))
}

const submit = (user: User) => user.click(screen.getByRole('button', { name: 'Create item' }))

beforeEach(() => {
  createMenuItem.mockReset()
  createMenuItem.mockResolvedValue('new-id')
  updateMenuItem.mockReset()
})

describe('creating an item together with its customisation', () => {
  it('1. creates an item with no customisation at all', async () => {
    const { user } = renderNewItemForm()
    await fillDetails(user)
    await submit(user)

    expect(createMenuItem).toHaveBeenCalledTimes(1)
    const [input, cost, newGroups] = createMenuItem.mock.calls[0] as [
      { modifierGroupIds: string[] },
      number,
      unknown[],
    ]
    expect(input.modifierGroupIds).toEqual([])
    expect(cost).toBe(120)
    expect(newGroups).toEqual([])
  })

  it('2. creates an item with a brand-new group, written in the same call', async () => {
    const { user } = renderNewItemForm()
    await fillDetails(user)
    await createGroup(user, 'Toppings', 'Pearl')
    await submit(user)

    const [input, , newGroups] = createMenuItem.mock.calls[0] as [
      { modifierGroupIds: string[] },
      number,
      { name: string; options: { name: string }[] }[],
    ]
    // Nothing was written before Create: the group travels with the item.
    expect(input.modifierGroupIds).toEqual([])
    expect(newGroups).toHaveLength(1)
    expect(newGroups[0]?.name).toBe('Toppings')
    expect(newGroups[0]?.options[0]?.name).toBe('Pearl')
  })

  it('3. creates an item that reuses a group that already exists', async () => {
    const { user } = renderNewItemForm()
    await fillDetails(user)
    await attachExisting(user, 'Sugar Level')
    await submit(user)

    const [input, , newGroups] = createMenuItem.mock.calls[0] as [
      { modifierGroupIds: string[] },
      number,
      unknown[],
    ]
    // Attached by id. The shared definition itself is not rewritten.
    expect(input.modifierGroupIds).toEqual(['g-sugar'])
    expect(newGroups).toEqual([])
  })

  it('4. creates an item using an existing group and a new one, in the order added', async () => {
    const { user } = renderNewItemForm()
    await fillDetails(user)
    await attachExisting(user, 'Ice Level')
    await attachExisting(user, 'Sugar Level')
    await createGroup(user, 'Toppings', 'Pearl')
    await submit(user)

    const [input, , newGroups] = createMenuItem.mock.calls[0] as [
      { modifierGroupIds: string[] },
      number,
      { name: string }[],
    ]
    expect(input.modifierGroupIds).toEqual(['g-ice', 'g-sugar'])
    expect(newGroups.map((group) => group.name)).toEqual(['Toppings'])
  })

  it('offers Shared by default, and says what that means', async () => {
    const { user } = renderNewItemForm()
    await user.click(screen.getByTestId('create-new-group'))

    const sharing = screen.getByTestId('group-sharing') as HTMLSelectElement
    expect(sharing.value).toBe('shared')
    // The consequence is stated, not left to be discovered by surprising three other items.
    expect(screen.getByTestId('group-sharing-hint').textContent).toMatch(
      /changes every item using it/i,
    )
  })

  it('marks a new group shared when Shared is chosen', async () => {
    const { user } = renderNewItemForm()
    await fillDetails(user)
    await createGroup(user, 'Sugar Level', 'Normal', 'shared')
    await submit(user)

    const [, , newGroups] = createMenuItem.mock.calls[0] as [
      unknown,
      number,
      { name: string; shared: boolean }[],
    ]
    expect(newGroups[0]?.shared).toBe(true)
  })

  it('marks a new group item-specific when This item only is chosen', async () => {
    const { user } = renderNewItemForm()
    await fillDetails(user)
    await createGroup(user, 'Patty Cooking Level', 'Medium', 'item')
    await submit(user)

    const [, , newGroups] = createMenuItem.mock.calls[0] as [
      unknown,
      number,
      { name: string; shared: boolean }[],
    ]
    expect(newGroups[0]?.shared).toBe(false)
    expect(newGroups[0]?.name).toBe('Patty Cooking Level')
  })

  it('changes the hint when the choice changes', async () => {
    const { user } = renderNewItemForm()
    await user.click(screen.getByTestId('create-new-group'))
    await user.selectOptions(screen.getByTestId('group-sharing'), 'item')
    expect(screen.getByTestId('group-sharing-hint').textContent).toMatch(
      /Belongs to this item alone/i,
    )
  })

  it('never offers another item’s private group for reuse', () => {
    renderNewItemForm()
    // OWNED belongs to one item, so it must not appear in the pool this form can draw on —
    // attaching it would let this item change something another item owns.
    const options = within(screen.getByTestId('reuse-group-select'))
      .getAllByRole('option')
      .map((option) => option.textContent)
    expect(options).toContain('Sugar Level')
    expect(options).toContain('Ice Level')
    expect(options).not.toContain('Patty Cooking Level')
  })

  it('tells the three states apart on screen', async () => {
    const { user } = renderNewItemForm()
    await attachExisting(user, 'Sugar Level')
    await createGroup(user, 'Toppings', 'Pearl')

    // Attached: shown as shared, and removable.
    const attached = screen.getByTestId('attached-group')
    expect(within(attached).getByText('Sugar Level')).toBeTruthy()
    expect(within(attached).getByText('Shared')).toBeTruthy()

    // Being invented: marked new, and said to be created on save.
    const draft = screen.getByTestId('draft-group')
    expect(within(draft).getByText('Toppings')).toBeTruthy()
    expect(within(draft).getByText('New')).toBeTruthy()

    // Still reusable, and no longer offered because it is already on this item.
    const options = within(screen.getByTestId('reuse-group-select')).getAllByRole('option')
    expect(options.map((option) => option.textContent)).not.toContain('Sugar Level')
  })

  it('removes an attached group without it ceasing to exist', async () => {
    const { user } = renderNewItemForm()
    await fillDetails(user)
    await attachExisting(user, 'Sugar Level')
    await user.click(screen.getByTestId('detach-group'))

    // Still offered for reuse: removing it from this item is not deleting it. Checked before
    // submitting, because a successful create navigates away.
    const options = within(screen.getByTestId('reuse-group-select')).getAllByRole('option')
    expect(options.map((option) => option.textContent)).toContain('Sugar Level')

    await submit(user)
    const [input] = createMenuItem.mock.calls[0] as [{ modifierGroupIds: string[] }]
    expect(input.modifierGroupIds).toEqual([])
  })

  it('never translates a vendor-entered group name', async () => {
    const { user } = renderNewItemForm()
    await attachExisting(user, 'Sugar Level')
    // Exactly as typed by the vendor, in the picker and in the attached list.
    expect(within(screen.getByTestId('attached-group')).getByText('Sugar Level')).toBeTruthy()
  })
})
