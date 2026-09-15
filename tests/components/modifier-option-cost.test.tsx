// @vitest-environment jsdom
/**
 * The cost field on a modifier option.
 *
 * `GroupForm` is the one editor for a group, shared by the existing-item screen and the
 * new-item form, so pinning it here covers both. What matters is the seam it sits on: the
 * form is handed the costs rather than reading them, because the group document it renders
 * is staff-readable and deliberately carries no cost at all. Everything the form produces
 * goes to `onSave` as a `ModifierGroupInput`, and it is the API — not this component — that
 * decides which collection each half of that lands in.
 */
import { screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { renderComponent } from './render'

vi.mock('@/features/auth/useAuth', () => ({
  useAuth: () => ({ role: 'admin', profile: { uid: 'u1', role: 'admin' } }),
}))
vi.mock('@/features/menu/useModifierGroups', () => ({
  useModifierGroups: () => ({ groups: [], loading: false }),
}))
vi.mock('@/features/menu/useModifierOptionCosts', () => ({
  useModifierOptionCosts: () => ({ costs: new Map(), loading: false }),
}))
vi.mock('@/features/menu/menu-api', () => ({
  createModifierGroupForItem: vi.fn(),
  attachModifierGroup: vi.fn(),
  detachModifierGroup: vi.fn(),
  deleteModifierGroup: vi.fn(),
  setModifierGroupActive: vi.fn(),
  updateModifierGroup: vi.fn(),
  itemsUsingGroup: vi.fn().mockResolvedValue([]),
}))

import { GroupForm, ModifierGroupsEditor } from '@/features/menu/ModifierGroupsEditor'
import { modifierCostKey } from '@/features/menu/modifier-cost'
import type { ModifierGroup } from '@/features/menu/modifiers'

const GROUP_ID = 'g-addon'

const group = (): ModifierGroup => ({
  id: GROUP_ID,
  itemId: null,
  name: 'Add-on',
  selection: 'multiple',
  required: false,
  sortOrder: 0,
  active: true,
  options: [
    { id: 'opt-egg', name: 'Egg', priceAdjustment: 150, active: true },
    { id: 'opt-duck', name: 'Smoked Duck', priceAdjustment: 400, active: true },
  ],
  createdAt: null,
  updatedAt: null,
})

const costs = new Map([
  [modifierCostKey(GROUP_ID, 'opt-egg'), 40],
  [modifierCostKey(GROUP_ID, 'opt-duck'), 200],
])

const onSave = vi.fn()

function renderForm(withCosts: ReadonlyMap<string, number> | undefined = costs) {
  return renderComponent(
    <GroupForm group={group()} costs={withCosts} onSave={onSave} onCancel={() => {}} />,
  )
}

const costInputs = () => screen.getAllByTestId('option-cost') as HTMLInputElement[]
const save = () => screen.getByTestId('modifier-save-group')

beforeEach(() => {
  onSave.mockReset()
})

/**
 * The option table's layout.
 *
 * This exists because of a real regression: the row was a `flex flex-wrap` line whose name
 * cell was `flex-1 min-w-0`. Adding the cost column pushed the fixed-width cells past the
 * line, and the flexible cell — basis 0, minimum 0 — absorbed the shortfall instead of
 * wrapping, collapsing until its label and its text overflowed across the next column. The
 * name and the price ended up painted on top of each other.
 *
 * jsdom does not apply Tailwind or compute layout, so none of this can assert pixels. What it
 * CAN pin is the structure that made the overlap possible: one field per column, declared
 * tracks rather than a flex line, and the same template on the header and every row.
 */
/**
 * How much room the table gets.
 *
 * Three of the four columns are fixed widths, so the name column is purely what the card has
 * left over — which makes the card's own max-width part of the layout rather than styling.
 * At `max-w-xl` inside a 28rem page column the remainder came to about 50px and a name like
 * "Cheese Sausage" could not be read.
 */
describe('the editor card is wide enough for the name column', () => {
  const item = {
    id: 'i1',
    name: 'Braised Pork Rice',
    description: '',
    categoryId: 'c1',
    price: 900,
    sortOrder: 0,
    active: true,
    modifierGroupIds: [],
    createdAt: null,
    updatedAt: null,
  }

  it('caps the card at 2xl (42rem) rather than xl (36rem)', () => {
    renderComponent(<ModifierGroupsEditor item={item} />)

    const card = screen.getByTestId('modifier-editor')
    expect(card.className).toContain('max-w-2xl')
    expect(card.className).not.toContain('max-w-xl')
  })
})

describe('the option table lays each field out in its own column', () => {
  const rows = () => screen.getAllByTestId('option-row')

  it('heads the table once, with the four columns in order', () => {
    renderForm()

    const header = screen.getByTestId('option-columns')
    expect(header.textContent).toBe('NameAdds (RM)Cost (RM)Actions')
    // The inputs keep their own labels, so the headings must not be read out a second time.
    expect(header.getAttribute('aria-hidden')).toBe('true')
  })

  it('declares the same column template on the header and on every row', () => {
    renderForm()

    const template = 'sm:grid-cols-[minmax(0,1fr)_5.5rem_5.5rem_8.75rem]'
    expect(screen.getByTestId('option-columns').className).toContain(template)
    for (const row of rows()) {
      expect(row.className).toContain('grid')
      expect(row.className).toContain(template)
      // The layout that caused the overlap. A wrapping flex line cannot hold columns.
      expect(row.className).not.toContain('flex-wrap')
    }
  })

  it('gives every row exactly one name, one adds and one cost input', () => {
    renderForm()

    for (const row of rows()) {
      expect(within(row).getAllByLabelText('Name')).toHaveLength(1)
      expect(within(row).getAllByLabelText(/adds/i)).toHaveLength(1)
      expect(within(row).getAllByTestId('option-cost')).toHaveLength(1)
    }
  })

  it('keeps the name column able to shrink without spilling into the next one', () => {
    renderForm()

    // `minmax(0,1fr)` on the track and `min-w-0` on the cell are the pair that overrides a
    // grid item's automatic minimum size. Without them a long option name widens the column
    // and pushes the money fields out of their tracks.
    const nameCell = (within(rows()[0] as HTMLElement).getByLabelText('Name') as HTMLElement)
      .parentElement
    expect(nameCell?.className).toContain('min-w-0')
  })

  it('lays a newly added option out exactly like the existing ones', async () => {
    const { user } = renderForm()
    const before = rows().length

    await user.click(screen.getByTestId('modifier-add-option'))

    const after = rows()
    expect(after).toHaveLength(before + 1)
    const added = after[after.length - 1] as HTMLElement
    expect(added.className).toBe((after[0] as HTMLElement).className)
    expect(within(added).getAllByLabelText('Name')).toHaveLength(1)
    expect(within(added).getAllByTestId('option-cost')).toHaveLength(1)
    // A new option starts free to provide, stated rather than blank.
    expect((within(added).getByTestId('option-cost') as HTMLInputElement).value).toBe('0.00')
  })

  it('leaves an existing option’s values untouched by the layout', () => {
    renderForm()

    const first = rows()[0] as HTMLElement
    expect((within(first).getByLabelText('Name') as HTMLInputElement).value).toBe('Egg')
    expect((within(first).getByLabelText(/adds/i) as HTMLInputElement).value).toBe('1.50')
    expect((within(first).getByTestId('option-cost') as HTMLInputElement).value).toBe('0.40')
  })

  it('keeps the active toggle and the remove button, in the actions column', async () => {
    const { user } = renderForm()
    const first = rows()[0] as HTMLElement

    const toggle = within(first).getByTestId('option-toggle-active')
    expect(toggle.getAttribute('data-status')).toBe('active')
    await user.click(toggle)
    expect(within(first).getByTestId('option-toggle-active').getAttribute('data-status')).toBe(
      'inactive',
    )

    expect(within(first).getByRole('button', { name: /remove/i })).toBeTruthy()
  })
})

describe('an option carries a cost beside its price', () => {
  it('shows one cost input per option, seeded from the costs it was given', () => {
    renderForm()

    const inputs = costInputs()
    expect(inputs).toHaveLength(2)
    expect(inputs[0]?.value).toBe('0.40')
    expect(inputs[1]?.value).toBe('2.00')
  })

  it('keeps cost and selling price as separate fields', () => {
    renderForm()

    // The egg sells for RM1.50 and costs RM0.40. Reading one off the other is exactly the
    // mistake this pair of inputs exists to prevent.
    const priceInputs = screen.getAllByLabelText(/adds/i) as HTMLInputElement[]
    expect(priceInputs[0]?.value).toBe('1.50')
    expect(costInputs()[0]?.value).toBe('0.40')
  })

  it('passes the cost through to the caller in whole sen', async () => {
    const { user } = renderForm()

    await user.clear(costInputs()[0] as HTMLElement)
    await user.type(costInputs()[0] as HTMLElement, '0.90')
    await user.click(save())

    expect(onSave).toHaveBeenCalledTimes(1)
    const input = onSave.mock.calls[0]?.[0] as { options: { id: string; cost: number }[] }
    expect(input.options[0]).toMatchObject({ id: 'opt-egg', cost: 90 })
    // Untouched options keep what they had, so saving a group does not quietly rewrite them.
    expect(input.options[1]).toMatchObject({ id: 'opt-duck', cost: 200 })
  })

  it('keeps option ids stable when only the cost is edited', async () => {
    const { user } = renderForm()

    await user.clear(costInputs()[1] as HTMLElement)
    await user.type(costInputs()[1] as HTMLElement, '2.50')
    await user.click(save())

    // The ids are snapshotted onto every order line that chose them: minting a new one
    // because a cost moved would detach the cost from every sale that mentions the option.
    const input = onSave.mock.calls[0]?.[0] as { options: { id: string }[] }
    expect(input.options.map((option) => option.id)).toEqual(['opt-egg', 'opt-duck'])
  })

  it('treats an option with no recorded cost as zero rather than blank', () => {
    // An option that predates costing. Zero is shown because the field has to say what will
    // be journalled if the admin saves without touching it.
    renderForm(new Map())
    expect(costInputs()[0]?.value).toBe('0.00')
  })

  it('refuses a malformed cost and names the option, rather than saving a guess', async () => {
    const { user } = renderForm()

    await user.clear(costInputs()[0] as HTMLElement)
    await user.type(costInputs()[0] as HTMLElement, 'free')
    await user.click(save())

    expect(onSave).not.toHaveBeenCalled()
    expect(screen.getByText(/Egg/)).toBeTruthy()
  })

  it('accepts a blank cost as zero, which is a real answer for a free option', async () => {
    const { user } = renderForm()

    await user.clear(costInputs()[0] as HTMLElement)
    await user.click(save())

    const input = onSave.mock.calls[0]?.[0] as { options: { cost: number }[] }
    expect(input.options[0]?.cost).toBe(0)
  })
})
