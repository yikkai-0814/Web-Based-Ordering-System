// @vitest-environment jsdom
/**
 * Asking how the customer wants an item made.
 *
 * The rules themselves are proven exhaustively in tests/unit. What is proven here is that the
 * screen obeys them: that a required group blocks "Add to Order" with a reason, that an
 * optional one does not, that a one-choice group replaces rather than accumulates, and that
 * the price the counter reads aloud is the price that reaches the cart.
 */
import { screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { ItemCustomisationDialog } from '@/features/pos/ItemCustomisationDialog'
import type { ModifierGroup } from '@/features/menu/modifiers'
import type { MenuItem } from '@/features/menu/types'

import { renderComponent } from './render'

const ITEM: MenuItem = {
  id: 'ccr',
  name: 'Chicken Chop Rice',
  description: '',
  categoryId: 'mains',
  price: 800,
  sortOrder: 0,
  active: true,
  createdAt: null,
  updatedAt: null,
}

function group(over: Partial<ModifierGroup> = {}): ModifierGroup {
  return {
    id: 'g-veg',
    itemId: 'ccr',
    name: 'Vegetables',
    selection: 'single',
    required: true,
    sortOrder: 0,
    active: true,
    options: [
      { id: 'veg-normal', name: 'Normal', priceAdjustment: 0, active: true },
      { id: 'veg-none', name: 'No vegetables', priceAdjustment: 0, active: true },
    ],
    createdAt: null,
    updatedAt: null,
    ...over,
  }
}

const ADDONS = group({
  id: 'g-addons',
  name: 'Add-ons',
  selection: 'multiple',
  required: false,
  options: [
    { id: 'add-egg', name: 'Extra egg', priceAdjustment: 100, active: true },
    { id: 'add-chicken', name: 'Extra chicken', priceAdjustment: 300, active: true },
  ],
})

function setup(groups: ModifierGroup[]) {
  const onAdd = vi.fn()
  const onCancel = vi.fn()
  const rendered = renderComponent(
    <ItemCustomisationDialog item={ITEM} groups={groups} onAdd={onAdd} onCancel={onCancel} />,
  )
  return { ...rendered, onAdd, onCancel }
}

const price = () => screen.getByTestId('customise-price').textContent
const addButton = () => screen.getByTestId('customise-add') as HTMLButtonElement

function optionById(id: string) {
  const found = screen
    .getAllByTestId('modifier-option')
    .find((node) => node.getAttribute('data-option-id') === id)
  if (!found) throw new Error(`no option ${id}`)
  return found
}

describe('what the dialog shows', () => {
  it('names the item and its base price', () => {
    setup([group()])
    expect(screen.getByTestId('customise-title').textContent).toBe('Chicken Chop Rice')
    expect(price()).toBe('RM 8.00')
  })

  it('shows every group and its options', () => {
    setup([group(), ADDONS])
    expect(screen.getAllByTestId('modifier-group')).toHaveLength(2)
    expect(screen.getAllByTestId('modifier-option')).toHaveLength(4)
  })

  it('shows the surcharge on options that carry one, and nothing on those that do not', () => {
    setup([group(), ADDONS])
    expect(optionById('add-egg').textContent).toContain('RM 1.00')
    expect(optionById('veg-none').textContent).not.toMatch(/RM/)
  })
})

describe('a required group must be answered', () => {
  it('blocks the add with a reason when nothing is chosen', async () => {
    // A required multi-select has no sensible default, so it starts unanswered.
    const { user } = setup([group({ ...ADDONS, required: true })])
    expect(addButton().disabled).toBe(true)
    // The vendor's own word, exactly as they typed it rather than case-folded.
    expect(screen.getByTestId('customise-error').textContent).toContain('Add-ons')

    await user.click(optionById('add-egg'))
    expect(addButton().disabled).toBe(false)
  })

  it('starts a required one-choice group on its first option, so the common case is one tap', () => {
    const { onAdd } = setup([group()])
    expect(addButton().disabled).toBe(false)
    expect(optionById('veg-normal').getAttribute('data-selected')).toBe('true')
    expect(onAdd).not.toHaveBeenCalled()
  })
})

describe('an optional group may be skipped', () => {
  it('allows the add with nothing chosen', async () => {
    const { user, onAdd } = setup([ADDONS])
    expect(addButton().disabled).toBe(false)

    await user.click(addButton())
    expect(onAdd).toHaveBeenCalledWith([])
  })
})

describe('single-select replaces, multi-select accumulates', () => {
  it('replaces the previous choice within a one-choice group', async () => {
    const { user, onAdd } = setup([group()])
    await user.click(optionById('veg-none'))

    expect(optionById('veg-normal').getAttribute('data-selected')).toBe('false')
    expect(optionById('veg-none').getAttribute('data-selected')).toBe('true')

    await user.click(addButton())
    expect(onAdd).toHaveBeenCalledWith([
      expect.objectContaining({ optionId: 'veg-none', groupId: 'g-veg' }),
    ])
  })

  it('keeps several choices within a multi-choice group', async () => {
    const { user, onAdd } = setup([ADDONS])
    await user.click(optionById('add-egg'))
    await user.click(optionById('add-chicken'))

    await user.click(addButton())
    expect(onAdd.mock.calls[0]?.[0]).toHaveLength(2)
  })

  it('lets a chosen option be tapped off again', async () => {
    const { user } = setup([ADDONS])
    await user.click(optionById('add-egg'))
    expect(optionById('add-egg').getAttribute('data-selected')).toBe('true')

    await user.click(optionById('add-egg'))
    expect(optionById('add-egg').getAttribute('data-selected')).toBe('false')
  })
})

describe('the running price is the price that reaches the cart', () => {
  it('adds a surcharge as it is chosen', async () => {
    const { user } = setup([ADDONS])
    expect(price()).toBe('RM 8.00')

    await user.click(optionById('add-egg'))
    expect(price()).toBe('RM 9.00')

    await user.click(optionById('add-chicken'))
    expect(price()).toBe('RM 12.00')
  })

  it('takes it away again when the option is deselected', async () => {
    const { user } = setup([ADDONS])
    await user.click(optionById('add-chicken'))
    expect(price()).toBe('RM 11.00')

    await user.click(optionById('add-chicken'))
    expect(price()).toBe('RM 8.00')
  })

  it('hands back exactly the choices that produced the price', async () => {
    const { user, onAdd } = setup([group(), ADDONS])
    await user.click(optionById('veg-none'))
    await user.click(optionById('add-chicken'))
    expect(price()).toBe('RM 11.00')

    await user.click(addButton())
    const selections = onAdd.mock.calls[0]?.[0] as { optionId: string; priceAdjustment: number }[]
    expect(selections.map((entry) => entry.optionId).sort()).toEqual(['add-chicken', 'veg-none'])
    expect(selections.reduce((sum, entry) => sum + entry.priceAdjustment, 0)).toBe(300)
  })
})

describe('cancelling', () => {
  it('adds nothing', async () => {
    const { user, onAdd, onCancel } = setup([group()])
    await user.click(screen.getByTestId('customise-cancel'))
    expect(onCancel).toHaveBeenCalled()
    expect(onAdd).not.toHaveBeenCalled()
  })
})

describe('the snapshot handed to the cart', () => {
  it('carries the group and option names, not just their ids', async () => {
    // This is what lets a receipt read correctly after the group has been deleted.
    const { user, onAdd } = setup([group()])
    await user.click(optionById('veg-none'))
    await user.click(addButton())

    expect(onAdd).toHaveBeenCalledWith([
      {
        groupId: 'g-veg',
        groupName: 'Vegetables',
        optionId: 'veg-none',
        optionName: 'No vegetables',
        priceAdjustment: 0,
      },
    ])
  })
})
