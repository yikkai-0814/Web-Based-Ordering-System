// @vitest-environment jsdom
/**
 * Navigation below `md`, where the sidebar is hidden.
 *
 * Before this existed a phone-width session could reach a page and never leave it. What
 * matters in a test is not that it looks like a bottom bar but that it offers each role
 * exactly the sections Phase 15 settled on, in that order — it reads `navItemsForRole`, so
 * the desktop and mobile navs cannot drift apart, and this proves the wiring.
 */
import { screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { MobileNav } from '@/components/layout/MobileNav'
import type { Role } from '@/features/auth/types'

import { renderComponent } from './render'

let currentRole: Role | null = 'staff'

vi.mock('@/features/auth/useAuth', () => ({
  useAuth: () => ({ role: currentRole, status: 'authenticated', profile: null }),
}))

afterEach(() => {
  currentRole = 'staff'
})

function renderNav(role: Role | null) {
  currentRole = role
  return renderComponent(
    <MemoryRouter>
      <MobileNav />
    </MemoryRouter>,
  )
}

const linkNames = () =>
  screen
    .getAllByRole('link')
    .map((link) => link.textContent?.trim())
    .filter(Boolean)

describe('MobileNav', () => {
  it('offers staff exactly New Order, Orders and Queue, in order', () => {
    renderNav('staff')
    expect(linkNames()).toEqual(['New Order', 'Queue', 'Orders', 'Settings'])
  })

  it('offers an admin exactly the five office sections, Dashboard first', () => {
    renderNav('admin')
    expect(linkNames()).toEqual(['Dashboard', 'Reports', 'Orders', 'Menu', 'Staff', 'Settings'])
  })

  it('does not offer an admin the counter, and offers nobody an Admin page', () => {
    renderNav('admin')
    const names = linkNames()
    for (const absent of ['New Order', 'Queue', 'Admin']) {
      expect(names).not.toContain(absent)
    }
  })

  it('points each link at the same route the sidebar uses', () => {
    renderNav('staff')
    expect(screen.getByRole('link', { name: 'New Order' }).getAttribute('href')).toBe('/pos')
    expect(screen.getByRole('link', { name: 'Orders' }).getAttribute('href')).toBe('/orders')
    expect(screen.getByRole('link', { name: 'Queue' }).getAttribute('href')).toBe('/queue')
  })

  it('labels every destination in words, never an icon alone', () => {
    // This is the only navigation at this width; an unlabelled icon would be a guess.
    renderNav('staff')
    for (const link of screen.getAllByRole('link')) {
      expect(link.textContent?.trim()).not.toBe('')
    }
  })

  it('has no collapse control — collapsing is a desktop-sidebar idea', () => {
    // A bottom bar has nothing to collapse into, and a phone has no cursor to hover a
    // tooltip with. The sidebar's preference deliberately does not reach here.
    renderNav('staff')
    expect(screen.queryByTestId('sidebar-toggle')).toBeNull()
  })

  it('renders nothing at all when there is no role', () => {
    const { container } = renderNav(null)
    expect(container.querySelector('nav')).toBeNull()
  })

  it('is one navigation landmark, named so a screen reader can find it', () => {
    renderNav('staff')
    expect(screen.getByRole('navigation', { name: 'Main' })).not.toBeNull()
  })
})
