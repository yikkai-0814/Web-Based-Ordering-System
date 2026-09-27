// @vitest-environment jsdom
/**
 * The desktop sidebar, in both widths.
 *
 * The thing worth holding still is that collapsing is *only* a width: the same items, in the
 * same order, for the same roles, still reachable and still announcing which one is current.
 * A collapse that quietly dropped a link, or left a keyboard user with anonymous icons, would
 * be a navigation change wearing a layout change's clothes.
 */
import { screen, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { SIDEBAR_STORAGE_KEY } from '@/components/layout/sidebar-state'
import { Sidebar } from '@/components/layout/Sidebar'
import type { Role } from '@/features/auth/types'

import { renderComponent } from './render'

let currentRole: Role | null = 'staff'

vi.mock('@/features/auth/useAuth', () => ({
  useAuth: () => ({ role: currentRole, status: 'authenticated', profile: null }),
}))

beforeEach(() => {
  currentRole = 'staff'
  window.localStorage.clear()
})

afterEach(() => {
  window.localStorage.clear()
})

function renderSidebar(role: Role | null = 'staff', at = '/pos') {
  currentRole = role
  return renderComponent(
    <MemoryRouter initialEntries={[at]}>
      <Routes>
        <Route path="*" element={<Sidebar />} />
      </Routes>
    </MemoryRouter>,
  )
}

const linkNames = () =>
  screen.getAllByRole('link').map((link) => link.getAttribute('aria-label') ?? link.textContent)

const nav = () => screen.getByRole('navigation', { name: 'Main' })
const toggle = () => screen.getByTestId('sidebar-toggle')
/** The label painted beside the icon, as opposed to the rail's tooltip with the same words. */
const paintedLabel = (name: string) =>
  within(screen.getByRole('link', { name })).queryByText(name, {
    selector: 'span:not([role=tooltip])',
  })
const tooltipOf = (name: string) =>
  within(screen.getByRole('link', { name })).queryByRole('tooltip', { hidden: true })

/**
 * jsdom has no layout and no media queries, so what these can check is the classes that
 * decide each width — the rail from `md`, the preference only from `xl` — and that nothing a
 * rail needs (a name, a tooltip, the current-page marker) is missing in either state.
 */
describe('Sidebar: the icon rail below xl', () => {
  it('is the rail below xl even when expanded, and full width only from xl', () => {
    renderSidebar('staff')

    const classes = nav().className.split(' ')
    expect(classes).toContain('w-16')
    expect(classes).toContain('xl:w-60')
  })

  it('paints the label only from xl, and keeps the tooltip for the rail', () => {
    renderSidebar('staff')

    expect(paintedLabel('Orders')?.className.split(' ')).toEqual(
      expect.arrayContaining(['hidden', 'xl:inline']),
    )
    expect(tooltipOf('Orders')?.textContent).toBe('Orders')
    expect(tooltipOf('Orders')?.className).toContain('xl:hidden')
  })

  it('offers the toggle only from xl, where it has something to change', () => {
    renderSidebar('staff')

    expect(toggle().className.split(' ')).toEqual(expect.arrayContaining(['hidden', 'xl:flex']))
  })

  it('stays the rail at every width once collapsed', async () => {
    const { user } = renderSidebar('staff')
    await user.click(toggle())

    expect(nav().className).not.toContain('xl:w-60')
    expect(paintedLabel('Orders')).toBeNull()
    expect(tooltipOf('Orders')?.className).not.toContain('xl:hidden')
  })

  it('sticks below the Topbar by the shared height, not a number of its own', () => {
    renderSidebar('staff')

    expect(nav().className).toContain('top-topbar')
    expect(nav().className).toContain('h-[calc(100svh-var(--topbar-height))]')
  })
})

describe('Sidebar: collapsing', () => {
  it('starts expanded, showing the labels', () => {
    renderSidebar('staff')
    expect(nav().getAttribute('data-collapsed')).toBe('false')
    expect(paintedLabel('New Order')).not.toBeNull()
    expect(toggle().getAttribute('aria-expanded')).toBe('true')
  })

  it('collapses and expands again from the toggle', async () => {
    const { user } = renderSidebar('staff')

    await user.click(toggle())
    expect(nav().getAttribute('data-collapsed')).toBe('true')
    expect(toggle().getAttribute('aria-expanded')).toBe('false')
    expect(toggle().getAttribute('aria-label')).toBe('Expand sidebar')

    await user.click(toggle())
    expect(nav().getAttribute('data-collapsed')).toBe('false')
    expect(toggle().getAttribute('aria-label')).toBe('Collapse sidebar')
  })

  it('keeps every destination, in order, when collapsed', async () => {
    // Collapsing is a width. Losing a link would be a navigation change.
    const { user } = renderSidebar('staff')
    const before = linkNames()

    await user.click(toggle())
    expect(linkNames()).toEqual(before)
    expect(linkNames()).toEqual(['New Order', 'Queue', 'Orders', 'Settings'])
  })

  it('keeps an admin’s full navigation too', async () => {
    const { user } = renderSidebar('admin')
    await user.click(toggle())
    expect(linkNames()).toEqual(['Dashboard', 'Reports', 'Orders', 'Menu', 'Staff', 'Settings'])
  })
})

describe('Sidebar: collapsed still says what each icon is', () => {
  it('names every link for assistive technology', async () => {
    // The visible label moves into a tooltip; the accessible name never moves at all.
    const { user } = renderSidebar('staff')
    await user.click(toggle())

    for (const label of ['New Order', 'Queue', 'Orders']) {
      expect(screen.getByRole('link', { name: label })).not.toBeNull()
    }
  })

  it('carries a tooltip that a keyboard can reach, not only a pointer', async () => {
    const { user } = renderSidebar('staff')
    await user.click(toggle())

    const link = screen.getByRole('link', { name: 'Orders' })
    const tip = within(link).getByRole('tooltip', { hidden: true })
    expect(tip.textContent).toBe('Orders')
    // Shown on focus as well as hover — a mouse-only tooltip leaves a keyboard user with a
    // column of unexplained icons.
    expect(tip.className).toContain('group-focus-visible/nav:opacity-100')
  })

  it('still says which page is current', async () => {
    const { user } = renderSidebar('staff', '/orders')
    await user.click(toggle())

    const current = screen.getByRole('link', { name: 'Orders' })
    expect(current.getAttribute('aria-current')).toBe('page')
    expect(within(current).getByText('(current page)')).not.toBeNull()
  })
})

describe('Sidebar: the preference sticks', () => {
  it('is still collapsed after a reload', async () => {
    const first = renderSidebar('staff')
    await first.user.click(toggle())
    first.unmount()

    renderSidebar('staff')
    expect(nav().getAttribute('data-collapsed')).toBe('true')
  })

  it('opens expanded when nothing has been stored', () => {
    renderSidebar('staff')
    expect(nav().getAttribute('data-collapsed')).toBe('false')
  })

  it('opens expanded when the stored value is not recognisable', () => {
    window.localStorage.setItem(SIDEBAR_STORAGE_KEY, 'yes-please')
    renderSidebar('staff')
    expect(nav().getAttribute('data-collapsed')).toBe('false')
  })
})
