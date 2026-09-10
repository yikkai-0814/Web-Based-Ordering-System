import { NavLink } from 'react-router'

import { navItemsForRole } from '@/components/layout/nav-items'
import { useAuth } from '@/features/auth/useAuth'
import { cn } from '@/lib/utils'

/**
 * Nav is filtered by role, so a staff account never sees the Admin link. That is
 * presentation only — RequireRole blocks the route, and firestore.rules blocks the data.
 */
export function Sidebar() {
  const { role } = useAuth()
  const items = navItemsForRole(role)

  return (
    <nav
      aria-label="Main"
      className="hidden w-60 shrink-0 flex-col gap-1 border-r bg-sidebar p-3 text-sidebar-foreground md:flex"
    >
      {items.map(({ to, label, icon: Icon }) => (
        <NavLink
          key={to}
          to={to}
          className={({ isActive }) =>
            cn(
              // h-touch keeps the target thumb-sized; a till is not operated with a mouse.
              'flex h-touch items-center gap-3 rounded-lg px-3 text-base font-medium transition-colors',
              'hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none',
              isActive
                ? 'bg-primary text-primary-foreground hover:bg-primary/90'
                : 'text-muted-foreground',
            )
          }
        >
          <Icon className="size-5" aria-hidden="true" />
          {label}
        </NavLink>
      ))}
    </nav>
  )
}
