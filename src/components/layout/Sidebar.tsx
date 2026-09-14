import { useTranslation } from '@/features/i18n/useTranslation'
import { useCallback, useState } from 'react'
import { NavLink } from 'react-router'
import { PanelLeftClose, PanelLeftOpen } from 'lucide-react'

import { navItemsForRole } from '@/components/layout/nav-items'
import {
  parseCollapsed,
  serializeCollapsed,
  SIDEBAR_STORAGE_KEY,
} from '@/components/layout/sidebar-state'
import { useAuth } from '@/features/auth/useAuth'
import { cn } from '@/lib/utils'

/**
 * localStorage access, wrapped because it throws outright in some contexts (a browser set to
 * block site data, a private window). Losing the preference is harmless — the sidebar simply
 * opens expanded — so every failure degrades to "show the labels".
 */
function readStoredCollapsed(): boolean {
  try {
    return parseCollapsed(window.localStorage.getItem(SIDEBAR_STORAGE_KEY))
  } catch {
    return false
  }
}

function writeStoredCollapsed(collapsed: boolean): void {
  try {
    window.localStorage.setItem(SIDEBAR_STORAGE_KEY, serializeCollapsed(collapsed))
  } catch {
    // Ignored: it still collapses for this page load, it just will not survive a refresh.
  }
}

/**
 * Desktop navigation, in full or as icons.
 *
 * Nav is filtered by role, so a staff account never sees the Admin link. That is presentation
 * only — RequireRole blocks the route, and firestore.rules blocks the data. Collapsing changes
 * none of it: the same items in the same order, with their labels moved into tooltips.
 *
 * **Below `md` this is not rendered at all** and `MobileNav` takes over as a bottom bar. The
 * collapse state is therefore a desktop-only concern and deliberately does not reach it — a
 * bottom bar has no room to collapse into, and a phone has no cursor to hover a tooltip with.
 *
 * The width is the whole mechanism: `main` is `flex-1`, so narrowing this column hands the
 * space straight to the page without either side knowing about the other.
 */
export function Sidebar() {
  const { role } = useAuth()
  const { t } = useTranslation()
  const items = navItemsForRole(role)
  const [collapsed, setCollapsed] = useState<boolean>(() => readStoredCollapsed())

  const toggle = useCallback(() => {
    setCollapsed((current) => {
      const next = !current
      writeStoredCollapsed(next)
      return next
    })
  }, [])

  return (
    <nav
      aria-label={t('nav.main')}
      data-collapsed={collapsed}
      className={cn(
        'sticky top-16 hidden h-[calc(100svh-4rem)] shrink-0 flex-col gap-1 self-start border-r bg-sidebar p-3 text-sidebar-foreground md:flex',
        'transition-[width] duration-200 ease-out',
        collapsed ? 'w-16 items-center' : 'w-56 lg:w-60',
      )}
    >
      {items.map(({ to, labelKey, icon: Icon }) => {
        const label = t(labelKey)
        return (
          <NavLink
            key={to}
            to={to}
            // The label is the accessible name whether or not it is painted on screen, so a
            // screen reader announces the same navigation in both states.
            aria-label={label}
            title={collapsed ? label : undefined}
            className={({ isActive }) =>
              cn(
                'group/nav relative flex h-touch items-center gap-3 rounded-lg text-base font-medium transition-colors',
                'hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none',
                collapsed ? 'w-touch justify-center px-0' : 'px-3',
                // The accent bar is the addition: the filled pill alone reads as "a button",
                // and at a glance in a busy kitchen it was not obvious WHICH section was
                // open. A bar hard against the sidebar edge is the one shape nothing else in
                // this column uses. It is drawn with a pseudo-element so it costs no node and
                // survives the collapsed width, where the pill shrinks to a square.
                'before:absolute before:top-1/2 before:-left-3 before:h-6 before:w-1 before:-translate-y-1/2 before:rounded-r-full before:transition-colors',
                isActive
                  ? 'bg-primary text-primary-foreground shadow-xs before:bg-primary hover:bg-primary/90'
                  : 'text-muted-foreground before:bg-transparent hover:text-foreground',
              )
            }
          >
            {({ isActive }) => (
              <>
                <Icon className="size-5 shrink-0" aria-hidden="true" />
                {collapsed ? (
                  <>
                    {/*
                     * The tooltip. Shown on hover AND on keyboard focus — a tooltip that only
                     * answers a mouse leaves a keyboard user with a column of anonymous icons.
                     * `aria-hidden` because the link already carries the same text as its
                     * accessible name, and announcing it twice helps nobody.
                     */}
                    <span
                      role="tooltip"
                      aria-hidden="true"
                      className={cn(
                        'pointer-events-none absolute left-full z-40 ml-2 rounded-md bg-popover px-2 py-1 text-sm whitespace-nowrap text-popover-foreground opacity-0 shadow-md ring-1 ring-foreground/10',
                        'transition-opacity duration-100 group-hover/nav:opacity-100 group-focus-visible/nav:opacity-100',
                      )}
                    >
                      {label}
                    </span>
                    {isActive && <span className="sr-only">(current page)</span>}
                  </>
                ) : (
                  <>
                    <span className="truncate">{label}</span>
                    {isActive && <span className="sr-only">(current page)</span>}
                  </>
                )}
              </>
            )}
          </NavLink>
        )
      })}

      {/* Pinned to the bottom, out of the way of the navigation it controls. */}
      <button
        type="button"
        onClick={toggle}
        data-testid="sidebar-toggle"
        aria-expanded={!collapsed}
        aria-label={collapsed ? t('nav.expandSidebar') : t('nav.collapseSidebar')}
        className={cn(
          'mt-auto flex h-touch items-center gap-3 rounded-lg text-sm font-medium text-muted-foreground transition-colors',
          'hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none',
          collapsed ? 'w-touch justify-center px-0' : 'px-3',
        )}
      >
        {collapsed ? (
          <PanelLeftOpen className="size-5 shrink-0" aria-hidden="true" />
        ) : (
          <PanelLeftClose className="size-5 shrink-0" aria-hidden="true" />
        )}
        {!collapsed && <span className="truncate">{t('common.collapse')}</span>}
      </button>
    </nav>
  )
}
