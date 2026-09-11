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
    roles: ROLES,
  },
  {
    to: '/pos',
    label: 'Till',
    icon: ScanBarcode,
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
    to: '/orders',
    label: 'Orders',
    icon: ReceiptText,
    roles: ROLES,
  },
  {
    to: '/menu',
    label: 'Menu',
    icon: CupSoda,
    roles: ROLES,
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
