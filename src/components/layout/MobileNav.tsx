import { useTranslation } from '@/features/i18n/useTranslation'
import { NavLink } from 'react-router'

import { navItemsForRole } from '@/components/layout/nav-items'
import { useAuth } from '@/features/auth/useAuth'
import { cn } from '@/lib/utils'

/**
 * Navigation below `md`, where the sidebar is hidden.
 *
 * Until this existed there was none: `Sidebar` is `hidden md:flex`, so a phone-width session
 * could reach a page but never leave it except by the browser's back button. A till or a
 * kitchen tablet held in portrait is not an exotic case for this application.
 *
 * A bottom bar rather than a drawer, because the thumb is already at the bottom of the
 * screen and a POS should not ask for two taps to change screen. It renders from
 * `navItemsForRole` — the same data the sidebar uses — so the roles and their order stay
 * whatever nav-items.ts says, and nothing here can drift from the desktop nav.
 *
 * An admin has six sections, which will not fit across a 390px screen at a readable size;
 * the row scrolls horizontally rather than shrinking the labels to nothing. Staff have four,
 * which fit comfortably, and staff are the ones actually working at this width.
 */
export function MobileNav() {
  const { role } = useAuth()
  const { t } = useTranslation()
  const items = navItemsForRole(role)

  if (items.length === 0) return null

  return (
    <nav
      aria-label={t('nav.main')}
      className={cn(
        'sticky bottom-0 z-30 flex min-h-mobile-nav shrink-0 gap-1 overflow-x-auto border-t bg-sidebar px-2 py-1.5 md:hidden',
        // Clears the home indicator on phones that have one, so the last row of links is not
        // sitting underneath it.
        'pb-[max(0.375rem,env(safe-area-inset-bottom))]',
      )}
    >
      {items.map(({ to, labelKey, icon: Icon }) => {
        const label = t(labelKey)
        return (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              cn(
                'flex min-w-18 flex-1 shrink-0 flex-col items-center justify-center gap-0.5 rounded-lg px-2 py-1.5',
                'text-xs font-medium transition-colors',
                'focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none',
                isActive
                  ? 'bg-primary/10 text-primary'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground',
              )
            }
          >
            {({ isActive }) => (
              <>
                <Icon className="size-5 shrink-0" aria-hidden="true" />
                {/* The label is always present, never icon-only: an icon alone is a guess, and
                  this is the only navigation available at this width. */}
                <span className="max-w-full truncate">{label}</span>
                {isActive && <span className="sr-only">(current page)</span>}
              </>
            )}
          </NavLink>
        )
      })}
    </nav>
  )
}
