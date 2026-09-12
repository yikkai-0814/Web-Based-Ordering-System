import {
  ChartColumn,
  ChefHat,
  CupSoda,
  IdCard,
  LayoutDashboard,
  ReceiptText,
  ScanBarcode,
  Settings,
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
    to: '/pos',
    // Named for what it is used for. "Till" described the hardware; this page is where an
    // order is started, served, filled and taken payment for.
    label: 'New Order',
    icon: ScanBarcode,
    // First for both roles, and the whole nav for staff: taking an order is the job.
    roles: ROLES,
  },
  {
    to: '/orders',
    label: 'Orders',
    icon: ReceiptText,
    roles: ROLES,
  },
  {
    to: '/queue',
    label: 'Queue',
    icon: ChefHat,
    // Both roles: the kitchen board is worked by whoever is making the food.
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
    to: '/reports',
    label: 'Reports',
    icon: ChartColumn,
    // Admin only: the page shows cost, estimated profit and margin.
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
    to: '/admin',
    label: 'Admin',
    icon: Settings,
    roles: ['admin'],
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
 * An admin still lands on the Dashboard, which is the screen written for them.
 *
 * Declared here rather than at the two places that redirect, because "where does this role
 * belong" is the same question the nav list answers, and two copies of it would be two
 * things to keep in step. A deep link the user actually asked for still wins over this —
 * see RequireAuth and LoginPage.
 */
export function landingPathFor(role: Role | null): string {
  return role === 'staff' ? '/pos' : '/dashboard'
}
