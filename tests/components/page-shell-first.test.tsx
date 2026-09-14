// @vitest-environment jsdom
/**
 * A page's own structure must not wait on Firestore.
 *
 * Menu and Staff each used to `return <Skeleton />` for the WHOLE page while their
 * collections loaded, so navigating to either showed a grey rectangle with no title, no
 * blurb and no controls. Measured against the emulator by clicking the real sidebar links,
 * the Menu heading did not appear for 611 ms on a cold client — all of it waiting for data
 * that none of that markup depends on.
 *
 * Nothing about the data is faster now; the difference is that the page frame is painted
 * from the first render and only the part that genuinely needs rows is held back. These
 * tests pin the distinction: heading present while loading, data region still a skeleton,
 * and the real content once it arrives.
 */
import { screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { renderComponent } from './render'

/** Flipped per test to stand in for "the snapshot has not landed yet". */
const state = {
  loading: true,
  categories: [] as unknown[],
  items: [] as unknown[],
  staff: [] as unknown[],
}

vi.mock('@/features/auth/useAuth', () => ({
  useAuth: () => ({ role: 'admin', profile: { uid: 'u1', role: 'admin' } }),
}))

vi.mock('@/features/menu/menu-api', () => ({
  createMenuItem: vi.fn(),
  updateMenuItem: vi.fn(),
  deleteMenuItem: vi.fn(),
  setMenuItemActive: vi.fn(),
}))

vi.mock('@/features/staff/staff-api', () => ({
  createStaffMember: vi.fn(),
  renameStaffMember: vi.fn(),
  setStaffActive: vi.fn(),
}))

vi.mock('@/features/menu/useCategories', () => ({
  useCategories: () => ({ categories: state.categories, loading: state.loading, error: null }),
}))
vi.mock('@/features/menu/useMenuItems', () => ({
  useMenuItems: () => ({ items: state.items, loading: state.loading, error: null }),
}))
vi.mock('@/features/menu/useItemCosts', () => ({
  useItemCosts: () => ({ costs: new Map<string, number>(), loading: false }),
}))
vi.mock('@/features/staff/useStaffMembers', () => ({
  useStaffMembers: () => ({
    staff: state.staff,
    data: state.staff,
    loading: state.loading,
    error: null,
  }),
}))

import { MenuListPage } from '@/features/menu/MenuListPage'
import { StaffListPage } from '@/features/staff/StaffListPage'

const CATEGORY = {
  id: 'cat-coffee',
  name: 'Coffee',
  sortOrder: 0,
  active: true,
  createdAt: null,
  updatedAt: null,
}

const ITEM = {
  id: 'item-1',
  name: 'Flat White',
  description: '',
  categoryId: 'cat-coffee',
  price: 1250,
  sortOrder: 0,
  active: true,
  createdAt: null,
  updatedAt: null,
}

const MEMBER = { id: 'staff-1', name: 'Alice', active: true, createdAt: null }

function skeletons(container: HTMLElement): number {
  return container.querySelectorAll('[data-slot="skeleton"]').length
}

beforeEach(() => {
  state.loading = true
  state.categories = []
  state.items = []
  state.staff = []
})

describe('Menu renders its own frame before its catalogue', () => {
  it('shows the heading and the admin controls while the collections are still loading', () => {
    const { container } = renderComponent(
      <MemoryRouter>
        <MenuListPage />
      </MemoryRouter>,
    )

    // The frame is there from the first render.
    expect(screen.getByRole('heading', { level: 1 })).toBeTruthy()
    // And its links are usable rather than painted over.
    expect(screen.getByRole('link', { name: /categories/i })).toBeTruthy()
    // Only the catalogue is withheld.
    expect(skeletons(container)).toBe(1)
    expect(screen.queryAllByTestId('menu-item-row')).toHaveLength(0)
  })

  it('replaces the skeleton with the catalogue once it arrives', () => {
    state.loading = false
    state.categories = [CATEGORY]
    state.items = [ITEM]

    const { container } = renderComponent(
      <MemoryRouter>
        <MenuListPage />
      </MemoryRouter>,
    )

    expect(screen.getByRole('heading', { level: 1 })).toBeTruthy()
    expect(skeletons(container)).toBe(0)
    expect(screen.getAllByTestId('menu-item-row')).toHaveLength(1)
  })
})

describe('Staff renders its own frame before its roster', () => {
  it('shows the heading and the add-member form while the roster is still loading', () => {
    const { container } = renderComponent(
      <MemoryRouter>
        <StaffListPage />
      </MemoryRouter>,
    )

    expect(screen.getByRole('heading', { level: 1 })).toBeTruthy()
    // Adding somebody does not depend on the existing roster, so the form is usable at once.
    expect(screen.getByLabelText(/add/i)).toBeTruthy()
    expect(skeletons(container)).toBe(1)
    expect(screen.queryAllByTestId('staff-row')).toHaveLength(0)
    // Not the empty state either: "no staff yet" would be a claim, and nothing is known yet.
    expect(screen.queryByText(/no staff/i)).toBeNull()
  })

  it('replaces the skeleton with the roster once it arrives', () => {
    state.loading = false
    state.staff = [MEMBER]

    const { container } = renderComponent(
      <MemoryRouter>
        <StaffListPage />
      </MemoryRouter>,
    )

    expect(screen.getByRole('heading', { level: 1 })).toBeTruthy()
    expect(skeletons(container)).toBe(0)
    expect(screen.getAllByTestId('staff-row')).toHaveLength(1)
  })
})
