import { say } from '../say'
import { describe, expect, it } from 'vitest'

import { landingPathFor, navItemsForRole, NAV_ITEMS } from '@/components/layout/nav-items'
import { ROLES } from '@/features/auth/types'

const labelsFor = (role: Parameters<typeof navItemsForRole>[0]) =>
  navItemsForRole(role).map((item) => say(item.labelKey))

const pathsFor = (role: Parameters<typeof navItemsForRole>[0]) =>
  navItemsForRole(role).map((item) => item.to)

/**
 * Navigation is declared as data, so what each role sees is a property of that data and can
 * be asserted exactly — no rendering required.
 *
 * The two roles are now disjoint apart from Orders: an admin runs the business, a staff
 * member works the counter. Every assertion below is `toEqual` rather than `toContain`,
 * because an item creeping into the wrong role's nav is precisely the regression worth
 * catching and "contains" would not notice it.
 */
describe('navItemsForRole', () => {
  it('gives staff the three things the counter does, then Settings, in order', () => {
    // Queue before Orders: the board is the screen a counter works from — what still has to
    // be made — where Orders is the record of what has already been sold.
    expect(labelsFor('staff')).toEqual(['New Order', 'Queue', 'Orders', 'Settings'])
    expect(pathsFor('staff')).toEqual(['/pos', '/queue', '/orders', '/settings'])
  })

  it('gives an admin the five things the office does, then Settings, in order', () => {
    expect(labelsFor('admin')).toEqual([
      'Dashboard',
      'Reports',
      'Orders',
      'Menu',
      'Staff',
      'Settings',
    ])
    expect(pathsFor('admin')).toEqual([
      '/dashboard',
      '/reports',
      '/orders',
      '/menu',
      '/staff',
      '/settings',
    ])
  })

  it('ends both roles on Settings', () => {
    // It is about the person and the device rather than the work, so it sits below
    // everything either role came here to do.
    for (const role of ROLES) {
      expect(pathsFor(role).at(-1)).toBe('/settings')
    }
  })

  it('keeps the counter out of the admin nav', () => {
    // Not merely hidden: /pos and /queue are guarded routes too. See App.tsx and
    // tests/components/route-access.test.tsx.
    const labels = labelsFor('admin')
    expect(labels).not.toContain('New Order')
    expect(labels).not.toContain('Queue')
  })

  it('keeps the office out of the staff nav', () => {
    const labels = labelsFor('staff')
    for (const absent of ['Dashboard', 'Reports', 'Menu', 'Staff']) {
      expect(labels).not.toContain(absent)
    }
  })

  it('has no Admin landing page to link to', () => {
    // Menu, Staff and Reports are each a link of their own; nothing is a page whose only
    // purpose is to list other pages.
    expect(NAV_ITEMS.map((item) => item.to)).not.toContain('/admin')
    expect(NAV_ITEMS.map((item) => say(item.labelKey))).not.toContain('Admin')
  })

  it('shares exactly two destinations between the two roles', () => {
    // The sales record, which both roles read, and Settings, which belongs to neither job.
    const shared = pathsFor('admin').filter((path) => pathsFor('staff').includes(path))
    expect(shared).toEqual(['/orders', '/settings'])
  })

  it('shows nobody anything when there is no role', () => {
    expect(navItemsForRole(null)).toEqual([])
  })

  it('calls the order-taking page New Order, not Till', () => {
    const newOrder = NAV_ITEMS.find((item) => item.to === '/pos')
    expect(newOrder && say(newOrder.labelKey)).toBe('New Order')
    // The route is deliberately unchanged, so existing links and bookmarks still work.
    expect(NAV_ITEMS.map((item) => item.to)).toContain('/pos')
  })

  it('offers every item to at least one role', () => {
    for (const item of NAV_ITEMS) {
      expect(item.roles.length).toBeGreaterThan(0)
      for (const role of item.roles) expect(ROLES).toContain(role)
    }
  })

  it('lists every item exactly once', () => {
    const paths = NAV_ITEMS.map((item) => item.to)
    expect(new Set(paths).size).toBe(paths.length)
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
    // Load-bearing now that the roles are disjoint: landing an admin on /pos would put them
    // on a route their own guard refuses.
    for (const role of ROLES) {
      expect(pathsFor(role)).toContain(landingPathFor(role))
    }
  })
})
