import { describe, expect, it } from 'vitest'

import { landingPathFor, navItemsForRole, NAV_ITEMS } from '@/components/layout/nav-items'
import { ROLES } from '@/features/auth/types'

const labelsFor = (role: Parameters<typeof navItemsForRole>[0]) =>
  navItemsForRole(role).map((item) => item.label)

const pathsFor = (role: Parameters<typeof navItemsForRole>[0]) =>
  navItemsForRole(role).map((item) => item.to)

/**
 * Phase 15. Navigation is declared as data, so what each role sees is a property of that
 * data and can be asserted exactly — no rendering required.
 */
describe('navItemsForRole', () => {
  it('gives staff exactly the three things the counter does, in order', () => {
    // Exact rather than "contains": an item creeping back into the staff nav is precisely
    // the regression worth catching, and "contains" would not notice.
    expect(labelsFor('staff')).toEqual(['New Order', 'Orders', 'Queue'])
    expect(pathsFor('staff')).toEqual(['/pos', '/orders', '/queue'])
  })

  it('keeps the Dashboard away from staff', () => {
    // Not a permission — /dashboard is still reachable by URL and the rules are unchanged.
    // It is simply not one of the things somebody at the counter is here to do.
    expect(labelsFor('staff')).not.toContain('Dashboard')
  })

  it('keeps the Menu out of the staff nav as well', () => {
    expect(labelsFor('staff')).not.toContain('Menu')
  })

  it('gives an admin the Dashboard first and New Order second', () => {
    expect(labelsFor('admin').slice(0, 2)).toEqual(['Dashboard', 'New Order'])
  })

  it('keeps every admin-only section for the admin', () => {
    const labels = labelsFor('admin')
    for (const expected of [
      'Dashboard',
      'New Order',
      'Orders',
      'Queue',
      'Menu',
      'Reports',
      'Staff',
      'Admin',
    ]) {
      expect(labels).toContain(expected)
    }
  })

  it('shows nobody anything when there is no role', () => {
    expect(navItemsForRole(null)).toEqual([])
  })

  it('calls the order-taking page New Order, not Till', () => {
    const newOrder = NAV_ITEMS.find((item) => item.to === '/pos')
    expect(newOrder?.label).toBe('New Order')
    // The route is deliberately unchanged, so existing links and bookmarks still work.
    expect(NAV_ITEMS.map((item) => item.to)).toContain('/pos')
  })

  it('offers every item to at least one role', () => {
    for (const item of NAV_ITEMS) {
      expect(item.roles.length).toBeGreaterThan(0)
      for (const role of item.roles) expect(ROLES).toContain(role)
    }
  })
})

describe('landingPathFor', () => {
  it('starts staff at New Order', () => {
    expect(landingPathFor('staff')).toBe('/pos')
  })

  it('starts an admin at the Dashboard', () => {
    expect(landingPathFor('admin')).toBe('/dashboard')
  })

  it('has a safe answer before the role is known', () => {
    // Reached only in the moment between authenticating and the profile arriving, and the
    // Dashboard is readable by both roles — so the worst case is a screen, never an error.
    expect(landingPathFor(null)).toBe('/dashboard')
  })

  it('sends every role somewhere that role can actually navigate to', () => {
    for (const role of ROLES) {
      expect(pathsFor(role)).toContain(landingPathFor(role))
    }
  })
})
