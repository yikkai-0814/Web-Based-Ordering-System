import {
  ChartColumn,
  ChefHat,
  CupSoda,
  IdCard,
  LayoutDashboard,
  ReceiptText,
  ScanBarcode,
  type LucideIcon,
} from 'lucide-react'

import { ROLES, type Role } from '@/features/auth/types'

export interface NavItem {
  to: string
  label: string
  icon: LucideIcon
  /** Which roles see this item at all. */
  roles: readonly Role[]
}

/**
 * Navigation is declared as data so that a later phase adds a line here plus a route,
 * rather than editing the Sidebar component itself.
 *
 * **The array order is not either role's order — it is the one order that yields both.**
 * Each role sees this list filtered, so the sequence has to satisfy two requirements at
 * once: an admin must read Dashboard, Reports, Orders, Menu, Staff, and a staff member must
 * read New Order, Orders, Queue. `Orders` is the item they share, so everything either role
 * sees above Orders is listed before it and everything below it after — which is why New
 * Order sits between Reports and Orders, and Queue sits last. Both orders are asserted
 * exactly in tests/unit/nav.test.ts; change this array and one of them will tell you.
 *
 * The two roles now share exactly one destination. An admin runs the business — figures,
 * catalogue, roster, and the sales record — and does not work the counter; a staff member
 * works the counter and does not manage anything. There is deliberately no "Admin" landing
 * page: Menu, Staff and Reports are each a link of their own, so nothing is a page whose
 * only purpose is to list other pages.
 */
export const NAV_ITEMS: readonly NavItem[] = [
  {
    to: '/dashboard',
    label: 'Dashboard',
    icon: LayoutDashboard,
    // Admin only. It answers an owner's questions — takings, outstanding money, estimated
    // profit — which is not what somebody standing at the counter needs a link to.
    roles: ['admin'],
  },
  {
    to: '/reports',
    label: 'Reports',
    icon: ChartColumn,
    // Admin only: the page shows cost, estimated profit and margin.
    roles: ['admin'],
  },
  {
    to: '/pos',
    // Named for what it is used for. "Till" described the hardware; this page is where an
    // order is started, served, filled and taken payment for.
    label: 'New Order',
    icon: ScanBarcode,
    // Staff only, and first for them: taking an order is the job. An admin has no counter
    // to work, and the route refuses them as well — see the guard in App.tsx.
    roles: ['staff'],
  },
  {
    to: '/orders',
    label: 'Orders',
    icon: ReceiptText,
    // The one thing both roles do: staff look up the sale in front of them, an admin reads
    // the day's history.
    roles: ROLES,
  },
  {
    to: '/menu',
    label: 'Menu',
    icon: CupSoda,
    // Admin only in the nav. The catalog is still readable by staff — the route and the
    // security rules are unchanged — it simply is not one of the three things the counter
    // is here to do.
    roles: ['admin'],
  },
  {
    to: '/staff',
    label: 'Staff',
    icon: IdCard,
    // Admin only: creating and retiring till operators is a management function.
    roles: ['admin'],
  },
  {
    to: '/queue',
    label: 'Queue',
    icon: ChefHat,
    // Staff only: the kitchen board is worked by whoever is making the food, and the route
    // refuses an admin as well.
    roles: ['staff'],
  },
]

export function navItemsForRole(role: Role | null): readonly NavItem[] {
  if (!role) return []
  return NAV_ITEMS.filter((item) => item.roles.includes(role))
}

/**
 * Where a session starts, by role.
 *
 * Staff land on New Order because that is the entire reason the account exists: sign in,
 * take an order, take the next one. Sending them to the Dashboard first made every shift
 * begin with a screen of figures they cannot act on and a hunt for the page they wanted.
 *
 * An admin still lands on the Dashboard, which is the screen written for them — and is the
 * only sensible answer now that an admin cannot open New Order at all.
 *
 * Declared here rather than at the two places that redirect, because "where does this role
 * belong" is the same question the nav list answers, and two copies of it would be two
 * things to keep in step. A deep link the user actually asked for still wins over this —
 * see RequireAuth and LoginPage.
 */
export function landingPathFor(role: Role | null): string {
  return role === 'staff' ? '/pos' : '/dashboard'
}
