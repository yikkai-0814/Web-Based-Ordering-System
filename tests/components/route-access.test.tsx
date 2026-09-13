// @vitest-environment jsdom
/**
 * Which routes each role may actually open.
 *
 * Hiding a link is not a control. An admin who types `/pos` must be refused, and a staff
 * member who types `/reports` must be refused, so what is exercised here is the real route
 * table from `App.tsx` — guards and all — rather than a copy of it written for the test.
 * Everything below the routing is stubbed: the page components become markers, and the
 * providers become pass-throughs, so nothing reaches Firestore.
 *
 * The counter guard is the new half. `/pos` and `/queue` used to be open to both roles;
 * they are now staff-only, nested in a `RequireRole` group exactly as the admin pages are.
 */
import type { ReactNode } from 'react'

import { screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { AuthStatus, Role } from '@/features/auth/types'
import { App } from '@/App'

import { renderComponent } from './render'

let currentRole: Role | null = 'staff'
let currentStatus: AuthStatus = 'authenticated'

vi.mock('@/features/auth/useAuth', () => ({
  useAuth: () => ({
    role: currentRole,
    status: currentStatus,
    profile: currentRole
      ? { uid: 'u1', displayName: 'Test User', role: currentRole, active: true }
      : null,
  }),
}))

/** Nothing in this file should reach Firebase; the module is imported for its singletons. */
vi.mock('@/lib/firebase', () => ({ app: {}, auth: {}, db: {} }))

// Each factory is hoisted above the module body, so the pass-through is written out in
// full rather than shared through a variable that would not exist yet.
vi.mock('@/features/auth/AuthProvider', () => ({
  AuthProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
}))
vi.mock('@/features/staff/StaffSessionProvider', () => ({
  StaffSessionProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
}))
vi.mock('@/features/theme/ThemeProvider', () => ({
  ThemeProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
}))

/** The shell is chrome; the routes underneath it are the subject. */
vi.mock('@/components/layout/AppShell', async () => {
  const { Outlet } = await import('react-router')
  return { AppShell: () => <Outlet /> }
})

/** Every page becomes a marker naming itself, so "which page rendered" is one assertion. */
vi.mock('@/features/pos/TerminalPage', () => ({
  TerminalPage: () => <div data-testid="page">New Order</div>,
}))
vi.mock('@/features/pos/QueuePage', () => ({
  QueuePage: () => <div data-testid="page">Queue</div>,
}))
vi.mock('@/features/pos/OrdersListPage', () => ({
  OrdersListPage: () => <div data-testid="page">Orders</div>,
}))
vi.mock('@/features/pos/OrderDetailPage', () => ({
  OrderDetailPage: () => <div data-testid="page">Order detail</div>,
}))
vi.mock('@/features/dashboard/DashboardPage', () => ({
  DashboardPage: () => <div data-testid="page">Dashboard</div>,
}))
vi.mock('@/features/reports/ReportsPage', () => ({
  ReportsPage: () => <div data-testid="page">Reports</div>,
}))
vi.mock('@/features/staff/StaffListPage', () => ({
  StaffListPage: () => <div data-testid="page">Staff</div>,
}))
vi.mock('@/features/menu/MenuListPage', () => ({
  MenuListPage: () => <div data-testid="page">Menu</div>,
}))
vi.mock('@/features/menu/CategoriesPage', () => ({
  CategoriesPage: () => <div data-testid="page">Categories</div>,
}))
vi.mock('@/features/menu/MenuItemFormPage', () => ({
  MenuItemFormPage: () => <div data-testid="page">Menu item</div>,
}))
vi.mock('@/features/auth/LoginPage', () => ({
  LoginPage: () => <div data-testid="page">Login</div>,
}))
vi.mock('@/pages/ForbiddenPage', () => ({
  ForbiddenPage: () => <div data-testid="page">Forbidden</div>,
}))
vi.mock('@/pages/NotFoundPage', () => ({
  NotFoundPage: () => <div data-testid="page">Not found</div>,
}))

/** Opens the app at a path, the way typing a URL does. */
function visit(path: string, role: Role | null) {
  currentRole = role
  window.history.pushState({}, '', path)
  return renderComponent(<App />)
}

const shown = () => screen.getByTestId('page').textContent

beforeEach(() => {
  currentRole = 'staff'
  currentStatus = 'authenticated'
})

afterEach(() => {
  window.history.pushState({}, '', '/')
})

describe('an admin runs the business and does not work the counter', () => {
  it('is refused the New Order route, typed directly', () => {
    visit('/pos', 'admin')
    expect(shown()).toBe('Forbidden')
  })

  it('is refused the Queue route, typed directly', () => {
    visit('/queue', 'admin')
    expect(shown()).toBe('Forbidden')
  })

  it('still reaches Orders, which is the sales record', () => {
    visit('/orders', 'admin')
    expect(shown()).toBe('Orders')
  })

  it('still reaches a single order, for looking up history', () => {
    visit('/orders/order-1', 'admin')
    expect(shown()).toBe('Order detail')
  })
})

describe('removing the Admin page leaves every real admin page working', () => {
  it.each([
    ['/dashboard', 'Dashboard'],
    ['/reports', 'Reports'],
    ['/orders', 'Orders'],
    ['/menu', 'Menu'],
    ['/staff', 'Staff'],
    ['/menu/categories', 'Categories'],
    ['/menu/new', 'Menu item'],
    ['/menu/item-1/edit', 'Menu item'],
  ])('opens %s for an admin', (path, expected) => {
    visit(path, 'admin')
    expect(shown()).toBe(expected)
  })

  it('has no /admin route left at all', () => {
    // Not a 403 — the page is gone, so the path is simply not a page any more.
    visit('/admin', 'admin')
    expect(shown()).toBe('Not found')
  })
})

describe('staff work the counter and manage nothing', () => {
  it.each([
    ['/pos', 'New Order'],
    ['/orders', 'Orders'],
    ['/queue', 'Queue'],
  ])('opens %s for staff', (path, expected) => {
    visit(path, 'staff')
    expect(shown()).toBe(expected)
  })

  it.each([['/reports'], ['/staff'], ['/menu/categories']])(
    'refuses staff %s, as before',
    (path) => {
      visit(path, 'staff')
      expect(shown()).toBe('Forbidden')
    },
  )
})

describe('each role lands where it can actually work', () => {
  it('sends staff to New Order', () => {
    visit('/', 'staff')
    expect(shown()).toBe('New Order')
  })

  it('sends an admin to the Dashboard', () => {
    // Load-bearing now that the roles are disjoint: landing an admin on New Order would put
    // them straight into their own guard.
    visit('/', 'admin')
    expect(shown()).toBe('Dashboard')
  })
})
