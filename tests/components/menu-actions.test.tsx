// @vitest-environment jsdom
/**
 * The actions on a menu item row line up with each other.
 *
 * Edit used to sit a few pixels above Archive and Delete, and the cause was not a margin.
 * The three controls were inline-level boxes in a text-aligned cell, so they shared a
 * baseline — and an `inline-flex` box takes its baseline from its first child. Archive and
 * Delete begin with text and so offered a real text baseline; Edit begins with the Pencil,
 * and an SVG has none, so the browser synthesized one from the bottom edge of the icon and
 * hung the whole button from there.
 *
 * The fix is to stop aligning them by baseline at all: one flex row, boxes aligned to each
 * other. jsdom has no layout and so cannot measure the pixels, but it can hold the structure
 * that decides them — one row, three flex items, the same size on each, and no per-button
 * offset quietly compensating for anything.
 */
import { screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { describe, expect, it, vi } from 'vitest'

import { MenuListPage } from '@/features/menu/MenuListPage'

import { renderComponent } from './render'

vi.mock('@/features/auth/useAuth', () => ({
  useAuth: () => ({ role: 'admin', profile: { uid: 'u1', role: 'admin' } }),
}))

vi.mock('@/features/menu/menu-api', () => ({
  createMenuItem: vi.fn(),
  updateMenuItem: vi.fn(),
  deleteMenuItem: vi.fn(),
  setMenuItemActive: vi.fn(),
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

/** A short name and a very long one, because a row's width must not move its actions. */
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
    name: 'Char Kway Teow with Extra Prawns and a Fried Egg on Top',
    description: 'A description long enough to wrap the first column on a narrow screen.',
    categoryId: 'cat-coffee',
    price: 1000,
    sortOrder: 1,
    active: false,
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

function renderMenu() {
  return renderComponent(
    <MemoryRouter>
      <MenuListPage />
    </MemoryRouter>,
  )
}

function rowFor(name: string): HTMLElement {
  const row = screen
    .getAllByTestId('menu-item-row')
    .find((candidate) => candidate.getAttribute('data-item-name') === name)
  if (!row) throw new Error(`No row for ${name}`)
  return row
}

/** The Edit control, which is a link wearing a button's clothes. */
function editIn(row: HTMLElement): HTMLElement {
  return within(row).getByRole('link', { name: `Edit ${row.getAttribute('data-item-name')}` })
}

/**
 * Every control in the row, in the order it is rendered. Found by the `data-variant` and
 * `data-size` that `Button` stamps on whatever it renders, rather than by `data-slot`:
 * Radix's dialog trigger overwrites the slot on the button it wraps, which is exactly the
 * kind of detail that would make this suite quietly stop looking at Delete.
 */
function actionsIn(row: HTMLElement): HTMLElement[] {
  return [...row.querySelectorAll('[data-variant][data-size]')] as HTMLElement[]
}

/** The flex row the actions sit in. */
function actionRowOf(row: HTMLElement): HTMLElement {
  const parent = editIn(row).parentElement
  if (!parent) throw new Error('Edit has no parent')
  return parent
}

/**
 * The classes that apply unconditionally — a variant like `active:translate-y-px` is a
 * press effect, not a resting offset, and must not be mistaken for one.
 */
function restingClasses(element: HTMLElement): string[] {
  return [...element.classList].filter((name) => !name.includes(':'))
}

const SHORT = 'Kopi O'
const LONG = 'Char Kway Teow with Extra Prawns and a Fried Egg on Top'

describe('the three actions are one row, not three inline boxes', () => {
  it('puts Edit, Archive and Delete in the same flex container', () => {
    renderMenu()
    const row = rowFor(SHORT)
    const actionRow = actionRowOf(row)

    // Aligned to each other, not to a text baseline: this is what fixes the icon.
    expect(actionRow.className).toMatch(/\bflex\b/)
    expect(actionRow.className).toMatch(/\bitems-center\b/)
    // Right-aligned as a group, in the column that is right-aligned in its header.
    expect(actionRow.className).toMatch(/\bjustify-end\b/)

    // All three are children of that one row, so all three are flex items. Edit being a
    // sibling of the others is the whole of the fix.
    for (const action of actionsIn(row)) {
      expect(action.parentElement).toBe(actionRow)
    }
  })

  it('keeps the actions in their existing order', () => {
    renderMenu()
    expect(actionsIn(rowFor(SHORT)).map((action) => action.textContent)).toEqual([
      'Edit',
      'Archive',
      'Delete',
    ])
  })

  it('spaces them with a gap rather than leaving their focus rings touching', () => {
    // The ring is 3px and the buttons were flush, so one button's focus ring landed on its
    // neighbour. The gap belongs to the row, so every pair is spaced identically.
    renderMenu()
    expect(actionRowOf(rowFor(SHORT)).className).toMatch(/\bgap-1\b/)
  })
})

describe('every action is the same size and sits in the same place', () => {
  it('gives all three the same button size', () => {
    renderMenu()
    const actions = actionsIn(rowFor(SHORT))
    expect(actions.map((action) => action.getAttribute('data-size'))).toEqual(['sm', 'sm', 'sm'])
  })

  it('gives all three the same box: height, padding and centred contents', () => {
    // The hover and focus surface is the box, so identical boxes are identical hit areas.
    renderMenu()
    for (const action of actionsIn(rowFor(SHORT))) {
      const classes = restingClasses(action)
      expect(classes).toContain('h-7')
      expect(classes).toContain('px-2.5')
      expect(classes).toContain('inline-flex')
      expect(classes).toContain('items-center')
      expect(classes).toContain('justify-center')
    }
  })

  it('does not nudge any single action into place', () => {
    // The point of the flex row is that nothing needs an offset. A margin, a translate or a
    // relative top on one button would be the fix this deliberately is not.
    renderMenu()
    for (const action of actionsIn(rowFor(SHORT))) {
      for (const name of restingClasses(action)) {
        expect(name).not.toMatch(/^-?m[trblxy]?-/)
        expect(name).not.toMatch(/^-?translate-/)
        expect(name).not.toMatch(/^(relative|absolute|top-|bottom-|self-)/)
      }
    }
  })
})

describe('the length of an item name does not move its actions', () => {
  it('lays out a long row exactly like a short one', () => {
    renderMenu()

    expect(actionRowOf(rowFor(LONG)).className).toBe(actionRowOf(rowFor(SHORT)).className)
    expect(actionsIn(rowFor(LONG)).map((action) => action.className)).toEqual(
      actionsIn(rowFor(SHORT)).map((action) => action.className),
    )
  })

  it('labels the archived row Restore without changing the shape of the row', () => {
    // Different word, same three boxes — the column must not reflow when an item is archived.
    renderMenu()
    expect(actionsIn(rowFor(LONG)).map((action) => action.textContent)).toEqual([
      'Edit',
      'Restore',
      'Delete',
    ])
  })
})

describe('Edit still does what it did', () => {
  it('links to the edit page for its own item', () => {
    renderMenu()
    expect(editIn(rowFor(SHORT)).getAttribute('href')).toBe('/menu/item-kopi/edit')
    expect(editIn(rowFor(LONG)).getAttribute('href')).toBe('/menu/item-ckt/edit')
  })

  it('keeps the accessible name that says which item it edits', () => {
    renderMenu()
    // The visible word is "Edit" for everyone; the label is what a screen reader announces.
    expect(editIn(rowFor(SHORT)).getAttribute('aria-label')).toBe('Edit Kopi O')
    expect(editIn(rowFor(SHORT)).textContent).toBe('Edit')
  })

  it('still carries its icon, hidden from assistive technology', () => {
    renderMenu()
    const icon = editIn(rowFor(SHORT)).querySelector('svg')
    expect(icon).not.toBeNull()
    expect(icon?.getAttribute('aria-hidden')).toBe('true')
  })
})
