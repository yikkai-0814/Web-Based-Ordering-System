// @vitest-environment jsdom
/**
 * Where a session starts, and what it can see from there.
 *
 * The data behind both is asserted in tests/unit (`navItemsForRole`, `landingPathFor`).
 * What is asserted here is that the app actually uses it: that the Sidebar renders the
 * role's items and the index route sends the role to its own landing page. Before Phase 15
 * the destination was the string `/dashboard`, written into two places, and a staff member
 * began every shift on a screen of an owner's figures.
 *
 * `useAuth` is stubbed, which is the only mock this file needs — neither component touches
 * Firestore.
 */
import { LanguageProvider } from '@/features/i18n/LanguageProvider'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { Sidebar } from '@/components/layout/Sidebar'
import type { AuthStatus, Role } from '@/features/auth/types'
import { LandingRedirect } from '@/features/auth/LandingRedirect'

import { renderComponent } from './render'

let currentRole: Role | null = 'staff'
let currentStatus: AuthStatus = 'authenticated'

vi.mock('@/features/auth/useAuth', () => ({
  useAuth: () => ({ role: currentRole, status: currentStatus, profile: null }),
}))

afterEach(() => {
  currentRole = 'staff'
  currentStatus = 'authenticated'
})

function renderSidebar(role: Role | null) {
  currentRole = role
  return renderComponent(
    <MemoryRouter>
      <Sidebar />
    </MemoryRouter>,
  )
}

const linkNames = () =>
  screen
    .getAllByRole('link')
    .map((link) => link.textContent?.trim())
    .filter(Boolean)

describe('Sidebar: what each role is offered', () => {
  it('shows staff New Order, Orders, Queue and Settings — and nothing else', () => {
    renderSidebar('staff')
    expect(linkNames()).toEqual(['New Order', 'Queue', 'Orders', 'Settings'])
  })

  it('does not offer staff the Dashboard', () => {
    renderSidebar('staff')
    expect(screen.queryByRole('link', { name: 'Dashboard' })).toBeNull()
  })

  it('shows an admin Dashboard, Reports, Orders, Menu, Staff and Settings — and nothing else', () => {
    renderSidebar('admin')
    expect(linkNames()).toEqual(['Dashboard', 'Reports', 'Orders', 'Menu', 'Staff', 'Settings'])
  })

  it('offers an admin Settings', () => {
    renderSidebar('admin')
    expect(screen.getByRole('link', { name: 'Settings' }).getAttribute('href')).toBe('/settings')
  })

  it('offers staff Settings too — it belongs to neither job', () => {
    renderSidebar('staff')
    expect(screen.getByRole('link', { name: 'Settings' }).getAttribute('href')).toBe('/settings')
  })

  it('does not offer an admin the counter', () => {
    // The nav is not the control — /pos and /queue are guarded routes — but an admin should
    // not be invited to a page they will be refused.
    renderSidebar('admin')
    expect(screen.queryByRole('link', { name: 'New Order' })).toBeNull()
    expect(screen.queryByRole('link', { name: 'Queue' })).toBeNull()
  })

  it('offers no Admin landing page to either role', () => {
    // Menu, Staff and Reports are each a link of their own.
    renderSidebar('admin')
    expect(screen.queryByRole('link', { name: 'Admin' })).toBeNull()
    renderSidebar('staff')
    expect(screen.queryByRole('link', { name: 'Admin' })).toBeNull()
  })

  it('calls it New Order rather than Till', () => {
    renderSidebar('staff')
    expect(screen.getByRole('link', { name: 'New Order' }).getAttribute('href')).toBe('/pos')
    expect(screen.queryByRole('link', { name: 'Till' })).toBeNull()
  })
})

/**
 * The index route, exercised through a real router: whatever it renders, the address that
 * results is what a person would be looking at.
 */
function renderLanding(role: Role | null, status: AuthStatus = 'authenticated') {
  currentRole = role
  currentStatus = status
  // The loading state renders FullPageSkeleton, which names itself through `t`.
  return render(
    <LanguageProvider>
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route index element={<LandingRedirect />} />
          <Route path="/pos" element={<span data-testid="page">New Order</span>} />
          <Route path="/dashboard" element={<span data-testid="page">Dashboard</span>} />
        </Routes>
      </MemoryRouter>
    </LanguageProvider>,
  )
}

describe('LandingRedirect: where a session starts', () => {
  it('sends staff to New Order', () => {
    renderLanding('staff')
    expect(screen.getByTestId('page').textContent).toBe('New Order')
  })

  it('sends an admin to the Dashboard', () => {
    renderLanding('admin')
    expect(screen.getByTestId('page').textContent).toBe('Dashboard')
  })

  it('waits rather than guessing while the role is still loading', () => {
    // Redirecting first and correcting afterwards would bounce every staff member through
    // the admin landing page for a frame.
    renderLanding(null, 'loading')
    expect(screen.queryByTestId('page')).toBeNull()
  })
})
